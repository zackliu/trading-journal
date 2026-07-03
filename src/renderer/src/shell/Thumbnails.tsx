import type { EntrySummary } from '../../../shared/domain';

interface Props {
  entries: EntrySummary[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Left-rail gallery of review thumbnails (click to open, right-click for actions). */
export function Thumbnails({ entries, selectedId, onOpen, onContextMenu }: Props): JSX.Element {
  if (entries.length === 0) {
    return <p className="thumbs__empty">No reviews yet.</p>;
  }
  return (
    <div className="thumbs" data-testid="thumbs">
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.id}
          className={`thumb${entry.id === selectedId ? ' is-active' : ''}`}
          data-testid="entry-item"
          onClick={() => onOpen(entry.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(entry.id, e.clientX, e.clientY);
          }}
        >
          {entry.imageHash ? (
            <img className="thumb__img" src={`tj-image://${entry.imageHash}`} alt="chart screenshot" />
          ) : (
            <span className="thumb__img thumb__img--blank">blank</span>
          )}
          <span className="thumb__meta">
            <span className="thumb__date">{entry.date ?? '—'}</span>
            <span className="thumb__when">{formatWhen(entry.createdAt)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
