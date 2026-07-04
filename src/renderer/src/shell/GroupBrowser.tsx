import { useEffect, useState } from 'react';
import type { EntrySummary, Tag, TagGroupView } from '../../../shared/domain';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Thumbnails } from './Thumbnails';

/** One accordion bucket in the pivot browse: a group value (with `tag`) or a year-month (no `tag`). */
export interface Bucket {
  key: string;
  label: string;
  entries: EntrySummary[];
  tag?: Tag;
}

interface Props {
  groups: TagGroupView[];
  /** Active pivot dimension: `'all'` (year-month) or a group id. */
  pivot: string;
  onPivot: (id: string) => void;
  buckets: Bucket[];
  totalCount: number;
  selectedEntryId: string | null;
  /** Open a review; `tag` (present for value buckets) briefly highlights its carriers. */
  onOpen: (entryId: string, tag?: Tag) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

/**
 * The left-rail browse: pick ONE group dimension from the selector (or "All reviews"), then the
 * library is bucketed into a collapsible accordion — value buckets for a group, year-month buckets
 * for "All reviews". A review appears in every bucket it belongs to with zero copies. The same
 * gallery renders each bucket; opening from a value bucket flashes the carrying annotations.
 */
export function GroupBrowser(props: Props): JSX.Element {
  const { groups, pivot, buckets } = props;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // A fresh pivot starts fully expanded.
  useEffect(() => setCollapsed(new Set()), [pivot]);

  const activeLabel = pivot === 'all' ? 'All reviews' : (groups.find((g) => g.id === pivot)?.label ?? 'All reviews');

  const toggle = (key: string): void =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const collapseAll = (): void => {
    setCollapsed(new Set(buckets.map((b) => b.key)));
    setMenu(null);
  };
  const expandAll = (): void => {
    setCollapsed(new Set());
    setMenu(null);
  };

  const menuItems: MenuItem[] = [
    { label: 'Collapse all', icon: 'sendtoback', testId: 'browse-collapse-all', onClick: collapseAll },
    { label: 'Expand all', icon: 'front', testId: 'browse-expand-all', onClick: expandAll },
  ];

  return (
    <div className="browse" data-testid="group-browser">
      <div className="pivot">
        <button
          type="button"
          className="pivot__btn"
          data-testid="pivot-selector"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="pivot__label">{activeLabel}</span>
          {pivot === 'all' ? <span className="pivot__count">{props.totalCount}</span> : null}
          <span className="pivot__caret" aria-hidden="true" />
        </button>
        {open ? (
          <div className="pivot__menu" data-testid="pivot-menu">
            <button
              type="button"
              className={`pivot__item${pivot === 'all' ? ' is-active' : ''}`}
              data-testid="pivot-all"
              onClick={() => {
                props.onPivot('all');
                setOpen(false);
              }}
            >
              All reviews
            </button>
            {groups.map((g) => (
              <button
                type="button"
                key={g.id}
                className={`pivot__item${pivot === g.id ? ' is-active' : ''}`}
                data-testid={`pivot-group-${g.id}`}
                onClick={() => {
                  props.onPivot(g.id);
                  setOpen(false);
                }}
              >
                {g.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="buckets" data-testid="buckets">
        {buckets.length === 0 ? (
          <p className="thumbs__empty">No reviews yet.</p>
        ) : (
          buckets.map((bucket) => {
            const isCollapsed = collapsed.has(bucket.key);
            return (
              <section className="pbucket" key={bucket.key} data-testid={`bucket-${bucket.key}`}>
                <button
                  type="button"
                  className={`pbucket__head${isCollapsed ? ' is-collapsed' : ''}`}
                  data-testid={`bucket-head-${bucket.key}`}
                  onClick={() => toggle(bucket.key)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className="pbucket__chev" aria-hidden="true" />
                  <span className="pbucket__label">{bucket.label}</span>
                  <span className="pbucket__count">{bucket.entries.length}</span>
                </button>
                {isCollapsed ? null : (
                  <div className="pbucket__body">
                    <Thumbnails
                      entries={bucket.entries}
                      selectedId={props.selectedEntryId}
                      onOpen={(id) => props.onOpen(id, bucket.tag)}
                      onContextMenu={props.onContextMenu}
                    />
                  </div>
                )}
              </section>
            );
          })
        )}
      </div>

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
