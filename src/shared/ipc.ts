// Typed IPC contract shared by main (handler), preload (bridge) and renderer (caller).
import type {
  AnnotationHit,
  Annotation,
  ArchivedResults,
  ArchivedVocab,
  CanvasLayer,
  CanvasLayerDeletionImpact,
  CanvasLayerUsage,
  CreateEntryInput,
  Entry,
  EntrySummary,
  InternalLinkResolution,
  InternalLinkTarget,
  ResultDimension,
  ResultDimensionView,
  SavedView,
  StatsExamplesEntry,
  StatsExamplesQuery,
  StatsQuery,
  StatsReport,
  StatsScope,
  Tag,
  TagGroup,
  TagGroupView,
  TagValue,
  ViewMatch,
  ViewQuery,
  WorkspaceState,
} from './domain';
import type { AiAccessSettings, AiAccessStatus } from './aiAccess';

export interface PingResult {
  ok: boolean;
  ts: number;
  dataDir: string;
  sqliteReady: boolean;
  userVersion: number;
}

export interface IpcApi {
  ping(): Promise<PingResult>;
  getWorkspaceState(): Promise<WorkspaceState>;
  pickWorkspaceFolder(): Promise<string | null>;
  setWorkspaceFolder(dir: string): Promise<WorkspaceState>;
  revealWorkspace(): Promise<void>;
  quitApp(): Promise<void>;
  getAiAccessStatus(): Promise<AiAccessStatus>;
  startAiAccess(confirmFullRead: boolean): Promise<AiAccessStatus>;
  stopAiAccess(): Promise<AiAccessStatus>;
  copyAiHttpConfig(): Promise<string>;
  getAiAccessSettings(): Promise<AiAccessSettings>;
  saveAiAccessSettings(settings: AiAccessSettings): Promise<AiAccessSettings>;
  resetAiAccessKey(): Promise<AiAccessStatus>;
  getJournalId(): Promise<string>;
  copyInternalLink(target: InternalLinkTarget): Promise<string>;
  readClipboardText(): Promise<string>;
  resolveInternalLink(target: InternalLinkTarget): Promise<InternalLinkResolution | null>;
  ingestImageEntry(bytes: Uint8Array): Promise<Entry>;
  listEntries(): Promise<EntrySummary[]>;
  newEntry(): Promise<Entry>;
  storeImage(bytes: Uint8Array): Promise<{ hash: string }>;
  setEntryImage(id: string, hash: string): Promise<Entry>;
  deleteEntry(id: string): Promise<void>;
  defineResultDimension(dimension: ResultDimension): Promise<void>;
  listResultDimensions(): Promise<ResultDimension[]>;
  listResultVocabulary(): Promise<ResultDimensionView[]>;
  deleteResultDimension(id: string): Promise<void>;
  defineResultValue(dimensionId: string, value: string, label?: string): Promise<void>;
  deleteResultValue(dimensionId: string, value: string): Promise<void>;
  restoreResultDimension(id: string): Promise<void>;
  restoreResultValue(dimensionId: string, value: string): Promise<void>;
  listArchivedResults(): Promise<ArchivedResults>;
  createEntry(input: CreateEntryInput): Promise<Entry>;
  updateEntry(id: string, input: CreateEntryInput): Promise<Entry>;
  updateEntryCanvas(id: string, canvasJson: string, annotations: Annotation[], thumbnail: string): Promise<Entry>;
  getEntry(id: string): Promise<Entry | null>;
  setEntryTags(id: string, tags: Tag[]): Promise<Entry>;
  setEntryDate(id: string, date: string): Promise<Entry>;
  queryAnnotationsByTag(tag: Tag): Promise<AnnotationHit[]>;
  queryEntriesByTag(tag: Tag): Promise<EntrySummary[]>;
  listGroups(): Promise<TagGroupView[]>;
  defineGroup(group: TagGroup): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  defineValue(value: TagValue): Promise<void>;
  deleteValue(groupId: string, value: string): Promise<void>;
  restoreGroup(id: string): Promise<void>;
  restoreValue(groupId: string, value: string): Promise<void>;
  purgeGroup(id: string): Promise<void>;
  purgeValue(groupId: string, value: string): Promise<void>;
  listArchivedGroups(): Promise<ArchivedVocab>;
  listCanvasLayers(): Promise<CanvasLayer[]>;
  listCanvasLayerUsage(): Promise<CanvasLayerUsage[]>;
  createCanvasLayer(name: string): Promise<CanvasLayer>;
  renameCanvasLayer(id: string, name: string): Promise<CanvasLayer>;
  reorderCanvasLayers(ids: string[]): Promise<CanvasLayer[]>;
  inspectCanvasLayerDeletion(id: string): Promise<CanvasLayerDeletionImpact>;
  deleteCanvasLayerAndMerge(id: string): Promise<CanvasLayerDeletionImpact>;
  setGroupPinned(id: string, pinned: boolean): Promise<void>;
  reorderGroups(ids: string[]): Promise<void>;
  reorderValues(groupId: string, values: string[]): Promise<void>;
  getStampLibrary(): Promise<{ canvasJson: string }>;
  saveStampLibrary(canvasJson: string): Promise<void>;
  runView(query: ViewQuery): Promise<ViewMatch[]>;
  queryEntriesByView(query: ViewQuery): Promise<EntrySummary[]>;
  countGroupValuesUnderView(query: ViewQuery, groupId: string): Promise<Array<{ value: string; count: number }>>;
  distinctResultValues(dimensionId: string): Promise<string[]>;
  runStats(query: StatsQuery): Promise<StatsReport>;
  queryStatsExamples(query: StatsExamplesQuery): Promise<StatsExamplesEntry[]>;
  queryStatsScopeEntries(scope: StatsScope): Promise<EntrySummary[]>;
  createSavedView(name: string, query: ViewQuery): Promise<SavedView>;
  listSavedViews(): Promise<SavedView[]>;
  getSavedView(id: string): Promise<SavedView | null>;
  deleteSavedView(id: string): Promise<void>;
}

