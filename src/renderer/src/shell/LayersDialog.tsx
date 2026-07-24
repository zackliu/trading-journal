import { useEffect, useRef, useState } from 'react';
import type { CanvasLayer, CanvasLayerDeletionImpact, CanvasLayerUsage } from '../../../shared/domain';
import { ConfirmDialog } from './ConfirmDialog';
import { EditableName } from './EditableName';
import { Icon } from './icons';

interface Props {
  layers: CanvasLayer[];
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onReorder: (ids: string[]) => Promise<void>;
  onInspectDelete: (id: string) => Promise<CanvasLayerDeletionImpact>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function LayersDialog(props: Props): JSX.Element {
  const [name, setName] = useState('');
  const [pending, setPending] = useState<CanvasLayerDeletionImpact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<CanvasLayerUsage[] | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pending) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending]);

  useEffect(() => {
    let active = true;
    void window.api.listCanvasLayerUsage().then(
      (next) => {
        if (active) setUsage(next);
      },
      (err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      active = false;
    };
  }, [props.layers]);

  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const add = (): void => {
    const value = name.trim();
    if (!value) return;
    void run(async () => {
      await props.onCreate(value);
      setName('');
    });
  };

  const requestDelete = (id: string): void => {
    void run(async () => setPending(await props.onInspectDelete(id)));
  };

  const confirmDelete = (): void => {
    if (!pending) return;
    const id = pending.layer.id;
    void run(async () => {
      await props.onDelete(id);
      setPending(null);
    });
  };

  const displayLayers = usage ? [...usage].reverse() : [];
  const isUnused = (layer: CanvasLayerUsage): boolean =>
    !layer.isBase && layer.objectCount === 0 && layer.stampCount === 0;

  const previewDrop = (event: React.DragEvent<HTMLDivElement>, targetId: string): void => {
    if (!draggedId || targetId === draggedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const remaining = displayLayers.filter((layer) => layer.id !== draggedId);
    const targetIndex = remaining.findIndex((layer) => layer.id === targetId);
    if (targetIndex < 0) return;
    const target = event.currentTarget.getBoundingClientRect();
    const after = event.clientY >= target.top + target.height / 2;
    const baseIndex = remaining.findIndex((layer) => layer.isBase);
    setDropIndex(Math.min(targetIndex + (after ? 1 : 0), baseIndex));
  };

  const commitDrop = (event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (!draggedId || dropIndex === null) return;
    const remaining = displayLayers.filter((layer) => layer.id !== draggedId);
    const dragged = displayLayers.find((layer) => layer.id === draggedId);
    if (!dragged) return;
    const nextDisplay = [...remaining];
    nextDisplay.splice(dropIndex, 0, dragged);
    const nextBottomToTop = [...nextDisplay].reverse();
    void run(async () => {
      await props.onReorder(nextBottomToTop.map((layer) => layer.id));
      setUsage(nextBottomToTop);
    });
    setDraggedId(null);
    setDropIndex(null);
  };

  return (
    <div className="modal" data-testid="layers-dialog" onMouseDown={() => props.onClose()}>
      <div className="modal__panel settings" onMouseDown={(event) => event.stopPropagation()}>
        <header className="settings__head">
          <div>
            <h2>图层管理</h2>
            <p className="layers__subtitle">越靠上越晚绘制，也会覆盖下方内容</p>
          </div>
          <button type="button" className="settings__close" aria-label="关闭" onClick={props.onClose}>
            <Icon name="back" />
          </button>
        </header>

        <div className="settings__new">
          <input
            className="settings__input"
            data-testid="layers-name"
            placeholder="新建顶层图层"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add();
            }}
          />
          <button type="button" className="settings__btn" data-testid="layers-add" disabled={busy || !name.trim()} onClick={add}>
            新建图层
          </button>
        </div>
        {error ? <div className="settings__error">{error}</div> : null}

        <div className="settings__list layers" data-testid="layers-list" onDrop={commitDrop}>
          <div className="layers__direction layers__direction--top"><span>最上层</span><span>覆盖下方</span></div>
          {usage === null ? <div className="layers__loading">正在读取图层使用情况…</div> : null}
          {displayLayers.map((layer, index) => (
            <div className="layers__item" key={layer.id}>
              <div className={`layers__slot${dropIndex === index ? ' is-active' : ''}`} />
              <div
                className={`layers__row${draggedId === layer.id ? ' is-dragging' : ''}${layer.isBase ? ' is-base' : ''}`}
                data-testid={`layer-${layer.id}`}
                draggable={!busy && isUnused(layer)}
                onDragStart={(event) => {
                  if (!isUnused(layer)) return;
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', layer.id);
                  setDraggedId(layer.id);
                  setDropIndex(index);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDropIndex(null);
                }}
                onDragOver={(event) => previewDrop(event, layer.id)}
              >
                <span className={`layers__handle${isUnused(layer) ? '' : ' is-locked'}`} aria-hidden="true">
                  <Icon name={isUnused(layer) ? 'grip' : 'lock'} />
                </span>
                <div className="layers__main">
                <EditableName
                  value={layer.name}
                  testId={`layer-name-${layer.id}`}
                  onSave={(value) => void run(() => props.onRename(layer.id, value))}
                />
                  <span className={`layers__usage${isUnused(layer) ? ' is-empty' : ''}`}>
                    {layer.isBase
                      ? '永久基层'
                      : isUnused(layer)
                        ? '空图层 · 可拖动调整'
                        : `${layer.objectCount} 个页面对象${layer.stampCount ? ` · ${layer.stampCount} 个图章` : ''}`}
                  </span>
                </div>
                {!layer.isBase ? (
                  <button
                    type="button"
                    className="settings__icon settings__icon--danger"
                    aria-label={`删除 ${layer.name}`}
                    data-testid={`layer-delete-${layer.id}`}
                    disabled={busy}
                    onClick={() => requestDelete(layer.id)}
                  >
                    <Icon name="trash" />
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <div className="layers__direction layers__direction--bottom"><span>最下层</span><span>固定基层</span></div>
        </div>
      </div>

      {pending ? (
        <ConfirmDialog
          title={`删除图层“${pending.layer.name}”？`}
          message={`该图层涉及 ${pending.entryCount} 条复盘、${pending.objectCount} 个页面对象和 ${pending.stampCount} 个图章。删除后它们会并入下方图层“${pending.mergeInto.name}”，对象内容和视觉顺序不会改变，但原图层结构无法恢复。`}
          confirmLabel="删除并合并"
          onConfirm={confirmDelete}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </div>
  );
}
