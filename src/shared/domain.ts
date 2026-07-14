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

/**
 * Where the app looks for the active journal data folder, and whether it is usable. `ready` means the
 * folder exists, is writable, and the database is open on it; the other states drive the setup gate.
 * `source` records how the path was resolved (env override / config pointer / nothing configured).
 */
export type WorkspaceStatus = 'ready' | 'unset' | 'missing' | 'unwritable';

export interface WorkspaceState {
  status: WorkspaceStatus;
  dataDir: string | null;
  source: 'env' | 'config' | 'none';
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

/** A preset value for a (string) result dimension — the value half plus an optional display label. */
export interface ResultDimensionValue {
  value: string;
  label?: string;
  /** How many distinct reviews have recorded this value (for the delete-confirm + Settings). */
  count: number;
}

/** A result dimension plus its declared preset values (empty for number dimensions) — the registry read. */
export interface ResultDimensionView {
  id: string;
  label: string;
  type: ResultValueType;
  /** How many distinct reviews have recorded any value for this dimension. */
  count: number;
  values: ResultDimensionValue[];
}

/** Archived (soft-deleted) classification vocabulary, shown in the Settings “Archived” section. */
export interface ArchivedGroup {
  id: string;
  label: string;
}
export interface ArchivedValue {
  groupId: string;
  groupLabel: string;
  value: string;
  label?: string;
}
export interface ArchivedVocab {
  groups: ArchivedGroup[];
  values: ArchivedValue[];
}

/** Archived (soft-deleted) result vocabulary, shown in the Result Settings “Archived” section. */
export interface ArchivedResultDimension {
  id: string;
  label: string;
}
export interface ArchivedResultValue {
  dimensionId: string;
  dimensionLabel: string;
  value: string;
}
export interface ArchivedResults {
  dimensions: ArchivedResultDimension[];
  values: ArchivedResultValue[];
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

/** One classification predicate: the group must carry at least one of these values (OR within). */
export interface TagPredicate {
  group: string;
  values: string[];
}

/**
 * A typed result predicate (annotation dimension only). A string dimension matches by membership in
 * `in`; a number dimension matches the range `gte`..`lte` (either bound optional). `result` is never
 * a tag — this only lets a view filter on a measured outcome.
 */
export interface ResultPredicate {
  dimension: string;
  in?: string[];
  gte?: number;
  lte?: number;
}

/**
 * A two-dimension view query. `entry` predicates must EXIST at the Entry level; the `annotation` tag
 * predicates + `results` predicates must ALL co-occur on a SINGLE annotation. An Entry matches when
 * the entry dimension holds AND at least one annotation satisfies the whole annotation dimension.
 * Level is chosen here (per view), never declared on the group.
 */
export interface ViewQuery {
  entry: TagPredicate[];
  annotation: TagPredicate[];
  results: ResultPredicate[];
}

/** A matched Entry plus the annotation ids that satisfied the annotation dimension (drives highlight). */
export interface ViewMatch {
  entryId: string;
  annotationIds: string[];
}

export interface StatsDateRange {
  from: string;
  to: string;
}

export type StatsPopulation =
  | { kind: 'matching-annotations'; predicates: TagPredicate[] }
  | { kind: 'active-result-bearing' };

export interface StatsScope {
  entry: TagPredicate[];
  population: StatsPopulation;
  dateRange?: StatsDateRange;
}

export interface StatsThreshold {
  op: 'gte' | 'lte';
  value: number;
}

export interface StatsCompareBy {
  level: 'entry' | 'annotation';
  group: string;
}

export interface StatsQuery {
  scope: StatsScope;
  dimension: string;
  threshold?: StatsThreshold;
  compareBy?: StatsCompareBy;
}

export interface StatsSampleCounts {
  contributingEntryCount: number;
  populationCount: number;
  recordedCount: number;
  missingCount: number;
  coverage: number | null;
}

export interface NumberAggregate {
  kind: 'number';
  mean: number | null;
  median: number | null;
  threshold?: StatsThreshold & {
    matchCount: number;
    rate: number | null;
  };
}

export interface StringSegment {
  value: string;
  label?: string;
  archivedOrUnregistered: boolean;
  count: number;
  rate: number | null;
}

export interface StringAggregate {
  kind: 'string';
  segments: StringSegment[];
}

export type StatsAggregate = NumberAggregate | StringAggregate;

export interface StatsCohort extends StatsSampleCounts {
  value: string | null;
  label: string;
  archivedOrUnregistered: boolean;
  aggregate: StatsAggregate;
}

export interface StatsReport {
  measure: ResultDimension;
  scopeEntryCount: number;
  counts: StatsSampleCounts;
  overall: StatsAggregate;
  cohorts?: StatsCohort[];
  overlap?: {
    multiAssignedPopulationCount: number;
    unassignedPopulationCount: number;
  };
}

export type StatsExamplesSegment =
  | { kind: 'all' }
  | { kind: 'recorded' }
  | { kind: 'missing' }
  | { kind: 'string-value'; value: string }
  | { kind: 'threshold-match' }
  | { kind: 'threshold-miss' };

export interface StatsExamplesQuery {
  stats: StatsQuery;
  cohortValue?: string | null;
  segment: StatsExamplesSegment;
}

export interface StatsExamplesEntry {
  entryId: string;
  annotationIds: string[];
}

/**
 * A user-declared classification group in the vocabulary registry. Groups (and their
 * values) exist independently of whether any review uses them — this registry feeds the
 * pivot browse dropdown, the Review/Annotation quick-pick, and Settings. `date` is NOT a
 * registry group: it is structural, system-maintained, and never a tagging option.
 */
export interface TagGroup {
  id: string;
  label: string;
  /** Pinned groups render as quick-pick controls on the Review / Annotation ribbon tabs. */
  pinned: boolean;
}

/** A user-declared value within a group (the `value` half of a `group:value` tag). */
export interface TagValue {
  groupId: string;
  value: string;
  label?: string;
}

/** A registry value plus its distinct-entry hit count (entry-level ∪ annotation-level). */
export interface TagValueView {
  value: string;
  label?: string;
  count: number;
}

/** A group with its declared values and counts — the read shape for browse + Settings. */
export interface TagGroupView {
  id: string;
  label: string;
  pinned: boolean;
  values: TagValueView[];
}

/** A compact entry row for the Daily list (no canvas JSON, no annotations). */
export interface EntrySummary {
  id: string;
  /** Rendered snapshot of the page (JPEG data URL); reflects the latest saved edits. */
  thumbnail?: string;
  /** Cover screenshot hash, used only as a fallback before the page is first rendered. */
  imageHash?: string;
  createdAt: number;
  date?: string;
}
