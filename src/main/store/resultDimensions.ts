import type { Db } from '../db';
import type { ResultDimension, ResultValueType } from '../../shared/domain';

interface DimensionRow {
  id: string;
  label: string;
  type: ResultValueType;
}

/** Create or update a user-defined result dimension (id is the stable key). */
export function upsertResultDimension(db: Db, dimension: ResultDimension): void {
  db.prepare(
    'INSERT INTO result_dimensions (id, label, type) VALUES (?, ?, ?) ' +
      'ON CONFLICT(id) DO UPDATE SET label = excluded.label, type = excluded.type',
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
