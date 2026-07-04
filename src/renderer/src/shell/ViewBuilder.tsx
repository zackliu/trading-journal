import { useEffect, useState } from 'react';
import type {
  ResultDimension,
  ResultPredicate,
  SavedView,
  TagGroupView,
  TagPredicate,
  ViewQuery,
} from '../../../shared/domain';

interface Props {
  groups: TagGroupView[];
  dimensions: ResultDimension[];
  initial: ViewQuery;
  savedViews: SavedView[];
  onApply: (query: ViewQuery) => void;
  onSaveView: (name: string, query: ViewQuery) => void;
  onDeleteView: (id: string) => void;
  onClose: () => void;
  fetchResultValues: (dimensionId: string) => Promise<string[]>;
}

/** Drop predicates that don't actually constrain anything, so an empty row never narrows the view. */
function cleanQuery(q: ViewQuery): ViewQuery {
  return {
    entry: q.entry.filter((p) => p.values.length > 0),
    annotation: q.annotation.filter((p) => p.values.length > 0),
    results: q.results.filter((r) => (r.in?.length ?? 0) > 0 || r.gte !== undefined || r.lte !== undefined),
  };
}

type Dim = 'entry' | 'annotation';

/**
 * The two-dimension view builder. Entry conditions must EXIST on the review; annotation conditions
 * (tags + typed result predicates) must all CO-OCCUR on a single trade. Which dimension a group lands
 * in is the user's choice here — level is never declared on the group. Also lists / saves views.
 */
