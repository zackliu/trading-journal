import type { WorkspaceState } from '../../../shared/domain';

interface Props {
  state: WorkspaceState;
  busy: boolean;
  error: string | null;
  onChoose: () => void;
  onRetry: () => void;
  onQuit: () => void;
}

/**
 * The blocking setup gate shown before the app whenever no usable data folder is configured. There is
 * no default location — the user must point the app at a folder for their journal data (which they may
 * keep on OneDrive, etc.). A configured-but-missing folder lands here too: the user re-picks, or
 * prepares that folder and retries. Until a folder is ready, the app does not open.
 */
export function SetupGate({ state, busy, error, onChoose, onRetry, onQuit }: Props): JSX.Element {
  const missing = state.status === 'missing';
  const unwritable = state.status === 'unwritable';
  const canRetry = missing || unwritable;

  return (
    <div className="setup" data-testid="setup-gate" data-status={state.status}>
      <div className="setup__card">
        <h1 className="setup__title">选择复盘数据文件夹</h1>
        <p className="setup__lead">
          你的复盘数据（<code>app.sqlite</code> 与 <code>images/</code>）会存放在你选择的文件夹里。可以放到 OneDrive
          之类的同步目录，方便备份和多机访问。应用自身的设置存在别处，不会跟着一起同步。
        </p>

        {missing ? (
          <p className="setup__warn" data-testid="setup-warn">
            找不到上次使用的数据文件夹：
            <code className="setup__path">{state.dataDir}</code>
            请重新选择一个文件夹，或在该位置准备好这个文件夹后点“重试”。
          </p>
        ) : null}
        {unwritable ? (
          <p className="setup__warn" data-testid="setup-warn">
            这个文件夹不可写：
            <code className="setup__path">{state.dataDir}</code>
            请换一个文件夹，或修复它的写入权限后点“重试”。
          </p>
        ) : null}
        {error ? <p className="setup__error">{error}</p> : null}

        <div className="setup__actions">
          <button
            type="button"
            className="setup__btn setup__btn--primary"
            data-testid="setup-choose"
            disabled={busy}
            onClick={onChoose}
          >
            {busy ? '打开中…' : '选择文件夹…'}
          </button>
          {canRetry ? (
            <button type="button" className="setup__btn" data-testid="setup-retry" disabled={busy} onClick={onRetry}>
              重试
            </button>
          ) : null}
          <button type="button" className="setup__btn setup__btn--ghost" data-testid="setup-quit" onClick={onQuit}>
            退出
          </button>
        </div>
      </div>
    </div>
  );
}
