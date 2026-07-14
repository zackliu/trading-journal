import { describe, expect, it } from 'vitest';
import {
  buildStatsReport,
  selectStatsExamples,
  type StatsPopulationRow,
  type StatsValueMeta,
} from '../../src/main/store/statsAggregate';

const numberMeasure = { id: 'r', label: 'R multiple', type: 'number' as const };
const stringMeasure = { id: 'outcome', label: 'Outcome', type: 'string' as const };

function row(
  annotationId: string,
  value: string | number | undefined,
  compareValues: string[] = [],
  entryId = `entry-${annotationId}`,
): StatsPopulationRow {
  return { entryId, annotationId, value, compareValues };
}

describe('statistics aggregate contract', () => {
  it('keeps missing samples in population while number metrics use recorded values', () => {
    const report = buildStatsReport({
      measure: numberMeasure,
      scopeEntryCount: 4,
      rows: [row('a', -1), row('b', 0), row('c', 1), row('d', 2), row('missing', undefined)],
      threshold: { op: 'gte', value: 1 },
      stringValues: [],
    });

    expect(report.counts).toEqual({
      contributingEntryCount: 5,
      populationCount: 5,
      recordedCount: 4,
      missingCount: 1,
      coverage: 0.8,
    });
    expect(report.overall).toEqual({
      kind: 'number',
      mean: 0.5,
      median: 0.5,
      threshold: { op: 'gte', value: 1, matchCount: 2, rate: 0.5 },
    });
  });

  it('returns null rather than zero for every zero-denominator metric', () => {
    const report = buildStatsReport({
      measure: numberMeasure,
      scopeEntryCount: 0,
      rows: [],
      threshold: { op: 'lte', value: 0 },
      stringValues: [],
    });

    expect(report.counts.coverage).toBeNull();
    expect(report.overall).toEqual({
      kind: 'number',
      mean: null,
      median: null,
      threshold: { op: 'lte', value: 0, matchCount: 0, rate: null },
    });
  });

  it('keeps archived and unregistered string results in the recorded denominator', () => {
    const values: StatsValueMeta[] = [
      { value: 'win', label: 'Win', archivedOrUnregistered: false },
      { value: 'old', label: 'Old outcome', archivedOrUnregistered: true },
      { value: 'free-text', archivedOrUnregistered: true },
    ];
    const report = buildStatsReport({
      measure: stringMeasure,
      scopeEntryCount: 2,
      rows: [row('a', 'win'), row('b', 'win'), row('c', 'old'), row('d', 'free-text'), row('e', undefined)],
      stringValues: values,
    });

    expect(report.overall).toEqual({
      kind: 'string',
      segments: [
        { ...values[0], count: 2, rate: 0.5 },
        { ...values[1], count: 1, rate: 0.25 },
        { ...values[2], count: 1, rate: 0.25 },
      ],
    });
  });

  it('keeps overlapping compare cohorts independent and overall samples unique', () => {
    const compareValues: StatsValueMeta[] = [
      { value: 'trend', label: 'Trend', archivedOrUnregistered: false },
      { value: 'volatile', label: 'Volatile', archivedOrUnregistered: true },
    ];
    const report = buildStatsReport({
      measure: numberMeasure,
      scopeEntryCount: 2,
      rows: [
        row('a', 1, ['trend', 'volatile'], 'entry-1'),
        row('b', 3, ['trend'], 'entry-1'),
        row('c', undefined, [], 'entry-2'),
      ],
      stringValues: [],
      compareValues,
    });

    expect(report.counts.populationCount).toBe(3);
    expect(report.overlap).toEqual({ multiAssignedPopulationCount: 1, unassignedPopulationCount: 1 });
    expect(report.cohorts?.map((cohort) => [cohort.value, cohort.populationCount, cohort.recordedCount])).toEqual([
      ['trend', 2, 2],
      ['volatile', 1, 1],
      [null, 1, 0],
    ]);
  });

  it('drills into exact segments without treating threshold missing as a miss', () => {
    const rows = [
      row('a', 2, ['trend'], 'entry-1'),
      row('b', -1, ['trend'], 'entry-1'),
      row('c', undefined, ['trend'], 'entry-2'),
      row('d', 0, [], 'entry-3'),
    ];

    expect(
      selectStatsExamples(rows, { kind: 'threshold-miss' }, { op: 'gte', value: 1 }, { specified: true, value: 'trend' }),
    ).toEqual([{ entryId: 'entry-1', annotationIds: ['b'] }]);
    expect(selectStatsExamples(rows, { kind: 'missing' }, undefined, { specified: false })).toEqual([
      { entryId: 'entry-2', annotationIds: ['c'] },
    ]);
    expect(selectStatsExamples(rows, { kind: 'all' }, undefined, { specified: true, value: null })).toEqual([
      { entryId: 'entry-3', annotationIds: ['d'] },
    ]);
  });
});