export function ViewBuilder(props: Props): JSX.Element {
  const [query, setQuery] = useState<ViewQuery>(props.initial);
  const [name, setName] = useState('');
  const [valueCache, setValueCache] = useState<Record<string, string[]>>({});

  const groupLabel = (id: string): string => props.groups.find((g) => g.id === id)?.label ?? id;

  // Lazily fetch the distinct recorded values for each string result dimension in play.
  useEffect(() => {
    for (const r of query.results) {
      const dim = props.dimensions.find((d) => d.id === r.dimension);
      if (dim?.type === 'string' && !(r.dimension in valueCache)) {
        void props.fetchResultValues(r.dimension).then((vals) =>
          setValueCache((c) => (r.dimension in c ? c : { ...c, [r.dimension]: vals })),
        );
      }
    }
  }, [query.results, props, valueCache]);

  const updateDim = (key: Dim, fn: (preds: TagPredicate[]) => TagPredicate[]): void =>
    setQuery((q) => (key === 'entry' ? { ...q, entry: fn(q.entry) } : { ...q, annotation: fn(q.annotation) }));

  const addGroup = (key: Dim, group: string): void => updateDim(key, (ps) => [...ps, { group, values: [] }]);
  const removeGroup = (key: Dim, group: string): void => updateDim(key, (ps) => ps.filter((p) => p.group !== group));
  const toggleValue = (key: Dim, group: string, value: string): void =>
    updateDim(key, (ps) =>
      ps.map((p) =>
        p.group !== group
          ? p
          : { ...p, values: p.values.includes(value) ? p.values.filter((v) => v !== value) : [...p.values, value] },
      ),
    );

  const addResult = (dimension: string): void => setQuery((q) => ({ ...q, results: [...q.results, { dimension }] }));
  const removeResult = (dimension: string): void =>
    setQuery((q) => ({ ...q, results: q.results.filter((r) => r.dimension !== dimension) }));
  const patchResult = (dimension: string, patch: Partial<ResultPredicate>): void =>
    setQuery((q) => ({ ...q, results: q.results.map((r) => (r.dimension === dimension ? { ...r, ...patch } : r)) }));
  const toggleResultIn = (dimension: string, value: string): void =>
    setQuery((q) => ({
      ...q,
      results: q.results.map((r) => {
        if (r.dimension !== dimension) return r;
        const cur = r.in ?? [];
        return { ...r, in: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
      }),
    }));

  const renderTagPredicates = (key: Dim): JSX.Element[] =>
    query[key].map((p) => {
      const g = props.groups.find((x) => x.id === p.group);
      return (
        <div className="viewb__pred" key={p.group} data-testid={`pred-${key}-${p.group}`}>
          <span className="viewb__predname">{groupLabel(p.group)}</span>
          <div className="viewb__chips">
            {(g?.values ?? []).map((v) => (
              <button
                type="button"
                key={v.value}
                className={`vchip${p.values.includes(v.value) ? ' is-on' : ''}`}
                data-testid={`vchip-${key}-${p.group}-${v.value}`}
                onClick={() => toggleValue(key, p.group, v.value)}
              >
                {v.label ?? v.value}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="viewb__predx"
            aria-label="Remove condition"
            onClick={() => removeGroup(key, p.group)}
          >
            ×
          </button>
        </div>
      );
    });

  const renderAddGroup = (key: Dim): JSX.Element | null => {
    const used = new Set(query[key].map((p) => p.group));
    const avail = props.groups.filter((g) => !used.has(g.id));
    if (avail.length === 0) return null;
    return (
      <select
        className="viewb__add"
        data-testid={`add-group-${key}`}
        value=""
        onChange={(e) => {
          if (e.target.value) addGroup(key, e.target.value);
        }}
      >
        <option value="">＋ Add group…</option>
        {avail.map((g) => (
          <option key={g.id} value={g.id}>
            {g.label}
          </option>
        ))}
      </select>
    );
  };

  const renderResults = (): JSX.Element[] =>
    query.results.map((r) => {
      const d = props.dimensions.find((x) => x.id === r.dimension);
      const values = valueCache[r.dimension] ?? [];
      return (
        <div className="viewb__pred" key={r.dimension} data-testid={`pred-result-${r.dimension}`}>
          <span className="viewb__predname">{d?.label ?? r.dimension}</span>
          {d?.type === 'number' ? (
            <div className="viewb__range">
              <input
                type="number"
                placeholder="min"
                value={r.gte ?? ''}
                data-testid={`result-gte-${r.dimension}`}
                onChange={(e) => patchResult(r.dimension, { gte: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
              <span className="viewb__dash">–</span>
              <input
                type="number"
                placeholder="max"
                value={r.lte ?? ''}
                data-testid={`result-lte-${r.dimension}`}
                onChange={(e) => patchResult(r.dimension, { lte: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </div>
          ) : (
            <div className="viewb__chips">
              {values.map((v) => (
                <button
                  type="button"
                  key={v}
                  className={`vchip${(r.in ?? []).includes(v) ? ' is-on' : ''}`}
                  data-testid={`rchip-${r.dimension}-${v}`}
                  onClick={() => toggleResultIn(r.dimension, v)}
                >
                  {v}
                </button>
              ))}
              {values.length === 0 ? <span className="viewb__empty">no values recorded yet</span> : null}
            </div>
          )}
          <button type="button" className="viewb__predx" aria-label="Remove result" onClick={() => removeResult(r.dimension)}>
            ×
          </button>
        </div>
      );
    });

  const renderAddResult = (): JSX.Element | null => {
    const used = new Set(query.results.map((r) => r.dimension));
    const avail = props.dimensions.filter((d) => !used.has(d.id));
    if (avail.length === 0) return null;
    return (
      <select
        className="viewb__add"
        data-testid="add-result"
        value=""
        onChange={(e) => {
          if (e.target.value) addResult(e.target.value);
        }}
      >
        <option value="">＋ Add result…</option>
        {avail.map((d) => (
          <option key={d.id} value={d.id}>
            {d.label}
          </option>
        ))}
      </select>
    );
  };

  return (
    <div className="modal" data-testid="view-builder" onMouseDown={() => props.onClose()}>
      <div className="modal__panel viewb" onMouseDown={(e) => e.stopPropagation()}>
        <header className="viewb__head">
          <h2 className="viewb__title">Filter &amp; saved views</h2>
          <button type="button" className="settings__close" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </header>
        <p className="viewb__hint">
          <strong>Entry</strong> conditions match the whole review. <strong>Annotation</strong> conditions must all land
          on one trade.
        </p>

        <section className="viewb__dim" data-testid="dim-entry">
          <h3 className="viewb__dimh">
            Entry conditions <span className="viewb__sub">whole review</span>
          </h3>
          {renderTagPredicates('entry')}
          {renderAddGroup('entry')}
        </section>

        <section className="viewb__dim" data-testid="dim-annotation">
          <h3 className="viewb__dimh">
            Annotation conditions <span className="viewb__sub">one trade</span>
          </h3>
          {renderTagPredicates('annotation')}
          {renderResults()}
          <div className="viewb__adds">
            {renderAddGroup('annotation')}
            {renderAddResult()}
          </div>
        </section>

        <section className="viewb__dim">
          <h3 className="viewb__dimh">Saved views</h3>
          {props.savedViews.length === 0 ? (
            <p className="viewb__empty">No saved views yet — build a filter and save it below.</p>
          ) : (
            <ul className="viewb__saved">
              {props.savedViews.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="viewb__savedload"
                    data-testid={`view-load-${v.id}`}
                    onClick={() => setQuery(JSON.parse(v.queryJson) as ViewQuery)}
                  >
                    {v.name}
                  </button>
                  <button
                    type="button"
                    className="viewb__predx"
                    aria-label="Delete view"
                    data-testid={`view-del-${v.id}`}
                    onClick={() => props.onDeleteView(v.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="viewb__saverow">
            <input
              className="viewb__name"
              placeholder="Name this view…"
              value={name}
              data-testid="view-name"
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="button"
              className="viewb__btn"
              disabled={!name.trim()}
              data-testid="view-save"
              onClick={() => {
                props.onSaveView(name.trim(), cleanQuery(query));
                setName('');
              }}
            >
              Save as view
            </button>
          </div>
        </section>

        <footer className="viewb__foot">
          <button type="button" className="viewb__btn" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="viewb__btn viewb__btn--primary"
            data-testid="view-apply"
            onClick={() => props.onApply(cleanQuery(query))}
          >
            Apply filter
          </button>
        </footer>
      </div>
    </div>
  );
}
