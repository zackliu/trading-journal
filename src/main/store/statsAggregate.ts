import type {
  ResultDimension,
  StatsAggregate,
  StatsCohort,
  StatsExamplesEntry,
  StatsExamplesSegment,
  StatsReport,
  StatsSampleCounts,
  StatsThreshold,
} from '../../shared/domain';

export interface StatsValueMeta {
  value: string;
  label?: string;
  archivedOrUnregistered: boolean;
}

export interface StatsPopulationRow {
  entryId: string;
  annotationId: string;
  value?: string | number;
  compareValues: string[];
}

interface BuildStatsReportInput {
  measure: ResultDimension;
  scopeEntryCount: number;
  rows: StatsPopulationRow[];
  threshold?: StatsThreshold;
  stringValues: StatsValueMeta[];
  compareValues?: StatsValueMeta[];
}

export function buildStatsReport(input: BuildStatsReportInput): StatsReport {
  const report: StatsReport = {
    measure: input.measure,
    scopeEntryCount: input.scopeEntryCount,
    counts: countSamples(input.rows),
    overall: aggregate(input.rows, input.measure.type, input.threshold, input.stringValues),
  };
  if (!input.compareValues) return report;

  const cohorts: StatsCohort[] = input.compareValues.map((meta) => {
    const rows = input.rows.filter((row) => row.compareValues.includes(meta.value));
    return {
      value: meta.value,
      label: meta.label ?? meta.value,
      archivedOrUnregistered: meta.archivedOrUnregistered,
      ...countSamples(rows),
      aggregate: aggregate(rows, input.measure.type, input.threshold, input.stringValues),
    };
  });
  const unassigned = input.rows.filter((row) => row.compareValues.length === 0);
  cohorts.push({
    value: null,
    label: 'No value',
    archivedOrUnregistered: false,
    ...countSamples(unassigned),
    aggregate: aggregate(unassigned, input.measure.type, input.threshold, input.stringValues),
  });
  report.cohorts = cohorts;
  report.overlap = {
    multiAssignedPopulationCount: input.rows.filter((row) => new Set(row.compareValues).size > 1).length,
    unassignedPopulationCount: unassigned.length,
  };
  return report;
}

export function selectStatsExamples(
  rows: StatsPopulationRow[],
  segment: StatsExamplesSegment,
  threshold: StatsThreshold | undefined,
  cohort: { specified: boolean; value?: string | null },
): StatsExamplesEntry[] {
  const selected = rows.filter((row) => {
    if (cohort.specified) {
      if (cohort.value === null) {
        if (row.compareValues.length > 0) return false;
      } else if (!cohort.value || !row.compareValues.includes(cohort.value)) {
        return false;
      }
    }
    return matchesSegment(row, segment, threshold);
  });

  const byEntry = new Map<string, string[]>();
  for (const row of selected) {
    const ids = byEntry.get(row.entryId);
    if (ids) ids.push(row.annotationId);
    else byEntry.set(row.entryId, [row.annotationId]);
  }
  return [...byEntry].map(([entryId, annotationIds]) => ({ entryId, annotationIds }));
}

function countSamples(rows: StatsPopulationRow[]): StatsSampleCounts {
  const recordedCount = rows.filter((row) => row.value !== undefined).length;
  return {
    contributingEntryCount: new Set(rows.map((row) => row.entryId)).size,
    populationCount: rows.length,
    recordedCount,
    missingCount: rows.length - recordedCount,
    coverage: rows.length === 0 ? null : recordedCount / rows.length,
  };
}

function aggregate(
  rows: StatsPopulationRow[],
  type: ResultDimension['type'],
  threshold: StatsThreshold | undefined,
  stringValues: StatsValueMeta[],
): StatsAggregate {
  if (type === 'number') {
    const values = rows
      .map((row) => row.value)
      .filter((value): value is number => typeof value === 'number')
      .sort((left, right) => left - right);
    const mean = values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
    const middle = Math.floor(values.length / 2);
    const median =
      values.length === 0
        ? null
        : values.length % 2 === 1
          ? values[middle]
          : (values[middle - 1] + values[middle]) / 2;
    const matchCount = threshold ? values.filter((value) => matchesThreshold(value, threshold)).length : 0;
    return {
      kind: 'number',
      mean,
      median,
      threshold: threshold
        ? {
            ...threshold,
            matchCount,
            rate: values.length === 0 ? null : matchCount / values.length,
          }
        : undefined,
    };
  }

  const values = rows.map((row) => row.value).filter((value): value is string => typeof value === 'string');
  const countByValue = new Map<string, number>();
  for (const value of values) countByValue.set(value, (countByValue.get(value) ?? 0) + 1);
  const declared = new Set(stringValues.map((meta) => meta.value));
  const unregistered = [...countByValue.keys()]
    .filter((value) => !declared.has(value))
    .sort((left, right) => left.localeCompare(right))
    .map((value) => ({ value, archivedOrUnregistered: true }));
  const ordered = [...stringValues.filter((meta) => countByValue.has(meta.value)), ...unregistered];
  return {
    kind: 'string',
    segments: ordered.map((meta) => {
      const count = countByValue.get(meta.value) ?? 0;
      return {
        ...meta,
        count,
        rate: values.length === 0 ? null : count / values.length,
      };
    }),
  };
}

function matchesSegment(
  row: StatsPopulationRow,
  segment: StatsExamplesSegment,
  threshold: StatsThreshold | undefined,
): boolean {
  if (segment.kind === 'all') return true;
  if (segment.kind === 'recorded') return row.value !== undefined;
  if (segment.kind === 'missing') return row.value === undefined;
  if (segment.kind === 'string-value') return row.value === segment.value;
  if (typeof row.value !== 'number' || !threshold) return false;
  const matched = matchesThreshold(row.value, threshold);
  return segment.kind === 'threshold-match' ? matched : !matched;
}

function matchesThreshold(value: number, threshold: StatsThreshold): boolean {
  return threshold.op === 'gte' ? value >= threshold.value : value <= threshold.value;
}