import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Result, ResultDimension } from '../../../shared/domain';
import type { AnnotationSelection } from '../editor/canvasController';
import { Icon } from './icons';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AnnotationEdits {
  result: Result;
  links: string[];
}

interface Props {
  x: number;
  y: number;
  annotation: AnnotationSelection;
  dimensions: ResultDimension[];
  linkClipboard: { entryId: string; annotationId: string } | null;
  onDefineDimension: (dim: ResultDimension) => void;
  onCopyLinkTarget: (annotationId: string) => void;
  onJumpLink: (annotationId: string) => void;
  onSave: (edits: AnnotationEdits) => void;
  onCancel: () => void;
}

/**
 * A right-click "Result & links…" popover anchored at the object. Tags live on the ribbon
 * quick-pick; this popover owns only the annotation's typed result and its cross-chart links.
 * Edits are staged in local draft state: **Save** commits them (and closes); clicking outside or
 * Escape **cancels** unsaved changes. Defining a result dimension commits immediately (global).
 */
export function TagPopover(props: Props): JSX.Element {
  const { annotation, dimensions, linkClipboard } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(props.onCancel);
  cancelRef.current = props.onCancel;

  // Anchor at the click, but clamp so the whole popover (incl. its Save button) stays on-screen —
  // re-clamping when its height changes (e.g. the result-dimension section expands).
  const [pos, setPos] = useState({ x: props.x, y: props.y });
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const reclamp = (): void => {
      const m = 8;
      const x = Math.max(m, Math.min(props.x, window.innerWidth - el.offsetWidth - m));
      const y = Math.max(m, Math.min(props.y, window.innerHeight - el.offsetHeight - m));
      setPos({ x, y });
    };
    reclamp();
    const ro = new ResizeObserver(reclamp);
    ro.observe(el);
    return () => ro.disconnect();
  }, [props.x, props.y]);

  const [links, setLinks] = useState<string[]>(annotation.links);
  const [resultDraft, setResultDraft] = useState<Record<string, string>>(() => {
    const draft: Record<string, string> = {};
    for (const [k, v] of Object.entries(annotation.result)) draft[k] = String(v);
    return draft;
  });

  const [dimId, setDimId] = useState('');
  const [dimLabel, setDimLabel] = useState('');
  const [dimType, setDimType] = useState<'string' | 'number'>('number');
  const [dimError, setDimError] = useState<string | null>(null);

  // Dismiss on outside click / Escape, deferred a tick so the opening click can't close it.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) cancelRef.current();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelRef.current();
    };
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const defineDim = (): void => {
    const id = dimId.trim();
    const label = dimLabel.trim();
    if (!KEBAB.test(id) || label === '') {
      setDimError('id must be kebab-case, label required');
      return;
    }
    props.onDefineDimension({ id, label, type: dimType });
    setDimId('');
    setDimLabel('');
    setDimError(null);
  };

  const linkToCopied = (): void => {
    if (!linkClipboard) return;
    const id = linkClipboard.annotationId;
    if (id !== annotation.id && !links.includes(id)) setLinks([...links, id]);
  };
  const removeLink = (id: string): void => setLinks(links.filter((x) => x !== id));

  const save = (): void => {
    const result: Result = {};
    for (const dim of dimensions) {
      const raw = (resultDraft[dim.id] ?? '').trim();
      if (raw === '') continue;
      if (dim.type === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n)) result[dim.id] = n;
      } else {
        result[dim.id] = raw;
      }
    }
    props.onSave({ result, links });
  };

  return (
    <div
      ref={rootRef}
      className="tagpop"
      data-testid="tag-popover"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <section className="insp__section">
        <h4 className="insp__heading">Result</h4>
        {dimensions.length === 0 ? (
          <div className="insp__muted">No result dimensions defined yet.</div>
        ) : (
          dimensions.map((dim) => (
            <label className="insp__field" key={dim.id}>
              <span className="insp__label">
                {dim.label} <em className="insp__type">{dim.type}</em>
              </span>
              <input
                className="insp__input"
                type={dim.type === 'number' ? 'number' : 'text'}
                data-testid={`result-${dim.id}`}
                value={resultDraft[dim.id] ?? ''}
                onChange={(e) => setResultDraft({ ...resultDraft, [dim.id]: e.target.value })}
              />
            </label>
          ))
        )}
        <details className="insp__more">
          <summary data-testid="dim-toggle">Define a result dimension</summary>
          <div className="insp__row">
            <input
              className="insp__input"
              placeholder="id (kebab)"
              data-testid="dim-id"
              value={dimId}
              onChange={(e) => setDimId(e.target.value)}
            />
            <input
              className="insp__input"
              placeholder="label"
              data-testid="dim-label"
              value={dimLabel}
              onChange={(e) => setDimLabel(e.target.value)}
            />
            <select
              className="insp__input"
              data-testid="dim-type"
              value={dimType}
              onChange={(e) => setDimType(e.target.value === 'string' ? 'string' : 'number')}
            >
              <option value="number">number</option>
              <option value="string">string</option>
            </select>
            <button type="button" className="insp__btn" data-testid="dim-add" onClick={defineDim}>
              Define
            </button>
          </div>
          {dimError ? <div className="insp__error">{dimError}</div> : null}
        </details>
      </section>

      <section className="insp__section">
        <h4 className="insp__heading">Links</h4>
        <div className="insp__row">
          <button
            type="button"
            className="insp__btn"
            data-testid="link-copy"
            onClick={() => props.onCopyLinkTarget(annotation.id)}
          >
            Copy as link target
          </button>
          <button
            type="button"
            className="insp__btn"
            data-testid="link-paste"
            disabled={!linkClipboard || linkClipboard.annotationId === annotation.id}
            onClick={linkToCopied}
          >
            Link to copied
          </button>
        </div>
        {links.length === 0 ? (
          <div className="insp__muted">No links.</div>
        ) : (
          links.map((id) => (
            <div className="insp__link" data-testid="link-item" key={id}>
              <button
                type="button"
                className="insp__linkgo"
                data-testid="link-go"
                title={id}
                onClick={() => props.onJumpLink(id)}
              >
                <Icon name="browse" /> {id.slice(0, 8)}…
              </button>
              <button
                type="button"
                className="chip__x"
                aria-label="remove link"
                data-testid="link-remove"
                onClick={() => removeLink(id)}
              >
                ×
              </button>
            </div>
          ))
        )}
      </section>

      <div className="tagpop__foot">
        <button type="button" className="insp__btn" data-testid="popover-cancel" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="button" className="tagpop__save" data-testid="popover-save" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
