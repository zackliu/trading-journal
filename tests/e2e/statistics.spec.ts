import { expect, test } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Annotation, StatsQuery } from '../../src/shared/domain';
import { launchApp, store } from './electronApp';

const CANVAS = '{}';

function tempDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'tj-stats-'));
}

function todayLocal(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function annotation(
  id: string,
  tags: Annotation['tags'],
  result?: Annotation['result'],
): Annotation {
  return { id, bounds: { x: 10, y: 10, width: 40, height: 30 }, tags, result };
}

async function seedStatistics(page: Parameters<typeof store.createEntry>[0]): Promise<void> {
  await store.defineDimension(page, { id: 'r', label: 'R multiple', type: 'number' });
  await store.defineDimension(page, { id: 'outcome', label: 'Outcome', type: 'string' });
  await store.defineDimension(page, { id: 'obsolete', label: 'Obsolete', type: 'number' });
  await store.defineResultValue(page, 'outcome', 'win', 'Win');
  await store.defineResultValue(page, 'outcome', 'loss', 'Loss');
  await store.defineResultValue(page, 'outcome', 'legacy', 'Legacy');

  await store.defineGroup(page, { id: 'context', label: 'Context', pinned: false });
  await store.defineValue(page, { groupId: 'context', value: 'trend', label: 'Trend' });
  await store.defineValue(page, { groupId: 'context', value: 'volatile', label: 'Volatile' });
  await store.defineGroup(page, { id: 'market', label: 'Market', pinned: false });
  await store.defineValue(page, { groupId: 'market', value: 'bull', label: 'Bull' });
  await store.defineValue(page, { groupId: 'market', value: 'range', label: 'Range' });

  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [
      { group: 'date', value: '2026-06-30' },
      { group: 'market', value: 'bull' },
      { group: 'market', value: 'range' },
    ],
    annotations: [
      annotation(
        'a1',
        [
          { group: 'setup', value: 'h2' },
          { group: 'context', value: 'trend' },
          { group: 'context', value: 'volatile' },
        ],
        { r: 2, outcome: 'win' },
      ),
      annotation(
        'a2',
        [
          { group: 'setup', value: 'h2' },
          { group: 'context', value: 'trend' },
        ],
        { outcome: 'legacy' },
      ),
      annotation('note', [], undefined),
      annotation('obsolete-only', [], { obsolete: 5 }),
    ],
  });
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'date', value: '2026-07-01' }],
    annotations: [
      annotation(
        'a3',
        [
          { group: 'setup', value: 'h2' },
          { group: 'context', value: 'ghost' },
        ],
        { r: 0, outcome: 'loss' },
      ),
      annotation('a4', [{ group: 'setup', value: 'h2' }], { r: -2 }),
      annotation('a5', [{ group: 'setup', value: 'h2' }], undefined),
      annotation('graphic', [], undefined),
    ],
  });

  await store.deleteResultValue(page, 'outcome', 'legacy');
  await store.deleteResultDimension(page, 'obsolete');
  await store.deleteValue(page, 'context', 'volatile');
  await store.deleteValue(page, 'market', 'range');
}

function defaultQuery(): StatsQuery {
  return {
    scope: { entry: [], population: { kind: 'active-result-bearing' } },
    dimension: 'r',
    threshold: { op: 'gte', value: 1 },
  };
}

function matchingQuery(): StatsQuery {
  return {
    scope: {
      entry: [],
      population: {
        kind: 'matching-annotations',
        predicates: [{ group: 'setup', values: ['h2'] }],
      },
    },
    dimension: 'r',
    threshold: { op: 'gte', value: 1 },
  };
}

