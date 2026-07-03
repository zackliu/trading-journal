import { useEffect, useRef } from 'react';
import { CanvasController } from './canvasController';

interface Props {
  entryId: string;
  onReady: (controller: CanvasController) => void;
}

function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

export function CanvasEditor({ entryId, onReady }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = canvasRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;

    const controller = new CanvasController(el);
    onReady(controller);
    let disposed = false;

    const measure = (): void => {
      controller.setViewport(Math.max(320, stage.clientWidth - 32), Math.max(240, stage.clientHeight - 32));
    };
    measure();

    void (async () => {
      const entry = await window.api.getEntry(entryId);
      if (!entry || disposed) return;
      await controller.loadEntry(entry.canvasJson, entry.image ? `tj-image://${entry.image.hash}` : null);
    })();

    const resizeObs = new ResizeObserver(() => measure());
    resizeObs.observe(stage);

    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isTextTarget(e.target)) {
        controller.deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);

    return () => {
      disposed = true;
      resizeObs.disconnect();
      window.removeEventListener('keydown', onKey);
      controller.dispose();
    };
  }, [entryId, onReady]);

  return (
    <div className="editor" ref={stageRef} data-testid="editor">
      <div className="editor__stage">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
