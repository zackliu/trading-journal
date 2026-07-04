import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Result } from '../../../shared/domain';
import type { AnnotationSelection } from '../editor/canvasController';
import { Icon } from './icons';

export interface AnnotationEdits {
  result: Result;
  links: string[];
}

interface Props {
  x: number;
  y: number;
  annotation: AnnotationSelection;
  linkClipboard: { entryId: string; annotationId: string } | null;
  onCopyLinkTarget: (annotationId: string) => void;
  onJumpLink: (annotationId: string) => void;
  onSave: (edits: AnnotationEdits) => void;
  onCancel: () => void;
}

/**
 * A right-click "Links…" popover anchored at the object. Tags live on the Review/Annotation ribbon
 * quick-pick and the trade's result on the Annotation tab; this popover owns only the annotation's
 * cross-chart links. Edits are staged locally: Save commits (preserving the recorded result);
 * clicking outside or Escape cancels.
 */
export function TagPopover(props: Props): JSX.Element {
  const { annotation, linkClipboard } = props;
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

  const linkToCopied = (): void => {
    if (!linkClipboard) return;
    const id = linkClipboard.annotationId;
    if (id !== annotation.id && !links.includes(id)) setLinks([...links, id]);
  };
  const removeLink = (id: string): void => setLinks(links.filter((x) => x !== id));

  // Result stays as recorded (it is edited on the Annotation tab) — the popover only changes links.
  const save = (): void => props.onSave({ result: annotation.result, links });

  return (
    <div
      ref={rootRef}
      className="tagpop"
      data-testid="tag-popover"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
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
