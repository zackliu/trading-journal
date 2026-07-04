import { useState } from 'react';
import type { ArchivedResults, ResultDimension, ResultDimensionView } from '../../../shared/domain';
import { ConfirmDialog } from './ConfirmDialog';
import { EditableName } from './EditableName';
import { slugify } from './slug';
import { Icon } from './icons';

interface Props {
  dimensions: ResultDimensionView[];
  archived: ArchivedResults;
  onDefineDimension: (dim: ResultDimension) => void;
  onDeleteDimension: (id: string) => void;
  onDefineValue: (dimensionId: string, value: string, label: string) => void;
  onDeleteValue: (dimensionId: string, value: string) => void;
  onRestoreDimension: (id: string) => void;
  onRestoreValue: (dimensionId: string, value: string) => void;
  onClose: () => void;
}

type PendingDelete =
  | { kind: 'dim'; id: string; label: string; count: number }
  | { kind: 'value'; dimensionId: string; value: string; label: string; count: number };

/**
 * The Result registry — declare the outcome dimensions you record per trade, mirroring the group /
 * tags Settings. A `string` dimension declares preset values (win / loss / breakeven …) that then
 * appear as one-tap chips on the Annotation tab; a `number` dimension has none (its value is typed).
 * A dimension's display label can be renamed in place (its stable id never changes); result *values*
 * are stored verbatim and are their own label, so they aren't renamed. Deleting a dimension or value
 * that trades still record is a recoverable archive (confirmed first, restorable from Archived).
 */
