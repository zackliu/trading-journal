import type { Db } from '../db';
import type {
  AiEntryContext,
  AiEntrySearchQuery,
  AiEntrySummary,
  AiJournalOverview,
  AiLinkedContext,
  AiLinkedContextQuery,
  AiResultDimensionSummary,
  AiSampleSearchQuery,
  AiSampleStudy,
  AiSampleStudyQuery,
  AiSampleSummary,
  AiStudySample,
  AiVocabularyItem,
  AiVocabularyQuery,
} from '../../shared/aiAccess';
import type { InternalLinkTarget, Result, Tag, TextLinkSpan, ViewQuery } from '../../shared/domain';
import { splitGraphemes } from '../../shared/graphemes';
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
}

interface TextLinkRow {
  source_entry_id: string;
  source_kind: 'entry-title' | 'annotation';
  source_object_id: string;
  start_grapheme: number;
  end_grapheme: number;
  target_kind: 'entry' | 'annotation';
  target_id: string;
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
      .prepare('SELECT id, entry_id, x, y, width, height FROM annotations ORDER BY id')
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
      contextResource: item.contextResource,
    }));
  }

  prepareSampleStudy(input: AiSampleStudyQuery): AiSampleStudy {
    const population = this.searchSamples({
      query: input.query,
      dateRange: input.dateRange,
      sort: input.sort,
    });
    const maxSamples = input.maxSamples ?? 200;
    const selected = population.slice(0, maxSamples);
    const nearbyTextLimit = input.nearbyTextLimitPerEntry ?? 6;
    const requestedDimensions = input.resultDimensions?.length
      ? [...new Set(input.resultDimensions)]
      : [...new Set(population.flatMap((sample) => Object.keys(sample.result ?? {})))];
    const resultDimensions = requestedDimensions.map((dimensionId) =>
      this.summarizeResultDimension(dimensionId, population),
    );
    const selectedByEntry = new Map<string, AiSampleSummary[]>();
    for (const sample of selected) {
      const list = selectedByEntry.get(sample.entryId);
      if (list) list.push(sample);
      else selectedByEntry.set(sample.entryId, [sample]);
    }
    const entries = [...selectedByEntry.entries()].map(([entryId, samples]) => {
      const context = this.entryContext(entryId);
      const contextById = new Map(context.annotations.map((annotation) => [annotation.annotationId, annotation]));
      const studySamples: AiStudySample[] = samples.map((sample) => {
        const annotationText = contextById.get(sample.annotationId)?.text;
        return {
          ...sample,
          text: annotationText,
          textTrust: annotationText === undefined ? undefined : 'untrusted-journal-evidence',
        };
      });
      const sampleIds = new Set(samples.map((sample) => sample.annotationId));
      const nearbyTexts = context.annotations
        .filter((annotation) => annotation.text && !sampleIds.has(annotation.annotationId))
        .map((annotation) => {
          const nearest = nearestSample(annotation.bounds, samples);
          return {
            annotationId: annotation.annotationId,
            text: annotation.text!,
            bounds: annotation.bounds,
            nearestSampleAnnotationId: nearest.sample.annotationId,
            distancePx: nearest.distance,
            evidenceTrust: 'untrusted-journal-evidence' as const,
          };
        })
        .sort((left, right) => left.distancePx - right.distancePx || left.annotationId.localeCompare(right.annotationId))
        .slice(0, nearbyTextLimit);
      return {
        entryId,
        effectiveDate: context.effectiveDate,
        title: context.title,
        entryTags: context.entryTags,
        samples: studySamples,
        nearbyTexts,
        contextResource: samples[0].contextResource,
      };
    });
    return {
      query: input.query,
      dateRange: input.dateRange,
      snapshotAt: new Date().toISOString(),
      populationSampleCount: population.length,
      distinctEntryCount: new Set(population.map((sample) => sample.entryId)).size,
      returnedSampleCount: selected.length,
      truncated: selected.length < population.length,
      narrowQueryHint:
        selected.length < population.length
          ? `Returned the first ${selected.length} of ${population.length} samples; narrow by date/tag/result or increase maxSamples.`
          : undefined,
      resultDimensions,
      entries,
      visualBatches: packVisualBatches(entries.map((entry) => ({
        entryId: entry.entryId,
        annotationIds: entry.samples.map((sample) => sample.annotationId),
      }))),
      evidenceTrust: 'untrusted-journal-evidence',
    };
  }

  entryContext(entryId: string, expectedUpdatedAt?: number): AiEntryContext {
    const entry = this.entryRow(entryId);
    if (expectedUpdatedAt !== undefined && entry.updated_at !== expectedUpdatedAt) {
      throw new Error('Entry context revision expired');
    }
    const text = extractCanvasText(entry.canvas_json);
    const rows = this.database
      .prepare('SELECT id, entry_id, x, y, width, height FROM annotations WHERE entry_id = ? ORDER BY id')
      .all(entryId) as AnnotationRow[];
    const effectiveDate = this.effectiveDate(entry.id, entry.created_at);
    const textLinks = this.textLinksForEntry(entryId);
    const annotations = rows.map((row) => {
      const annotationText = text.byAnnotation.get(row.id);
      return {
        ...this.annotationSummary(row, effectiveDate, entry.updated_at),
        text: annotationText,
        textTrust: annotationText === undefined ? undefined : ('untrusted-journal-evidence' as const),
        textLinks: textLinks.get(`annotation:${row.id}`) ?? [],
      };
    });
    return {
      entryId,
      effectiveDate,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      entryTags: this.entryTags(entryId),
      title: text.title,
      titleTextLinks: textLinks.get(`entry-title:${entryId}`) ?? [],
      annotations,
      visualEvidenceTool: 'get_visual_evidence',
      evidenceTrust: 'untrusted-journal-evidence',
    };
  }

  linkedContext(input: AiLinkedContextQuery): AiLinkedContext {
    const maxDepth = input.depth ?? 1;
    const maxNodes = 100;
    const maxEdges = 200;
    const queue: Array<{ target: InternalLinkTarget; depth: number }> = [{ target: input.target, depth: 0 }];
    const visited = new Set<string>();
    const nodes: AiLinkedContext['nodes'] = [];
    const edges: AiLinkedContext['edges'] = [];
    const edgeKeys = new Set<string>();
    const textCache = new Map<string, ReturnType<typeof extractCanvasText>>();
    let truncated = false;

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const currentKey = targetKey(current.target);
      if (visited.has(currentKey)) continue;
      if (nodes.length >= maxNodes) {
        truncated = true;
        break;
      }
      const node = this.linkedNode(current.target);
      if (!node) {
        if (current.depth === 0) throw new Error(`${current.target.kind} not found: ${current.target.id}`);
        continue;
      }
      visited.add(currentKey);
      nodes.push(node);
      if (current.depth >= maxDepth) continue;

      for (const row of this.incidentTextLinks(current.target)) {
        const source = textLinkSource(row);
        const target: InternalLinkTarget = { kind: row.target_kind, id: row.target_id };
        const edgeKey = [
          targetKey(source),
          row.start_grapheme,
          row.end_grapheme,
          targetKey(target),
        ].join('|');
        if (!edgeKeys.has(edgeKey)) {
          if (edges.length >= maxEdges) {
            truncated = true;
            continue;
          }
          edgeKeys.add(edgeKey);
          edges.push({
            source,
            target,
            start: row.start_grapheme,
            end: row.end_grapheme,
            displayText: this.textLinkDisplayText(row, textCache),
            broken: !this.internalTargetExists(target),
          });
        }
        for (const neighbor of [source, target]) {
          if (!visited.has(targetKey(neighbor)) && this.internalTargetExists(neighbor)) {
            queue.push({ target: neighbor, depth: current.depth + 1 });
          }
        }
      }
    }
    return { nodes, edges, truncated };
  }

  private linkedNode(target: InternalLinkTarget): AiLinkedContext['nodes'][number] | null {
    if (target.kind === 'entry') {
      const entry = this.database
        .prepare('SELECT id, canvas_json, created_at, updated_at FROM entries WHERE id = ?')
        .get(target.id) as EntryRow | undefined;
      if (!entry) return null;
      return {
        target: { ...target },
        entryId: entry.id,
        effectiveDate: this.effectiveDate(entry.id, entry.created_at),
        title: extractCanvasText(entry.canvas_json).title,
        entryTags: this.entryTags(entry.id),
      };
    }
    const annotation = this.annotationRow(target.id);
    if (!annotation) return null;
    const entry = this.entryRow(annotation.entry_id);
    const text = extractCanvasText(entry.canvas_json).byAnnotation.get(annotation.id);
    return {
      target: { ...target },
      entryId: entry.id,
      effectiveDate: this.effectiveDate(entry.id, entry.created_at),
      bounds: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
      tags: this.annotationTags(annotation.id),
      result: this.annotationResult(annotation.id),
      text,
      textLinks: this.textLinksForEntry(entry.id).get(`annotation:${annotation.id}`) ?? [],
    };
  }

  private incidentTextLinks(target: InternalLinkTarget): TextLinkRow[] {
    const outgoing =
      target.kind === 'entry'
        ? (this.database
            .prepare(
              "SELECT * FROM text_links WHERE source_kind = 'entry-title' AND source_entry_id = ? AND source_object_id = ?",
            )
            .all(target.id, target.id) as TextLinkRow[])
        : (this.database
            .prepare("SELECT * FROM text_links WHERE source_kind = 'annotation' AND source_object_id = ?")
            .all(target.id) as TextLinkRow[]);
    const incoming = this.database
      .prepare('SELECT * FROM text_links WHERE target_kind = ? AND target_id = ?')
      .all(target.kind, target.id) as TextLinkRow[];
    return [...outgoing, ...incoming];
  }

  private internalTargetExists(target: InternalLinkTarget): boolean {
    const table = target.kind === 'entry' ? 'entries' : 'annotations';
    return this.database.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(target.id) !== undefined;
  }

  private textLinkDisplayText(
    row: TextLinkRow,
    cache: Map<string, ReturnType<typeof extractCanvasText>>,
  ): string {
    let text = cache.get(row.source_entry_id);
    if (!text) {
      text = extractCanvasText(this.entryRow(row.source_entry_id).canvas_json);
      cache.set(row.source_entry_id, text);
    }
    const sourceText =
      row.source_kind === 'entry-title' ? text.title : text.byAnnotation.get(row.source_object_id);
    return sourceText ? splitGraphemes(sourceText).slice(row.start_grapheme, row.end_grapheme).join('') : '';
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
        ...this.tagUsageCounts(value.group_id, value.value),
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
        .prepare('SELECT id, entry_id, x, y, width, height FROM annotations WHERE id = ?')
        .get(annotationId) as AnnotationRow | undefined) ?? null
    );
  }

  private textLinksForEntry(entryId: string): Map<string, TextLinkSpan[]> {
    const rows = this.database
      .prepare(
        'SELECT source_entry_id, source_kind, source_object_id, start_grapheme, end_grapheme, target_kind, target_id ' +
          'FROM text_links WHERE source_entry_id = ? ORDER BY source_kind, source_object_id, start_grapheme',
      )
      .all(entryId) as TextLinkRow[];
    const bySource = new Map<string, TextLinkSpan[]>();
    for (const row of rows) {
      const key = `${row.source_kind}:${row.source_object_id}`;
      const list = bySource.get(key) ?? [];
      list.push({
        start: row.start_grapheme,
        end: row.end_grapheme,
        target: { kind: row.target_kind, id: row.target_id },
      });
      bySource.set(key, list);
    }
    return bySource;
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

  private tagUsageCounts(group: string, value: string): Pick<
    AiVocabularyItem,
    'usageCount' | 'entryUsageCount' | 'annotationUsageCount' | 'annotationEntryUsageCount'
  > {
    const usageCount = this.database
      .prepare(
        'SELECT COUNT(DISTINCT entry_id) AS count FROM (' +
          'SELECT entry_id FROM entry_tags WHERE "group" = ? AND value = ? UNION ' +
          'SELECT entry_id FROM annotation_tags WHERE "group" = ? AND value = ?)',
      )
      .get(group, value, group, value) as { count: number };
    const entryUsageCount = this.database
      .prepare('SELECT COUNT(DISTINCT entry_id) AS count FROM entry_tags WHERE "group" = ? AND value = ?')
      .get(group, value) as { count: number };
    const annotationUsage = this.database
      .prepare(
        'SELECT COUNT(*) AS annotation_count, COUNT(DISTINCT entry_id) AS entry_count ' +
          'FROM annotation_tags WHERE "group" = ? AND value = ?',
      )
      .get(group, value) as { annotation_count: number; entry_count: number };
    return {
      usageCount: usageCount.count,
      entryUsageCount: entryUsageCount.count,
      annotationUsageCount: annotationUsage.annotation_count,
      annotationEntryUsageCount: annotationUsage.entry_count,
    };
  }

  private summarizeResultDimension(
    dimensionId: string,
    population: AiSampleSummary[],
  ): AiResultDimensionSummary {
    const definition = this.database
      .prepare('SELECT label, type FROM result_dimensions WHERE id = ?')
      .get(dimensionId) as { label: string; type: 'string' | 'number' } | undefined;
    if (!definition) throw new Error(`result dimension not found: ${dimensionId}`);
    const values = population
      .map((sample) => sample.result?.[dimensionId])
      .filter((value): value is string | number => value !== undefined);
    const base = {
      id: dimensionId,
      label: definition.label,
      type: definition.type,
      populationCount: population.length,
      recordedCount: values.length,
      missingCount: population.length - values.length,
    };
    if (definition.type === 'string') {
      const counts = new Map<string, number>();
      for (const value of values) {
        if (typeof value !== 'string') continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      const recorded = [...counts.values()].reduce((total, count) => total + count, 0);
      return {
        ...base,
        stringValues: [...counts.entries()]
          .map(([value, count]) => ({ value, count, rate: recorded === 0 ? 0 : count / recorded }))
          .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)),
      };
    }
    const numbers = values.filter((value): value is number => typeof value === 'number');
    return {
      ...base,
      numberSummary:
        numbers.length === 0
          ? undefined
          : {
              min: Math.min(...numbers),
              max: Math.max(...numbers),
              mean: numbers.reduce((total, value) => total + value, 0) / numbers.length,
            },
    };
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

function targetKey(target: InternalLinkTarget): string {
  return `${target.kind}:${target.id}`;
}

function textLinkSource(row: TextLinkRow): InternalLinkTarget {
  return row.source_kind === 'entry-title'
    ? { kind: 'entry', id: row.source_entry_id }
    : { kind: 'annotation', id: row.source_object_id };
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

function nearestSample(bounds: { x: number; y: number; width: number; height: number }, samples: AiSampleSummary[]): {
  sample: AiSampleSummary;
  distance: number;
} {
  let nearest = samples[0];
  let distance = rectangleDistance(bounds, nearest.bounds);
  for (const sample of samples.slice(1)) {
    const candidate = rectangleDistance(bounds, sample.bounds);
    if (candidate < distance) {
      nearest = sample;
      distance = candidate;
    }
  }
  return { sample: nearest, distance: Number(distance.toFixed(2)) };
}

function rectangleDistance(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
): number {
  const dx = Math.max(left.x - (right.x + right.width), right.x - (left.x + left.width), 0);
  const dy = Math.max(left.y - (right.y + right.height), right.y - (left.y + left.height), 0);
  return Math.hypot(dx, dy);
}

function packVisualBatches(requests: Array<{ entryId: string; annotationIds: string[] }>): AiSampleStudy['visualBatches'] {
  const chunks = requests.flatMap((request) => {
    const result: Array<{ entryId: string; annotationIds: string[] }> = [];
    for (let index = 0; index < request.annotationIds.length; index += 8) {
      result.push({ entryId: request.entryId, annotationIds: request.annotationIds.slice(index, index + 8) });
    }
    return result;
  });
  const batches: AiSampleStudy['visualBatches'] = [];
  let current: AiSampleStudy['visualBatches'][number] = { requests: [], sampleCount: 0 };
  for (const request of chunks) {
    if (current.requests.length >= 4 || current.sampleCount + request.annotationIds.length > 8) {
      batches.push(current);
      current = { requests: [], sampleCount: 0 };
    }
    current.requests.push(request);
    current.sampleCount += request.annotationIds.length;
  }
  if (current.requests.length > 0) batches.push(current);
  return batches;
}