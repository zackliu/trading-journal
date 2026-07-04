import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';

export interface DragHandle {
  onPointerDown: (e: ReactPointerEvent) => void;
}

interface Props<T> {
  items: T[];
  getKey: (item: T) => string;
  /** Commit a new top-to-bottom order (the full key list) after a drag settles. */
  onReorder: (orderedKeys: string[]) => void;
  /** Render one row; spread `handle` onto the drag-handle element (e.g. the ☰ grip). */
  renderItem: (item: T, handle: DragHandle) => ReactNode;
  className?: string;
}

interface DragState {
  from: number;
  over: number;
  grabY: number;
  /** The dragged row's outer height (incl. gap) — how far siblings slide to make room. */
  height: number;
  /** Original row centres at grab time, for hit-testing the drop slot. */
  centres: number[];
}

/**
 * A small pointer-driven vertical sortable. During a drag the picked row follows the cursor (lifted)
 * while the others slide to open a gap (CSS transform transition); on drop the new order is committed.
 * Reordering is not applied until drop, so the dragged row never jumps under the cursor. Hand-rolled
 * (no drag dependency); heights may vary per row (groups), so siblings shift by the dragged row's size.
 */
export function SortableList<T>({ items, getKey, onReorder, renderItem, className }: Props<T>): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dy, setDy] = useState(0);
  const keys = items.map(getKey);

  const startDrag = (index: number) => (e: ReactPointerEvent): void => {
    const c = ref.current;
    if (!c || e.button !== 0) return;
    e.preventDefault();
    const rows = Array.from(c.querySelectorAll<HTMLElement>(':scope > [data-sort-row]'));
    const rects = rows.map((r) => r.getBoundingClientRect());
    const centres = rects.map((r) => r.top + r.height / 2);
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const height = (rects[index]?.height ?? 0) + gap;
    setDrag({ from: index, over: index, grabY: e.clientY, height, centres });
    setDy(0);
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent): void => {
      const delta = e.clientY - drag.grabY;
      const centre = drag.centres[drag.from] + delta;
      let over = drag.from;
      if (delta > 0) {
        for (let i = drag.from + 1; i < drag.centres.length; i += 1) {
          if (centre > drag.centres[i]) over = i;
          else break;
        }
      } else {
        for (let i = drag.from - 1; i >= 0; i -= 1) {
          if (centre < drag.centres[i]) over = i;
          else break;
        }
      }
      setDy(delta);
      setDrag((d) => (d && d.over !== over ? { ...d, over } : d));
    };
    const onUp = (): void => {
      setDrag((d) => {
        if (d && d.over !== d.from) {
          const next = keys.slice();
          const [moved] = next.splice(d.from, 1);
          next.splice(d.over, 0, moved);
          onReorder(next);
        }
        return null;
      });
      setDy(0);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, keys, onReorder]);

  return (
    <div ref={ref} className={className} style={drag ? { userSelect: 'none' } : undefined}>
      {items.map((item, i) => {
        let transform = '';
        let dragging = false;
        if (drag) {
          if (i === drag.from) {
            transform = `translateY(${dy}px)`;
            dragging = true;
          } else if (drag.from < drag.over && i > drag.from && i <= drag.over) {
            transform = `translateY(${-drag.height}px)`;
          } else if (drag.over < drag.from && i >= drag.over && i < drag.from) {
            transform = `translateY(${drag.height}px)`;
          }
        }
        return (
          <div
            key={keys[i]}
            data-sort-row=""
            className={`sortrow${dragging ? ' is-dragging' : ''}`}
            style={{
              transform,
              transition: dragging ? 'none' : 'transform 190ms cubic-bezier(0.2, 0, 0, 1)',
              zIndex: dragging ? 3 : undefined,
              position: 'relative',
            }}
          >
            {renderItem(item, { onPointerDown: startDrag(i) })}
          </div>
        );
      })}
    </div>
  );
}