export const IpcChannel = {
  ping: 'app:ping',
  getWorkspaceState: 'workspace:get-state',
  pickWorkspaceFolder: 'workspace:pick-folder',
  setWorkspaceFolder: 'workspace:set-folder',
  revealWorkspace: 'workspace:reveal',
  quitApp: 'workspace:quit',
  getAiAccessStatus: 'ai-access:status',
  startAiAccess: 'ai-access:start',
  stopAiAccess: 'ai-access:stop',
  copyAiHttpConfig: 'ai-access:copy-http-config',
  getAiAccessSettings: 'ai-access:get-settings',
  saveAiAccessSettings: 'ai-access:save-settings',
  resetAiAccessKey: 'ai-access:reset-key',
  getJournalId: 'internal-link:get-journal-id',
  copyInternalLink: 'internal-link:copy',
  resolveInternalLink: 'internal-link:resolve',
  ingestImageEntry: 'ingest:image-entry',
  listEntries: 'store:list-entries',
  newEntry: 'store:new-entry',
  storeImage: 'ingest:store-image',
  setEntryImage: 'store:set-entry-image',
  deleteEntry: 'store:delete-entry',
  defineResultDimension: 'store:define-result-dimension',
  listResultDimensions: 'store:list-result-dimensions',
  listResultVocabulary: 'result:list-vocab',
  deleteResultDimension: 'result:delete-dimension',
  defineResultValue: 'result:define-value',
  deleteResultValue: 'result:delete-value',
  restoreResultDimension: 'result:restore-dimension',
  restoreResultValue: 'result:restore-value',
  listArchivedResults: 'result:list-archived',
  createEntry: 'store:create-entry',
  updateEntry: 'store:update-entry',
  updateEntryCanvas: 'store:update-entry-canvas',
  getEntry: 'store:get-entry',
  setEntryTags: 'store:set-entry-tags',
  setEntryDate: 'store:set-entry-date',
  queryAnnotationsByTag: 'store:query-annotations-by-tag',
  queryEntriesByTag: 'store:query-entries-by-tag',
  listGroups: 'vocab:list-groups',
  defineGroup: 'vocab:define-group',
  deleteGroup: 'vocab:delete-group',
  defineValue: 'vocab:define-value',
  deleteValue: 'vocab:delete-value',
  restoreGroup: 'vocab:restore-group',
  restoreValue: 'vocab:restore-value',
  purgeGroup: 'vocab:purge-group',
  purgeValue: 'vocab:purge-value',
  listArchivedGroups: 'vocab:list-archived',
  listCanvasLayers: 'canvas-layer:list',
  listCanvasLayerUsage: 'canvas-layer:list-usage',
  createCanvasLayer: 'canvas-layer:create',
  renameCanvasLayer: 'canvas-layer:rename',
  reorderCanvasLayers: 'canvas-layer:reorder',
  inspectCanvasLayerDeletion: 'canvas-layer:inspect-deletion',
  deleteCanvasLayerAndMerge: 'canvas-layer:delete-and-merge',
  setGroupPinned: 'vocab:set-group-pinned',
  reorderGroups: 'vocab:reorder-groups',
  reorderValues: 'vocab:reorder-values',
  getStampLibrary: 'stamp:get-library',
  saveStampLibrary: 'stamp:save-library',
  runView: 'view:run',
  queryEntriesByView: 'view:query-entries',
  countGroupValuesUnderView: 'view:count-group-values',
  distinctResultValues: 'view:result-values',
  runStats: 'stats:run',
  queryStatsExamples: 'stats:examples',
  queryStatsScopeEntries: 'stats:scope-entries',
  createSavedView: 'view:create-saved',
  listSavedViews: 'view:list-saved',
  getSavedView: 'view:get-saved',
  deleteSavedView: 'view:delete-saved',
} as const;
