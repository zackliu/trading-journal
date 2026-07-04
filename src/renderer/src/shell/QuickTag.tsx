import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Tag, TagGroupView } from '../../../shared/domain';

interface Props {
  /** The declared vocabulary (registry groups + values), in the user's Settings order. */
  groups: TagGroupView[];
  /** The target's current tags (entry-level for the Review tab, annotation-level for the Annotation tab). */
  selected: Tag[];
  onToggle: (tag: Tag, on: boolean) => void;
  onOpenSettings: () => void;
}

/**
 * The shared one-tap tagging control on the Review + Annotation ribbon tabs. Each pinned group is a
 * fixed-width block (values in Settings order, applied floated to the front so they always show);
 * anything that doesn't fit collapses into a "+N" that opens a bounded, scrollable, searchable drawer.
 * Selecting only — new values are created in Settings. Same mechanism for a whole review or one
 * annotation (no special annotation type).
 */
export function QuickTag({ groups, selected, onToggle, onOpenSettings }: Props): JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const pinned = groups.filter((g) => g.pinned);
  const shown = showAll || pinned.length === 0 ? groups : pinned;
  const hasHidden = pinned.length > 0 && groups.some((g) => !g.pinned);

  if (groups.length === 0) {
    return (
      <div className="qtag qtag--empty" data-testid="quick-tag">
        <span>No tag groups yet.</span>
        <button type="button" className="qtag__link" data-testid="quick-tag-settings" onClick={onOpenSettings}>
          Define groups in Settings
        </button>
      </div>
    );
  }

  return (
    <div className="qtag" data-testid="quick-tag">
      {shown.map((group) => (
        <GroupQuickPick key={group.id} group={group} selected={selected} onToggle={onToggle} />
      ))}
      {hasHidden ? (
        <button type="button" className="qtag__more" data-testid="quick-tag-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Fewer' : 'More…'}
        </button>
      ) : null}
    </div>
  );
}

function isOn(selected: Tag[], groupId: string, value: string): boolean {
  return selected.some((t) => t.group === groupId && t.value === value);
}

function GroupQuickPick({
  group,
  selected,
  onToggle,
}: {
  group: TagGroupView;
  selected: Tag[];
  onToggle: (tag: Tag, on: boolean) => void;
}): JSX.Element {
  const chipsRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [query, setQuery] = useState('');

  // Applied values float to the front (each partition in Settings order) so they're always visible.
  const applied = group.values.filter((v) => isOn(selected, group.id, v.value));
  const rest = group.values.filter((v) => !isOn(selected, group.id, v.value));
  const ordered = [...applied, ...rest];

  // Measure how many chips overflow the two-row area (a whole third-row chip → the "+N" count).
  useLayoutEffect(() => {
    const el = chipsRef.current;
    if (!el) return;
    const measure = (): void => {
      const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-chip]'));
      const h = el.clientHeight;
      let n = 0;
      for (const chip of chips) if (chip.offsetTop >= h) n += 1;
      setHidden(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [group.values, selected]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!drawerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    const timer = window.setTimeout(() => window.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const listed = q
    ? group.values.filter((v) => (v.label ?? v.value).toLowerCase().includes(q) || v.value.includes(q))
    : ordered;

  const toggleDrawer = (): void => {
    setOpen((o) => {
      const next = !o;
      if (next) {
        const r = groupRef.current?.getBoundingClientRect();
        if (r) setPos({ left: Math.min(r.left, window.innerWidth - 292), top: r.bottom + 4 });
        setQuery('');
      }
      return next;
    });
  };

  return (
    <div className="qtag__group" data-testid={`qtag-group-${group.id}`} ref={groupRef}>
      <div className="qtag__vals">
        <div className="qtag__chips" ref={chipsRef}>
          {ordered.map((v) => {
            const on = isOn(selected, group.id, v.value);
            return (
              <button
                key={v.value}
                type="button"
                data-chip=""
                className={`qchip${on ? ' is-on' : ''}`}
                data-testid={`qtag-${group.id}-${v.value}`}
                aria-pressed={on}
                title={v.label ?? v.value}
                onClick={() => onToggle({ group: group.id, value: v.value }, !on)}
              >
                {v.label ?? v.value}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={`qtag__expand${hidden === 0 ? ' is-empty' : ''}`}
          data-testid={`qtag-expand-${group.id}`}
          title="Show all"
          aria-hidden={hidden === 0}
          tabIndex={hidden === 0 ? -1 : 0}
          onClick={toggleDrawer}
        >
          +{hidden}
        </button>
      </div>
      <div className="qtag__label">{group.label}</div>

      {open ? (
        <div
          className="qdrawer"
          data-testid={`qtag-drawer-${group.id}`}
          ref={drawerRef}
          style={pos ? { left: pos.left, top: pos.top } : undefined}
        >
          <input
            className="qdrawer__search"
            autoFocus
            placeholder={`Search ${group.label}…`}
            data-testid={`qtag-search-${group.id}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="qdrawer__list">
            {listed.length === 0 ? (
              <div className="qdrawer__empty">No match.</div>
            ) : (
              listed.map((v) => {
                const on = isOn(selected, group.id, v.value);
                return (
                  <button
                    key={v.value}
                    type="button"
                    className={`qdrawer__item${on ? ' is-on' : ''}`}
                    data-testid={`qdrawer-${group.id}-${v.value}`}
                    onClick={() => onToggle({ group: group.id, value: v.value }, !on)}
                  >
                    <span className="qdrawer__check" aria-hidden="true" />
                    <span className="qdrawer__name">{v.label ?? v.value}</span>
                    <span className="qdrawer__count">{v.count}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