test('statistics disclose exact populations, denominators, dates, and string values', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedStatistics(page);

  const defaultReport = await store.runStats(page, defaultQuery());
  expect(defaultReport.scopeEntryCount).toBe(2);
  expect(defaultReport.counts).toEqual({
    contributingEntryCount: 2,
    populationCount: 4,
    recordedCount: 3,
    missingCount: 1,
    coverage: 0.75,
  });
  expect(defaultReport.overall.kind).toBe('number');
  if (defaultReport.overall.kind === 'number') {
    expect(defaultReport.overall.mean).toBe(0);
    expect(defaultReport.overall.median).toBe(0);
    expect(defaultReport.overall.threshold).toEqual({ op: 'gte', value: 1, matchCount: 1, rate: 1 / 3 });
  }

  const matchingReport = await store.runStats(page, matchingQuery());
  expect(matchingReport.counts).toEqual({
    contributingEntryCount: 2,
    populationCount: 5,
    recordedCount: 3,
    missingCount: 2,
    coverage: 0.6,
  });

  const dated = await store.runStats(page, {
    ...defaultQuery(),
    scope: {
      ...defaultQuery().scope,
      dateRange: { from: '2026-06-30', to: '2026-06-30' },
    },
  });
  expect(dated.scopeEntryCount).toBe(1);
  expect(dated.counts.populationCount).toBe(2);
  const datedEntries = await store.queryStatsScopeEntries(page, {
    ...defaultQuery().scope,
    dateRange: { from: '2026-06-30', to: '2026-06-30' },
  });
  expect(datedEntries).toHaveLength(1);
  expect(datedEntries[0].date).toBe('2026-06-30');

  const stringReport = await store.runStats(page, { ...defaultQuery(), dimension: 'outcome', threshold: undefined });
  expect(stringReport.overall).toEqual({
    kind: 'string',
    segments: [
      { value: 'win', label: 'Win', archivedOrUnregistered: false, count: 1, rate: 1 / 3 },
      { value: 'loss', label: 'Loss', archivedOrUnregistered: false, count: 1, rate: 1 / 3 },
      { value: 'legacy', label: 'Legacy', archivedOrUnregistered: true, count: 1, rate: 1 / 3 },
    ],
  });

  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'probe', value: 'created-day' }],
    annotations: [annotation('created-day-sample', [], { r: 1 })],
  });
  const fallbackReport = await store.runStats(page, {
    scope: {
      entry: [{ group: 'probe', values: ['created-day'] }],
      population: { kind: 'active-result-bearing' },
      dateRange: { from: todayLocal(), to: todayLocal() },
    },
    dimension: 'r',
  });
  expect(fallbackReport.scopeEntryCount).toBe(1);
  expect(fallbackReport.counts.populationCount).toBe(1);

  const longResult = 'x'.repeat(120);
  await store.createEntry(page, {
    canvasJson: CANVAS,
    entryTags: [{ group: 'probe', value: 'long-result' }],
    annotations: [annotation('long-string-sample', [], { outcome: longResult })],
  });
  const longStringStats: StatsQuery = {
    scope: {
      entry: [{ group: 'probe', values: ['long-result'] }],
      population: { kind: 'active-result-bearing' },
    },
    dimension: 'outcome',
  };
  expect(
    await store.queryStatsExamples(page, {
      stats: longStringStats,
      segment: { kind: 'string-value', value: longResult },
    }),
  ).toEqual([{ entryId: expect.any(String), annotationIds: ['long-string-sample'] }]);

  await expect(
    store.runStats(page, {
      ...defaultQuery(),
      scope: { ...defaultQuery().scope, dateRange: { from: '2026-02-30', to: '2026-03-01' } },
    }),
  ).rejects.toThrow(/real calendar date/);

  await expect(
    store.runStats(page, { ...defaultQuery(), dimension: 'outcome' }),
  ).rejects.toThrow(/threshold requires a number/);

  await app.close();
});

test('single-group compare preserves overlap, archived membership, and No value', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedStatistics(page);

  const annotationReport = await store.runStats(page, {
    ...matchingQuery(),
    compareBy: { level: 'annotation', group: 'context' },
  });
  expect(annotationReport.counts.populationCount).toBe(5);
  expect(annotationReport.overlap).toEqual({
    multiAssignedPopulationCount: 1,
    unassignedPopulationCount: 2,
  });
  expect(
    annotationReport.cohorts?.map((cohort) => ({
      value: cohort.value,
      label: cohort.label,
      archived: cohort.archivedOrUnregistered,
      population: cohort.populationCount,
    })),
  ).toEqual([
    { value: 'trend', label: 'Trend', archived: false, population: 2 },
    { value: 'volatile', label: 'Volatile', archived: true, population: 1 },
    { value: 'ghost', label: 'ghost', archived: true, population: 1 },
    { value: null, label: 'No value', archived: false, population: 2 },
  ]);

  const entryReport = await store.runStats(page, {
    ...matchingQuery(),
    compareBy: { level: 'entry', group: 'market' },
  });
  expect(entryReport.overlap).toEqual({
    multiAssignedPopulationCount: 2,
    unassignedPopulationCount: 3,
  });
  expect(entryReport.cohorts?.map((cohort) => [cohort.value, cohort.populationCount])).toEqual([
    ['bull', 2],
    ['range', 2],
    [null, 3],
  ]);

  await app.close();
});

test('statistics examples rerun the same population and never count missing as threshold misses', async () => {
  const { app, page } = await launchApp(tempDataDir());
  await seedStatistics(page);
  const stats = matchingQuery();

  expect(
    await store.queryStatsExamples(page, { stats, segment: { kind: 'threshold-match' } }),
  ).toEqual([{ entryId: expect.any(String), annotationIds: ['a1'] }]);

  const misses = await store.queryStatsExamples(page, { stats, segment: { kind: 'threshold-miss' } });
  expect(misses).toHaveLength(1);
  expect(misses[0].annotationIds).toEqual(['a3', 'a4']);
  expect(
    await store.queryStatsExamples(page, { stats, segment: { kind: 'missing' } }),
  ).toEqual([
    { entryId: expect.any(String), annotationIds: ['a5'] },
    { entryId: expect.any(String), annotationIds: ['a2'] },
  ]);

  const compareStats: StatsQuery = { ...stats, compareBy: { level: 'annotation', group: 'context' } };
  expect(
    await store.queryStatsExamples(page, {
      stats: compareStats,
      cohortValue: 'volatile',
      segment: { kind: 'all' },
    }),
  ).toEqual([{ entryId: expect.any(String), annotationIds: ['a1'] }]);
  const unassigned = await store.queryStatsExamples(page, {
    stats: compareStats,
    cohortValue: null,
    segment: { kind: 'all' },
  });
  expect(unassigned).toHaveLength(1);
  expect(unassigned[0].annotationIds).toEqual(['a4', 'a5']);

  const stringStats: StatsQuery = { ...stats, dimension: 'outcome', threshold: undefined };
  expect(
    await store.queryStatsExamples(page, {
      stats: stringStats,
      segment: { kind: 'string-value', value: 'legacy' },
    }),
  ).toEqual([{ entryId: expect.any(String), annotationIds: ['a2'] }]);

  await app.close();
});