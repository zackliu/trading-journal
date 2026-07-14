import type { Db } from '../db';
import type {
  EntrySummary,
  ResultDimension,
  ResultValueType,
  StatsExamplesEntry,
  StatsExamplesQuery,
  StatsQuery,
  StatsReport,
  StatsScope,
  TagPredicate,
} from '../../shared/domain';
import { summariesForIds } from './entryStore';
import { runViewQuery } from './viewMatcher';
import {
  buildStatsReport,
  selectStatsExamples,
  type StatsPopulationRow,
  type StatsValueMeta,
} from './statsAggregate';

interface EntryDateRow {
  id: string;
  created_at: number;
  date_value: string | null;
}

interface AnnotationIdRow {
  id: string;
  entry_id: string;
}

interface ResultRow {
  annotation_id: string;
  string_value: string | null;
  number_value: number | null;
}

interface RegistryValueRow {
  value: string;
  label: string | null;
  archived: number;
}

interface StatsContext {
  measure: ResultDimension;
  scopeEntryCount: number;
  rows: StatsPopulationRow[];
  stringValues: StatsValueMeta[];
  compareValues?: StatsValueMeta[];
}

export function runStatsQuery(db: Db, query: StatsQuery): StatsReport {
  const context = loadStatsContext(db, query);
  return buildStatsReport({
    measure: context.measure,
    scopeEntryCount: context.scopeEntryCount,
    rows: context.rows,
    threshold: query.threshold,
    stringValues: context.stringValues,
    compareValues: context.compareValues,
  });
}

export function queryStatsExamples(db: Db, query: StatsExamplesQuery): StatsExamplesEntry[] {
  const context = loadStatsContext(db, query.stats);
  validateExamplesQuery(query, context.measure.type);
  return selectStatsExamples(context.rows, query.segment, query.stats.threshold, {
    specified: Object.prototype.hasOwnProperty.call(query, 'cohortValue'),
    value: query.cohortValue,
  });
}

export function queryStatsScopeEntries(db: Db, scope: StatsScope): EntrySummary[] {
  const scoped = loadScopeEntries(db, scope);
  const summaries = new Map(summariesForIds(db, scoped.map((entry) => entry.id)).map((entry) => [entry.id, entry]));
  return scoped.map((entry) => summaries.get(entry.id)).filter((entry): entry is EntrySummary => entry !== undefined);
}

function loadStatsContext(db: Db, query: StatsQuery): StatsContext {
  const measure = requireActiveMeasure(db, query);
  requireAvailableCompareGroup(db, query);
  const scopeEntries = loadScopeEntries(db, query.scope);
  const scopeIds = new Set(scopeEntries.map((entry) => entry.id));
  const annotationRows = loadPopulationAnnotations(db, query, scopeIds);
  const resultByAnnotation = loadMeasureValues(db, query.dimension, measure.type);
  const compareByOwner = query.compareBy ? loadCompareMembership(db, query.compareBy.level, query.compareBy.group) : null;
  const entryOrder = new Map(scopeEntries.map((entry, index) => [entry.id, index]));
  const rows: StatsPopulationRow[] = annotationRows
    .map((annotation) => ({
      entryId: annotation.entry_id,
      annotationId: annotation.id,
      value: resultByAnnotation.get(annotation.id),
      compareValues: compareByOwner?.get(query.compareBy?.level === 'entry' ? annotation.entry_id : annotation.id) ?? [],
    }))
    .sort((left, right) => {
      const byEntry = (entryOrder.get(left.entryId) ?? 0) - (entryOrder.get(right.entryId) ?? 0);
      return byEntry || left.annotationId.localeCompare(right.annotationId);
    });

  return {
    measure,
    scopeEntryCount: scopeEntries.length,
    rows,
    stringValues: measure.type === 'string' ? loadResultValueMeta(db, measure.id, rows) : [],
    compareValues: query.compareBy ? loadTagValueMeta(db, query.compareBy.group, rows) : undefined,
  };
}

function requireActiveMeasure(db: Db, query: StatsQuery): ResultDimension {
  const row = db
    .prepare('SELECT id, label, type FROM result_dimensions WHERE id = ? AND archived = 0')
    .get(query.dimension) as ResultDimension | undefined;
  if (!row) throw new Error(`result dimension is not active: ${query.dimension}`);
  if (query.threshold && row.type !== 'number') throw new Error('a threshold requires a number result dimension');
  return row;
}

function requireAvailableCompareGroup(db: Db, query: StatsQuery): void {
  if (!query.compareBy) return;
  const row = db
    .prepare('SELECT id FROM tag_groups WHERE id = ? AND archived = 0')
    .get(query.compareBy.group) as { id: string } | undefined;
  if (!row) throw new Error(`compare group is not available: ${query.compareBy.group}`);
}

function loadScopeEntries(db: Db, scope: StatsScope): Array<EntryDateRow & { effectiveDate: string }> {
  const entryMatches =
    scope.entry.length === 0
      ? null
      : new Set(
          runViewQuery(db, { entry: scope.entry, annotation: [], results: [] }).map((match) => match.entryId),
        );
  const rows = db
    .prepare(
      `SELECT e.id, e.created_at,
        (SELECT value FROM entry_tags d WHERE d.entry_id = e.id AND d."group" = 'date' ORDER BY value DESC LIMIT 1) AS date_value
       FROM entries e`,
    )
    .all() as EntryDateRow[];
  return rows
    .filter((row) => !entryMatches || entryMatches.has(row.id))
    .map((row) => ({ ...row, effectiveDate: row.date_value ?? localCalendarDate(row.created_at) }))
    .filter((row) => {
      const range = scope.dateRange;
      return !range || (row.effectiveDate >= range.from && row.effectiveDate <= range.to);
    })
    .sort((left, right) => {
      if (left.effectiveDate !== right.effectiveDate) return left.effectiveDate < right.effectiveDate ? 1 : -1;
      return right.created_at - left.created_at || left.id.localeCompare(right.id);
    });
}

