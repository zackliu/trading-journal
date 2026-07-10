import type { EntrySummary } from '../../../shared/domain';

interface Props {
  entries: EntrySummary[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
}

/** One date per row: the review's `date` tag if set, else the day it was created. */
function formatDate(entry: EntrySummary): string {
  if (entry.date) return entry.date;
  return new Date(entry.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Left-rail gallery of review thumbnails (click to open, right-click for actions). */
export function Thumbnails({ entries, selectedId, onOpen, onContextMenu }: Props): JSX.Element {
  if (entries.length === 0) {
    return <p className="thumbs__empty">No reviews yet.</p>;
  }
  return (
    <div className="thumbs" data-testid="thumbs">
      {entries.map((entry) => {
        // The thumbnail is the rendered page (reflects every edit); the cover screenshot is only a
        // fallback for a freshly ingested review whose page has not been rendered yet.
        const src = entry.thumbnail ?? (entry.imageHash ? `tj-image://${entry.imageHash}` : null);
        return (
          <button
            type="button"
            key={entry.id}
            className={`thumb${entry.id === selectedId ? ' is-active' : ''}`}
            data-testid="entry-item"
            data-entry-id={entry.id}
            onClick={() => onOpen(entry.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              onContextMenu(entry.id, e.clientX, e.clientY);
            }}
          >
            {src ? (
              <img className="thumb__img" src={src} alt="review preview" />
            ) : (
              <span className="thumb__img" aria-hidden="true" />
            )}
            <span className="thumb__meta">
              <span className="thumb__date">{formatDate(entry)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
