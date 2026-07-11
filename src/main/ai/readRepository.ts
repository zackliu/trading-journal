import type { Db } from '../db';
import type {
  AiAnnotationContext,
  AiEntryContext,
  AiEntrySearchQuery,
  AiEntrySummary,
  AiJournalOverview,
  AiLinkedContext,
  AiLinkedContextQuery,
  AiSampleSearchQuery,
  AiSampleSummary,
  AiVocabularyItem,
  AiVocabularyQuery,
} from '../../shared/aiAccess';
import type { Result, Tag, ViewQuery } from '../../shared/domain';
import { viewQuerySchema } from '../store/validation';
import { runViewQuery } from '../store/viewMatcher';

interface EntryRow {
  id: string;
  canvas_json: string;
  created_at: number;
  updated_at: number;
}

interface AnnotationRow {
  id: string;
  entry_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  links: string;
}

interface ResultRow {
  dimension_id: string;
  string_value: string | null;
  number_value: number | null;
}

const EMPTY_QUERY: ViewQuery = { entry: [], annotation: [], results: [] };
const MAX_CANVAS_JSON_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_OBJECTS = 500;
const MAX_TOTAL_TEXT = 32_000;

export class AiReadRepository {
  constructor(
    private readonly database: Db,
    private readonly journalInstanceId: string,
    private readonly appVersion: string,
  ) {}

