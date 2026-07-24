import { useEffect, useState } from 'react';
import { Icon, type IconName } from './icons';

export interface MenuItem {
  label: string;
  detail?: string;
  icon?: IconName;
  danger?: boolean;
  info?: boolean;
  active?: boolean;
  testId?: string;
  onClick?: () => void;
  items?: MenuItem[];
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A minimal right-click menu anchored at the cursor; closes on any outside interaction. */
export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  useEffect(() => {
    const close = (): void => onClose();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // Defer the dismiss listeners a tick so the opening right-click can't close it.
    const timer = window.setTimeout(() => {
      window.addEventListener('click', close);
      window.addEventListener('contextmenu', close);
    }, 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(x, window.innerWidth - 220));
  const top = Math.max(8, Math.min(y, window.innerHeight - 80));
  const submenuOpensLeft = left + 430 > window.innerWidth;

  const renderItems = (menuItems: MenuItem[], nested = false): JSX.Element[] =>
    menuItems.map((item, index) => {
      const key = item.testId ?? `${item.label}-${index}`;
      if (item.info) {
        return (
          <div className="ctxmenu__info" data-testid={item.testId} key={key}>
            {item.icon ? <Icon name={item.icon} /> : null}
            <span className="ctxmenu__info-copy">
              <span>{item.label}</span>
              {item.detail ? <strong>{item.detail}</strong> : null}
            </span>
          </div>
        );
      }
      if (item.items) {
        const isOpen = openSubmenu === key;
        return (
          <div
            className="ctxmenu__branch"
            key={key}
            onMouseEnter={() => setOpenSubmenu(key)}
          >
            <button
              type="button"
              className="ctxmenu__item ctxmenu__item--branch"
              data-testid={item.testId}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              onFocus={() => setOpenSubmenu(key)}
              onClick={(event) => {
                event.stopPropagation();
                setOpenSubmenu(key);
              }}
            >
              {item.icon ? <Icon name={item.icon} /> : null}
              <span>{item.label}</span>
              {item.detail ? <span className="ctxmenu__detail">{item.detail}</span> : null}
              <Icon name="chevronright" />
            </button>
            <div
              className={`ctxmenu ctxmenu__submenu${isOpen ? ' is-open' : ''}${submenuOpensLeft ? ' opens-left' : ''}`}
              role="menu"
            >
              {renderItems(item.items, true)}
            </div>
          </div>
        );
      }
      return (
        <button
          key={key}
          type="button"
          className={`ctxmenu__item${item.danger ? ' ctxmenu__item--danger' : ''}${item.active ? ' is-active' : ''}`}
          data-testid={item.testId}
          role={nested ? 'menuitem' : undefined}
          onMouseEnter={nested ? undefined : () => setOpenSubmenu(null)}
          onClick={() => {
            item.onClick?.();
            onClose();
          }}
        >
          {item.icon ? <Icon name={item.icon} /> : <span className="ctxmenu__icon-space" />}
          <span>{item.label}</span>
          {item.detail ? <span className="ctxmenu__detail">{item.detail}</span> : null}
          {item.active ? <Icon name="check" /> : null}
        </button>
      );
    });

  return (
    <div
      className="ctxmenu"
      data-testid="context-menu"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {renderItems(items)}
    </div>
  );
}
