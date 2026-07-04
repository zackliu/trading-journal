import type { Db } from '../db';

// Browse reads: an Entry belongs to a `group:value` bucket if it carries the tag at the ENTRY level
// OR on any of its ANNOTATIONS (union). Both reads hit only the denormalized index tables
// (entry_tags / annotation_tags) — never the canvas JSON. `UNION` deduplicates entry ids.

/** Distinct entry ids carrying `group:value` at entry level or on any annotation. */
export function entryIdsForTag(db: Db, group: string, value: string): string[] {
  const rows = db
    .prepare(
      'SELECT entry_id FROM entry_tags WHERE "group" = ? AND value = ? ' +
        'UNION SELECT entry_id FROM annotation_tags WHERE "group" = ? AND value = ?',
    )
    .all(group, value, group, value) as Array<{ entry_id: string }>;
  return rows.map((row) => row.entry_id);
}

/** Count of distinct entries carrying `group:value` (entry-level ∪ annotation-level). */
export function countEntriesForTag(db: Db, group: string, value: string): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) AS n FROM (' +
        'SELECT entry_id FROM entry_tags WHERE "group" = ? AND value = ? ' +
        'UNION SELECT entry_id FROM annotation_tags WHERE "group" = ? AND value = ?)',
    )
    .get(group, value, group, value) as { n: number };
  return row.n;
}
