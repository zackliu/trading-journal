import type { Db } from '../db';
import type { Annotation, AnnotationHit, Result, Tag } from '../../shared/domain';
import { getResultDimensionType } from './resultDimensions';

interface AnnotationRow {
  id: string;
  entry_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  links: string;
}

interface TagRow {
  group: string;
  value: string;
}

interface ResultRow {
  dimension_id: string;
  string_value: string | null;
  number_value: number | null;
}

/**
 * Replace this entry's annotation projection (annotations + annotation_tags +
 * annotation_results) with the given annotations. Called inside the Entry Store's
 * write transaction so the index stays in sync with the durable Entry.
 *
 * A result value is stored in the column matching its dimension's declared type;
 * an undefined dimension or a type mismatch fails fast (the model must be explicit).
 */
export function projectEntryAnnotations(db: Db, entryId: string, annotations: Annotation[]): void {
  // Deleting the annotation rows cascades to annotation_tags / annotation_results.
  db.prepare('DELETE FROM annotations WHERE entry_id = ?').run(entryId);

  const insAnnotation = db.prepare(
    'INSERT INTO annotations (id, entry_id, x, y, width, height, links) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insTag = db.prepare(
    'INSERT OR IGNORE INTO annotation_tags (annotation_id, entry_id, "group", value) VALUES (?, ?, ?, ?)',
  );
  const insNumber = db.prepare(
    'INSERT INTO annotation_results (annotation_id, entry_id, dimension_id, string_value, number_value) VALUES (?, ?, ?, NULL, ?)',
  );
  const insString = db.prepare(
    'INSERT INTO annotation_results (annotation_id, entry_id, dimension_id, string_value, number_value) VALUES (?, ?, ?, ?, NULL)',
  );

  for (const annotation of annotations) {
    insAnnotation.run(
      annotation.id,
      entryId,
      annotation.bounds.x,
      annotation.bounds.y,
      annotation.bounds.width,
      annotation.bounds.height,
      JSON.stringify(annotation.links ?? []),
    );

    for (const tag of annotation.tags) {
      insTag.run(annotation.id, entryId, tag.group, tag.value);
    }

    if (annotation.result) {
      for (const [dimensionId, value] of Object.entries(annotation.result)) {
        const type = getResultDimensionType(db, dimensionId);
        if (!type) {
          throw new Error(`result dimension not defined: ${dimensionId}`);
        }
        if (type === 'number') {
          if (typeof value !== 'number') {
            throw new Error(`result dimension "${dimensionId}" expects a number`);
          }
          insNumber.run(annotation.id, entryId, dimensionId, value);
        } else {
          if (typeof value !== 'string') {
            throw new Error(`result dimension "${dimensionId}" expects a string`);
          }
          insString.run(annotation.id, entryId, dimensionId, value);
        }
      }
    }
  }
}

export function queryAnnotationsByTag(db: Db, tag: Tag): AnnotationHit[] {
  const rows = db
    .prepare(
      'SELECT a.id, a.entry_id, a.x, a.y, a.width, a.height, a.links FROM annotations a ' +
        'JOIN annotation_tags t ON t.annotation_id = a.id ' +
        'WHERE t."group" = ? AND t.value = ? ORDER BY a.id',
    )
    .all(tag.group, tag.value) as AnnotationRow[];

  return rows.map((row) => ({
    annotationId: row.id,
    entryId: row.entry_id,
    bounds: { x: row.x, y: row.y, width: row.width, height: row.height },
    tags: readAnnotationTags(db, row.id),
    result: readAnnotationResult(db, row.id),
    links: JSON.parse(row.links) as string[],
  }));
}

export function readAnnotationTags(db: Db, annotationId: string): Tag[] {
  const rows = db
    .prepare('SELECT "group", value FROM annotation_tags WHERE annotation_id = ? ORDER BY "group", value')
    .all(annotationId) as TagRow[];
  return rows.map((row) => ({ group: row.group, value: row.value }));
}

export function readAnnotationResult(db: Db, annotationId: string): Result | undefined {
  const rows = db
    .prepare('SELECT dimension_id, string_value, number_value FROM annotation_results WHERE annotation_id = ?')
    .all(annotationId) as ResultRow[];
  if (rows.length === 0) return undefined;

  const result: Result = {};
  for (const row of rows) {
    result[row.dimension_id] = row.number_value !== null ? row.number_value : (row.string_value as string);
  }
  return result;
}