  overview(): AiJournalOverview {
    const count = (table: string): number =>
      (this.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    const dates = this.database
      .prepare('SELECT MIN(value) AS min, MAX(value) AS max FROM entry_tags WHERE "group" = ?')
      .get('date') as { min: string | null; max: string | null };
    return {
      journalInstanceId: this.journalInstanceId,
      appVersion: this.appVersion,
      schemaVersion: this.database.pragma('user_version', { simple: true }) as number,
      entryCount: count('entries'),
      annotationCount: count('annotations'),
      dateRange: dates.min && dates.max ? { from: dates.min, to: dates.max } : null,
      groupCount: count('tag_groups'),
      resultDimensionCount: count('result_dimensions'),
      savedViewCount: count('saved_views'),
      agentGuideResource: 'trading-journal://agent-guide/current',
    };
  }

  listVocabulary(query: AiVocabularyQuery): AiVocabularyItem[] {
    if (query.kind === 'groups') return this.listGroupVocabulary(query.includeArchived === true);
    if (query.kind === 'results') return this.listResultVocabulary(query.includeArchived === true);
    return this.listSavedViews();
  }

  searchEntries(input: AiEntrySearchQuery): AiEntrySummary[] {
    const query = this.resolveViewQuery(input.query, input.savedViewId);
    const matches = runViewQuery(this.database, query);
    const matchMap = new Map(matches.map((match) => [match.entryId, match.annotationIds]));
    const rows = this.database
      .prepare('SELECT id, canvas_json, created_at, updated_at FROM entries')
      .all() as EntryRow[];
    const items = rows
      .filter((row) => matchMap.has(row.id))
      .map((row) => {
        const effectiveDate = this.effectiveDate(row.id, row.created_at);
        return {
          entryId: row.id,
          effectiveDate,
          entryTags: this.entryTags(row.id),
          matchingAnnotationIds: matchMap.get(row.id) ?? [],
          contextResource: this.entryContextUri(row.id, row.updated_at),
          createdAt: row.created_at,
        };
      })
      .filter((item) => !input.dateRange || (item.effectiveDate >= input.dateRange.from && item.effectiveDate <= input.dateRange.to));
    const oldestFirst = input.sort === 'oldest';
    items.sort((left, right) => {
      const ascending =
        left.effectiveDate.localeCompare(right.effectiveDate) ||
        left.createdAt - right.createdAt ||
        left.entryId.localeCompare(right.entryId);
      return oldestFirst ? ascending : -ascending;
    });
    return items.map((item) => ({
      entryId: item.entryId,
      effectiveDate: item.effectiveDate,
      entryTags: item.entryTags,
      matchingAnnotationIds: item.matchingAnnotationIds,
      contextResource: item.contextResource,
    }));
  }

  searchSamples(input: AiSampleSearchQuery): AiSampleSummary[] {
    const matches = runViewQuery(this.database, input.query);
    const entryIds = new Set(matches.map((match) => match.entryId));
    const annotationIds = new Set(matches.flatMap((match) => match.annotationIds));
    const hasAnnotationDimension = input.query.annotation.length > 0 || input.query.results.length > 0;
    const entryRows = this.database
      .prepare('SELECT id, canvas_json, created_at, updated_at FROM entries')
      .all() as EntryRow[];
    const entries = new Map(entryRows.map((row) => [row.id, row]));
    const rows = this.database
      .prepare('SELECT id, entry_id, x, y, width, height, links FROM annotations ORDER BY id')
      .all() as AnnotationRow[];
    const items = rows
      .filter((row) => entryIds.has(row.entry_id) && (!hasAnnotationDimension || annotationIds.has(row.id)))
      .map((row) => {
        const entry = entries.get(row.entry_id);
        if (!entry) throw new Error(`annotation references missing entry: ${row.id}`);
        const effectiveDate = this.effectiveDate(entry.id, entry.created_at);
        return {
          ...this.annotationSummary(row, effectiveDate, entry.updated_at),
          createdAt: entry.created_at,
        };
      })
      .filter((item) => !input.dateRange || (item.effectiveDate >= input.dateRange.from && item.effectiveDate <= input.dateRange.to));
    const oldestFirst = input.sort === 'oldest';
    items.sort((left, right) => {
      const ascending =
        left.effectiveDate.localeCompare(right.effectiveDate) ||
        left.createdAt - right.createdAt ||
        left.annotationId.localeCompare(right.annotationId);
      return oldestFirst ? ascending : -ascending;
    });
    return items.map((item) => ({
      annotationId: item.annotationId,
      entryId: item.entryId,
      effectiveDate: item.effectiveDate,
      bounds: item.bounds,
      tags: item.tags,
      result: item.result,
      links: item.links,
      contextResource: item.contextResource,
    }));
  }

  entryContext(entryId: string, expectedUpdatedAt?: number): AiEntryContext {
    const entry = this.entryRow(entryId);
    if (expectedUpdatedAt !== undefined && entry.updated_at !== expectedUpdatedAt) {
      throw new Error('Entry context revision expired');
    }
    const text = extractCanvasText(entry.canvas_json);
    const rows = this.database
      .prepare('SELECT id, entry_id, x, y, width, height, links FROM annotations WHERE entry_id = ? ORDER BY id')
      .all(entryId) as AnnotationRow[];
    const effectiveDate = this.effectiveDate(entry.id, entry.created_at);
    const annotations = rows.map((row) => {
      const annotationText = text.byAnnotation.get(row.id);
      return {
        ...this.annotationSummary(row, effectiveDate, entry.updated_at),
        text: annotationText,
        textTrust: annotationText === undefined ? undefined : ('untrusted-journal-evidence' as const),
      };
    });
    return {
      entryId,
      effectiveDate,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      entryTags: this.entryTags(entryId),
      title: text.title,
      annotations,
      visualEvidenceTool: 'get_visual_evidence',
      evidenceTrust: 'untrusted-journal-evidence',
    };
  }

  linkedContext(input: AiLinkedContextQuery): AiLinkedContext {
    const maxDepth = input.depth ?? 1;
    const maxNodes = 100;
    const queue: Array<{ id: string; depth: number }> = [{ id: input.annotationId, depth: 0 }];
    const visited = new Set<string>();
    const nodes: AiAnnotationContext[] = [];
    const edges: AiLinkedContext['edges'] = [];
    let truncated = false;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || visited.has(current.id)) continue;
      if (nodes.length >= maxNodes) {
        truncated = true;
        break;
      }
      const row = this.annotationRow(current.id);
      if (!row) {
        if (current.depth === 0) throw new Error(`annotation not found: ${current.id}`);
        continue;
      }
      visited.add(row.id);
      const entry = this.entryRow(row.entry_id);
      const text = extractCanvasText(entry.canvas_json).byAnnotation.get(row.id);
      const node = { ...this.annotationSummary(row, this.effectiveDate(entry.id, entry.created_at), entry.updated_at), text };
      nodes.push(node);
      if (current.depth >= maxDepth) continue;
      for (const target of node.links) {
        const exists = this.annotationRow(target) !== null;
        edges.push({ from: row.id, to: target, broken: !exists });
        if (exists && !visited.has(target)) queue.push({ id: target, depth: current.depth + 1 });
      }
    }
    return { nodes, edges, truncated };
  }

  private resolveViewQuery(query?: ViewQuery, savedViewId?: string): ViewQuery {
    if (query) return query;
    if (!savedViewId) return EMPTY_QUERY;
    const row = this.database.prepare('SELECT query_json FROM saved_views WHERE id = ?').get(savedViewId) as
      | { query_json: string }
      | undefined;
    if (!row) throw new Error(`saved view not found: ${savedViewId}`);
    return viewQuerySchema.parse(JSON.parse(row.query_json) as unknown);
  }

  private listGroupVocabulary(includeArchived: boolean): AiVocabularyItem[] {
    const groups = this.database
      .prepare(`SELECT id, label, archived FROM tag_groups ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort, rowid`)
      .all() as Array<{ id: string; label: string; archived: number }>;
    const values = this.database
      .prepare(
        `SELECT group_id, value, label, archived FROM tag_values ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort, rowid`,
      )
      .all() as Array<{ group_id: string; value: string; label: string | null; archived: number }>;
    return [
      ...groups.map((group) => ({
        id: group.id,
        label: group.label,
        kind: 'group' as const,
        archived: group.archived !== 0,
      })),
      ...values.map((value) => ({
        id: `${value.group_id}:${value.value}`,
        parentId: value.group_id,
        label: value.label ?? value.value,
        kind: 'tag-value' as const,
        archived: value.archived !== 0,
        usageCount: this.tagUsageCount(value.group_id, value.value),
      })),
    ];
  }

  private listResultVocabulary(includeArchived: boolean): AiVocabularyItem[] {
    const dimensions = this.database
      .prepare(
        `SELECT id, label, type, archived FROM result_dimensions ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY rowid`,
      )
      .all() as Array<{ id: string; label: string; type: 'string' | 'number'; archived: number }>;
    const values = this.database
      .prepare(
        `SELECT dimension_id, value, label, archived FROM result_dimension_values ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort, rowid`,
      )
      .all() as Array<{ dimension_id: string; value: string; label: string | null; archived: number }>;
    return [
      ...dimensions.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        kind: 'result-dimension' as const,
        valueType: dimension.type,
        archived: dimension.archived !== 0,
        usageCount: this.resultUsageCount(dimension.id),
      })),
      ...values.map((value) => ({
        id: `${value.dimension_id}:${value.value}`,
        parentId: value.dimension_id,
        label: value.label ?? value.value,
        kind: 'result-value' as const,
        archived: value.archived !== 0,
      })),
    ];
  }

  private listSavedViews(): AiVocabularyItem[] {
    const rows = this.database
      .prepare('SELECT id, name, query_json FROM saved_views ORDER BY created_at DESC, id DESC')
      .all() as Array<{ id: string; name: string; query_json: string }>;
    return rows.map((row) => ({
      id: row.id,
      label: row.name,
      kind: 'saved-view',
      archived: false,
      query: viewQuerySchema.parse(JSON.parse(row.query_json) as unknown),
    }));
  }

  private annotationSummary(row: AnnotationRow, effectiveDate: string, updatedAt: number): AiSampleSummary {
    return {
      annotationId: row.id,
      entryId: row.entry_id,
      effectiveDate,
      bounds: { x: row.x, y: row.y, width: row.width, height: row.height },
      tags: this.annotationTags(row.id),
      result: this.annotationResult(row.id),
      links: parseLinks(row.links),
      contextResource: this.entryContextUri(row.entry_id, updatedAt),
    };
  }

  private entryRow(entryId: string): EntryRow {
    const row = this.database
      .prepare('SELECT id, canvas_json, created_at, updated_at FROM entries WHERE id = ?')
      .get(entryId) as EntryRow | undefined;
    if (!row) throw new Error(`entry not found: ${entryId}`);
    return row;
  }

  private annotationRow(annotationId: string): AnnotationRow | null {
    return (
      (this.database
        .prepare('SELECT id, entry_id, x, y, width, height, links FROM annotations WHERE id = ?')
        .get(annotationId) as AnnotationRow | undefined) ?? null
    );
  }

  private entryTags(entryId: string): Tag[] {
    return (
      this.database
        .prepare('SELECT "group", value FROM entry_tags WHERE entry_id = ? ORDER BY "group", value')
        .all(entryId) as Array<{ group: string; value: string }>
    ).map((tag) => ({ group: tag.group, value: tag.value }));
  }

  private annotationTags(annotationId: string): Tag[] {
    return (
      this.database
        .prepare('SELECT "group", value FROM annotation_tags WHERE annotation_id = ? ORDER BY "group", value')
        .all(annotationId) as Array<{ group: string; value: string }>
    ).map((tag) => ({ group: tag.group, value: tag.value }));
  }

  private annotationResult(annotationId: string): Result | undefined {
    const rows = this.database
      .prepare('SELECT dimension_id, string_value, number_value FROM annotation_results WHERE annotation_id = ?')
      .all(annotationId) as ResultRow[];
    if (rows.length === 0) return undefined;
    const result: Result = {};
    for (const row of rows) result[row.dimension_id] = row.number_value ?? (row.string_value as string);
    return result;
  }

  private effectiveDate(entryId: string, createdAt: number): string {
    const row = this.database
      .prepare('SELECT value FROM entry_tags WHERE entry_id = ? AND "group" = ? ORDER BY value DESC LIMIT 1')
      .get(entryId, 'date') as { value: string } | undefined;
    return row?.value ?? localCalendarDate(createdAt);
  }

  private entryContextUri(entryId: string, updatedAt: number): string {
    return `trading-journal://journal/${this.journalInstanceId}/entries/${encodeURIComponent(entryId)}/context?rev=${updatedAt}`;
  }

  private tagUsageCount(group: string, value: string): number {
    const row = this.database
      .prepare(
        'SELECT COUNT(DISTINCT entry_id) AS count FROM (' +
          'SELECT entry_id FROM entry_tags WHERE "group" = ? AND value = ? UNION ' +
          'SELECT entry_id FROM annotation_tags WHERE "group" = ? AND value = ?)',
      )
      .get(group, value, group, value) as { count: number };
    return row.count;
  }

  private resultUsageCount(dimensionId: string): number {
    return (
      this.database
        .prepare('SELECT COUNT(DISTINCT entry_id) AS count FROM annotation_results WHERE dimension_id = ?')
        .get(dimensionId) as { count: number }
    ).count;
  }
}

function localCalendarDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLinks(raw: string): string[] {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string').slice(0, 100) : [];
}

function extractCanvasText(canvasJson: string): { title?: string; byAnnotation: Map<string, string> } {
  const byAnnotation = new Map<string, string>();
  if (Buffer.byteLength(canvasJson, 'utf8') > MAX_CANVAS_JSON_BYTES) return { byAnnotation };
  let parsed: unknown;
  try {
    parsed = JSON.parse(canvasJson) as unknown;
  } catch {
    return { byAnnotation };
  }
  let objectCount = 0;
  let totalText = 0;
  let title: string | undefined;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || objectCount >= MAX_TEXT_OBJECTS || totalText >= MAX_TOTAL_TEXT || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child, depth + 1);
      return;
    }
    objectCount += 1;
    const record = value as Record<string, unknown>;
    const text = typeof record.text === 'string' ? record.text.slice(0, 4_000) : undefined;
    if (text) {
      const allowed = text.slice(0, Math.max(0, MAX_TOTAL_TEXT - totalText));
      totalText += allowed.length;
      if (typeof record.tjId === 'string') byAnnotation.set(record.tjId, allowed);
      else if (!title) title = allowed;
    }
    if (Array.isArray(record.objects)) visit(record.objects, depth + 1);
  };
  visit(parsed, 0);
  return { title, byAnnotation };
}