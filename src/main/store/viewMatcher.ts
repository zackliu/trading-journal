import type { Db } from '../db';
import type { ResultPredicate, TagPredicate, ViewMatch, ViewQuery } from '../../shared/domain';

/**
 * Pure Slice 7 matcher shared by the app and AI read boundary. It only reads the denormalized index;
 * no Entry writer or canvas parser is reachable from this module.
 */
export function runViewQuery(db: Db, query: ViewQuery): ViewMatch[] {
  const entrySet = query.entry.length > 0 ? entriesMatchingEntryDim(db, query.entry) : null;
  const hasAnnotationDim = query.annotation.length > 0 || query.results.length > 0;

  if (hasAnnotationDim) {
    const byEntry = new Map<string, string[]>();
    for (const match of annotationsMatchingAnnotationDim(db, query.annotation, query.results)) {
      if (entrySet && !entrySet.has(match.entryId)) continue;
      const list = byEntry.get(match.entryId);
      if (list) list.push(match.annotationId);
      else byEntry.set(match.entryId, [match.annotationId]);
    }
    return [...byEntry.entries()].map(([entryId, annotationIds]) => ({ entryId, annotationIds }));
  }

  const ids = entrySet ? [...entrySet] : allEntryIds(db);
  return ids.map((entryId) => ({ entryId, annotationIds: [] }));
}

function entriesMatchingEntryDim(db: Db, predicates: TagPredicate[]): Set<string> {
  let matches: Set<string> | null = null;
  for (const predicate of predicates) {
    const placeholders = predicate.values.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT DISTINCT entry_id FROM entry_tags WHERE "group" = ? AND value IN (${placeholders})`)
      .all(predicate.group, ...predicate.values) as Array<{ entry_id: string }>;
    const current = new Set(rows.map((row) => row.entry_id));
    matches = matches === null ? current : intersect(matches, current);
    if (matches.size === 0) break;
  }
  return matches ?? new Set<string>();
}

function annotationsMatchingAnnotationDim(
  db: Db,
  tagPredicates: TagPredicate[],
  resultPredicates: ResultPredicate[],
): Array<{ entryId: string; annotationId: string }> {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  for (const predicate of tagPredicates) {
    const placeholders = predicate.values.map(() => '?').join(',');
    clauses.push(
      `EXISTS (SELECT 1 FROM annotation_tags t WHERE t.annotation_id = a.id AND t."group" = ? AND t.value IN (${placeholders}))`,
    );
    params.push(predicate.group, ...predicate.values);
  }

  for (const predicate of resultPredicates) {
    const conditions: string[] = ['result.dimension_id = ?'];
    const resultParams: Array<string | number> = [predicate.dimension];
    if (predicate.in && predicate.in.length > 0) {
      const placeholders = predicate.in.map(() => '?').join(',');
      conditions.push(`result.string_value IN (${placeholders})`);
      resultParams.push(...predicate.in);
    }
    if (predicate.gte !== undefined) {
      conditions.push('result.number_value >= ?');
      resultParams.push(predicate.gte);
    }
    if (predicate.lte !== undefined) {
      conditions.push('result.number_value <= ?');
      resultParams.push(predicate.lte);
    }
    clauses.push(
      `EXISTS (SELECT 1 FROM annotation_results result WHERE result.annotation_id = a.id AND ${conditions.join(' AND ')})`,
    );
    params.push(...resultParams);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT a.id, a.entry_id FROM annotations a ${where} ORDER BY a.id`).all(...params) as Array<{
    id: string;
    entry_id: string;
  }>;
  return rows.map((row) => ({ entryId: row.entry_id, annotationId: row.id }));
}

function allEntryIds(db: Db): string[] {
  return (db.prepare('SELECT id FROM entries').all() as Array<{ id: string }>).map((row) => row.id);
}

function intersect(left: Set<string>, right: Set<string>): Set<string> {
  const result = new Set<string>();
  for (const value of left) if (right.has(value)) result.add(value);
  return result;
}