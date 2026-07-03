import { useEffect } from 'react';
import { Icon, type IconName } from './icons';

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  testId?: string;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A minimal right-click menu anchored at the cursor; closes on any outside interaction. */
export function ContextMenu({ x, y, items, onClose }: Props): JSX.Element {
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

  return (
    <div
      className="ctxmenu"
      data-testid="context-menu"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`ctxmenu__item${item.danger ? ' ctxmenu__item--danger' : ''}`}
          data-testid={item.testId}
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.icon ? <Icon name={item.icon} /> : null} {item.label}
        </button>
      ))}
    </div>
  );
}
