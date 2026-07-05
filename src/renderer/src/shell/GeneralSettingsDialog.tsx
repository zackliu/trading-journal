import { useEffect, useRef } from 'react';
import { Icon } from './icons';

interface Props {
  dataDir: string | null;
  busy: boolean;
  error: string | null;
  onChange: () => void;
  onReveal: () => void;
  onClose: () => void;
}

/**
 * General settings (Home → Settings → General): shows where the journal data folder currently lives
 * and lets the user move it. Changing the folder points the app at the new location as-is (no copy of
 * existing data) and reloads; the app-config pointer that remembers this choice lives separately under
 * the OS user-data folder.
 */
export function GeneralSettingsDialog({ dataDir, busy, error, onChange, onReveal, onClose }: Props): JSX.Element {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal" data-testid="general-settings" onMouseDown={() => onClose()}>
      <div className="modal__panel settings" onMouseDown={(e) => e.stopPropagation()}>
        <header className="settings__head">
          <h2>General</h2>
          <button type="button" className="settings__close" aria-label="Close" data-testid="general-close" onClick={onClose}>
            <Icon name="back" />
          </button>
        </header>

        <div className="general">
          <div className="general__label">复盘数据文件夹</div>
          <div className="general__path" data-testid="general-path">
            {dataDir ?? '（未设置）'}
          </div>

          <div className="general__actions">
            <button type="button" className="settings__btn" data-testid="general-change" disabled={busy} onClick={onChange}>
              {busy ? '切换中…' : '更换文件夹…'}
            </button>
            <button type="button" className="general__btn" data-testid="general-reveal" disabled={busy || !dataDir} onClick={onReveal}>
              在资源管理器中打开
            </button>
          </div>
          {error ? <p className="general__error">{error}</p> : null}

          <p className="general__note">
            更换后应用会直接使用新文件夹里的数据（不会复制旧数据），并重新加载。若把数据放在 OneDrive
            等同步目录，请避免在两台机器上同时打开，以免同步过程中损坏数据。
          </p>
        </div>
      </div>
    </div>
  );
}
