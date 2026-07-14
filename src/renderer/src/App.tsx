import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import type {
  ArchivedResults,
  ArchivedVocab,
  EntrySummary,
  Result,
  ResultDimension,
  ResultDimensionView,
  SavedView,
  StatsCompareBy,
  StatsDateRange,
  StatsExamplesEntry,
  StatsExamplesQuery,
  StatsExamplesSegment,
  StatsQuery,
  StatsReport,
  StatsScope,
  StatsThreshold,
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
import { ConfirmDialog } from './shell/ConfirmDialog';
import {
  GroupBrowser,
  type BrowseOccurrence,
  type Bucket,
  type GroupBrowserHandle,
} from './shell/GroupBrowser';
import { Icon } from './shell/icons';
import { Ribbon, type RibbonTab, type StatsPeriod } from './shell/Ribbon';
import { SettingsDialog } from './shell/SettingsDialog';
import { ResultSettingsDialog } from './shell/ResultSettingsDialog';
import { GeneralSettingsDialog } from './shell/GeneralSettingsDialog';
import { SetupGate } from './shell/SetupGate';
import { ViewBuilder } from './shell/ViewBuilder';
import { StatusBar } from './shell/StatusBar';
import { StatsPanel } from './shell/StatsPanel';
import { StatsSampleDialog } from './shell/StatsSampleDialog';
import { TagPopover, type AnnotationEdits } from './shell/TagPopover';
import { Thumbnails } from './shell/Thumbnails';

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
  bold: false,
};
const EMPTY_EDITOR: EditorState = { canUndo: false, canRedo: false, dirty: false, hasSelection: false };
const EMPTY_QUERY: ViewQuery = { entry: [], annotation: [], results: [] };
const EMPTY_BUCKETS: Bucket[] = [];
const WHEEL_GESTURE_IDLE_MS = 400;

interface FilterMatch {
  ids: Set<string>;
  annById: Map<string, string[]>;
}
interface FilterResult {
  key: string;
  match: FilterMatch;
}
interface RailSnapshot {
  contextKey: string;
  buckets: Bucket[];
}
type FlashReq = { tag: Tag } | { annIds: string[] };
type SaveOutcome = 'saved' | 'skipped' | 'failed';
interface PendingFlash {
  entryId: string;
  contextKey: string;
  requestId: number;
  req: FlashReq;
}

interface StatsConfig {
  scope: StatsScope;
  dimension: string | null;
  threshold?: StatsThreshold;
  compareBy?: StatsCompareBy;
}

interface StatsExamplesSession {
  kind: 'samples' | 'entries';
  request?: StatsExamplesQuery;
  queryKey: string;
  revision: number;
  label: string;
  entries: StatsExamplesEntry[];
  activeEntryId: string;
  annotationIndex: number;
}

function sameOccurrence(a: BrowseOccurrence | null, b: BrowseOccurrence | null): boolean {
  return !!a && !!b && a.pivot === b.pivot && a.bucketKey === b.bucketKey && a.entryId === b.entryId;
}

function annotationQueryProjection(annotations: ReturnType<CanvasController['extractAnnotations']>): string {
  return JSON.stringify(
    [...annotations]
      .filter((annotation) => annotation.tags.length > 0 || Object.keys(annotation.result ?? {}).length > 0)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((annotation) => ({
        id: annotation.id,
        tags: [...annotation.tags].sort((a, b) =>
          `${a.group}:${a.value}`.localeCompare(`${b.group}:${b.value}`),
        ),
        result: Object.fromEntries(Object.entries(annotation.result ?? {}).sort(([a], [b]) => a.localeCompare(b))),
      })),
  );
}

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

/** Group all reviews into year-month buckets for the “All reviews” pivot, ordered by `dir` (newest
 *  first by default). Derived from the structural `date` (or the created day), never a declared group
 *  / never a tagging option. */
function yearMonthBuckets(entries: EntrySummary[], dir: 'asc' | 'desc'): Bucket[] {
  const byMonth = new Map<string, EntrySummary[]>();
  for (const entry of entries) {
    const day = entry.date ?? new Date(entry.createdAt).toISOString().slice(0, 10);
    const ym = day.slice(0, 7);
    const list = byMonth.get(ym);
    if (list) list.push(entry);
    else byMonth.set(ym, [entry]);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (dir === 'desc' ? (a[0] < b[0] ? 1 : -1) : a[0] < b[0] ? -1 : 1))
    .map(([ym, list]) => ({ key: ym, label: ym, entries: list }));
}

function localCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datePreset(days: number): StatsDateRange {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1));
  return { from: localCalendarDate(from), to: localCalendarDate(to) };
}

function copyPredicates(predicates: StatsScope['entry']): StatsScope['entry'] {
  return predicates.map((predicate) => ({ ...predicate, values: [...predicate.values] }));
}

function statsExamplesLabel(
  segment: StatsExamplesSegment,
  report: StatsReport | null,
  query: StatsQuery | null,
  cohortValue?: string | null,
): string {
  const cohort =
    cohortValue === undefined
      ? null
      : report?.cohorts?.find((item) => item.value === cohortValue)?.label ?? (cohortValue ?? 'No value');
  const prefix = cohort ? `${cohort} · ` : '';
  if (segment.kind === 'all') return `${prefix}all samples`;
  if (segment.kind === 'recorded') return `${prefix}recorded ${report?.measure.label ?? 'result'}`;
  if (segment.kind === 'missing') {
    const measure = report?.measure.label ?? 'result';
    return query?.scope.population.kind === 'active-result-bearing'
      ? `${prefix}not recorded for ${measure} / result-bearing samples`
      : `${prefix}missing ${measure}`;
  }
  if (segment.kind === 'string-value') return `${prefix}${segment.value}`;
  return `${prefix}${segment.kind === 'threshold-match' ? 'condition matched' : 'condition not matched'}`;
}

