import type { Db } from '../db';
import type {
  InternalLinkTarget,
  TextLinkSourceProjection,
  TextLinkSpan,
} from '../../shared/domain';
import { splitGraphemes } from '../../shared/graphemes';
import { normalizeTextLinkSpans } from '../../shared/textLinkSpans';

const MAX_CANVAS_BYTES = 16_000_000;
const MAX_CANVAS_NODES = 50_000;
const MAX_CANVAS_DEPTH = 100;

function parseTarget(value: unknown): InternalLinkTarget {
  if (!value || typeof value !== 'object') throw new Error('invalid text-link target');
  const candidate = value as Record<string, unknown>;
  if ((candidate.kind !== 'entry' && candidate.kind !== 'annotation') || typeof candidate.id !== 'string' || !candidate.id) {
    throw new Error('invalid text-link target');
  }
  return { kind: candidate.kind, id: candidate.id };
}

function parseSpans(value: unknown, text: string): TextLinkSpan[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('tjTextLinks must be an array');
  const spans = value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('invalid text-link span');
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.start !== 'number' || typeof candidate.end !== 'number') {
      throw new Error('invalid text-link span');
    }
    return { start: candidate.start, end: candidate.end, target: parseTarget(candidate.target) };
  });
  return normalizeTextLinkSpans(spans, splitGraphemes(text).length);
}

export function extractTextLinkProjection(
  canvasJson: string,
  entryId: string,
  annotationIds: ReadonlySet<string>,
): TextLinkSourceProjection[] {
  if (Buffer.byteLength(canvasJson, 'utf8') > MAX_CANVAS_BYTES) throw new Error('canvas JSON is too large');
  let root: unknown;
  try {
    root = JSON.parse(canvasJson) as unknown;
  } catch {
    throw new Error('canvas JSON is malformed');
  }

  const projections: TextLinkSourceProjection[] = [];
  const sourceKeys = new Set<string>();
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop() as { value: unknown; depth: number };
    visited += 1;
    if (visited > MAX_CANVAS_NODES || current.depth > MAX_CANVAS_DEPTH) throw new Error('canvas JSON is too complex');
    if (Array.isArray(current.value)) {
      for (const child of current.value) pending.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    const object = current.value as Record<string, unknown>;
    if (object.type === 'TextBoxAnnotation') {
      if (typeof object.text !== 'string') throw new Error('text annotation is missing text');
      const spans = parseSpans(object.tjTextLinks, object.text);
      if (object.tjRole === 'title') {
        const key = `entry-title:${entryId}`;
        if (sourceKeys.has(key)) throw new Error('duplicate Entry title source');
        sourceKeys.add(key);
        projections.push({ source: { kind: 'entry-title' }, text: object.text, textLinks: spans });
      } else if (typeof object.tjId === 'string' && object.tjId) {
        if (!annotationIds.has(object.tjId)) throw new Error(`text-link source is not in this Entry: ${object.tjId}`);
        const key = `annotation:${object.tjId}`;
        if (sourceKeys.has(key)) throw new Error(`duplicate text-link source: ${object.tjId}`);
        sourceKeys.add(key);
        projections.push({
          source: { kind: 'annotation', annotationId: object.tjId },
          text: object.text,
          textLinks: spans,
        });
      } else if (spans.length > 0) {
        throw new Error('text-link source has no annotation id');
      }
    }
    for (const child of Object.values(object)) pending.push({ value: child, depth: current.depth + 1 });
  }
  return projections;
}

export function projectEntryTextLinks(
  db: Db,
  entryId: string,
  canvasJson: string,
  annotationIds: ReadonlySet<string>,
): void {
  const projections = extractTextLinkProjection(canvasJson, entryId, annotationIds);
  db.prepare('DELETE FROM text_links WHERE source_entry_id = ?').run(entryId);
  const insert = db.prepare(`
    INSERT INTO text_links (
      source_entry_id, source_kind, source_object_id, start_grapheme, end_grapheme, target_kind, target_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const projection of projections) {
    const sourceKind = projection.source.kind;
    const sourceObjectId = sourceKind === 'entry-title' ? entryId : projection.source.annotationId;
    for (const span of projection.textLinks) {
      insert.run(entryId, sourceKind, sourceObjectId, span.start, span.end, span.target.kind, span.target.id);
    }
  }
}