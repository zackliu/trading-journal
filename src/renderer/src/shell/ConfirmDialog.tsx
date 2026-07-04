import { useEffect, useRef } from 'react';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A small confirmation modal shown before archiving a vocabulary entry that reviews still use. */
export function ConfirmDialog(props: Props): JSX.Element {
  const cancelRef = useRef(props.onCancel);
  cancelRef.current = props.onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="modal confirm-scrim" data-testid="confirm-dialog" onMouseDown={() => props.onCancel()}>
      <div className="modal__panel confirm" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="confirm__title">{props.title}</h3>
        <p className="confirm__msg">{props.message}</p>
        <div className="confirm__foot">
          <button type="button" className="viewb__btn" data-testid="confirm-cancel" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="viewb__btn viewb__btn--danger"
            data-testid="confirm-ok"
            onClick={props.onConfirm}
          >
            {props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
