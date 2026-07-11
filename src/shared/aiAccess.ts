import type { Bounds, Result, Tag, ViewQuery } from './domain';

export type AiAccessState = 'off' | 'starting' | 'on' | 'stopping' | 'error';

export interface AiAccessActivity {
  at: string;
  client: string;
  operation: string;
  outcome: 'ok' | 'rejected' | 'error';
  itemCount?: number;
  byteCount?: number;
}

export interface AiAccessStatus {
  state: AiAccessState;
  disclosureAccepted: boolean;
  port: number | null;
  endpoint: string | null;
  clientCount: number;
  accessEpoch: string | null;
  error: string | null;
  guide: string;
  recentActivity: AiAccessActivity[];
}

export interface AiPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface AiPromptTemplate {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  body: string;
  arguments: AiPromptArgument[];
  source: 'built-in' | 'custom';
}

export interface AiAccessSettings {
  guide: string;
  prompts: AiPromptTemplate[];
}

export interface AiReadContext {
  journalInstanceId: string;
  accessEpoch: string;
  sessionId: string;
  snapshotAt: string;
}

export interface AiPageInput {
  cursor?: string;
  limit?: number;
}

export interface AiPage<T> {
  items: T[];
  nextCursor?: string;
  snapshotAt: string;
  truncated?: boolean;
  narrowQueryHint?: string;
}

export type AiEvidenceTrust = 'untrusted-journal-evidence';

export interface AiJournalOverview {
  journalInstanceId: string;
  appVersion: string;
  schemaVersion: number;
  entryCount: number;
  annotationCount: number;
  dateRange: { from: string; to: string } | null;
  groupCount: number;
  resultDimensionCount: number;
  savedViewCount: number;
  agentGuideResource: string;
}

export interface AiVocabularyQuery extends AiPageInput {
  kind: 'groups' | 'results' | 'saved-views';
  includeArchived?: boolean;
}

export interface AiVocabularyItem {
  id: string;
  label: string;
  kind: 'group' | 'tag-value' | 'result-dimension' | 'result-value' | 'saved-view';
  parentId?: string;
  valueType?: 'string' | 'number';
  archived: boolean;
  usageCount?: number;
  entryUsageCount?: number;
  annotationUsageCount?: number;
  annotationEntryUsageCount?: number;
  query?: ViewQuery;
}

export interface AiDateRange {
  from: string;
  to: string;
}

export interface AiEntrySearchQuery extends AiPageInput {
  query?: ViewQuery;
  savedViewId?: string;
  dateRange?: AiDateRange;
  sort?: 'newest' | 'oldest';
}

export interface AiEntrySummary {
  entryId: string;
  effectiveDate: string;
  entryTags: Tag[];
  matchingAnnotationIds: string[];
  contextResource: string;
}

export interface AiSampleSearchQuery extends AiPageInput {
  query: ViewQuery;
  dateRange?: AiDateRange;
  sort?: 'newest' | 'oldest';
}

export interface AiSampleSummary {
  annotationId: string;
  entryId: string;
  effectiveDate: string;
  bounds: Bounds;
  tags: Tag[];
  result?: Result;
  links: string[];
  contextResource: string;
}

export interface AiSampleStudyQuery {
  query: ViewQuery;
  dateRange?: AiDateRange;
  sort?: 'newest' | 'oldest';
  resultDimensions?: string[];
  maxSamples?: number;
  nearbyTextLimitPerEntry?: number;
}

export interface AiResultValueCount {
  value: string;
  count: number;
  rate: number;
}

export interface AiResultDimensionSummary {
  id: string;
  label: string;
  type: 'string' | 'number' | 'unknown';
  populationCount: number;
  recordedCount: number;
  missingCount: number;
  stringValues?: AiResultValueCount[];
  numberSummary?: {
    min: number;
    max: number;
    mean: number;
  };
}

export interface AiStudySample extends AiSampleSummary {
  text?: string;
  textTrust?: AiEvidenceTrust;
}

export interface AiNearbyTextEvidence {
  annotationId: string;
  text: string;
  bounds: Bounds;
  nearestSampleAnnotationId: string;
  distancePx: number;
  evidenceTrust: AiEvidenceTrust;
}

export interface AiSampleStudyEntry {
  entryId: string;
  effectiveDate: string;
  title?: string;
  entryTags: Tag[];
  samples: AiStudySample[];
  nearbyTexts: AiNearbyTextEvidence[];
  contextResource: string;
}

export interface AiVisualEvidenceBatchRequest {
  requests: AiVisualEvidenceQuery[];
}

export interface AiSampleStudyVisualBatch {
  requests: AiVisualEvidenceQuery[];
  sampleCount: number;
}

export interface AiSampleStudy {
  query: ViewQuery;
  dateRange?: AiDateRange;
  snapshotAt: string;
  populationSampleCount: number;
  distinctEntryCount: number;
  returnedSampleCount: number;
  truncated: boolean;
  narrowQueryHint?: string;
  resultDimensions: AiResultDimensionSummary[];
  entries: AiSampleStudyEntry[];
  visualBatches: AiSampleStudyVisualBatch[];
  evidenceTrust: AiEvidenceTrust;
}

export interface AiAnnotationContext extends AiSampleSummary {
  text?: string;
  textTrust?: AiEvidenceTrust;
}

export interface AiEntryContext {
  entryId: string;
  effectiveDate: string;
  createdAt: number;
  updatedAt: number;
  entryTags: Tag[];
  title?: string;
  annotations: AiAnnotationContext[];
  visualEvidenceTool: 'get_visual_evidence';
  evidenceTrust: AiEvidenceTrust;
}