export function ResultSettingsDialog(props: Props): JSX.Element {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'string' | 'number'>('string');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const addDimension = (): void => {
    const id = slugify(label);
    if (!id) {
      setError('enter a name');
      return;
    }
    props.onDefineDimension({ id, label: label.trim(), type });
    setLabel('');
    setError(null);
  };

  const requestDeleteDimension = (dim: ResultDimensionView): void => {
    if (dim.count > 0) setPending({ kind: 'dim', id: dim.id, label: dim.label, count: dim.count });
    else props.onDeleteDimension(dim.id);
  };
  const requestDeleteValue = (dimensionId: string, value: string, label: string, count: number): void => {
    if (count > 0) setPending({ kind: 'value', dimensionId, value, label, count });
    else props.onDeleteValue(dimensionId, value);
  };
  const confirmDelete = (): void => {
    if (!pending) return;
    if (pending.kind === 'dim') props.onDeleteDimension(pending.id);
    else props.onDeleteValue(pending.dimensionId, pending.value);
    setPending(null);
  };

  return (
    <div className="modal" data-testid="result-settings" onMouseDown={() => props.onClose()}>
      <div className="modal__panel settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings__head">
          <h2>Result types</h2>
          <button type="button" className="settings__close" aria-label="Close" data-testid="result-settings-close" onClick={props.onClose}>
            ×
          </button>
        </header>

        <div className="settings__new">
          <input
            className="settings__input"
            placeholder="New result, e.g. Outcome or R multiple"
            data-testid="result-dim-name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addDimension();
            }}
          />
          <select
            className="settings__input"
            data-testid="result-dim-type"
            value={type}
            onChange={(e) => setType(e.target.value === 'number' ? 'number' : 'string')}
          >
            <option value="string">choices</option>
            <option value="number">number</option>
          </select>
          <button type="button" className="settings__btn" data-testid="result-add-dim" onClick={addDimension}>
            <Icon name="plus" /> Add
          </button>
        </div>
        {error ? <div className="settings__error">{error}</div> : null}

        <div className="settings__list">
          {props.dimensions.length === 0 ? (
            <p className="settings__empty">
              No result types yet. Add one above — a “choices” type (like Outcome) then offers its values as
              one-tap chips on the Annotation tab.
            </p>
          ) : (
            props.dimensions.map((dim) => (
              <ResultRow
                key={dim.id}
                dim={dim}
                onRelabel={(label) => props.onDefineDimension({ id: dim.id, label, type: dim.type })}
                onDelete={() => requestDeleteDimension(dim)}
                onDefineValue={props.onDefineValue}
                requestDeleteValue={requestDeleteValue}
              />
            ))
          )}
        </div>

        <ResultArchivedSection
          archived={props.archived}
          onRestoreDimension={props.onRestoreDimension}
          onRestoreValue={props.onRestoreValue}
        />

        {pending ? (
          <ConfirmDialog
            title={pending.kind === 'dim' ? 'Archive result type?' : 'Archive result choice?'}
            message={`“${pending.label}” is recorded on ${pending.count} review${
              pending.count === 1 ? '' : 's'
            }. It will be hidden but kept, and you can restore it from Archived below.`}
            confirmLabel="Archive"
            onConfirm={confirmDelete}
            onCancel={() => setPending(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function ResultArchivedSection({
  archived,
  onRestoreDimension,
  onRestoreValue,
}: {
  archived: ArchivedResults;
  onRestoreDimension: (id: string) => void;
  onRestoreValue: (dimensionId: string, value: string) => void;
}): JSX.Element | null {
  const [open, setOpen] = useState(false);
  const total = archived.dimensions.length + archived.values.length;
  if (total === 0) return null;

  return (
    <div className={`archived${open ? ' is-open' : ''}`} data-testid="result-archived">
      <button type="button" className="archived__toggle" data-testid="result-archived-toggle" onClick={() => setOpen((v) => !v)}>
        <Icon name={open ? 'view' : 'browse'} />
        Archived ({total})
      </button>
      {open ? (
        <div className="archived__list">
          {archived.dimensions.map((d) => (
            <div className="archived__row" key={`d:${d.id}`} data-testid={`result-archived-dim-${d.id}`}>
              <span className="archived__kind">result</span>
              <span className="archived__name">{d.label}</span>
              <button
                type="button"
                className="archived__restore"
                data-testid={`result-restore-dim-${d.id}`}
                onClick={() => onRestoreDimension(d.id)}
              >
                Restore
              </button>
            </div>
          ))}
          {archived.values.map((v) => (
            <div className="archived__row" key={`rv:${v.dimensionId}:${v.value}`} data-testid={`result-archived-value-${v.dimensionId}-${v.value}`}>
              <span className="archived__kind">{v.dimensionLabel}</span>
              <span className="archived__name">{v.value}</span>
              <button
                type="button"
                className="archived__restore"
                data-testid={`result-restore-value-${v.dimensionId}-${v.value}`}
                onClick={() => onRestoreValue(v.dimensionId, v.value)}
              >
                Restore
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ResultRow({
  dim,
  onRelabel,
  onDelete,
  onDefineValue,
  requestDeleteValue,
}: {
  dim: ResultDimensionView;
  onRelabel: (label: string) => void;
  onDelete: () => void;
  onDefineValue: (dimensionId: string, value: string, label: string) => void;
  requestDeleteValue: (dimensionId: string, value: string, label: string, count: number) => void;
}): JSX.Element {
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);

  const addValue = (): void => {
    // A result choice is stored verbatim — "1R", "-1R", "BE" are exact outcomes (the sign is data), NOT
    // a slug like a tag value, or "1R" and "-1R" would collapse to the same key and overwrite each other.
    const value = val.trim();
    if (!value) {
      setErr(true);
      return;
    }
    onDefineValue(dim.id, value, value);
    setVal('');
    setErr(false);
  };

  return (
    <section className="sgroup" data-testid={`result-dim-${dim.id}`}>
      <div className="sgroup__head">
        <EditableName value={dim.label} testId={`result-dim-name-${dim.id}`} onSave={onRelabel} />
        <span className="sgroup__id">{dim.id}</span>
        <span className="rtype">{dim.type === 'number' ? 'number' : 'choices'}</span>
        <span className="svalue__count" title="Reviews recording this result">{dim.count}</span>
        <button
          type="button"
          className="sgroup__del"
          aria-label="Delete result type"
          data-testid={`result-del-dim-${dim.id}`}
          onClick={onDelete}
        >
          <Icon name="trash" />
        </button>
      </div>

      {dim.type === 'string' ? (
        <div className="sgroup__vals">
          {dim.values.map((v) => (
            <div className="svalue" data-testid={`result-value-${dim.id}-${v.value}`} key={v.value}>
              <span className="svalue__name">{v.label ?? v.value}</span>
              <span className="svalue__count">{v.count}</span>
              <button
                type="button"
                className="svalue__x"
                aria-label="Delete value"
                data-testid={`result-del-value-${dim.id}-${v.value}`}
                onClick={() => requestDeleteValue(dim.id, v.value, v.label ?? v.value, v.count)}
              >
                ×
              </button>
            </div>
          ))}
          <input
            className={`sgroup__add${err ? ' is-error' : ''}`}
            placeholder="Add a choice, e.g. win"
            data-testid={`result-add-value-${dim.id}`}
            value={val}
            onChange={(e) => {
              setVal(e.target.value);
              setErr(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addValue();
            }}
          />
        </div>
      ) : (
        <p className="sgroup__hint">A number you type per trade (e.g. 2, −1). No preset choices.</p>
      )}
    </section>
  );
}
