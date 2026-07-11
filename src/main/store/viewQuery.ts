import type { Db } from '../db';
import type { EntrySummary, ViewQuery } from '../../shared/domain';
import { entryIdsForTag } from './tagQuery';
import { summariesForIds } from './entryStore';
import { runViewQuery } from './viewMatcher';

export { runViewQuery } from './viewMatcher';

// The Slice 7 query engine. A ViewQuery has two dimensions, both read only from the denormalized
// index (entry_tags / annotation_tags / annotation_results) — never the canvas JSON:
//   - Entry dimension:      each predicate must EXIST at the entry level; AND across predicates.
//   - Annotation dimension: all tag + result predicates must CO-OCCUR on ONE annotation.
// An Entry matches when the entry dimension holds AND ≥1 annotation satisfies the annotation
// dimension. A group's level is chosen per view (which array it lands in), not declared on the group.

/** Newest-first summaries for the entries a ViewQuery matches — the gallery read. */
export function queryEntriesByView(db: Db, query: ViewQuery): EntrySummary[] {
  return summariesForIds(
    db,
    runViewQuery(db, query).map((m) => m.entryId),
  );
}

/**
 * Context-sensitive counts: for each registry value of `groupId`, how many of the ViewQuery's matched
 * entries also carry that value (entry-level ∪ annotation-level, matching the pivot's union semantics).
 */
export function countGroupValuesUnderView(
  db: Db,
  query: ViewQuery,
  groupId: string,
): Array<{ value: string; count: number }> {
  const matched = new Set(runViewQuery(db, query).map((m) => m.entryId));
  const values = db
    .prepare('SELECT value FROM tag_values WHERE group_id = ? ORDER BY sort, rowid')
    .all(groupId) as Array<{ value: string }>;
  return values.map(({ value }) => {
    let count = 0;
    for (const id of entryIdsForTag(db, groupId, value)) if (matched.has(id)) count += 1;
    return { value, count };
  });
}
