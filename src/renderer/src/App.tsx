import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { EntrySummary, ResultDimension, Tag, TagGroup, TagGroupView, TagValue } from '../../shared/domain';
import type { PingResult } from '../../shared/ipc';
import { CanvasEditor } from './editor/CanvasEditor';
import type { AnnotationSelection, CanvasController, DrawStyle, EditorState, Tool } from './editor/canvasController';
import { ContextMenu, type MenuItem } from './shell/ContextMenu';
import { GroupBrowser, type Bucket } from './shell/GroupBrowser';
import { Icon } from './shell/icons';
import { Ribbon } from './shell/Ribbon';
import { SettingsDialog } from './shell/SettingsDialog';
import { StatusBar } from './shell/StatusBar';
import { TagPopover, type AnnotationEdits } from './shell/TagPopover';

type Health = 'ok' | 'pending' | 'error';
type Menu = { x: number; y: number; items: MenuItem[] };

const DEFAULT_STYLE: DrawStyle = {
  stroke: '#f85149',
  fill: 'transparent',
  opacity: 1,
  strokeWidth: 3,
  dash: 'solid',
  borderless: false,
  textColor: '#111827',
  fontSize: 22,
};
const EMPTY_EDITOR: EditorState = { canUndo: false, canRedo: false, dirty: false, hasSelection: false };

async function fileToBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Group all reviews into year-month buckets (newest first) for the “All reviews” pivot. Derived from
 *  the structural `date` (or the created day), never a declared group / never a tagging option. */
function yearMonthBuckets(entries: EntrySummary[]): Bucket[] {
  const byMonth = new Map<string, EntrySummary[]>();
  for (const entry of entries) {
    const day = entry.date ?? new Date(entry.createdAt).toISOString().slice(0, 10);
    const ym = day.slice(0, 7);
    const list = byMonth.get(ym);
    if (list) list.push(entry);
    else byMonth.set(ym, [entry]);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([ym, list]) => ({ key: ym, label: ym, entries: list }));
}

