type Health = 'ok' | 'pending' | 'error';

interface Props {
  ipcHealth: Health;
  storeHealth: Health;
  storeLabel: string;
  dirty?: boolean;
  showZoom?: boolean;
  zoomPercent?: number;
  fitMode?: boolean;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomSet?: (percent: number) => void;
  onFit?: () => void;
}

export function StatusBar({
  ipcHealth,
  storeHealth,
  storeLabel,
  dirty,
  showZoom,
  zoomPercent = 100,
  fitMode,
  onZoomIn,
  onZoomOut,
  onZoomSet,
  onFit,
}: Props): JSX.Element {
  return (
    <footer className="foot">
      <span className="foot__item" data-testid="status-ipc">
        <span className={`dot dot--${ipcHealth}`} aria-hidden="true" /> Main IPC{' '}
        {ipcHealth === 'ok' ? 'connected' : ipcHealth}
      </span>
      <span className="foot__item" data-testid="status-store">
        <span className={`dot dot--${storeHealth}`} aria-hidden="true" /> {storeLabel}
      </span>
      {dirty !== undefined ? (
        <span className="foot__item foot__item--right" data-testid="dirty-state">
          {dirty ? 'Saving…' : 'All changes saved'}
        </span>
      ) : null}
      {showZoom ? (
        <span className="foot__zoom" data-testid="zoom-control">
          <button type="button" className="foot__zbtn" title="Zoom out" data-testid="zoom-out" onClick={onZoomOut}>
            −
          </button>
          <input
            type="range"
            className="foot__zslider"
            min={10}
            max={400}
            step={1}
            value={zoomPercent}
            aria-label="Zoom"
            onChange={(e) => onZoomSet?.(Number(e.target.value))}
          />
          <button type="button" className="foot__zbtn" title="Zoom in" data-testid="zoom-in" onClick={onZoomIn}>
            +
          </button>
          <button
            type="button"
            className={`foot__zpct${fitMode ? ' is-fit' : ''}`}
            title="Fit page to window"
            data-testid="zoom-fit"
            onClick={onFit}
          >
            {zoomPercent}%
          </button>
        </span>
      ) : null}
    </footer>
  );
}
