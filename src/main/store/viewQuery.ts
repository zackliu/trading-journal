import type { Db } from '../db';
import type { EntrySummary, ResultPredicate, TagPredicate, ViewMatch, ViewQuery } from '../../shared/domain';
import { entryIdsForTag } from './tagQuery';
import { summariesForIds } from './entryStore';

// The Slice 7 query engine. A ViewQuery has two dimensions, both read only from the denormalized
// index (entry_tags / annotation_tags / annotation_results) — never the canvas JSON:
//   - Entry dimension:      each predicate must EXIST at the entry level; AND across predicates.
//   - Annotation dimension: all tag + result predicates must CO-OCCUR on ONE annotation.
// An Entry matches when the entry dimension holds AND ≥1 annotation satisfies the annotation
// dimension. A group's level is chosen per view (which array it lands in), not declared on the group.

/** Evaluate a ViewQuery → each matched entry with the annotation ids that satisfied the annotation dimension. */
export function runViewQuery(db: Db, query: ViewQuery): ViewMatch[] {
  const entrySet = query.entry.length > 0 ? entriesMatchingEntryDim(db, query.entry) : null;
  const hasAnnotationDim = query.annotation.length > 0 || query.results.length > 0;

  if (hasAnnotationDim) {
    const byEntry = new Map<string, string[]>();
    for (const m of annotationsMatchingAnnotationDim(db, query.annotation, query.results)) {
      if (entrySet && !entrySet.has(m.entryId)) continue; // must also satisfy the entry dimension
      const list = byEntry.get(m.entryId);
      if (list) list.push(m.annotationId);
      else byEntry.set(m.entryId, [m.annotationId]);
    }
    return [...byEntry.entries()].map(([entryId, annotationIds]) => ({ entryId, annotationIds }));
  }

  // No annotation dimension: matches are the entries satisfying the entry dimension (or all entries).
  const ids = entrySet ? [...entrySet] : allEntryIds(db);
  return ids.map((entryId) => ({ entryId, annotationIds: [] }));
}

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

/** Entries that carry every entry-dimension predicate at the entry level (AND across, OR within). */
function entriesMatchingEntryDim(db: Db, preds: TagPredicate[]): Set<string> {
  let acc: Set<string> | null = null;
  for (const p of preds) {
    const placeholders = p.values.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT DISTINCT entry_id FROM entry_tags WHERE "group" = ? AND value IN (${placeholders})`)
      .all(p.group, ...p.values) as Array<{ entry_id: string }>;
    const set = new Set(rows.map((r) => r.entry_id));
    acc = acc === null ? set : intersect(acc, set);
    if (acc.size === 0) break;
  }
  return acc ?? new Set<string>();
}

/** Annotations on which ALL tag + result predicates co-occur, with their parent entry id. */
function annotationsMatchingAnnotationDim(
  db: Db,
  tagPreds: TagPredicate[],
  resultPreds: ResultPredicate[],
): Array<{ entryId: string; annotationId: string }> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  for (const p of tagPreds) {
    const placeholders = p.values.map(() => '?').join(',');
    clauses.push(
      `EXISTS (SELECT 1 FROM annotation_tags t WHERE t.annotation_id = a.id AND t."group" = ? AND t.value IN (${placeholders}))`,
    );
    params.push(p.group, ...p.values);
  }

  for (const r of resultPreds) {
    const conds: string[] = ['rr.dimension_id = ?'];
    const rp: Array<string | number> = [r.dimension];
    if (r.in && r.in.length > 0) {
      const placeholders = r.in.map(() => '?').join(',');
      conds.push(`rr.string_value IN (${placeholders})`);
      rp.push(...r.in);
    }
    if (r.gte !== undefined) {
      conds.push('rr.number_value >= ?');
      rp.push(r.gte);
    }
    if (r.lte !== undefined) {
      conds.push('rr.number_value <= ?');
      rp.push(r.lte);
    }
    clauses.push(
      `EXISTS (SELECT 1 FROM annotation_results rr WHERE rr.annotation_id = a.id AND ${conds.join(' AND ')})`,
    );
    params.push(...rp);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT a.id, a.entry_id FROM annotations a ${where} ORDER BY a.id`).all(...params) as Array<{
    id: string;
    entry_id: string;
  }>;
  return rows.map((r) => ({ entryId: r.entry_id, annotationId: r.id }));
}

function allEntryIds(db: Db): string[] {
  return (db.prepare('SELECT id FROM entries').all() as Array<{ id: string }>).map((r) => r.id);
}

function intersect(a: Set<string>, b: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const x of a) if (b.has(x)) out.add(x);
  return out;
}
