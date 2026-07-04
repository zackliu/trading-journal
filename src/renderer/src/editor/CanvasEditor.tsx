import { useEffect, useRef } from 'react';
import { CanvasController } from './canvasController';

interface Props {
  entryId: string;
  onReady: (controller: CanvasController) => void;
  onLoaded?: () => void;
  /** Wheel past the top/bottom of the (possibly scrolled) stage steps to the prev/next review. */
  onWheelNavigate?: (dir: 1 | -1) => void;
}

function isTextTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
  );
}

export function CanvasEditor({ entryId, onReady, onLoaded, onWheelNavigate }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      const [entry, lib] = await Promise.all([window.api.getEntry(entryId), window.api.getStampLibrary()]);
      if (!entry || disposed) return;
      await controller.loadEntry(
        entry.canvasJson,
        entry.image ? `tj-image://${entry.image.hash}` : null,
        lib.canvasJson,
      );
      if (!disposed) onLoaded?.();
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
  }, [entryId, onReady, onLoaded]);

  // Wheel over the stage scrolls it; once it can't scroll further that way (or the page fits with no
  // scrollbar), the wheel steps to the previous / next review. React's onWheel is passive and can't
  // preventDefault, so attach a non-passive native listener.
  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || !onWheelNavigate) return;
    const onWheel = (e: WheelEvent): void => {
      if (Math.abs(e.deltaY) < 1) return;
      const goingDown = e.deltaY > 0;
      const atBottom = scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2;
      const atTop = scroll.scrollTop <= 1;
      if (goingDown ? !atBottom : !atTop) return; // still room to scroll → let the stage scroll
      e.preventDefault();
      onWheelNavigate(goingDown ? 1 : -1);
    };
    scroll.addEventListener('wheel', onWheel, { passive: false });
    return () => scroll.removeEventListener('wheel', onWheel);
  }, [onWheelNavigate]);

  return (
    <div className="editor" ref={stageRef} data-testid="editor">
      <div className="editor__stage" ref={scrollRef}>
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
