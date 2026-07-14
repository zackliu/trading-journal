import type {
  NumberAggregate,
  StatsCohort,
  StatsExamplesSegment,
  StatsQuery,
  StatsReport,
  StringAggregate,
} from '../../../shared/domain';

interface Props {
  query: StatsQuery | null;
  report: StatsReport | null;
  loading: boolean;
  error: string | null;
  drillError: string | null;
  ignoredResultCount: number;
  drillBusy: boolean;
  onRetry: () => void;
  onEditSample: () => void;
  onOpenResultSettings: () => void;
  onFocusMeasure: () => void;
  onReviewScopeEntries: () => void;
  onReviewExamples: (segment: StatsExamplesSegment, cohortValue?: string | null) => void;
}

function count(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function number(value: number | null): string {
  return value === null ? 'N/A' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function percent(value: number | null): string {
  return value === null
    ? 'N/A'
    : new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 }).format(value);
}

function thresholdLabel(aggregate: NumberAggregate): string {
  if (!aggregate.threshold) return '';
  return `${aggregate.threshold.op === 'gte' ? '≥' : '≤'} ${number(aggregate.threshold.value)}`;
}

function ReviewButton(props: {
  disabled?: boolean;
  onClick: () => void;
  label?: string;
  testId?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      className="stats__review"
      data-testid={props.testId}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.label ?? 'Review examples'}
    </button>
  );
}

