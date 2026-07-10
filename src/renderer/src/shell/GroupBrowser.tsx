import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { EntrySummary, Tag, TagGroupView } from '../../../shared/domain';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Icon } from './icons';
import { Thumbnails } from './Thumbnails';

/** One accordion bucket in the pivot browse: a group value (with `tag`) or a year-month (no `tag`). */
export interface Bucket {
  key: string;
  label: string;
  entries: EntrySummary[];
  tag?: Tag;
}

/** One concrete thumbnail position in the current browse rail. */
export interface BrowseOccurrence {
  pivot: string;
  bucketKey: string;
  entryId: string;
  tag?: Tag;
}

interface Props {
  groups: TagGroupView[];
  /** Active pivot dimension: `'all'` (year-month) or a group id. */
  pivot: string;
  onPivot: (id: string) => void;
  buckets: Bucket[];
  totalCount: number;
  /** Date order of the reviews in every bucket: 'desc' = newest first, 'asc' = oldest first. */
  sortDir: 'desc' | 'asc';
  onToggleSort: () => void;
  /** The exact active thumbnail occurrence; null when the open review is outside the current rail. */
  selectedOccurrence: BrowseOccurrence | null;
  /** Activate a thumbnail occurrence. Click and wheel navigation share the same App path. */
  onOpen: (occurrence: BrowseOccurrence) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  /** Current pivot/filter/sort is waiting for its matching atomic rail snapshot. */
  loading: boolean;
  /** Current rail query failed; old results stay unavailable until an explicit retry succeeds. */
  error: string | null;
  onRetry: () => void;
  /** The active view filter as compact chips (empty = no filter); each is scoped entry vs annotation. */
  filterChips: Array<{ text: string; scope: 'entry' | 'annotation' }>;
  onClearFilter: () => void;
}

/** Imperative handle so the wheel-nav (which lives over the editor) can reveal a review the rail is
 *  currently hiding inside a collapsed bucket. */
export interface GroupBrowserHandle {
  /** Expand the exact bucket containing the wheel target. No-op if it is already open. */
  revealBucket: (bucketKey: string) => void;
}

/**
 * The left-rail browse: pick ONE group dimension from the selector (or "All reviews"), then the
 * library is bucketed into a collapsible accordion — value buckets for a group, year-month buckets
 * for "All reviews". A review appears in every bucket it belongs to with zero copies. The same
 * gallery renders each bucket; opening from a value bucket flashes the carrying annotations.
 */
export const GroupBrowser = forwardRef<GroupBrowserHandle, Props>(function GroupBrowser(
  props,
  ref,
): JSX.Element {
  const { groups, pivot, buckets } = props;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // A fresh pivot starts fully expanded.
  useEffect(() => setCollapsed(new Set()), [pivot]);

  // Reveal a wheel target that sits in a collapsed bucket: expand that exact occurrence's bucket.
  useImperativeHandle(
    ref,
    () => ({
      revealBucket: (bucketKey: string): void => {
        setCollapsed((prev) => {
          if (!prev.has(bucketKey)) return prev;
          const next = new Set(prev);
          next.delete(bucketKey);
          return next;
        });
      },
    }),
    [],
  );

  // Keep the exact active occurrence in view after a wheel step or rail click (minimal scroll).
  useEffect(() => {
    if (!props.selectedOccurrence) return;
    railRef.current?.querySelector('.thumb.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [
    props.selectedOccurrence?.pivot,
    props.selectedOccurrence?.bucketKey,
    props.selectedOccurrence?.entryId,
  ]);

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
      {props.filterChips.length > 0 ? (
        <div className="filterbar" data-testid="filter-bar">
          <div className="filterbar__chips">
            {props.filterChips.map((c) => (
              <span key={`${c.scope}-${c.text}`} className={`fchip fchip--${c.scope}`} title={`${c.scope} condition`}>
                {c.text}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="filterbar__clear"
            data-testid="filter-clear"
            onClick={props.onClearFilter}
          >
            Clear
          </button>
        </div>
      ) : null}
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
        <button
          type="button"
          className="pivot__sort"
          data-testid="sort-toggle"
          data-dir={props.sortDir}
          title={props.sortDir === 'desc' ? 'Newest first' : 'Oldest first'}
          aria-label={
            props.sortDir === 'desc'
              ? 'Reviews sorted newest first — click for oldest first'
              : 'Reviews sorted oldest first — click for newest first'
          }
          onClick={props.onToggleSort}
        >
          <Icon name={props.sortDir === 'desc' ? 'sortdesc' : 'sortasc'} />
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

      <div className="buckets" data-testid="buckets" ref={railRef}>
        {props.error ? (
          <div className="thumbs__empty" data-testid="buckets-error" role="alert">
            <p>Couldn’t update reviews.</p>
            <button type="button" className="filterbar__clear" onClick={props.onRetry}>
              Retry
            </button>
          </div>
        ) : props.loading ? (
          <p className="thumbs__empty" data-testid="buckets-loading">Updating…</p>
        ) : buckets.length === 0 ? (
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
                      selectedId={
                        props.selectedOccurrence?.pivot === pivot &&
                        props.selectedOccurrence.bucketKey === bucket.key
                          ? props.selectedOccurrence.entryId
                          : null
                      }
                      onOpen={(entryId) =>
                        props.onOpen({ pivot, bucketKey: bucket.key, entryId, tag: bucket.tag })
                      }
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
});