export function App(): JSX.Element {
  const [activeTab, setActiveTab] = useState<RibbonTab>('Home');
  const [entries, setEntries] = useState<EntrySummary[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [selectedOccurrence, setSelectedOccurrence] = useState<BrowseOccurrence | null>(null);
  const [pivot, setPivot] = useState('all');
  // Left-rail review order by date: 'desc' = newest first (default), 'asc' = oldest first.
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [groups, setGroups] = useState<TagGroupView[]>([]);
  const [archivedGroups, setArchivedGroups] = useState<ArchivedVocab>({ groups: [], values: [] });
  const [railSnapshot, setRailSnapshot] = useState<RailSnapshot>({ contextKey: '', buckets: [] });
  const [railError, setRailError] = useState<string | null>(null);
  const [railRetry, setRailRetry] = useState(0);
  const [entryUserTags, setEntryUserTags] = useState<Tag[]>([]);
  const [entryDate, setEntryDate] = useState<string>('');
  const [entryMetadataLoadedId, setEntryMetadataLoadedId] = useState<string | null>(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState<AnnotationSelection | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showGeneral, setShowGeneral] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ViewQuery>(EMPTY_QUERY);
  const [filterResult, setFilterResult] = useState<FilterResult | null>(null);
  const [queryRevision, setQueryRevision] = useState(0);
  const [queryMutationCount, setQueryMutationCount] = useState(0);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [showViewBuilder, setShowViewBuilder] = useState(false);
  const [showStatsSample, setShowStatsSample] = useState(false);
  const [statsConfig, setStatsConfig] = useState<StatsConfig | null>(null);
  const [statsPeriod, setStatsPeriod] = useState<StatsPeriod>('all');
  const [statsCustomRange, setStatsCustomRange] = useState<StatsDateRange>(() => datePreset(1));
  const [statsIgnoredResults, setStatsIgnoredResults] = useState(0);
  const [statsReport, setStatsReport] = useState<StatsReport | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [statsDrillError, setStatsDrillError] = useState<string | null>(null);
  const [statsRetry, setStatsRetry] = useState(0);
  const [statsExamples, setStatsExamples] = useState<StatsExamplesSession | null>(null);
  const [statsExamplesBusy, setStatsExamplesBusy] = useState(false);
  const [showResultSettings, setShowResultSettings] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  // The id of a review awaiting delete confirmation (a destructive, unrecoverable action).
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Distinct from `error` (transient ingest/action failures): a persistent "your last edit could not be
  // written" warning. It is cleared by the next successful auto-save, so it stays up only while the
  // durable canvas is actually behind the on-screen page.
  const [saveError, setSaveError] = useState<string | null>(null);
  // A review that could not be loaded (e.g. a screenshot file is missing or still syncing from OneDrive).
  // We show a clear notice instead of a silent blank page, and keep the editor unmounted so its cleared
  // canvas can never be auto-saved over the review's good data.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ipcHealth, setIpcHealth] = useState<Health>('pending');
  const [storeHealth, setStoreHealth] = useState<Health>('pending');
  const [storeLabel, setStoreLabel] = useState('opening…');

  const [tool, setTool] = useState<Tool>('select');
  const [style, setStyle] = useState<DrawStyle>(DEFAULT_STYLE);
  // The effective style of the current selection (Office-style "format follows selection"); null when
  // nothing / a multi-selection is active, so the ribbon falls back to the persistent draw defaults.
  const [selectionStyle, setSelectionStyle] = useState<DrawStyle | null>(null);
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
  const saveRunningRef = useRef<Promise<SaveOutcome> | null>(null);
  const saveAgainRef = useRef(false);
  const stampLockedRef = useRef(stampLocked);
  const selectedEntryIdRef = useRef(selectedEntryId);
  const wheelGestureRef = useRef<{ lastAt: number; direction: 1 | -1 | 0; navigated: boolean }>({
    lastAt: 0,
    direction: 0,
    navigated: false,
  });
  const browserRef = useRef<GroupBrowserHandle | null>(null);
  const activationRequestRef = useRef(0);
  const railContextKeyRef = useRef('');
  const loadedEntryIdRef = useRef<string | null>(null);
  const queryProjectionRef = useRef<string | null>(null);
  const drawingClipboardRef = useRef<Record<string, unknown> | null>(null);
  const pendingFlashRef = useRef<PendingFlash | null>(null);
  const entryUserTagsRef = useRef(entryUserTags);
  const entryDateRef = useRef(entryDate);
  const entryMetadataMutationRef = useRef(0);
  const entryMetadataLoadedIdRef = useRef<string | null>(null);
  const selectedAnnotationRef = useRef(selectedAnnotation);
  const statsScrollRef = useRef<HTMLDivElement | null>(null);
  const statsRestoreScrollRef = useRef(0);
  const tabRequestRef = useRef(0);
  const statsEvidenceRequestRef = useRef(0);
  const statsQueryKeyRef = useRef('');
  const queryRevisionRef = useRef(queryRevision);

  const entriesKey = useMemo(
    () => entries.map((entry) => `${entry.id}:${entry.date ?? ''}:${entry.createdAt}`).join('|'),
    [entries],
  );
  const filterKey = JSON.stringify(filter);
  const queryUpdating = queryMutationCount > 0;
  const filterRequestKey = JSON.stringify([filterKey, entriesKey, queryRevision, railRetry]);
  const activeFilterMatch = queryUpdating
    ? undefined
    : isEmptyQuery(filter)
    ? null
    : filterResult?.key === filterRequestKey
      ? filterResult.match
      : undefined;
  const pivotGroupKey = useMemo(
    () => JSON.stringify(pivot === 'all' ? null : groups.find((group) => group.id === pivot) ?? null),
    [groups, pivot],
  );
  const filterMatchKey = useMemo(() => {
    if (activeFilterMatch === undefined) return 'pending';
    if (activeFilterMatch === null) return 'all';
    return [...activeFilterMatch.ids]
      .sort()
      .map((id) => `${id}:${[...(activeFilterMatch.annById.get(id) ?? [])].sort().join(',')}`)
      .join('|');
  }, [activeFilterMatch]);
  const railContextKey = JSON.stringify([
    pivot,
    sortDir,
    filterKey,
    filterMatchKey,
    entriesKey,
    pivotGroupKey,
    queryRevision,
    queryUpdating,
    railRetry,
  ]);
  railContextKeyRef.current = railContextKey;
  const railReady = railSnapshot.contextKey === railContextKey;
  const buckets = railReady ? railSnapshot.buckets : EMPTY_BUCKETS;
  const railOccurrences = useMemo(
    () =>
      buckets.flatMap((bucket) =>
        bucket.entries.map((entry) => ({
          pivot,
          bucketKey: bucket.key,
          entryId: entry.id,
          tag: bucket.tag,
        })),
      ),
    [buckets, pivot],
  );
  const activeOccurrence = useMemo(() => {
    if (!selectedEntryId) return null;
    return (
      (selectedOccurrence?.entryId === selectedEntryId
        ? railOccurrences.find((occurrence) => sameOccurrence(occurrence, selectedOccurrence))
        : null) ??
      railOccurrences.find((occurrence) => occurrence.entryId === selectedEntryId) ??
      null
    );
  }, [railOccurrences, selectedEntryId, selectedOccurrence]);
  const statsQuery: StatsQuery | null =
    statsConfig?.dimension
      ? {
          scope: statsConfig.scope,
          dimension: statsConfig.dimension,
          threshold: statsConfig.threshold,
          compareBy: statsConfig.compareBy,
        }
      : null;
  const statsQueryKey = JSON.stringify(statsQuery);
  statsQueryKeyRef.current = statsQueryKey;
  queryRevisionRef.current = queryRevision;
  const statsWorkspace = activeTab === 'Stats' && statsExamples === null;
  const currentStatsExample = statsExamples?.entries.find((item) => item.entryId === statsExamples.activeEntryId) ?? null;
  const statsExampleSummaries = useMemo(() => {
    if (!statsExamples) return [];
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    return statsExamples.entries
      .map((item) => byId.get(item.entryId))
      .filter((entry): entry is EntrySummary => entry !== undefined);
  }, [entries, statsExamples]);

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

  const importCurrentViewIntoStats = useCallback(() => {
    const entry = copyPredicates(filter.entry);
    const annotation = copyPredicates(filter.annotation);
    setStatsConfig((current) => {
      const currentDimension = current?.dimension
        ? dimensions.find((dimension) => dimension.id === current.dimension)
        : undefined;
      const dimension = currentDimension?.id ?? dimensions[0]?.id ?? null;
      const compareBy =
        current?.compareBy && groups.some((group) => group.id === current.compareBy?.group)
          ? current.compareBy
          : undefined;
      return {
        scope: {
          entry,
          population:
            annotation.length > 0
              ? { kind: 'matching-annotations', predicates: annotation }
              : { kind: 'active-result-bearing' },
          dateRange: current?.scope.dateRange,
        },
        dimension,
        threshold: currentDimension?.type === 'number' ? current?.threshold : undefined,
        compareBy,
      };
    });
    setStatsIgnoredResults(filter.results.length);
  }, [dimensions, filter, groups]);

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

  useEffect(() => {
    setStatsConfig((current) => {
      if (!current) return current;
      const selected = current.dimension
        ? dimensions.find((dimension) => dimension.id === current.dimension)
        : undefined;
      if (selected || (current.dimension === null && dimensions.length === 0)) return current;
      return { ...current, dimension: dimensions[0]?.id ?? null, threshold: undefined };
    });
  }, [dimensions]);

  useEffect(() => {
    setStatsConfig((current) => {
      if (!current?.compareBy || groups.some((group) => group.id === current.compareBy?.group)) return current;
      return { ...current, compareBy: undefined };
    });
  }, [groups]);

  useEffect(() => {
    if (activeTab !== 'Stats') return;
    if (!statsQuery) {
      setStatsLoading(false);
      setStatsReport(null);
      setStatsError(null);
      return;
    }
    let cancelled = false;
    setStatsLoading(true);
    setStatsReport(null);
    setStatsError(null);
    void window.api
      .runStats(statsQuery)
      .then((report) => {
        if (!cancelled) setStatsReport(report);
      })
      .catch((err: unknown) => {
        if (!cancelled) setStatsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, queryRevision, statsQueryKey, statsRetry]);

  useEffect(() => {
    if (!statsWorkspace) return;
    const frame = requestAnimationFrame(() => {
      if (statsScrollRef.current) statsScrollRef.current.scrollTop = statsRestoreScrollRef.current;
    });
    return () => cancelAnimationFrame(frame);
  }, [statsWorkspace]);

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
  const saveNow = useCallback((): Promise<SaveOutcome> => {
    if (saveRunningRef.current) {
      saveAgainRef.current = true;
      return saveRunningRef.current;
    }
    const initialController = controllerRef.current;
    const initialId = selectedEntryIdRef.current;
    if (!initialController || !initialId || loadedEntryIdRef.current !== initialId) {
      return Promise.resolve('skipped');
    }
    const run = async (): Promise<SaveOutcome> => {
      do {
        saveAgainRef.current = false;
        const controller = controllerRef.current;
        const id = selectedEntryIdRef.current;
        if (!controller || !id || loadedEntryIdRef.current !== id) return 'skipped';
        const saveVersion = controller.captureSaveVersion();
        if (saveVersion === null) return 'skipped';
        let queryIndexChanged = false;
        try {
          const thumbnail = controller.renderThumbnail();
          const annotations = controller.extractAnnotations();
          const pageJson = controller.serializePage();
          const stripJson = controller.serializeStrip();
          const nextQueryProjection = annotationQueryProjection(annotations);
          queryIndexChanged =
            queryProjectionRef.current !== null && queryProjectionRef.current !== nextQueryProjection;
          if (queryIndexChanged) setQueryMutationCount((count) => count + 1);
          setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, thumbnail } : e)));
          await window.api.updateEntryCanvas(id, pageJson, annotations, thumbnail);
          if (queryIndexChanged) {
            queryProjectionRef.current = nextQueryProjection;
            setQueryRevision((revision) => revision + 1);
          }
          await window.api.saveStampLibrary(stripJson);
          controller.markSaved(saveVersion);
          setSaveError(null);
        } catch (err) {
          // A failed write must never masquerade as saved. Keep the review dirty (don't markSaved),
          // surface the reason, and stop this pass — the next edit or a manual Ctrl+S retries. We never
          // rethrow here: a swallowed rejection would silently drop the edit the user just made.
          setSaveError(err instanceof Error ? err.message : String(err));
          return 'failed';
        } finally {
          if (queryIndexChanged) setQueryMutationCount((count) => Math.max(0, count - 1));
        }
      } while (saveAgainRef.current);
      return 'saved';
    };
    const promise = run();
    saveRunningRef.current = promise;
    void promise.finally(() => {
      if (saveRunningRef.current === promise) saveRunningRef.current = null;
    });
    return promise;
  }, []);

  const changeActiveTab = useCallback(
    (next: RibbonTab) => {
      const requestId = ++tabRequestRef.current;
      if (next !== 'Stats') {
        if (!statsExamples && statsExamplesBusy) {
          statsEvidenceRequestRef.current += 1;
          setStatsExamplesBusy(false);
        }
        setActiveTab(next);
        return;
      }
      void (async () => {
        const controller = controllerRef.current;
        controller?.commitTextEditing();
        const saveOutcome = controller?.isDirty() ? await saveNow() : 'skipped';
        if (requestId !== tabRequestRef.current || saveOutcome === 'failed') return;
        statsEvidenceRequestRef.current += 1;
        setStatsExamplesBusy(false);
        if (!statsConfig) importCurrentViewIntoStats();
        if (statsExamples) setStatsExamples(null);
        setStatsDrillError(null);
        setActiveTab('Stats');
      })();
    },
    [importCurrentViewIntoStats, saveNow, statsConfig, statsExamples],
  );

  const changeStatsPeriod = useCallback(
    (period: StatsPeriod) => {
      setStatsPeriod(period);
      const dateRange =
        period === 'all'
          ? undefined
          : period === '30d'
            ? datePreset(30)
            : period === '90d'
              ? datePreset(90)
              : statsCustomRange;
      setStatsConfig((current) =>
        current ? { ...current, scope: { ...current.scope, dateRange } } : current,
      );
    },
    [statsCustomRange],
  );

  const changeStatsCustomRange = useCallback(
    (range: StatsDateRange) => {
      setStatsCustomRange(range);
      if (statsPeriod !== 'custom' || !range.from || !range.to || range.from > range.to) return;
      setStatsConfig((current) =>
        current ? { ...current, scope: { ...current.scope, dateRange: range } } : current,
      );
    },
    [statsPeriod],
  );

  const changeStatsDimension = useCallback((dimension: string) => {
    setStatsConfig((current) => (current ? { ...current, dimension, threshold: undefined } : current));
  }, []);

  const applyStatsSample = useCallback((entry: StatsScope['entry'], annotation: StatsScope['entry']) => {
    setStatsConfig((current) =>
      current
        ? {
            ...current,
            scope: {
              ...current.scope,
              entry: copyPredicates(entry),
              population:
                annotation.length > 0
                  ? { kind: 'matching-annotations', predicates: copyPredicates(annotation) }
                  : { kind: 'active-result-bearing' },
            },
          }
        : current,
    );
    setStatsIgnoredResults(0);
    setShowStatsSample(false);
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
    setActiveTab((current) => (current === 'Stats' ? current : selectedEntryId ? 'Draw' : 'Home'));
    entryMetadataMutationRef.current += 1;
    entryMetadataLoadedIdRef.current = null;
    entryUserTagsRef.current = [];
    entryDateRef.current = '';
    setEntryMetadataLoadedId(null);
    setEntryUserTags([]);
    setEntryDate('');
    setLoadError(null); // a fresh selection starts clean; a prior review's load error must not linger
  }, [selectedEntryId]);
  useEffect(() => {
    entryUserTagsRef.current = entryUserTags;
  }, [entryUserTags]);
  useEffect(() => {
    entryDateRef.current = entryDate;
  }, [entryDate]);
  useEffect(() => {
    selectedAnnotationRef.current = selectedAnnotation;
  }, [selectedAnnotation]);
  // Recompute which reviews (and their co-occurring annotations) the active filter matches. Re-runs
  // when the filter or the library changes, so a newly added matching review appears automatically.
  useEffect(() => {
    if (isEmptyQuery(filter)) {
      setFilterResult(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      setRailError(null);
      try {
        const matches = await window.api.runView(filter);
        if (cancelled) return;
        setFilterResult({
          key: filterRequestKey,
          match: {
            ids: new Set(matches.map((m) => m.entryId)),
            annById: new Map(matches.map((m) => [m.entryId, m.annotationIds])),
          },
        });
      } catch (err) {
        if (!cancelled) setRailError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, filterRequestKey, entries]);

  // Load the open review's date + user (non-`date`) entry tags for the Review tab.
  useEffect(() => {
    if (!selectedEntryId) {
      setEntryUserTags([]);
      setEntryDate('');
      return;
    }
    let cancelled = false;
    void window.api.getEntry(selectedEntryId).then((entry) => {
      if (cancelled || !entry) return;
      const tags = entry.entryTags.filter((t) => t.group !== 'date');
      const date = entry.entryTags.find((t) => t.group === 'date')?.value ?? '';
      entryUserTagsRef.current = tags;
      entryDateRef.current = date;
      entryMetadataLoadedIdRef.current = selectedEntryId;
      setEntryUserTags(tags);
      setEntryDate(date);
      setEntryMetadataLoadedId(selectedEntryId);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedEntryId]);

  // Compute the left-rail browse buckets over the filter's survivors: year-month for “All reviews”,
  // else the selected group's value buckets. Counts are context-sensitive (within the active filter);
  // membership is read from the store (entry ∪ annotation) — never scanning canvas JSON.
  useEffect(() => {
    if (activeFilterMatch === undefined) return;
    setRailError(null);
    const survivors = activeFilterMatch ? entries.filter((e) => activeFilterMatch.ids.has(e.id)) : entries;
    // `entries` arrives newest-first from the store; reverse for oldest-first. Both the month buckets
    // and the reviews inside every bucket follow this one order.
    const ordered = sortDir === 'asc' ? [...survivors].reverse() : survivors;
    if (pivot === 'all') {
      setRailSnapshot({ contextKey: railContextKey, buckets: yearMonthBuckets(ordered, sortDir) });
      return;
    }
    const group = groups.find((g) => g.id === pivot);
    if (!group) {
      setRailSnapshot({ contextKey: railContextKey, buckets: [] });
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const next = await Promise.all(
          group.values.map(async (value): Promise<Bucket> => {
            const ids = new Set(
              (await window.api.queryEntriesByTag({ group: group.id, value: value.value })).map(
                (entry) => entry.id,
              ),
            );
            return {
              key: value.value,
              label: value.label ?? value.value,
              entries: ordered.filter((e) => ids.has(e.id)),
              tag: { group: group.id, value: value.value },
            };
          }),
        );
        if (!cancelled) setRailSnapshot({ contextKey: railContextKey, buckets: next });
      } catch (err) {
        if (!cancelled) setRailError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeFilterMatch, entries, groups, pivot, railContextKey, sortDir]);

  const switchTo = useCallback(
    async (
      nextId: string | null,
      occurrence: BrowseOccurrence | null = null,
      stillCurrent?: () => boolean,
    ): Promise<boolean> => {
      if (!occurrence && !stillCurrent) activationRequestRef.current += 1;
      if (!occurrence) pendingFlashRef.current = null;
      if (nextId === selectedEntryIdRef.current) {
        if (stillCurrent && !stillCurrent()) return false;
        setSelectedOccurrence(occurrence);
        return true;
      }
      // Fabric does not exit text editing when focus leaves the canvas, so freshly typed text is not yet
      // committed. Commit it first, then flush pending edits — otherwise switching reviews (rail click,
      // wheel, New, link) would silently discard what the user just typed. Gate the save on the
      // controller's LIVE dirty state, not the stale closure value.
      const controller = controllerRef.current;
      const loaded = !!controller && loadedEntryIdRef.current === selectedEntryIdRef.current;
      if (loaded) controller.commitTextEditing();
      if (loaded && controller.isDirty() && (await saveNow()) === 'failed') return false;
      if (stillCurrent && !stillCurrent()) return false;
      controllerRef.current = null;
      loadedEntryIdRef.current = null;
      queryProjectionRef.current = null;
      setSelectedOccurrence(occurrence);
      setSelectedEntryId(nextId);
      setTool('select');
      setEditorState(EMPTY_EDITOR);
      setPopover(null);
      setSelectedAnnotation(null);
      await refresh();
      return true;
    },
    [saveNow, refresh],
  );

  const focusStatsAnnotation = useCallback(
    async (entryId: string, annotationId: string): Promise<void> => {
      if (selectedEntryIdRef.current === entryId && loadedEntryIdRef.current === entryId) {
        controllerRef.current?.selectAnnotationById(annotationId);
        return;
      }
      pendingSelectRef.current = annotationId;
      const switched = await switchTo(entryId);
      if (!switched && pendingSelectRef.current === annotationId) pendingSelectRef.current = null;
    },
    [switchTo],
  );

  const activateStatsExample = useCallback(
    (entryId: string, annotationIndex = 0) => {
      const item = statsExamples?.entries.find((entry) => entry.entryId === entryId);
      if (!item) return;
      const index =
        item.annotationIds.length === 0
          ? 0
          : Math.max(0, Math.min(annotationIndex, item.annotationIds.length - 1));
      setStatsExamples((current) =>
        current ? { ...current, activeEntryId: entryId, annotationIndex: index } : current,
      );
      const annotationId = item.annotationIds[index];
      if (annotationId) void focusStatsAnnotation(entryId, annotationId);
      else void switchTo(entryId);
    },
    [focusStatsAnnotation, statsExamples, switchTo],
  );

  const openStatsExamples = useCallback(
    async (segment: StatsExamplesSegment, cohortValue?: string | null) => {
      if (!statsQuery) return;
      const request: StatsExamplesQuery = {
        stats: statsQuery,
        segment,
        ...(cohortValue !== undefined ? { cohortValue } : {}),
      };
      const requestId = ++statsEvidenceRequestRef.current;
      const dispatchRevision = queryRevisionRef.current;
      const dispatchQueryKey = statsQueryKey;
      statsRestoreScrollRef.current = statsScrollRef.current?.scrollTop ?? 0;
      setStatsExamplesBusy(true);
      setStatsDrillError(null);
      try {
        const [matched, summaries] = await Promise.all([
          window.api.queryStatsExamples(request),
          window.api.listEntries(),
        ]);
        if (
          requestId !== statsEvidenceRequestRef.current ||
          statsQueryKeyRef.current !== dispatchQueryKey ||
          queryRevisionRef.current !== dispatchRevision
        ) {
          return;
        }
        if (matched.length === 0 || matched[0].annotationIds.length === 0) {
          setStatsDrillError('No examples match this statistic.');
          return;
        }
        setEntries(summaries);
        const first = matched[0];
        setStatsExamples({
          kind: 'samples',
          request,
          queryKey: dispatchQueryKey,
          revision: dispatchRevision,
          label: statsExamplesLabel(segment, statsReport, statsQuery, cohortValue),
          entries: matched,
          activeEntryId: first.entryId,
          annotationIndex: 0,
        });
        await focusStatsAnnotation(first.entryId, first.annotationIds[0]);
      } catch (err) {
        if (requestId === statsEvidenceRequestRef.current) {
          setStatsDrillError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (requestId === statsEvidenceRequestRef.current) setStatsExamplesBusy(false);
      }
    },
    [focusStatsAnnotation, statsQueryKey, statsReport],
  );

  const reviewStatsScopeEntries = useCallback(async () => {
    if (!statsConfig) return;
    const requestId = ++statsEvidenceRequestRef.current;
    const dispatchRevision = queryRevisionRef.current;
    const dispatchQueryKey = statsQueryKeyRef.current;
    statsRestoreScrollRef.current = statsScrollRef.current?.scrollTop ?? 0;
    setStatsExamplesBusy(true);
    setStatsDrillError(null);
    try {
      const summaries = await window.api.queryStatsScopeEntries(statsConfig.scope);
      if (
        requestId !== statsEvidenceRequestRef.current ||
        queryRevisionRef.current !== dispatchRevision ||
        statsQueryKeyRef.current !== dispatchQueryKey
      ) return;
      if (summaries.length === 0) {
        setStatsDrillError('No Entries match this date and classification scope.');
        return;
      }
      const entries = summaries.map((entry) => ({ entryId: entry.id, annotationIds: [] }));
      setEntries(summaries);
      setStatsExamples({
        kind: 'entries',
        queryKey: dispatchQueryKey,
        revision: dispatchRevision,
        label: 'matching scope Entries',
        entries,
        activeEntryId: entries[0].entryId,
        annotationIndex: 0,
      });
      await switchTo(entries[0].entryId);
    } catch (err) {
      if (requestId === statsEvidenceRequestRef.current) {
        setStatsDrillError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestId === statsEvidenceRequestRef.current) setStatsExamplesBusy(false);
    }
  }, [statsConfig, switchTo]);

  useEffect(() => {
    const session = statsExamples;
    if (
      !session ||
      session.kind !== 'samples' ||
      !session.request ||
      session.revision === queryRevision
    ) {
      return;
    }
    if (session.queryKey !== statsQueryKeyRef.current) {
      statsEvidenceRequestRef.current += 1;
      setStatsExamples(null);
      setStatsDrillError('Statistics settings changed. Review examples again from the updated report.');
      return;
    }

    const requestId = ++statsEvidenceRequestRef.current;
    const dispatchRevision = queryRevision;
    setStatsExamplesBusy(true);
    setStatsDrillError(null);
    void Promise.all([window.api.queryStatsExamples(session.request), window.api.listEntries()])
      .then(([matched, summaries]) => {
        if (
          requestId !== statsEvidenceRequestRef.current ||
          queryRevisionRef.current !== dispatchRevision ||
          statsQueryKeyRef.current !== session.queryKey
        ) return;
        if (matched.length === 0) {
          setStatsExamples(null);
          setStatsDrillError('These examples changed after the edit. No samples now match this statistic.');
          return;
        }
        const previous = session.entries.find((entry) => entry.entryId === session.activeEntryId);
        const previousAnnotationId = previous?.annotationIds[session.annotationIndex];
        const sameEntry = matched.find((entry) => entry.entryId === session.activeEntryId);
        const sameIndex = previousAnnotationId ? (sameEntry?.annotationIds.indexOf(previousAnnotationId) ?? -1) : -1;
        const active = sameEntry && sameIndex >= 0 ? sameEntry : matched[0];
        const annotationIndex = sameEntry && sameIndex >= 0 ? sameIndex : 0;
        setEntries(summaries);
        setStatsExamples({
          ...session,
          revision: dispatchRevision,
          entries: matched,
          activeEntryId: active.entryId,
          annotationIndex,
        });
        const annotationId = active.annotationIds[annotationIndex];
        if (active.entryId !== session.activeEntryId || annotationId !== previousAnnotationId) {
          void focusStatsAnnotation(active.entryId, annotationId);
        }
      })
      .catch((err: unknown) => {
        if (requestId === statsEvidenceRequestRef.current) {
          setStatsDrillError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (requestId === statsEvidenceRequestRef.current) setStatsExamplesBusy(false);
      });
  }, [focusStatsAnnotation, queryRevision, statsExamples]);

  const focusStatsMeasure = useCallback(() => {
    document.querySelector<HTMLElement>('[data-testid="stats-measure"]')?.focus();
  }, []);

  const beginNavigationIntent = useCallback((): (() => boolean) => {
    const requestId = ++activationRequestRef.current;
    pendingFlashRef.current = null;
    return () => activationRequestRef.current === requestId;
  }, []);
  // Clicking and wheel navigation activate the same concrete rail occurrence: reveal it, make it the
  // sole active thumbnail, switch the durable artifact if needed, then run that occurrence's highlight.
  const activateOccurrence = useCallback(
    async (occurrence: BrowseOccurrence): Promise<void> => {
      if (!railReady) return;
      const requestId = ++activationRequestRef.current;
      const contextKey = railContextKey;
      const stillCurrent = (): boolean =>
        activationRequestRef.current === requestId && railContextKeyRef.current === contextKey;
      browserRef.current?.revealBucket(occurrence.bucketKey);
      const annIds = filter.annotation.length > 0 ? activeFilterMatch?.annById.get(occurrence.entryId) : undefined;
      const req: FlashReq | null =
        occurrence.tag ? { tag: occurrence.tag } : annIds && annIds.length > 0 ? { annIds } : null;
      pendingFlashRef.current = req ? { entryId: occurrence.entryId, contextKey, requestId, req } : null;
      const switched = await switchTo(occurrence.entryId, occurrence, stillCurrent);
      if (!switched || !stillCurrent()) {
        if (pendingFlashRef.current?.requestId === requestId) pendingFlashRef.current = null;
        return;
      }
      if (req && loadedEntryIdRef.current === occurrence.entryId) {
        if ('annIds' in req) controllerRef.current?.flashAnnotationHighlight(req.annIds);
        else controllerRef.current?.flashTagHighlight(req.tag);
        if (pendingFlashRef.current?.requestId === requestId) pendingFlashRef.current = null;
      }
    },
    [activeFilterMatch, filter.annotation.length, railContextKey, railReady, switchTo],
  );

  useEffect(() => {
    pendingFlashRef.current = null;
  }, [railContextKey]);

  // Close / reload safety net: Fabric never commits an in-progress text edit on focus loss, so flush it
  // before the page unloads. saveNow dispatches its IPC synchronously, so the main process receives and
  // persists the payload even as the renderer goes away.
  useEffect(() => {
    const onBeforeUnload = (): void => {
      const controller = controllerRef.current;
      if (!controller) return;
      controller.commitTextEditing();
      if (controller.isDirty()) void saveNow();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveNow]);

  // Wheel past a stage edge steps through the LEFT RAIL exactly as shown: down = the review below,
  // up = the one above. It walks the rail's filtered/sorted order (never the whole library), spans
  // collapsed buckets, and expands the bucket it lands in. A review absent from the rail (filtered
  // out, or the open one isn't a rail member) has no position, so the wheel leaves it alone.
  const onWheelNavigate = useCallback((dir: 1 | -1): void => {
    const now = Date.now();
    const gesture = wheelGestureRef.current;
    if (dir !== gesture.direction || now - gesture.lastAt > WHEEL_GESTURE_IDLE_MS) gesture.navigated = false;
    gesture.lastAt = now;
    gesture.direction = dir;
    if (gesture.navigated) return;
    if (statsExamples) {
      const index = statsExamples.entries.findIndex((entry) => entry.entryId === statsExamples.activeEntryId);
      const target = index + dir;
      if (index < 0 || target < 0 || target >= statsExamples.entries.length) return;
      gesture.navigated = true;
      activateStatsExample(statsExamples.entries[target].entryId);
      return;
    }
    const idx = activeOccurrence
      ? railOccurrences.findIndex((occurrence) => sameOccurrence(occurrence, activeOccurrence))
      : -1;
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= railOccurrences.length) return; // at the ends, stay put
    gesture.navigated = true;
    void activateOccurrence(railOccurrences[target]);
  }, [activateOccurrence, activateStatsExample, activeOccurrence, railOccurrences, statsExamples]);

  const createNew = useCallback(async () => {
    const stillCurrent = beginNavigationIntent();
    setBusy(true);
    setError(null);
    try {
      const entry = await window.api.newEntry();
      if (stillCurrent()) await switchTo(entry.id, null, stillCurrent);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [beginNavigationIntent, switchTo]);

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
      const stillCurrent = beginNavigationIntent();
      const targetEntryId = selectedEntryId;
      const targetController = controllerRef.current;
      setBusy(true);
      setError(null);
      try {
        if (targetEntryId && targetController) {
          const { hash } = await window.api.storeImage(bytes);
          if (
            !stillCurrent() ||
            selectedEntryIdRef.current !== targetEntryId ||
            controllerRef.current !== targetController
          ) {
            return;
          }
          const inserted = await targetController.addImage(
            `tj-image://${hash}`,
            () =>
              stillCurrent() &&
              loadedEntryIdRef.current === targetEntryId &&
              selectedEntryIdRef.current === targetEntryId &&
              controllerRef.current === targetController,
          );
          if (!inserted) return;
          const { isFirst } = inserted;
          if (isFirst) await window.api.setEntryImage(targetEntryId, hash);
          // addImage() commits history → auto-saves the canvas + thumbnail via onContentChanged.
        } else {
          const entry = await window.api.ingestImageEntry(bytes);
          if (stillCurrent()) await switchTo(entry.id, null, stillCurrent);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [beginNavigationIntent, selectedEntryId, switchTo],
  );

  const removeEntry = useCallback(
    async (id: string) => {
      setMenu(null);
      setQueryMutationCount((count) => count + 1);
      try {
        await window.api.deleteEntry(id);
        setQueryRevision((revision) => revision + 1);
        if (statsExamples?.entries.some((entry) => entry.entryId === id)) {
          statsEvidenceRequestRef.current += 1;
          setStatsExamplesBusy(false);
          setStatsExamples(null);
          setStatsDrillError('The evidence set changed because a review was deleted. Statistics were recalculated.');
        }
        if (id === selectedEntryId) {
          activationRequestRef.current += 1;
          pendingFlashRef.current = null;
          controllerRef.current = null;
          loadedEntryIdRef.current = null;
          queryProjectionRef.current = null;
          setSelectedOccurrence(null);
          setSelectedEntryId(null);
          setEditorState(EMPTY_EDITOR);
          setPopover(null);
        }
        await refresh();
      } finally {
        setQueryMutationCount((count) => Math.max(0, count - 1));
      }
    },
    [selectedEntryId, refresh, statsExamples],
  );

  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const controller = controllerRef.current;
      // A text box is the paste target → the paste is TEXT that adopts the box's own colour / size,
      // never an image. While the box is being edited, Fabric's hidden textarea inserts the clipboard
      // text natively (plain, since per-character style copy is disabled) — we only must not hijack it
      // as an image. A selected (not-editing) box: append the clipboard text into it ourselves.
      if (controller?.isEditingText()) return;
      const pastedText = event.clipboardData?.getData('text/plain') ?? '';
      if (pastedText && controller?.insertTextIntoActiveTextBox(pastedText)) {
        event.preventDefault();
        return;
      }
      // "Paste the most recently copied thing onto the page" — recency, not a fixed priority. A
      // system-clipboard screenshot is checked first: whenever one is present it is the newest copy,
      // because copying a drawing (the `copy` handler below) overwrites the system clipboard. Only with
      // no system image do we fall back to an internally copied drawing.
      const items = event.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i += 1) {
          const item = items[i];
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              drawingClipboardRef.current = null; // the screenshot is newer — drop the stale drawing copy
              void fileToBytes(file).then(addImage);
              return;
            }
          }
        }
      }
      const clip = drawingClipboardRef.current;
      if (clip && selectedEntryIdRef.current && controllerRef.current) {
        event.preventDefault();
        void controllerRef.current.pasteSerializedAnnotation(clip);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImage]);

  // Ctrl+C copies the selected drawing into an internal clipboard for the unified Ctrl+V paste. It
  // listens on the `copy` event (symmetric with `paste`) so it can also overwrite the system clipboard:
  // clearing any stale screenshot there makes "is there a system image?" a truthful recency signal at
  // paste time, so a freshly copied drawing can never be out-ranked by an older screenshot.
  useEffect(() => {
    const onCopy = (event: ClipboardEvent): void => {
      const t = event.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const copied = controllerRef.current?.copyActiveAnnotation() ?? null;
      if (!copied) return; // nothing copyable selected — leave the last copy (and the clipboard) untouched
      event.preventDefault();
      event.clipboardData?.setData('text/plain', ' '); // replace the OS clipboard → drop any stale image
      drawingClipboardRef.current = copied;
    };
    window.addEventListener('copy', onCopy);
    return () => window.removeEventListener('copy', onCopy);
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
    loadedEntryIdRef.current = null;
    queryProjectionRef.current = null;
    controller.onState(setEditorState);
    controller.onToolChange(setTool);
    controller.onSelectionStyle(setSelectionStyle);
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
    controller.onAnnotationSelection((selection, source) => {
      setSelectedAnnotation(selection);
      if (selection && source === 'pointer') setActiveTab('Annotation');
    });
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
            onClick: () => {
              setMenu(null);
              setConfirmDelete(id);
            },
          },
        ],
      });
    },
    [],
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
      const stillCurrent = beginNavigationIntent();
      setPopover(null);
      const loc = await window.api.locateAnnotation(annotationId);
      if (!loc || !stillCurrent()) return;
      if (loc.entryId === selectedEntryId) {
        controllerRef.current?.selectAnnotationById(annotationId);
      } else {
        pendingSelectRef.current = annotationId;
        await switchTo(loc.entryId, null, stillCurrent);
      }
    },
    [beginNavigationIntent, selectedEntryId, switchTo],
  );
  // Toggle a tag on the whole review (Review tab quick-pick). Entry tags save immediately.
  const onToggleEntryTag = useCallback(
    (tag: Tag, on: boolean) => {
      const id = selectedEntryIdRef.current;
      if (!id || entryMetadataLoadedIdRef.current !== id) return;
      const cur = entryUserTagsRef.current;
      const has = cur.some((t) => t.group === tag.group && t.value === tag.value);
      const next = on ? (has ? cur : [...cur, tag]) : cur.filter((t) => !(t.group === tag.group && t.value === tag.value));
      const mutationId = ++entryMetadataMutationRef.current;
      entryUserTagsRef.current = next;
      setEntryUserTags(next);
      setQueryMutationCount((count) => count + 1);
      void (async () => {
        try {
          await window.api.setEntryTags(id, next);
          setQueryRevision((revision) => revision + 1);
          await Promise.all([refresh(), refreshGroups()]);
        } catch (err) {
          if (selectedEntryIdRef.current === id && entryMetadataMutationRef.current === mutationId) {
            entryUserTagsRef.current = cur;
            setEntryUserTags(cur);
          }
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setQueryMutationCount((count) => Math.max(0, count - 1));
        }
      })();
    },
    [refresh, refreshGroups],
  );

  // Change the review's structural date (Review tab). Saves immediately, then re-lists so the rail
  // re-sorts and the year-month buckets update — the date the user set is the review's "time".
  const onChangeEntryDate = useCallback(
    (date: string) => {
      const id = selectedEntryIdRef.current;
      if (!id || !date || entryMetadataLoadedIdRef.current !== id) return;
      const previous = entryDateRef.current;
      const mutationId = ++entryMetadataMutationRef.current;
      entryDateRef.current = date;
      setEntryDate(date);
      setQueryMutationCount((count) => count + 1);
      void (async () => {
        try {
          await window.api.setEntryDate(id, date);
          setQueryRevision((revision) => revision + 1);
          await refresh();
        } catch (err) {
          if (selectedEntryIdRef.current === id && entryMetadataMutationRef.current === mutationId) {
            entryDateRef.current = previous;
            setEntryDate(previous);
          }
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setQueryMutationCount((count) => Math.max(0, count - 1));
        }
      })();
    },
    [refresh],
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

  const onEditorLoaded = useCallback((entryId: string) => {
    setLoadError(null); // a successful (re)load clears any earlier load-failure notice
    loadedEntryIdRef.current = entryId;
    if (controllerRef.current) {
      queryProjectionRef.current = annotationQueryProjection(controllerRef.current.extractAnnotations());
    }
    const pending = pendingSelectRef.current;
    if (pending) {
      controllerRef.current?.selectAnnotationById(pending);
      pendingSelectRef.current = null;
    }
    const pendingFlash = pendingFlashRef.current;
    if (
      pendingFlash &&
      pendingFlash.entryId === entryId &&
      pendingFlash.contextKey === railContextKeyRef.current &&
      pendingFlash.requestId === activationRequestRef.current
    ) {
      if ('annIds' in pendingFlash.req) controllerRef.current?.flashAnnotationHighlight(pendingFlash.req.annIds);
      else controllerRef.current?.flashTagHighlight(pendingFlash.req.tag);
      pendingFlashRef.current = null;
    }
  }, []);

  // The open review failed to load. Drop the controller so its cleared canvas can never be auto-saved
  // over the review's real data, and surface a notice (the editor is replaced by a load-error panel).
  const onEditorLoadError = useCallback((message: string) => {
    controllerRef.current = null;
    loadedEntryIdRef.current = null;
    queryProjectionRef.current = null;
    setEditorState(EMPTY_EDITOR);
    setLoadError(message);
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
        activeTab={activeTab}
        onActiveTabChange={changeActiveTab}
        entryOpen={entryOpen}
        hasSelection={editorState.hasSelection}
        tool={tool}
        style={selectionStyle ?? style}
        canUndo={editorState.canUndo}
        canRedo={editorState.canRedo}
        onNew={() => void createNew()}
        onDeleteReview={() => {
          if (selectedEntryId) setConfirmDelete(selectedEntryId);
        }}
        onTool={pickTool}
        onStyle={changeStyle}
        onBeforeTextStyle={() => controllerRef.current?.snapshotTextSelection()}
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
        entryDate={entryDate}
        entryMetadataReady={entryMetadataLoadedId === selectedEntryId}
        onChangeEntryDate={onChangeEntryDate}
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
        statsScope={statsConfig?.scope ?? null}
        statsPeriod={statsPeriod}
        statsCustomRange={statsCustomRange}
        statsDimension={statsConfig?.dimension ?? null}
        statsThreshold={statsConfig?.threshold}
        statsCompareBy={statsConfig?.compareBy}
        statsControlsDisabled={statsExamples !== null || statsExamplesBusy}
        onStatsEditSample={() => {
          if (!statsConfig) importCurrentViewIntoStats();
          setShowStatsSample(true);
        }}
        onStatsUseCurrentView={importCurrentViewIntoStats}
        onStatsPeriod={changeStatsPeriod}
        onStatsCustomRange={changeStatsCustomRange}
        onStatsDimension={changeStatsDimension}
        onStatsThreshold={(threshold) =>
          setStatsConfig((current) => (current ? { ...current, threshold } : current))
        }
        onStatsCompareBy={(compareBy) =>
          setStatsConfig((current) => (current ? { ...current, compareBy } : current))
        }
      />

      <div className="workspace">
      <div className={`body${statsWorkspace ? ' body--concealed' : ''}${statsExamples ? ' body--stats-examples' : ''}`}>
        {statsExamples ? (
          <div className="stats-examples-bar" data-testid="stats-examples-bar">
            <button type="button" className="ribbon__back" data-testid="stats-back" onClick={() => changeActiveTab('Stats')}>
              <Icon name="back" /> Back to Statistics
            </button>
            <strong>Statistics examples: {statsExamples.label}</strong>
            <span>
              {statsExamples.kind === 'entries'
                ? 'This review is in the exact date and classification scope'
                : `This review: ${currentStatsExample?.annotationIds.length ?? 0} matching sample${
                    (currentStatsExample?.annotationIds.length ?? 0) === 1 ? '' : 's'
                  }`}
            </span>
            {statsExamples.kind === 'samples' ? <div className="stats-examples-bar__step">
              <button
                type="button"
                data-testid="stats-example-prev"
                disabled={!currentStatsExample || statsExamples.annotationIndex <= 0}
                onClick={() => activateStatsExample(statsExamples.activeEntryId, statsExamples.annotationIndex - 1)}
              >
                Previous
              </button>
              <span data-testid="stats-example-position">
                {currentStatsExample ? statsExamples.annotationIndex + 1 : 0} / {currentStatsExample?.annotationIds.length ?? 0}
              </span>
              <button
                type="button"
                data-testid="stats-example-next"
                disabled={!currentStatsExample || statsExamples.annotationIndex >= currentStatsExample.annotationIds.length - 1}
                onClick={() => activateStatsExample(statsExamples.activeEntryId, statsExamples.annotationIndex + 1)}
              >
                Next
              </button>
            </div> : <span />}
          </div>
        ) : null}
        <aside className="rail">
          {statsExamples ? (
            <div className="browse stats-examples-rail" data-testid="stats-examples-rail">
              <div className="stats-examples-rail__head">
                <span>Evidence</span><strong>{statsExamples.entries.length}</strong>
              </div>
              <div className="buckets">
                <Thumbnails
                  entries={statsExampleSummaries}
                  selectedId={statsExamples.activeEntryId}
                  onOpen={(entryId) => activateStatsExample(entryId)}
                  onContextMenu={openThumbMenu}
                />
              </div>
            </div>
          ) : (
            <GroupBrowser
              ref={browserRef}
              groups={groups}
              pivot={pivot}
              onPivot={setPivot}
              buckets={buckets}
              totalCount={entries.length}
              sortDir={sortDir}
              onToggleSort={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
              selectedOccurrence={activeOccurrence}
              filterChips={chips}
              onClearFilter={() => setFilter(EMPTY_QUERY)}
              onOpen={(occurrence) => void activateOccurrence(occurrence)}
              onContextMenu={openThumbMenu}
              loading={!railReady && !railError}
              error={railError}
              onRetry={() => setRailRetry((retry) => retry + 1)}
            />
          )}
        </aside>

        <main className="main">
          {error ? (
            <div className="notice notice--error" data-testid="ingest-error">
              {error}
            </div>
          ) : null}
          {saveError ? (
            <div className="notice notice--error" data-testid="save-error" role="alert">
              Couldn’t save your last change ({saveError}). Your edit is still on the page — it will retry on
              your next change, or press Ctrl+S.
            </div>
          ) : null}
          {busy ? <div className="notice">Working…</div> : null}
          {selectedEntryId ? (
            loadError ? (
              <div className="empty-state" data-testid="load-error">
                <div className="empty-state__card">
                  <h2>Couldn’t open this review</h2>
                  <p>
                    Your data is safe and was not changed. A screenshot this review uses couldn’t be read —
                    it may still be downloading (for example from OneDrive), or its image file is missing.
                  </p>
                  <button
                    type="button"
                    className="empty-state__new"
                    data-testid="load-error-retry"
                    onClick={() => setLoadError(null)}
                  >
                    Try again
                  </button>
                  <span className="empty-state__hint">{loadError}</span>
                </div>
              </div>
            ) : (
              <CanvasEditor
                key={selectedEntryId}
                entryId={selectedEntryId}
                onReady={onReady}
                onLoaded={onEditorLoaded}
                onLoadError={onEditorLoadError}
                onWheelNavigate={onWheelNavigate}
              />
            )
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

      {statsWorkspace ? (
        <div className="stats-workspace" data-testid="stats-workspace" ref={statsScrollRef}>
          <StatsPanel
            query={statsQuery}
            report={statsReport}
            loading={statsLoading}
            error={statsError}
            drillError={statsDrillError}
            ignoredResultCount={statsIgnoredResults}
            drillBusy={statsExamplesBusy}
            onRetry={() => setStatsRetry((retry) => retry + 1)}
            onEditSample={() => setShowStatsSample(true)}
            onOpenResultSettings={() => setShowResultSettings(true)}
            onFocusMeasure={focusStatsMeasure}
            onReviewScopeEntries={reviewStatsScopeEntries}
            onReviewExamples={(segment, cohortValue) => void openStatsExamples(segment, cohortValue)}
          />
        </div>
      ) : null}
      </div>

      <StatusBar
        ipcHealth={ipcHealth}
        storeHealth={storeHealth}
        storeLabel={storeLabel}
        dirty={!statsWorkspace && entryOpen ? editorState.dirty : undefined}
        showZoom={!statsWorkspace && entryOpen}
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
      {showStatsSample && statsConfig ? (
        <StatsSampleDialog
          groups={groups}
          initial={statsConfig.scope}
          onApply={applyStatsSample}
          onClose={() => setShowStatsSample(false)}
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
      {confirmDelete ? (
        <ConfirmDialog
          title="Delete review?"
          message="This permanently deletes the review — its page, screenshots, annotations and tags. This cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => {
            const id = confirmDelete;
            setConfirmDelete(null);
            void removeEntry(id);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}
    </div>
  );
}