function Distribution(props: {
  aggregate: StringAggregate;
  recordedCount: number;
  disabled: boolean;
  cohortValue?: string | null;
  compact?: boolean;
  colorIndexByValue: ReadonlyMap<string, number>;
  onReview: Props['onReviewExamples'];
}): JSX.Element {
  return (
    <div className={`stats-dist${props.compact ? ' stats-dist--compact' : ''}`}>
      <div className="stats-dist__bar" aria-hidden="true">
        {props.aggregate.segments.map((segment, index) => {
          const colorIndex = props.colorIndexByValue.get(segment.value) ?? index;
          return (
            <span
              key={segment.value}
              className={`stats-dist__fill stats-dist__fill--${colorIndex % 4}`}
              style={{ width: `${(segment.rate ?? 0) * 100}%` }}
            />
          );
        })}
      </div>
      <div className="stats-dist__legend">
        {props.aggregate.segments.map((segment, index) => {
          const colorIndex = props.colorIndexByValue.get(segment.value) ?? index;
          return (
            <button
              type="button"
              key={segment.value}
              className="stats-dist__segment"
              data-testid="stats-string-segment"
              data-value={segment.value}
              disabled={props.disabled || segment.count === 0}
              onClick={() => props.onReview({ kind: 'string-value', value: segment.value }, props.cohortValue)}
            >
              <span className={`stats-dist__key stats-dist__key--${colorIndex % 4}`} aria-hidden="true" />
              <span>{segment.label ?? segment.value}</span>
              {segment.archivedOrUnregistered ? <span className="stats__archived">archived / unregistered</span> : null}
              <strong>{count(segment.count)}</strong>
              <span>{percent(segment.rate)}</span>
              <small>/ {count(props.recordedCount)}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberCohortCells(props: {
  cohort: StatsCohort;
  disabled: boolean;
  onReview: Props['onReviewExamples'];
}): JSX.Element {
  const { cohort } = props;
  if (cohort.aggregate.kind !== 'number') return <td colSpan={3}>N/A</td>;
  return (
    <>
      <td>
        <button
          type="button"
          className="stats-table__metric"
          data-testid="stats-cohort-mean"
          disabled={props.disabled || cohort.recordedCount === 0}
          onClick={() => props.onReview({ kind: 'recorded' }, cohort.value)}
        >
          {number(cohort.aggregate.mean)}
        </button>
      </td>
      <td>
        <button
          type="button"
          className="stats-table__metric"
          data-testid="stats-cohort-median"
          disabled={props.disabled || cohort.recordedCount === 0}
          onClick={() => props.onReview({ kind: 'recorded' }, cohort.value)}
        >
          {number(cohort.aggregate.median)}
        </button>
      </td>
      {cohort.aggregate.threshold ? (
        <td>
          <button
            type="button"
            className="stats-table__metric"
            data-testid="stats-cohort-threshold-match"
            disabled={props.disabled || cohort.aggregate.threshold.matchCount === 0}
            onClick={() => props.onReview({ kind: 'threshold-match' }, cohort.value)}
          >
            {percent(cohort.aggregate.threshold.rate)}{' '}
            <small>{count(cohort.aggregate.threshold.matchCount)} / {count(cohort.recordedCount)}</small>
          </button>
          {cohort.recordedCount > cohort.aggregate.threshold.matchCount ? (
            <button
              type="button"
              className="stats-table__miss"
              data-testid="stats-cohort-threshold-miss"
              disabled={props.disabled}
              onClick={() => props.onReview({ kind: 'threshold-miss' }, cohort.value)}
            >
              {count(cohort.recordedCount - cohort.aggregate.threshold.matchCount)} not matched
            </button>
          ) : null}
        </td>
      ) : null}
    </>
  );
}

export function StatsPanel(props: Props): JSX.Element {
  if (!props.query) {
    return (
      <div className="stats-empty" data-testid="stats-empty-dimensions">
        <h2>No result dimensions yet</h2>
        <p>Define the result you want to measure, then record it on annotations.</p>
        <button type="button" className="viewb__btn viewb__btn--primary" onClick={props.onOpenResultSettings}>
          Define result…
        </button>
      </div>
    );
  }
  if (props.loading) return <div className="stats-empty" data-testid="stats-loading">Calculating statistics…</div>;
  if (props.error) {
    return (
      <div className="stats-empty" data-testid="stats-error" role="alert">
        <h2>Couldn’t calculate statistics</h2>
        <p>{props.error}</p>
        <button type="button" className="viewb__btn" onClick={props.onRetry}>Retry</button>
      </div>
    );
  }
  if (!props.report) return <div className="stats-empty">Preparing statistics…</div>;

  const { report, query } = props;
  const defaultPopulation = query.scope.population.kind === 'active-result-bearing';
  const missingLabel = defaultPopulation
    ? `Not recorded for ${report.measure.label} / result-bearing samples`
    : `Missing ${report.measure.label}`;
  const coverageLabel = defaultPopulation
    ? `Recorded ${report.measure.label} / result-bearing samples`
    : 'Coverage';
  const smallSample = report.counts.recordedCount > 0 && report.counts.recordedCount < 10;
  const stringColorIndex = new Map(
    report.overall.kind === 'string'
      ? report.overall.segments.map((segment, index) => [segment.value, index] as const)
      : [],
  );
  const compareCoverageLabel = defaultPopulation ? 'Recorded / result-bearing' : 'Coverage';
  const compareMissingLabel = defaultPopulation ? 'not recorded' : 'missing';

  return (
    <div className="stats-report" data-testid="stats-report">
      <header className="stats-head">
        <div>
          <span className="stats-head__eyebrow">Statistics</span>
          <h1>{report.measure.label}</h1>
        </div>
        <button type="button" className="viewb__btn" onClick={props.onEditSample}>Edit sample…</button>
      </header>

      {props.ignoredResultCount > 0 ? (
        <div className="stats-bias" data-testid="stats-result-filter-warning">
          Ignored {props.ignoredResultCount} result filter{props.ignoredResultCount === 1 ? '' : 's'} from the View to
          avoid pre-selecting outcomes.
        </div>
      ) : null}
      {props.drillError ? (
        <div className="stats-bias stats-bias--error" data-testid="stats-drill-error" role="alert">
          {props.drillError}
        </div>
      ) : null}

      <section className="stats-pop" data-testid="stats-population">
        <button
          type="button"
          className="stats-metric"
          data-testid="stats-scope-count"
          disabled={report.scopeEntryCount === 0 || props.drillBusy}
          onClick={props.onReviewScopeEntries}
        >
          <span>Scope Entries</span><strong>{count(report.scopeEntryCount)}</strong>
        </button>
        <button
          type="button"
          className="stats-metric"
          data-testid="stats-population-count"
          disabled={report.counts.populationCount === 0 || props.drillBusy}
          onClick={() => props.onReviewExamples({ kind: 'all' })}
        >
          <span>Population samples</span><strong>{count(report.counts.populationCount)}</strong>
        </button>
        <button
          type="button"
          className="stats-metric"
          data-testid="stats-contributing-count"
          disabled={report.counts.populationCount === 0 || props.drillBusy}
          onClick={() => props.onReviewExamples({ kind: 'all' })}
        >
          <span>Contributing Entries</span><strong>{count(report.counts.contributingEntryCount)}</strong>
        </button>
        <button
          type="button"
          className="stats-metric"
          data-testid="stats-recorded"
          disabled={report.counts.recordedCount === 0 || props.drillBusy}
          onClick={() => props.onReviewExamples({ kind: 'recorded' })}
        >
          <span>Recorded</span><strong>{count(report.counts.recordedCount)}</strong>
        </button>
        <button
          type="button"
          className="stats-metric"
          data-testid="stats-missing"
          disabled={report.counts.missingCount === 0 || props.drillBusy}
          onClick={() => props.onReviewExamples({ kind: 'missing' })}
        >
          <span>{missingLabel}</span><strong>{count(report.counts.missingCount)}</strong>
        </button>
        <div className="stats-metric" data-testid="stats-coverage">
          <span>{coverageLabel}</span><strong>{percent(report.counts.coverage)}</strong>
          <small>{count(report.counts.recordedCount)} / {count(report.counts.populationCount)}</small>
        </div>
      </section>

      {smallSample ? <p className="stats-small">Very small sample — review the examples.</p> : null}

      {report.counts.populationCount === 0 ? (
        <section className="stats-empty stats-empty--inline" data-testid="stats-no-population">
          <h2>No samples match this scope</h2>
          <div className="stats-empty__actions">
            <button type="button" className="viewb__btn" onClick={props.onEditSample}>Edit sample</button>
            <button type="button" className="viewb__btn" onClick={props.onReviewScopeEntries}>Review matching entries</button>
          </div>
        </section>
      ) : report.counts.recordedCount === 0 ? (
        <section className="stats-empty stats-empty--inline" data-testid="stats-no-recorded">
          <h2>No {report.measure.label} values are recorded in this population</h2>
          <div className="stats-empty__actions">
            <button type="button" className="viewb__btn" onClick={props.onFocusMeasure}>Choose another result</button>
            <ReviewButton
              disabled={props.drillBusy}
              label="Review missing examples"
              onClick={() => props.onReviewExamples({ kind: 'missing' })}
            />
          </div>
        </section>
      ) : (
        <>
          <section className="stats-section" data-testid="stats-overall">
            <div className="stats-section__head">
              <div>
                <span className="stats-section__kicker">Overall</span>
                <h2>{defaultPopulation ? 'All result-bearing samples' : 'All eligible samples'}</h2>
              </div>
              <ReviewButton
                disabled={props.drillBusy}
                testId="stats-review-all"
                onClick={() => props.onReviewExamples({ kind: 'all' })}
              />
            </div>
            {report.overall.kind === 'number' ? (
              <div className="stats-number">
                <button type="button" onClick={() => props.onReviewExamples({ kind: 'recorded' })}>
                  <span>Mean</span><strong data-testid="stats-number-mean">{number(report.overall.mean)}</strong>
                </button>
                <button type="button" onClick={() => props.onReviewExamples({ kind: 'recorded' })}>
                  <span>Median</span><strong data-testid="stats-number-median">{number(report.overall.median)}</strong>
                </button>
                {report.overall.threshold ? (
                  <div className="stats-number__threshold" data-testid="stats-number-threshold">
                    <button type="button" onClick={() => props.onReviewExamples({ kind: 'threshold-match' })}>
                      <span>Condition match {thresholdLabel(report.overall)}</span>
                      <strong>{percent(report.overall.threshold.rate)}</strong>
                      <small>{count(report.overall.threshold.matchCount)} / {count(report.counts.recordedCount)}</small>
                    </button>
                    <ReviewButton
                      disabled={props.drillBusy || report.overall.threshold.matchCount === report.counts.recordedCount}
                      label="Review not matched"
                      onClick={() => props.onReviewExamples({ kind: 'threshold-miss' })}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <Distribution
                aggregate={report.overall}
                recordedCount={report.counts.recordedCount}
                disabled={props.drillBusy}
                colorIndexByValue={stringColorIndex}
                onReview={props.onReviewExamples}
              />
            )}
          </section>

          {report.cohorts && report.overlap ? (
            <section className="stats-section" data-testid="stats-compare">
              <div className="stats-section__head">
                <div><span className="stats-section__kicker">Compare</span><h2>Independent membership cohorts</h2></div>
                <p>
                  {count(report.overlap.multiAssignedPopulationCount)} samples appear in multiple rows; rows should not
                  be added. {count(report.overlap.unassignedPopulationCount)} have no value.
                </p>
              </div>
              <div className="stats-table-wrap">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th>Cohort</th><th>Samples</th><th>Entries</th><th>Recorded</th><th>{compareCoverageLabel}</th>
                      {report.overall.kind === 'number' ? <><th>Mean</th><th>Median</th>{report.overall.threshold ? <th>Condition</th> : null}</> : <th>Distribution</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {report.cohorts.map((cohort) => (
                      <tr key={cohort.value ?? '__none__'} data-testid="stats-cohort" data-value={cohort.value ?? '__none__'}>
                        <th>{cohort.label}{cohort.archivedOrUnregistered ? <span className="stats__archived">archived / unregistered</span> : null}</th>
                        <td>
                          <button type="button" className="stats-table__metric" disabled={props.drillBusy || cohort.populationCount === 0} onClick={() => props.onReviewExamples({ kind: 'all' }, cohort.value)}>
                            {count(cohort.populationCount)}
                          </button>
                        </td>
                        <td>
                          <button type="button" className="stats-table__metric" disabled={props.drillBusy || cohort.populationCount === 0} onClick={() => props.onReviewExamples({ kind: 'all' }, cohort.value)}>
                            {count(cohort.contributingEntryCount)}
                          </button>
                        </td>
                        <td>
                          <button type="button" className="stats-table__metric" disabled={props.drillBusy || cohort.recordedCount === 0} onClick={() => props.onReviewExamples({ kind: 'recorded' }, cohort.value)}>
                            {count(cohort.recordedCount)}
                          </button>
                        </td>
                        <td>
                          <button type="button" className="stats-table__metric" disabled={props.drillBusy || cohort.populationCount === 0} onClick={() => props.onReviewExamples({ kind: 'all' }, cohort.value)}>
                            {percent(cohort.coverage)}
                          </button>
                          {cohort.missingCount > 0 ? (
                            <button type="button" className="stats-table__miss" disabled={props.drillBusy} onClick={() => props.onReviewExamples({ kind: 'missing' }, cohort.value)}>
                              {count(cohort.missingCount)} {compareMissingLabel}
                            </button>
                          ) : null}
                        </td>
                        {cohort.aggregate.kind === 'number' ? (
                          <NumberCohortCells cohort={cohort} disabled={props.drillBusy} onReview={props.onReviewExamples} />
                        ) : (
                          <td className="stats-table__dist">
                            <Distribution
                              aggregate={cohort.aggregate}
                              recordedCount={cohort.recordedCount}
                              disabled={props.drillBusy}
                              cohortValue={cohort.value}
                              compact
                              colorIndexByValue={stringColorIndex}
                              onReview={props.onReviewExamples}
                            />
                          </td>
                        )}
                        <td>
                          <ReviewButton
                            disabled={props.drillBusy || cohort.populationCount === 0}
                            onClick={() => props.onReviewExamples({ kind: 'all' }, cohort.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}