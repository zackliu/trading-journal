import { useEffect, useRef, useState } from 'react';
import type { Result, ResultDimension, Tag } from '../../../shared/domain';
import type { AnnotationSelection } from '../editor/canvasController';
import { Icon } from './icons';

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AnnotationEdits {
  tags: Tag[];
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
 * A right-click "Tags & result…" popover anchored at the object. Edits are staged in
 * local draft state: **Save** commits them (and closes); clicking outside or Escape
 * **cancels** unsaved changes (and closes). Defining a result dimension is a global
 * action that commits immediately (not part of the annotation draft).
 */
export function TagPopover(props: Props): JSX.Element {
  const { annotation, dimensions, linkClipboard } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(props.onCancel);
  cancelRef.current = props.onCancel;

  const [tags, setTags] = useState<Tag[]>(annotation.tags);
  const [links, setLinks] = useState<string[]>(annotation.links);
  const [resultDraft, setResultDraft] = useState<Record<string, string>>(() => {
    const draft: Record<string, string> = {};
    for (const [k, v] of Object.entries(annotation.result)) draft[k] = String(v);
    return draft;
  });

  const [tagGroup, setTagGroup] = useState('');
  const [tagValue, setTagValue] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);

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

  const addTag = (): void => {
    const group = tagGroup.trim();
    const value = tagValue.trim();
    if (!KEBAB.test(group) || !KEBAB.test(value)) {
      setTagError('group and value must be kebab-case');
      return;
    }
    if (!tags.some((t) => t.group === group && t.value === value)) setTags([...tags, { group, value }]);
    setTagGroup('');
    setTagValue('');
    setTagError(null);
  };

  const removeTag = (t: Tag): void => setTags(tags.filter((x) => !(x.group === t.group && x.value === t.value)));

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
    props.onSave({ tags, result, links });
  };

  return (
    <div
      ref={rootRef}
      className="tagpop"
      data-testid="tag-popover"
      style={{ left: props.x, top: props.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <section className="insp__section">
        <h4 className="insp__heading">Tags</h4>
        <div className="insp__tags">
          {tags.length === 0 ? (
            <span className="insp__muted">No tags yet</span>
          ) : (
            tags.map((t) => (
              <span className="chip" data-testid="popover-tag" key={`${t.group}:${t.value}`}>
                {t.group}:{t.value}
                <button
                  type="button"
                  className="chip__x"
                  aria-label={`remove ${t.group}:${t.value}`}
                  onClick={() => removeTag(t)}
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="insp__row">
          <input
            className="insp__input"
            placeholder="group"
            data-testid="tag-group"
            value={tagGroup}
            onChange={(e) => setTagGroup(e.target.value)}
          />
          <input
            className="insp__input"
            placeholder="value"
            data-testid="tag-value"
            value={tagValue}
            onChange={(e) => setTagValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addTag();
            }}
          />
          <button type="button" className="insp__btn" data-testid="tag-add" onClick={addTag}>
            Add
          </button>
        </div>
        {tagError ? <div className="insp__error">{tagError}</div> : null}
      </section>

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
