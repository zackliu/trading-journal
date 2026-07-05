import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type {
  ArchivedResults,
  ArchivedVocab,
  EntrySummary,
  Result,
  ResultDimension,
  ResultDimensionView,
  SavedView,
  Tag,
  TagGroup,
  TagGroupView,
  TagValue,
  ViewQuery,
  WorkspaceState,
} from '../../shared/domain';
import type { PingResult } from '../../shared/ipc';
import { CanvasEditor } from './editor/CanvasEditor';
import type { AnnotationSelection, CanvasController, DrawStyle, EditorState, Tool } from './editor/canvasController';
import { ContextMenu, type MenuItem } from './shell/ContextMenu';
import { GroupBrowser, type Bucket } from './shell/GroupBrowser';
import { Icon } from './shell/icons';
import { Ribbon } from './shell/Ribbon';
import { SettingsDialog } from './shell/SettingsDialog';
import { ResultSettingsDialog } from './shell/ResultSettingsDialog';
import { GeneralSettingsDialog } from './shell/GeneralSettingsDialog';
import { SetupGate } from './shell/SetupGate';
import { ViewBuilder } from './shell/ViewBuilder';
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
const EMPTY_QUERY: ViewQuery = { entry: [], annotation: [], results: [] };

interface FilterMatch {
  ids: Set<string>;
  annById: Map<string, string[]>;
}
type FlashReq = { tag: Tag } | { annIds: string[] };

function isEmptyQuery(q: ViewQuery): boolean {
  return q.entry.length === 0 && q.annotation.length === 0 && q.results.length === 0;
}