function loadPopulationAnnotations(db: Db, query: StatsQuery, scopeIds: Set<string>): AnnotationIdRow[] {
  const candidates =
    query.scope.population.kind === 'active-result-bearing'
      ? (db
          .prepare(
            `SELECT a.id, a.entry_id FROM annotations a
             WHERE EXISTS (
               SELECT 1 FROM annotation_results result
               JOIN result_dimensions dimension ON dimension.id = result.dimension_id
               WHERE result.annotation_id = a.id AND dimension.archived = 0
             )
             ORDER BY a.id`,
          )
          .all() as AnnotationIdRow[])
      : annotationsMatchingTags(db, query.scope.population.predicates);
  return candidates.filter((annotation) => scopeIds.has(annotation.entry_id));
}

function annotationsMatchingTags(db: Db, predicates: TagPredicate[]): AnnotationIdRow[] {
  const clauses: string[] = [];
  const params: string[] = [];
  for (const predicate of predicates) {
    const placeholders = predicate.values.map(() => '?').join(',');
    clauses.push(
      `EXISTS (SELECT 1 FROM annotation_tags tag WHERE tag.annotation_id = a.id AND tag."group" = ? AND tag.value IN (${placeholders}))`,
    );
    params.push(predicate.group, ...predicate.values);
  }
  return db
    .prepare(`SELECT a.id, a.entry_id FROM annotations a WHERE ${clauses.join(' AND ')} ORDER BY a.id`)
    .all(...params) as AnnotationIdRow[];
}

function loadMeasureValues(db: Db, dimension: string, type: ResultValueType): Map<string, string | number> {
  const rows = db
    .prepare(
      'SELECT annotation_id, string_value, number_value FROM annotation_results WHERE dimension_id = ? ORDER BY annotation_id',
    )
    .all(dimension) as ResultRow[];
  const values = new Map<string, string | number>();
  for (const row of rows) {
    const value = type === 'number' ? row.number_value : row.string_value;
    if (value !== null) values.set(row.annotation_id, value);
  }
  return values;
}

function loadCompareMembership(
  db: Db,
  level: 'entry' | 'annotation',
  group: string,
): Map<string, string[]> {
  const owner = level === 'entry' ? 'entry_id' : 'annotation_id';
  const table = level === 'entry' ? 'entry_tags' : 'annotation_tags';
  const rows = db
    .prepare(`SELECT ${owner} AS owner, value FROM ${table} WHERE "group" = ? ORDER BY owner, value`)
    .all(group) as Array<{ owner: string; value: string }>;
  const membership = new Map<string, string[]>();
  for (const row of rows) {
    const values = membership.get(row.owner);
    if (values) values.push(row.value);
    else membership.set(row.owner, [row.value]);
  }
  return membership;
}

function loadResultValueMeta(db: Db, dimension: string, rows: StatsPopulationRow[]): StatsValueMeta[] {
  const actual = new Set(
    rows.map((row) => row.value).filter((value): value is string => typeof value === 'string'),
  );
  const registry = db
    .prepare(
      'SELECT value, label, archived FROM result_dimension_values WHERE dimension_id = ? ORDER BY archived, sort, rowid',
    )
    .all(dimension) as RegistryValueRow[];
  return orderedValueMeta(actual, registry);
}

function loadTagValueMeta(db: Db, group: string, rows: StatsPopulationRow[]): StatsValueMeta[] {
  const actual = new Set(rows.flatMap((row) => row.compareValues));
  const registry = db
    .prepare('SELECT value, label, archived FROM tag_values WHERE group_id = ? ORDER BY archived, sort, rowid')
    .all(group) as RegistryValueRow[];
  return orderedValueMeta(actual, registry);
}

function orderedValueMeta(actual: Set<string>, registry: RegistryValueRow[]): StatsValueMeta[] {
  const meta: StatsValueMeta[] = [];
  const seen = new Set<string>();
  for (const row of registry) {
    if (!actual.has(row.value)) continue;
    seen.add(row.value);
    meta.push({
      value: row.value,
      label: row.label ?? undefined,
      archivedOrUnregistered: row.archived !== 0,
    });
  }
  for (const value of [...actual].filter((item) => !seen.has(item)).sort((a, b) => a.localeCompare(b))) {
    meta.push({ value, archivedOrUnregistered: true });
  }
  return meta;
}

function validateExamplesQuery(query: StatsExamplesQuery, measureType: ResultValueType): void {
  const hasCohort = Object.prototype.hasOwnProperty.call(query, 'cohortValue');
  if (hasCohort && !query.stats.compareBy) throw new Error('a cohort example requires compareBy');
  if (query.segment.kind === 'string-value' && measureType !== 'string') {
    throw new Error('a string-value example requires a string result dimension');
  }
  if (
    (query.segment.kind === 'threshold-match' || query.segment.kind === 'threshold-miss') &&
    !query.stats.threshold
  ) {
    throw new Error('a threshold example requires a threshold');
  }
}

function localCalendarDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}