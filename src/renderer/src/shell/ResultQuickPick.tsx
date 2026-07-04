import type { Result, ResultDimensionView } from '../../../shared/domain';

interface Props {
  dimensions: ResultDimensionView[];
  /** The selected annotation's current result (dimensionId -> value). */
  result: Result;
  onSet: (dimensionId: string, value: string | number | null) => void;
  onOpenSettings: () => void;
}

/**
 * The Annotation tab's result editor — the same one-tap feel as the tag quick-pick, but for the
 * trade's outcome. A `choices` dimension shows its preset values as single-select chips (click the
 * active one to clear); a `number` dimension is a small numeric field. Recording a result never
 * needs the right-click popover anymore.
 */
export function ResultQuickPick({ dimensions, result, onSet, onOpenSettings }: Props): JSX.Element {
  if (dimensions.length === 0) {
    return (
      <div className="qtag qtag--empty" data-testid="result-quick">
        <span>No result types yet.</span>
        <button type="button" className="qtag__link" data-testid="result-quick-settings" onClick={onOpenSettings}>
          Define results in Settings
        </button>
      </div>
    );
  }
  return (
    <div className="qtag" data-testid="result-quick">
      {dimensions.map((dim) => (
        <DimPick key={dim.id} dim={dim} current={result[dim.id]} onSet={onSet} />
      ))}
    </div>
  );
}

function DimPick({
  dim,
  current,
  onSet,
}: {
  dim: ResultDimensionView;
  current: string | number | undefined;
  onSet: (dimensionId: string, value: string | number | null) => void;
}): JSX.Element {
  return (
    <div className="qtag__group" data-testid={`rquick-${dim.id}`}>
      <div className="qtag__vals">
        {dim.type === 'string' && dim.values.length > 0 ? (
          <div className="qtag__chips">
            {dim.values.map((v) => {
              const on = current === v.value;
              return (
                <button
                  key={v.value}
                  type="button"
                  className={`qchip${on ? ' is-on' : ''}`}
                  data-testid={`rquick-${dim.id}-${v.value}`}
                  onClick={() => onSet(dim.id, on ? null : v.value)}
                >
                  {v.label ?? v.value}
                </button>
              );
            })}
          </div>
        ) : dim.type === 'number' ? (
          <input
            className="rquick__input"
            type="number"
            placeholder="—"
            data-testid={`rquick-num-${dim.id}`}
            value={current ?? ''}
            onChange={(e) => {
              const n = Number(e.target.value);
              onSet(dim.id, e.target.value === '' || !Number.isFinite(n) ? null : n);
            }}
          />
        ) : (
          <input
            className="rquick__input"
            type="text"
            placeholder="—"
            data-testid={`rquick-text-${dim.id}`}
            value={current ?? ''}
            onChange={(e) => onSet(dim.id, e.target.value === '' ? null : e.target.value)}
          />
        )}
      </div>
      <div className="qtag__label">{dim.label}</div>
    </div>
  );
}
