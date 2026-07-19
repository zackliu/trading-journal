import { useEffect, useRef, useState } from 'react';

interface Props {
  initialText: string;
  initialLink: string;
  validateLink: (link: string) => Promise<string | null>;
  onSave: (text: string, link: string) => Promise<string | null>;
  onCancel: () => void;
}

export function LinkDialog(props: Props): JSX.Element {
  const [text, setText] = useState(props.initialText);
  const [link, setLink] = useState(props.initialLink);
  const [validation, setValidation] = useState<string | null>('Enter an internal link.');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef(0);
  const cancelRef = useRef(props.onCancel);
  cancelRef.current = props.onCancel;

  useEffect(() => {
    const request = ++requestRef.current;
    if (!link.trim()) {
      setChecking(false);
      setValidation('Enter an internal link.');
      return;
    }
    setChecking(true);
    void props.validateLink(link.trim()).then((message) => {
      if (request !== requestRef.current) return;
      setChecking(false);
      setValidation(message);
    });
  }, [link, props.validateLink]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const save = async (): Promise<void> => {
    if (!text || checking || validation || saving) return;
    setSaving(true);
    const message = await props.onSave(text, link.trim());
    if (message) {
      setValidation(message);
      setSaving(false);
    }
  };

  return (
    <div className="modal link-dialog-scrim" data-testid="link-dialog" onMouseDown={props.onCancel}>
      <form
        className="modal__panel link-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3 className="link-dialog__title">Hyperlink</h3>
        <label className="link-dialog__field">
          <span>Text to display</span>
          <input
            autoFocus
            data-testid="link-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="link-dialog__field">
          <span>Link</span>
          <input
            data-testid="link-address"
            spellCheck={false}
            value={link}
            onChange={(event) => setLink(event.target.value)}
          />
          <small className={`link-dialog__validation${validation ? ' link-dialog__validation--error' : ''}`}>
            {checking ? 'Checking…' : (validation ?? 'Internal target found')}
          </small>
        </label>
        <div className="link-dialog__foot">
          <button type="button" className="viewb__btn" onClick={props.onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            className="viewb__btn viewb__btn--primary"
            data-testid="link-save"
            disabled={!text || checking || validation !== null || saving}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}