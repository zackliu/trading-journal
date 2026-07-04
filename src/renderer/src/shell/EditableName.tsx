import { useState } from 'react';
import { Icon } from './icons';

interface Props {
  value: string;
  onSave: (label: string) => void;
  testId: string;
}

/**
 * A label with a small pencil that turns it into an inline input — the simple in-place rename used in
 * Settings. Enter / blur commits the new display label (the stable id never changes); Escape cancels.
 */
export function EditableName({ value, onSave, testId }: Props): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span className="ename">
        <span className="ename__text">{value}</span>
        <button
          type="button"
          className="ename__edit"
          aria-label="Rename"
          data-testid={`${testId}-edit`}
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
        >
          <Icon name="pencil" />
        </button>
      </span>
    );
  }

  const commit = (): void => {
    const next = draft.trim();
    if (next && next !== value) onSave(next);
    setEditing(false);
  };

  return (
    <input
      className="ename__input"
      autoFocus
      data-testid={`${testId}-input`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setEditing(false);
      }}
      onBlur={commit}
    />
  );
}