export function App(): JSX.Element {
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [pivot, setPivot] = useState('all');
  const [groups, setGroups] = useState<TagGroupView[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [entryUserTags, setEntryUserTags] = useState<Tag[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationSelection | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ipcHealth, setIpcHealth] = useState<Health>('pending');
  const [storeHealth, setStoreHealth] = useState<Health>('pending');
  const [storeLabel, setStoreLabel] = useState('opening…');

  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<DrawStyle>(DEFAULT_STYLE);
  const [editorState, setEditorState] = useState<EditorState>(EMPTY_EDITOR);
  const [zoom, setZoom] = useState<{ percent: number; fitMode: boolean }>({ percent: 100, fitMode: true });
  const [popover, setPopover] = useState<{ annotation: AnnotationSelection; x: number; y: number } | null>(null);
  const [dimensions, setDimensions] = useState<ResultDimension[]>([]);
  const [linkClipboard, setLinkClipboard] = useState<{ entryId: string; annotationId: string } | null>(null);
  const [stampLocked, setStampLocked] = useState(true);
  const controllerRef = useRef<CanvasController | null>(null);
  const pendingSelectRef = useRef<string | null>(null);
  const styleRef = useRef(style);
  const saveRunningRef = useRef<Promise<void> | null>(null);
  const saveAgainRef = useRef(false);
  const stampLockedRef = useRef(stampLocked);
  const selectedEntryIdRef = useRef(selectedEntryId);
  const entriesRef = useRef(entries);
  const switchToRef = useRef<(id: string | null) => Promise<void>>(async () => {});
  const wheelNavAtRef = useRef(0);
  const drawingClipboardRef = useRef<Record<string, unknown> | null>(null);
  const pendingFlashRef = useRef<Tag | null>(null);
  const entryUserTagsRef = useRef(entryUserTags);
  const selectedAnnotationRef = useRef(selectedAnnotation);

  const refresh = useCallback(async () => {
    setEntries(await window.api.listEntries());
  }, []);

  const refreshDimensions = useCallback(async () => {
    setDimensions(await window.api.listResultDimensions());
  }, []);

  const refreshGroups = useCallback(async () => {
    setGroups(await window.api.listGroups());
  }, []);

  useEffect(() => {
    void refresh();
    void refreshDimensions();
    void refreshGroups();
    window.api
      .ping()
      .then((res: PingResult) => {
        setIpcHealth(res.ok ? 'ok' : 'error');
        setStoreHealth(res.sqliteReady ? 'ok' : 'error');
        setStoreLabel(res.sqliteReady ? `SQLite v${res.userVersion}` : 'unavailable');
      })
      .catch(() => {
        setIpcHealth('error');
        setStoreHealth('error');
        setStoreLabel('unavailable');
      });
  }, [refresh, refreshDimensions, refreshGroups]);

  const entryOpen = selectedEntryId !== null;

  // Auto-save engine — editing IS saving, there is no manual-save ritual. Every committed edit calls
  // this. It coalesces concurrent calls (one write in flight; a request during a write re-runs once
  // after), always serializes the latest state, and mirrors the page into the rail thumbnail live.
  const saveNow = useCallback((): Promise<void> => {
    if (saveRunningRef.current) {
      saveAgainRef.current = true;
      return saveRunningRef.current;
    }
    const run = async (): Promise<void> => {
      try {
        do {
          saveAgainRef.current = false;
          const controller = controllerRef.current;
          const id = selectedEntryIdRef.current;
          if (!controller || !id) break;
          const thumbnail = controller.renderThumbnail();
          setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, thumbnail } : e)));
          await window.api.updateEntryCanvas(
            id,
            controller.serializePage(),
            controller.extractAnnotations(),
            thumbnail,
          );
          await window.api.saveStampLibrary(controller.serializeStrip());
          controller.markSaved();
        } while (saveAgainRef.current);
      } finally {
        saveRunningRef.current = null;
      }
    };
    saveRunningRef.current = run();
    return saveRunningRef.current;
  }, []);

  useEffect(() => {
    styleRef.current = style;
  }, [style]);
  useEffect(() => {
    stampLockedRef.current = stampLocked;
    controllerRef.current?.setPaletteLocked(stampLocked);
  }, [stampLocked]);
  useEffect(() => {
    selectedEntryIdRef.current = selectedEntryId;
  }, [selectedEntryId]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    entryUserTagsRef.current = entryUserTags;
  }, [entryUserTags]);
  useEffect(() => {
    selectedAnnotationRef.current = selectedAnnotation;
  }, [selectedAnnotation]);

  // Load the open review's user (non-`date`) entry tags for the Review tab quick-pick.
  useEffect(() => {
    if (!selectedEntryId) {
      setEntryUserTags([]);
      return;
    }
    let cancelled = false;
    void window.api.getEntry(selectedEntryId).then((entry) => {
      if (!cancelled && entry) setEntryUserTags(entry.entryTags.filter((t) => t.group !== 'date'));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEntryId]);

  // Compute the left-rail browse buckets for the active pivot: year-month for “All reviews”, else the
  // selected group's value buckets (entry ∪ annotation, via the store — never scanning canvas JSON).
  useEffect(() => {
    if (pivot === 'all') {
      setBuckets(yearMonthBuckets(entries));
      return;
    }
    const group = groups.find((g) => g.id === pivot);
    if (!group) {
      setBuckets([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const next: Bucket[] = [];
      for (const value of group.values) {
        const hits = await window.api.queryEntriesByTag({ group: group.id, value: value.value });
        next.push({
          key: value.value,
          label: value.label ?? value.value,
          entries: hits,
          tag: { group: group.id, value: value.value },
        });
      }
      if (!cancelled) setBuckets(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pivot, groups, entries]);

  const switchTo = useCallback(
    async (nextId: string | null) => {
      if (nextId === selectedEntryIdRef.current) return; // already open — re-selecting is a no-op
      if (editorState.dirty) await saveNow();
      controllerRef.current = null;
      setSelectedEntryId(nextId);
      setTool('select');
      setEditorState(EMPTY_EDITOR);
      setPopover(null);
      setSelectedAnnotation(null);
      await refresh();
    },
    [editorState.dirty, saveNow, refresh],
  );
  useEffect(() => {
    switchToRef.current = switchTo;
  }, [switchTo]);

  // Wheel past a stage edge steps through the rail: down = next (further down the list), up = previous.
  const onWheelNavigate = useCallback((dir: 1 | -1): void => {
    const now = Date.now();
    if (now - wheelNavAtRef.current < 450) return; // one step per scroll gesture
    const list = entriesRef.current;
    const idx = list.findIndex((e) => e.id === selectedEntryIdRef.current);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= list.length) return; // at the ends, stay put
    wheelNavAtRef.current = now;
    void switchToRef.current(list[target].id);
  }, []);

  const createNew = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const entry = await window.api.newEntry();
      await switchTo(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [switchTo]);

  // Ctrl/Cmd+N creates a new blank review.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        void createNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [createNew]);

  // Paste/drop an image: add it as a movable object on the open review, or capture a new one.
  const addImage = useCallback(
    async (bytes: Uint8Array) => {
      setBusy(true);
      setError(null);
      try {
        if (selectedEntryId && controllerRef.current) {
          const { hash } = await window.api.storeImage(bytes);
          const { isFirst } = await controllerRef.current.addImage(`tj-image://${hash}`);
          if (isFirst) await window.api.setEntryImage(selectedEntryId, hash);
          // addImage() commits history → auto-saves the canvas + thumbnail via onContentChanged.
        } else {
          const entry = await window.api.ingestImageEntry(bytes);
          await switchTo(entry.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [selectedEntryId, switchTo],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      setMenu(null);
      await window.api.deleteEntry(id);
      if (id === selectedEntryId) {
        controllerRef.current = null;
        setSelectedEntryId(null);
        setEditorState(EMPTY_EDITOR);
        setPopover(null);
      }
      await refresh();
    },
    [selectedEntryId, refresh],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      // Unified "paste to page": an internally copied drawing pastes an independent copy;
      // otherwise a system-clipboard screenshot pastes as an image object (the ingest path).
      const clip = drawingClipboardRef.current;
      if (clip && selectedEntryIdRef.current && controllerRef.current) {
        event.preventDefault();
        void controllerRef.current.pasteSerializedAnnotation(clip);
        return;
      }
      const items = event.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            void fileToBytes(file).then(addImage);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImage]);

  // Ctrl+C copies the selected drawing into an internal clipboard (for the unified Ctrl+V paste).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'c') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const copied = controllerRef.current?.copyActiveAnnotation() ?? null;
      if (copied) {
        drawingClipboardRef.current = copied;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Ctrl/Cmd+S: a habitual "save now". Auto-save already persists every edit, so this just flushes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  // Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo. Skipped while typing in a field (native undo wins).
  // Undo/redo bypass the history, so persist the result to keep the DB + thumbnail in step with the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const controller = controllerRef.current;
      if (!controller) return;
      e.preventDefault();
      const redo = key === 'y' || (key === 'z' && e.shiftKey);
      void (redo ? controller.redo() : controller.undo()).then(() => saveNow());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const file = event.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) void fileToBytes(file).then(addImage);
    },
    [addImage],
  );

  const onReady = useCallback((controller: CanvasController) => {
    controllerRef.current = controller;
    controller.onState(setEditorState);
    controller.onToolChange(setTool);
    controller.onContext((r) => {
      const items: MenuItem[] = [];
      if (r.annotation) {
        const ann = r.annotation;
        const px = r.x;
        const py = r.y;
        items.push({
          label: 'Result & links…',
          icon: 'tag',
          testId: 'menu-result-links',
          onClick: () => setPopover({ annotation: ann, x: px, y: py }),
        });
      }
      if (r.isLocked) {
        items.push({
          label: 'Unlock',
          icon: 'unlock',
          testId: 'menu-unlock',
          onClick: () => controllerRef.current?.unlockContext(),
        });
        items.push({
          label: 'Bring to front',
          icon: 'front',
          onClick: () => controllerRef.current?.bringContextToFront(),
        });
        items.push({
          label: 'Send to back',
          icon: 'sendtoback',
          onClick: () => controllerRef.current?.sendContextToBack(),
        });
      } else if (r.hasSelection) {
        if (r.isImage) {
          items.push({
            label: 'Fit to canvas',
            icon: 'fit',
            onClick: () => controllerRef.current?.fitActiveToCanvas(),
          });
        }
        items.push({
          label: 'Bring to front',
          icon: 'front',
          onClick: () => controllerRef.current?.bringToFront(),
        });
        items.push({
          label: 'Send to back',
          icon: 'sendtoback',
          onClick: () => controllerRef.current?.sendToBack(),
        });
        items.push({
          label: 'Lock',
          icon: 'lock',
          testId: 'menu-lock',
          onClick: () => controllerRef.current?.lockActive(),
        });
        items.push({
          label: 'Delete',
          icon: 'trash',
          danger: true,
          onClick: () => controllerRef.current?.deleteSelected(),
        });
      }
      if (items.length > 0) setMenu({ x: r.x, y: r.y, items });
    });
    controller.onZoom(setZoom);
    // Every committed edit auto-saves the Entry page + stamp library and mirrors the rail thumbnail.
    controller.onContentChanged(() => void saveNow());
    // Selecting an annotation surfaces the contextual Annotation ribbon tab (tags target this object).
    controller.onAnnotationSelection(setSelectedAnnotation);
    controller.setPaletteLocked(stampLockedRef.current);
    controller.setStyle(styleRef.current);
  }, [saveNow]);

  const pickTool = useCallback((next: Tool) => {
    setTool(next);
    controllerRef.current?.setTool(next);
  }, []);
  const changeStyle = useCallback((patch: Partial<DrawStyle>) => {
    setStyle((prev) => ({ ...prev, ...patch }));
    controllerRef.current?.setStyle(patch);
  }, []);

  const openThumbMenu = useCallback(
    (id: string, x: number, y: number) => {
      setMenu({
        x,
        y,
        items: [
          {
            label: 'Delete review',
            icon: 'trash',
            danger: true,
            testId: 'context-delete',
            onClick: () => void removeEntry(id),
          },
        ],
      });
    },
    [removeEntry],
  );

  const onDefineDimension = useCallback(
    async (dim: ResultDimension) => {
      await window.api.defineResultDimension(dim);
      await refreshDimensions();
    },
    [refreshDimensions],
  );
  const onCopyLinkTarget = useCallback(
    (annotationId: string) => {
      if (selectedEntryId) setLinkClipboard({ entryId: selectedEntryId, annotationId });
    },
    [selectedEntryId],
  );
  const onPopoverSave = useCallback(
    (edits: AnnotationEdits) => {
      if (popover) {
        controllerRef.current?.setAnnotationResultLinks(popover.annotation.id, edits.result, edits.links);
      }
      setPopover(null);
    },
    [popover],
  );

  const onToggleStampLock = useCallback(() => setStampLocked((v) => !v), []);
  const jumpToAnnotation = useCallback(
    async (annotationId: string) => {
      setPopover(null);
      const loc = await window.api.locateAnnotation(annotationId);
      if (!loc) return;
      if (loc.entryId === selectedEntryId) {
        controllerRef.current?.selectAnnotationById(annotationId);
      } else {
        pendingSelectRef.current = annotationId;
        await switchTo(loc.entryId);
      }
    },
    [selectedEntryId, switchTo],
  );
  // Toggle a tag on the whole review (Review tab quick-pick). Entry tags save immediately.
  const onToggleEntryTag = useCallback(
    (tag: Tag, on: boolean) => {
      const id = selectedEntryIdRef.current;
      if (!id) return;
      const cur = entryUserTagsRef.current;
      const has = cur.some((t) => t.group === tag.group && t.value === tag.value);
      const next = on ? (has ? cur : [...cur, tag]) : cur.filter((t) => !(t.group === tag.group && t.value === tag.value));
      setEntryUserTags(next);
      void window.api.setEntryTags(id, next).then(() => {
        void refresh();
        void refreshGroups();
      });
    },
    [refresh, refreshGroups],
  );

  // Toggle a tag on the selected annotation (Annotation contextual tab). Preserves its result / links.
  const onToggleAnnotationTag = useCallback(
    (tag: Tag, on: boolean) => {
      const sel = selectedAnnotationRef.current;
      if (!sel) return;
      const has = sel.tags.some((t) => t.group === tag.group && t.value === tag.value);
      const next = on ? (has ? sel.tags : [...sel.tags, tag]) : sel.tags.filter((t) => !(t.group === tag.group && t.value === tag.value));
      controllerRef.current?.applyAnnotationEdits(sel.id, next, sel.result, sel.links);
      void saveNow().then(() => {
        void refresh();
        void refreshGroups();
      });
    },
    [saveNow, refresh, refreshGroups],
  );

  // Settings window: declare / delete groups & values, pin for quick-pick (registry writes only).
  const onDefineGroup = useCallback(async (group: TagGroup) => {
    await window.api.defineGroup(group);
    await refreshGroups();
  }, [refreshGroups]);
  const onDeleteGroup = useCallback(async (id: string) => {
    await window.api.deleteGroup(id);
    await refreshGroups();
  }, [refreshGroups]);
  const onDefineValueCfg = useCallback(async (value: TagValue) => {
    await window.api.defineValue(value);
    await refreshGroups();
  }, [refreshGroups]);
  const onDeleteValue = useCallback(async (groupId: string, value: string) => {
    await window.api.deleteValue(groupId, value);
    await refreshGroups();
  }, [refreshGroups]);
  const onSetPinned = useCallback(async (id: string, pinned: boolean) => {
    await window.api.setGroupPinned(id, pinned);
    await refreshGroups();
  }, [refreshGroups]);
  const onReorderGroups = useCallback(async (ids: string[]) => {
    await window.api.reorderGroups(ids);
    await refreshGroups();
  }, [refreshGroups]);
  const onReorderValues = useCallback(async (groupId: string, values: string[]) => {
    await window.api.reorderValues(groupId, values);
    await refreshGroups();
  }, [refreshGroups]);

  // Open a review from a browse bucket; a value bucket's tag briefly highlights its carriers.
  const openFromBrowse = useCallback(
    async (id: string, tag?: Tag) => {
      if (id === selectedEntryIdRef.current) {
        if (tag) controllerRef.current?.flashTagHighlight(tag);
        return;
      }
      pendingFlashRef.current = tag ?? null;
      await switchTo(id);
    },
    [switchTo],
  );

  const onEditorLoaded = useCallback(() => {
    const pending = pendingSelectRef.current;
    if (pending) {
      controllerRef.current?.selectAnnotationById(pending);
      pendingSelectRef.current = null;
    }
    const flashTag = pendingFlashRef.current;
    if (flashTag) {
      controllerRef.current?.flashTagHighlight(flashTag);
      pendingFlashRef.current = null;
    }
  }, []);

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <Ribbon
        entryOpen={entryOpen}
        entryId={selectedEntryId}
        hasSelection={editorState.hasSelection}
        tool={tool}
        style={style}
        canUndo={editorState.canUndo}
        canRedo={editorState.canRedo}
        onNew={() => void createNew()}
        onDeleteReview={() => {
          if (selectedEntryId) void removeEntry(selectedEntryId);
        }}
        onTool={pickTool}
        onStyle={changeStyle}
        onUndo={() => void controllerRef.current?.undo().then(() => saveNow())}
        onRedo={() => void controllerRef.current?.redo().then(() => saveNow())}
        onDeleteSelected={() => controllerRef.current?.deleteSelected()}
        onBringToFront={() => controllerRef.current?.bringToFront()}
        onSendToBack={() => controllerRef.current?.sendToBack()}
        onFitToCanvas={() => controllerRef.current?.fitActiveToCanvas()}
        onSave={() => void saveNow()}
        stampLocked={stampLocked}
        onToggleStampLock={onToggleStampLock}
        groups={groups}
        entryTags={entryUserTags}
        selectedAnnotation={selectedAnnotation}
        onToggleEntryTag={onToggleEntryTag}
        onToggleAnnotationTag={onToggleAnnotationTag}
        onOpenSettings={() => setShowSettings(true)}
      />

      <div className="body">
        <aside className="rail">
          <GroupBrowser
            groups={groups}
            pivot={pivot}
            onPivot={setPivot}
            buckets={buckets}
            totalCount={entries.length}
            selectedEntryId={selectedEntryId}
            onOpen={(id, tag) => void openFromBrowse(id, tag)}
            onContextMenu={openThumbMenu}
          />
        </aside>

        <main className="main">
          {error ? (
            <div className="notice notice--error" data-testid="ingest-error">
              {error}
            </div>
          ) : null}
          {busy ? <div className="notice">Working…</div> : null}
          {selectedEntryId ? (
            <CanvasEditor
              key={selectedEntryId}
              entryId={selectedEntryId}
              onReady={onReady}
              onLoaded={onEditorLoaded}
              onWheelNavigate={onWheelNavigate}
            />
          ) : (
            <div className="empty-state" data-testid="empty-state">
              <div className="empty-state__card">
                <h2>Start a review</h2>
                <p>Create a blank review and paste a chart into it — or paste a screenshot to capture one directly.</p>
                <button
                  type="button"
                  className="empty-state__new"
                  data-testid="empty-new"
                  onClick={() => void createNew()}
                >
                  <Icon name="plus" /> New review
                </button>
                <span className="empty-state__hint">or press Ctrl+V · or drop an image</span>
              </div>
            </div>
          )}
        </main>
      </div>

      <StatusBar
        ipcHealth={ipcHealth}
        storeHealth={storeHealth}
        storeLabel={storeLabel}
        dirty={entryOpen ? editorState.dirty : undefined}
        showZoom={entryOpen}
        zoomPercent={zoom.percent}
        fitMode={zoom.fitMode}
        onZoomIn={() => controllerRef.current?.zoomIn()}
        onZoomOut={() => controllerRef.current?.zoomOut()}
        onZoomSet={(p) => controllerRef.current?.setZoomPercent(p)}
        onFit={() => controllerRef.current?.fitToViewport()}
      />

      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
      {popover ? (
        <TagPopover
          x={popover.x}
          y={popover.y}
          annotation={popover.annotation}
          dimensions={dimensions}
          linkClipboard={linkClipboard}
          onDefineDimension={onDefineDimension}
          onCopyLinkTarget={onCopyLinkTarget}
          onJumpLink={jumpToAnnotation}
          onSave={onPopoverSave}
          onCancel={() => setPopover(null)}
        />
      ) : null}
      {showSettings ? (
        <SettingsDialog
          groups={groups}
          onDefineGroup={(g) => void onDefineGroup(g)}
          onDeleteGroup={(id) => void onDeleteGroup(id)}
          onDefineValue={(v) => void onDefineValueCfg(v)}
          onDeleteValue={(gid, val) => void onDeleteValue(gid, val)}
          onSetPinned={(id, p) => void onSetPinned(id, p)}
          onReorderGroups={(ids) => void onReorderGroups(ids)}
          onReorderValues={(gid, vals) => void onReorderValues(gid, vals)}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
    </div>
  );
}