/** Describe the active filter as compact chips for the rail + a one-line ribbon summary. */
function filterChips(
  q: ViewQuery,
  groups: TagGroupView[],
  dimensions: ResultDimension[],
): Array<{ text: string; scope: 'entry' | 'annotation' }> {
  const gl = (id: string): string => groups.find((g) => g.id === id)?.label ?? id;
  const vl = (gid: string, v: string): string =>
    groups.find((g) => g.id === gid)?.values.find((x) => x.value === v)?.label ?? v;
  const dl = (id: string): string => dimensions.find((d) => d.id === id)?.label ?? id;
  const chips: Array<{ text: string; scope: 'entry' | 'annotation' }> = [];
  for (const p of q.entry)
    chips.push({ scope: 'entry', text: `${gl(p.group)}: ${p.values.map((v) => vl(p.group, v)).join(' / ')}` });
  for (const p of q.annotation)
    chips.push({ scope: 'annotation', text: `${gl(p.group)}: ${p.values.map((v) => vl(p.group, v)).join(' / ')}` });
  for (const r of q.results) {
    let val = '';
    if (r.in && r.in.length > 0) val = r.in.join(' / ');
    else if (r.gte !== undefined && r.lte !== undefined) val = `${r.gte}–${r.lte}`;
    else if (r.gte !== undefined) val = `≥ ${r.gte}`;
    else if (r.lte !== undefined) val = `≤ ${r.lte}`;
    chips.push({ scope: 'annotation', text: `${dl(r.dimension)}: ${val}` });
  }
  return chips;
}

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
  const [archivedGroups, setArchivedGroups] = useState<ArchivedVocab>({ groups: [], values: [] });
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [entryUserTags, setEntryUserTags] = useState<Tag[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationSelection | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showGeneral, setShowGeneral] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewQuery>(EMPTY_QUERY);
  const [filterMatch, setFilterMatch] = useState<FilterMatch | null>(null);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showViewBuilder, setShowViewBuilder] = useState(false);
  const [showResultSettings, setShowResultSettings] = useState(false);
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
  const [dimensions, setDimensions] = useState<ResultDimensionView[]>([]);
  const [archivedResults, setArchivedResults] = useState<ArchivedResults>({ dimensions: [], values: [] });
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
  const pendingFlashRef = useRef<FlashReq | null>(null);
  const filterMatchRef = useRef<FilterMatch | null>(null);
  const entryUserTagsRef = useRef(entryUserTags);
  const selectedAnnotationRef = useRef(selectedAnnotation);

  const refresh = useCallback(async () => {
    setEntries(await window.api.listEntries());
  }, []);

  const refreshDimensions = useCallback(async () => {
    const [dims, arch] = await Promise.all([window.api.listResultVocabulary(), window.api.listArchivedResults()]);
    setDimensions(dims);
    setArchivedResults(arch);
  }, []);

  const refreshGroups = useCallback(async () => {
    const [gs, arch] = await Promise.all([window.api.listGroups(), window.api.listArchivedGroups()]);
    setGroups(gs);
    setArchivedGroups(arch);
  }, []);

  const refreshSavedViews = useCallback(async () => {
    setSavedViews(await window.api.listSavedViews());
  }, []);

  const workspaceReady = workspace?.status === 'ready';

  // Resolve which data folder is active before touching the store. Until it is `ready`, the app renders
  // the setup gate instead of the workspace (the store IPCs would have no open DB behind them).
  useEffect(() => {
    window.api
      .getWorkspaceState()
      .then(setWorkspace)
      .catch(() => setWorkspace({ status: 'unset', dataDir: null, source: 'none' }));
  }, []);

  useEffect(() => {
    if (!workspaceReady) return;
    void refresh();
    void refreshDimensions();
    void refreshGroups();
    void refreshSavedViews();
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
  }, [workspaceReady, refresh, refreshDimensions, refreshGroups, refreshSavedViews]);

  // Pick a data folder (native dialog) and switch to it. On success the whole renderer reloads so it
  // boots cleanly against the new workspace — used by both the setup gate and General settings.
  const chooseWorkspaceFolder = useCallback(async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    try {
      const dir = await window.api.pickWorkspaceFolder();
      if (!dir) {
        setWorkspaceBusy(false);
        return; // canceled the dialog
      }
      const next = await window.api.setWorkspaceFolder(dir);
      if (next.status === 'ready') {
        window.location.reload();
        return;
      }
      setWorkspace(next);
      setWorkspaceError(next.status === 'unwritable' ? '该文件夹不可写，换一个试试。' : '该文件夹不可用。');
      setWorkspaceBusy(false);
    } catch {
      setWorkspaceError('切换失败，请重试。');
      setWorkspaceBusy(false);
    }
  }, []);

  // Re-check the configured folder (the user may have prepared it). If ready now, reload into it.
  const retryWorkspace = useCallback(async () => {
    setWorkspaceBusy(true);
    setWorkspaceError(null);
    const next = await window.api.getWorkspaceState();
    if (next.status === 'ready') {
      window.location.reload();
      return;
    }
    setWorkspace(next);
    setWorkspaceBusy(false);
  }, []);

  const revealWorkspace = useCallback(() => void window.api.revealWorkspace(), []);
  const quitApp = useCallback(() => void window.api.quitApp(), []);

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
  useEffect(() => {
    filterMatchRef.current = filterMatch;
  }, [filterMatch]);

  // Recompute which reviews (and their co-occurring annotations) the active filter matches. Re-runs
  // when the filter or the library changes, so a newly added matching review appears automatically.
  useEffect(() => {
    if (isEmptyQuery(filter)) {
      setFilterMatch(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const matches = await window.api.runView(filter);
      if (cancelled) return;
      setFilterMatch({
        ids: new Set(matches.map((m) => m.entryId)),
        annById: new Map(matches.map((m) => [m.entryId, m.annotationIds])),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, entries]);

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

  // Compute the left-rail browse buckets over the filter's survivors: year-month for “All reviews”,
  // else the selected group's value buckets. Counts are context-sensitive (within the active filter);
  // membership is read from the store (entry ∪ annotation) — never scanning canvas JSON.
  useEffect(() => {
    const survivors = filterMatch ? entries.filter((e) => filterMatch.ids.has(e.id)) : entries;
    if (pivot === 'all') {
      setBuckets(yearMonthBuckets(survivors));
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
        const ids = new Set(
          (await window.api.queryEntriesByTag({ group: group.id, value: value.value })).map((e) => e.id),
        );
        next.push({
          key: value.value,
          label: value.label ?? value.value,
          entries: survivors.filter((e) => ids.has(e.id)),
          tag: { group: group.id, value: value.value },
        });
      }
      if (!cancelled) setBuckets(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pivot, groups, entries, filterMatch]);

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
          label: 'Links…',
          icon: 'browse',
          testId: 'menu-links',
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
  const onDeleteDimension = useCallback(
    async (id: string) => {
      await window.api.deleteResultDimension(id);
      await refreshDimensions();
    },
    [refreshDimensions],
  );
  const onDefineResultValue = useCallback(
    async (dimensionId: string, value: string, label: string) => {
      await window.api.defineResultValue(dimensionId, value, label);
      await refreshDimensions();
    },
    [refreshDimensions],
  );
  const onDeleteResultValue = useCallback(
    async (dimensionId: string, value: string) => {
      await window.api.deleteResultValue(dimensionId, value);
      await refreshDimensions();
    },
    [refreshDimensions],
  );
  const onRestoreResultDimension = useCallback(
    async (id: string) => {
      await window.api.restoreResultDimension(id);
      await refreshDimensions();
    },
    [refreshDimensions],
  );
  const onRestoreResultValue = useCallback(
    async (dimensionId: string, value: string) => {
      await window.api.restoreResultValue(dimensionId, value);
      await refreshDimensions();
    },
    [refreshDimensions],
  );
  // Set (or clear) one result dimension on the selected annotation — the Annotation tab's one-tap editor.
  const onSetAnnotationResult = useCallback(
    (dimensionId: string, value: string | number | null) => {
      const sel = selectedAnnotationRef.current;
      if (!sel) return;
      const next: Result = { ...sel.result };
      if (value === null) delete next[dimensionId];
      else next[dimensionId] = value;
      controllerRef.current?.applyAnnotationEdits(sel.id, sel.tags, next, sel.links);
      void saveNow().then(() => void refresh());
    },
    [saveNow, refresh],
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
  const onRestoreGroup = useCallback(async (id: string) => {
    await window.api.restoreGroup(id);
    await refreshGroups();
  }, [refreshGroups]);
  const onRestoreValue = useCallback(async (groupId: string, value: string) => {
    await window.api.restoreValue(groupId, value);
    await refreshGroups();
  }, [refreshGroups]);
  const onPurgeGroup = useCallback(async (id: string) => {
    await window.api.purgeGroup(id);
    await refreshGroups();
  }, [refreshGroups]);
  const onPurgeValue = useCallback(async (groupId: string, value: string) => {
    await window.api.purgeValue(groupId, value);
    await refreshGroups();
  }, [refreshGroups]);

  // Open a review from a browse bucket; a value bucket's tag briefly highlights its carriers.
  const openFromBrowse = useCallback(
    async (id: string, tag?: Tag) => {
      const annIds = filterMatchRef.current?.annById.get(id);
      const req: FlashReq | null = annIds && annIds.length > 0 ? { annIds } : tag ? { tag } : null;
      if (id === selectedEntryIdRef.current) {
        if (req && 'annIds' in req) controllerRef.current?.flashAnnotationHighlight(req.annIds);
        else if (req) controllerRef.current?.flashTagHighlight(req.tag);
        return;
      }
      pendingFlashRef.current = req;
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
    const req = pendingFlashRef.current;
    if (req) {
      if ('annIds' in req) controllerRef.current?.flashAnnotationHighlight(req.annIds);
      else controllerRef.current?.flashTagHighlight(req.tag);
      pendingFlashRef.current = null;
    }
  }, []);

  const onSaveView = useCallback(
    async (name: string, q: ViewQuery) => {
      await window.api.createSavedView(name, q);
      await refreshSavedViews();
    },
    [refreshSavedViews],
  );
  const onDeleteView = useCallback(
    async (id: string) => {
      await window.api.deleteSavedView(id);
      await refreshSavedViews();
    },
    [refreshSavedViews],
  );
  const onLoadView = useCallback(
    (id: string) => {
      const v = savedViews.find((x) => x.id === id);
      if (v) setFilter(JSON.parse(v.queryJson) as ViewQuery);
    },
    [savedViews],
  );

  const chips = filterChips(filter, groups, dimensions);
  const filterSummary =
    chips.length === 0 ? 'No filter' : `${chips.length} condition${chips.length > 1 ? 's' : ''} active`;
  const hasFilter = !isEmptyQuery(filter);

  if (!workspace) {
    return <div className="boot" data-testid="boot-splash" />;
  }
  if (workspace.status !== 'ready') {
    return (
      <SetupGate
        state={workspace}
        busy={workspaceBusy}
        error={workspaceError}
        onChoose={() => void chooseWorkspaceFolder()}
        onRetry={() => void retryWorkspace()}
        onQuit={quitApp}
      />
    );
  }

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
        onOpenResultSettings={() => setShowResultSettings(true)}
        onOpenGeneral={() => setShowGeneral(true)}
        resultDimensions={dimensions}
        onSetAnnotationResult={onSetAnnotationResult}
        savedViews={savedViews}
        hasFilter={hasFilter}
        filterSummary={filterSummary}
        onEditFilter={() => setShowViewBuilder(true)}
        onClearFilter={() => setFilter(EMPTY_QUERY)}
        onLoadView={onLoadView}
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
            filterChips={chips}
            onClearFilter={() => setFilter(EMPTY_QUERY)}
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
          linkClipboard={linkClipboard}
          onCopyLinkTarget={onCopyLinkTarget}
          onJumpLink={jumpToAnnotation}
          onSave={onPopoverSave}
          onCancel={() => setPopover(null)}
        />
      ) : null}
      {showSettings ? (
        <SettingsDialog
          groups={groups}
          archived={archivedGroups}
          onDefineGroup={(g) => void onDefineGroup(g)}
          onDeleteGroup={(id) => void onDeleteGroup(id)}
          onDefineValue={(v) => void onDefineValueCfg(v)}
          onDeleteValue={(gid, val) => void onDeleteValue(gid, val)}
          onSetPinned={(id, p) => void onSetPinned(id, p)}
          onReorderGroups={(ids) => void onReorderGroups(ids)}
          onReorderValues={(gid, vals) => void onReorderValues(gid, vals)}
          onRestoreGroup={(id) => void onRestoreGroup(id)}
          onRestoreValue={(gid, val) => void onRestoreValue(gid, val)}
          onPurgeGroup={(id) => void onPurgeGroup(id)}
          onPurgeValue={(gid, val) => void onPurgeValue(gid, val)}
          onClose={() => setShowSettings(false)}
        />
      ) : null}
      {showViewBuilder ? (
        <ViewBuilder
          groups={groups}
          dimensions={dimensions}
          initial={filter}
          savedViews={savedViews}
          onApply={(q) => {
            setFilter(q);
            setShowViewBuilder(false);
          }}
          onSaveView={(name, q) => void onSaveView(name, q)}
          onDeleteView={(id) => void onDeleteView(id)}
          onClose={() => setShowViewBuilder(false)}
          fetchResultValues={(id) => window.api.distinctResultValues(id)}
        />
      ) : null}
      {showResultSettings ? (
        <ResultSettingsDialog
          dimensions={dimensions}
          archived={archivedResults}
          onDefineDimension={(d) => void onDefineDimension(d)}
          onDeleteDimension={(id) => void onDeleteDimension(id)}
          onDefineValue={(dimId, value, label) => void onDefineResultValue(dimId, value, label)}
          onDeleteValue={(dimId, value) => void onDeleteResultValue(dimId, value)}
          onRestoreDimension={(id) => void onRestoreResultDimension(id)}
          onRestoreValue={(dimId, value) => void onRestoreResultValue(dimId, value)}
          onClose={() => setShowResultSettings(false)}
        />
      ) : null}
      {showGeneral ? (
        <GeneralSettingsDialog
          dataDir={workspace.dataDir}
          busy={workspaceBusy}
          error={workspaceError}
          onChange={() => void chooseWorkspaceFolder()}
          onReveal={revealWorkspace}
          onClose={() => setShowGeneral(false)}
        />
      ) : null}
    </div>
  );
}
