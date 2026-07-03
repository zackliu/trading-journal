// Slice 1 domain contracts. Pure types only (no runtime), so both the Electron
// main process and the renderer can import them across the typed IPC boundary.
//
// Invariants encoded here:
// - A Tag is a grouped classification: `group:value` (kebab-case), stored as two fields.
// - An annotation's `result` is a typed, multi-dimensional measurement — NOT a tag,
//   never in the browse navigation. Each dimension's value is a string or a number;
//   its type is governed by a user-predefined ResultDimension.
// - An Entry is the durable artifact: image ref + opaque canvas JSON + entry tags +
//   the annotation projections. It is stored once and never duplicated for a view.

export interface ImageRef {
  hash: string;
}

export interface Tag {
  group: string;
  value: string;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ResultValueType = 'string' | 'number';

/** A user-predefined outcome dimension. Its `type` governs how values are stored. */
export interface ResultDimension {
  id: string;
  label: string;
  type: ResultValueType;
}

/** An annotation's optional outcome: dimensionId -> typed value. Stats-only. */
export type Result = Record<string, string | number>;

export interface Annotation {
  id: string;
  bounds: Bounds;
  tags: Tag[];
  result?: Result;
  links?: string[];
}

export interface Entry {
  id: string;
  image?: ImageRef;
  canvasJson: string;
  entryTags: Tag[];
  annotations: Annotation[];
  createdAt: number;
  updatedAt: number;
}

export interface CreateEntryInput {
  image?: ImageRef;
  canvasJson: string;
  entryTags: Tag[];
  annotations: Annotation[];
}

/** A denormalized annotation row returned by index queries (never reads canvas JSON). */
export interface AnnotationHit {
  annotationId: string;
  entryId: string;
  bounds: Bounds;
  tags: Tag[];
  result?: Result;
  links: string[];
}

export interface SavedView {
  id: string;
  name: string;
  queryJson: string;
  createdAt: number;
}

/** A compact entry row for the Daily list (no canvas JSON, no annotations). */
export interface EntrySummary {
  id: string;
  imageHash?: string;
  createdAt: number;
  date?: string;
}
