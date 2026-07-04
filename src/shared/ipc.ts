// Typed IPC contract shared by main (handler), preload (bridge) and renderer (caller).
import type {
  AnnotationHit,
  Annotation,
  CreateEntryInput,
  Entry,
  EntrySummary,
  ResultDimension,
  Tag,
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
  queryAnnotationsByTag(tag: Tag): Promise<AnnotationHit[]>;
  locateAnnotation(annotationId: string): Promise<{ entryId: string } | null>;
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
  queryAnnotationsByTag: 'store:query-annotations-by-tag',
  locateAnnotation: 'store:locate-annotation',
  getStampLibrary: 'stamp:get-library',
  saveStampLibrary: 'stamp:save-library',
} as const;
