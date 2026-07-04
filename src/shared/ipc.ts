// Typed IPC contract shared by main (handler), preload (bridge) and renderer (caller).
import type {
  AnnotationHit,
  Annotation,
  CreateEntryInput,
  Entry,
  EntrySummary,
  ResultDimension,
  Tag,
  TagGroup,
  TagGroupView,
  TagValue,
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
  setGroupPinned(id: string, pinned: boolean): Promise<void>;
  reorderGroups(ids: string[]): Promise<void>;
  reorderValues(groupId: string, values: string[]): Promise<void>;
  getStampLibrary(): Promise<{ canvasJson: string }>;
  saveStampLibrary(canvasJson: string): Promise<void>;
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
  setGroupPinned: 'vocab:set-group-pinned',
  reorderGroups: 'vocab:reorder-groups',
  reorderValues: 'vocab:reorder-values',
  getStampLibrary: 'stamp:get-library',
  saveStampLibrary: 'stamp:save-library',
} as const;