export interface AiLinkedContextQuery {
  annotationId: string;
  depth?: 1 | 2;
}

export interface AiLinkedContext {
  nodes: AiAnnotationContext[];
  edges: Array<{ from: string; to: string; broken: boolean }>;
  truncated: boolean;
}

export type AiPoint = { x: number; y: number };
export type AiAffineTransform = [number, number, number, number, number, number];

export type AiVisualGeometry =
  | { kind: 'quad'; points: [AiPoint, AiPoint, AiPoint, AiPoint] }
  | { kind: 'segment'; start: AiPoint; end: AiPoint }
  | { kind: 'arrow'; start: AiPoint; end: AiPoint; arrowTip: AiPoint; arrowHead: [AiPoint, AiPoint, AiPoint] }
  | { kind: 'polyline'; points: AiPoint[]; precision: 'exact' }
  | { kind: 'path'; points: AiPoint[]; precision: 'flattened'; tolerancePx: number }
  | { kind: 'composite'; children: AiVisualGeometry[] }
  | { kind: 'unsupported'; reason: string };

export interface AiScreenshotInstance {
  id: string;
  hash: string;
  nativeWidth: number;
  nativeHeight: number;
  pageQuad: [AiPoint, AiPoint, AiPoint, AiPoint];
  sourceToPage: AiAffineTransform;
  pageToSource?: AiAffineTransform;
  zIndex: number;
}

export interface AiVisualAnnotation {
  markId: string;
  annotationId: string;
  indexBounds: Bounds;
  paintBounds: Bounds;
  geometry: AiVisualGeometry;
  visualStyle: {
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    opacity?: number;
  };
  zIndex: number;
  tags: Tag[];
  result?: Result;
  links: string[];
  text?: string;
  association: {
    kind: 'unique' | 'ambiguous' | 'none' | 'unsupported';
    screenshotIds: string[];
  };
}

export type AiVisualAssetKind =
  | 'overview'
  | 'locator'
  | 'focus'
  | 'source-locator'
  | 'source-clean'
  | 'underlay';

export interface AiVisualAsset {
  id: string;
  kind: AiVisualAssetKind;
  uri: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  width: number;
  height: number;
  annotationId?: string;
  markId?: string;
  pairedAssetId?: string;
  derived: boolean;
  notUserVisibleComposition?: boolean;
  evidenceTrust: AiEvidenceTrust;
  warnings: string[];
}

export interface AiVisualEvidenceManifest {
  bundleId: string;
  entryId: string;
  evidenceRevision: string;
  page: { width: number; height: number; pageToRender: AiAffineTransform };
  screenshots: AiScreenshotInstance[];
  annotations: AiVisualAnnotation[];
  assets: AiVisualAsset[];
  inlineAssetIds?: string[];
  omittedInlineAssetIds?: string[];
  evidenceTrust: AiEvidenceTrust;
  warnings: string[];
  expiresAt: string;
}

export interface AiVisualEvidenceQuery {
  entryId: string;
  annotationIds: string[];
}

export interface AiVisualEvidenceBatch {
  manifests: AiVisualEvidenceManifest[];
}

export interface AiResourceRead {
  uri: string;
  mimeType: string;
  text?: string;
  blob?: string;
}

export interface AiResourceBatchRead {
  items: AiResourceRead[];
}

export type AiReadErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_SAMPLE_POPULATION'
  | 'NOT_FOUND'
  | 'CURSOR_EXPIRED'
  | 'SESSION_MISMATCH'
  | 'REVISION_EXPIRED'
  | 'EVIDENCE_EXPIRED'
  | 'LIMIT_EXCEEDED'
  | 'BUSY'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'READ_FAILED';

export interface AiReadError {
  code: AiReadErrorCode;
  message: string;
  hint: string;
  field?: string;
  retryable: boolean;
}

export type JournalReadRequest =
  | { op: 'overview' }
  | { op: 'list-vocabulary'; input: AiVocabularyQuery }
  | { op: 'search-entries'; input: AiEntrySearchQuery }
  | { op: 'search-samples'; input: AiSampleSearchQuery }
  | { op: 'prepare-sample-study'; input: AiSampleStudyQuery }
  | { op: 'entry-context'; input: { entryId: string; expectedUpdatedAt?: number } }
  | { op: 'linked-context'; input: AiLinkedContextQuery }
  | { op: 'visual-evidence'; input: AiVisualEvidenceQuery }
  | { op: 'visual-evidence-batch'; input: AiVisualEvidenceBatchRequest }
  | { op: 'read-resource'; input: { uri: string } }
  | { op: 'read-resources'; input: { uris: string[] } };

export type JournalReadResponse =
  | { op: 'overview'; value: AiJournalOverview }
  | { op: 'list-vocabulary'; value: AiPage<AiVocabularyItem> }
  | { op: 'search-entries'; value: AiPage<AiEntrySummary> }
  | { op: 'search-samples'; value: AiPage<AiSampleSummary> }
  | { op: 'prepare-sample-study'; value: AiSampleStudy }
  | { op: 'entry-context'; value: AiEntryContext }
  | { op: 'linked-context'; value: AiLinkedContext }
  | { op: 'visual-evidence'; value: AiVisualEvidenceManifest }
  | { op: 'visual-evidence-batch'; value: AiVisualEvidenceBatch }
  | { op: 'read-resource'; value: AiResourceRead }
  | { op: 'read-resources'; value: AiResourceBatchRead };