import type { Db } from '../db';
import type { ArchivedResults, ResultDimension, ResultDimensionView, ResultValueType } from '../../shared/domain';

interface DimensionRow {
  id: string;
  label: string;
  type: ResultValueType;
}

interface ValueRow {
  value: string;
  label: string | null;
}

/**
 * Create or (re)declare a user-defined result dimension (`id` is the stable key). A dimension's storage
 * `type` is FIXED at creation and is never changed by a re-declare of the same id. Recorded results live
 * in the column matching that type (`string_value` / `number_value`), so flipping the type would strand
 * every existing result in the wrong column and make the next save of those annotations throw. Re-declaring
 * an existing id therefore only updates its display label and un-archives it; the original type is kept.
 */
export function upsertResultDimension(db: Db, dimension: ResultDimension): void {
  db.prepare(
    'INSERT INTO result_dimensions (id, label, type) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET label = excluded.label, archived = 0',
  ).run(dimension.id, dimension.label, dimension.type);
}

export function listResultDimensions(db: Db): ResultDimension[] {
  const rows = db
    .prepare('SELECT id, label, type FROM result_dimensions ORDER BY id')
    .all() as DimensionRow[];
  return rows.map((row) => ({ id: row.id, label: row.label, type: row.type }));
}

export function getResultDimensionType(db: Db, id: string): ResultValueType | null {
  const row = db.prepare('SELECT type FROM result_dimensions WHERE id = ?').get(id) as
    | { type: ResultValueType }
    | undefined;
  return row ? row.type : null;
}

/** Distinct string values recorded for a result dimension — the View builder's string-value picker. */
export function distinctResultValues(db: Db, dimensionId: string): string[] {
  const rows = db
    .prepare(
      'SELECT DISTINCT string_value AS v FROM annotation_results WHERE dimension_id = ? AND string_value IS NOT NULL ORDER BY v',
    )
    .all(dimensionId) as Array<{ v: string }>;
  return rows.map((r) => r.v);
}

/** Declare (or relabel) a preset value for a result dimension; new values append to the end. */
export function defineResultValue(db: Db, dimensionId: string, value: string, label?: string): void {
  db.prepare(
    'INSERT INTO result_dimension_values (dimension_id, value, label, sort) ' +
      'VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM result_dimension_values WHERE dimension_id = ?)) ' +
      'ON CONFLICT(dimension_id, value) DO UPDATE SET label = excluded.label, archived = 0',
  ).run(dimensionId, value, label ?? null, dimensionId);
}

/** Soft-delete a preset value: archive it (kept + restorable). Recorded results are untouched. */
export function deleteResultValue(db: Db, dimensionId: string, value: string): void {
  db.prepare('UPDATE result_dimension_values SET archived = 1 WHERE dimension_id = ? AND value = ?').run(
    dimensionId,
    value,
  );
}

/** Restore an archived preset value. */
export function restoreResultValue(db: Db, dimensionId: string, value: string): void {
  db.prepare('UPDATE result_dimension_values SET archived = 0 WHERE dimension_id = ? AND value = ?').run(
    dimensionId,
    value,
  );
}

/**
 * Soft-delete a result dimension: archive it (hidden from the Annotation editor + active Settings) but
 * keep the row — recorded results stay valid and it can be restored. Archiving (unlike a hard delete)
 * never breaks a later canvas save's “dimension defined” check.
 */
export function deleteResultDimension(db: Db, id: string): void {
  db.prepare('UPDATE result_dimensions SET archived = 1 WHERE id = ?').run(id);
}

/** Restore an archived result dimension. */
export function restoreResultDimension(db: Db, id: string): void {
  db.prepare('UPDATE result_dimensions SET archived = 0 WHERE id = ?').run(id);
}

/** Distinct reviews that recorded any value for a dimension (delete-confirm signal). */
function countEntriesForDimension(db: Db, dimensionId: string): number {
  const row = db
    .prepare('SELECT COUNT(DISTINCT entry_id) AS n FROM annotation_results WHERE dimension_id = ?')
    .get(dimensionId) as { n: number };
  return row.n;
}

/** Distinct reviews that recorded a specific string value for a dimension. */
function countEntriesForResultValue(db: Db, dimensionId: string, value: string): number {
  const row = db
    .prepare('SELECT COUNT(DISTINCT entry_id) AS n FROM annotation_results WHERE dimension_id = ? AND string_value = ?')
    .get(dimensionId, value) as { n: number };
  return row.n;
}

/** All result dimensions (active) with preset values + usage counts — the Result Settings + Annotation read. */
export function listResultVocabulary(db: Db): ResultDimensionView[] {
  const dims = db
    .prepare('SELECT id, label, type FROM result_dimensions WHERE archived = 0 ORDER BY id')
    .all() as DimensionRow[];
  const valsStmt = db.prepare(
    'SELECT value, label FROM result_dimension_values WHERE dimension_id = ? AND archived = 0 ORDER BY sort, rowid',
  );
  return dims.map((d) => ({
    id: d.id,
    label: d.label,
    type: d.type,
    count: countEntriesForDimension(db, d.id),
    values: (valsStmt.all(d.id) as ValueRow[]).map((r) => ({
      value: r.value,
      label: r.label ?? undefined,
      count: countEntriesForResultValue(db, d.id, r.value),
    })),
  }));
}

/** Archived dimensions + archived values (of still-active dimensions) — the Result Settings “Archived” section. */
export function listArchivedResults(db: Db): ArchivedResults {
  const dimensions = db
    .prepare('SELECT id, label FROM result_dimensions WHERE archived = 1 ORDER BY id')
    .all() as Array<{ id: string; label: string }>;
  const values = db
    .prepare(
      'SELECT rv.dimension_id AS dimensionId, rd.label AS dimensionLabel, rv.value AS value ' +
        'FROM result_dimension_values rv JOIN result_dimensions rd ON rd.id = rv.dimension_id ' +
        'WHERE rv.archived = 1 AND rd.archived = 0 ORDER BY rv.sort, rv.rowid',
    )
    .all() as Array<{ dimensionId: string; dimensionLabel: string; value: string }>;
  return { dimensions, values };
}
