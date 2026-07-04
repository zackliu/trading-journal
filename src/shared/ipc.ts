// Typed IPC contract shared by main (handler), preload (bridge) and renderer (caller).
import type {
  AnnotationHit,
  Annotation,
  ArchivedResults,
  ArchivedVocab,
  CreateEntryInput,
  Entry,
  EntrySummary,
  ResultDimension,
  ResultDimensionView,
  SavedView,
  Tag,
  TagGroup,
  TagGroupView,
  TagValue,
  ViewMatch,
  ViewQuery,
} from './domain';

export interface PingResult {
  ok: boolean;
  ts: number;
  dataDir: string;
  sqliteReady: boolean;
  userVersion: number;
}

export interface IpcApi {
  ping(): Promise<PingResult>;
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
  queryAnnotationsByTag(tag: Tag): Promise<AnnotationHit[]>;
  queryEntriesByTag(tag: Tag): Promise<EntrySummary[]>;
  locateAnnotation(annotationId: string): Promise<{ entryId: string } | null>;
  listGroups(): Promise<TagGroupView[]>;
  defineGroup(group: TagGroup): Promise<void>;
  deleteGroup(id: string): Promise<void>;
  defineValue(value: TagValue): Promise<void>;
  deleteValue(groupId: string, value: string): Promise<void>;
  restoreGroup(id: string): Promise<void>;
  restoreValue(groupId: string, value: string): Promise<void>;
  listArchivedGroups(): Promise<ArchivedVocab>;
  setGroupPinned(id: string, pinned: boolean): Promise<void>;
  reorderGroups(ids: string[]): Promise<void>;
  reorderValues(groupId: string, values: string[]): Promise<void>;
  getStampLibrary(): Promise<{ canvasJson: string }>;
  saveStampLibrary(canvasJson: string): Promise<void>;
  runView(query: ViewQuery): Promise<ViewMatch[]>;
  queryEntriesByView(query: ViewQuery): Promise<EntrySummary[]>;
  countGroupValuesUnderView(query: ViewQuery, groupId: string): Promise<Array<{ value: string; count: number }>>;
  distinctResultValues(dimensionId: string): Promise<string[]>;
  createSavedView(name: string, query: ViewQuery): Promise<SavedView>;
  listSavedViews(): Promise<SavedView[]>;
  getSavedView(id: string): Promise<SavedView | null>;
  deleteSavedView(id: string): Promise<void>;
}

export const IpcChannel = {
  ping: 'app:ping',
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
  queryAnnotationsByTag: 'store:query-annotations-by-tag',
  queryEntriesByTag: 'store:query-entries-by-tag',
  locateAnnotation: 'store:locate-annotation',
  listGroups: 'vocab:list-groups',
  defineGroup: 'vocab:define-group',
  deleteGroup: 'vocab:delete-group',
  defineValue: 'vocab:define-value',
  deleteValue: 'vocab:delete-value',
  restoreGroup: 'vocab:restore-group',
  restoreValue: 'vocab:restore-value',
  listArchivedGroups: 'vocab:list-archived',
  setGroupPinned: 'vocab:set-group-pinned',
  reorderGroups: 'vocab:reorder-groups',
  reorderValues: 'vocab:reorder-values',
  getStampLibrary: 'stamp:get-library',
  saveStampLibrary: 'stamp:save-library',
  runView: 'view:run',
  queryEntriesByView: 'view:query-entries',
  countGroupValuesUnderView: 'view:count-group-values',
  distinctResultValues: 'view:result-values',
  createSavedView: 'view:create-saved',
  listSavedViews: 'view:list-saved',
  getSavedView: 'view:get-saved',
  deleteSavedView: 'view:delete-saved',
} as const;
