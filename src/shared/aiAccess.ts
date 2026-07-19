import type { Bounds, InternalLinkTarget, Result, Tag, TextLinkSpan, ViewQuery } from './domain';

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
  textLinks: TextLinkSpan[];
}

export interface AiEntryContext {
  entryId: string;
  effectiveDate: string;
  createdAt: number;
  updatedAt: number;
  entryTags: Tag[];
  title?: string;
  titleTextLinks: TextLinkSpan[];
  annotations: AiAnnotationContext[];
  visualEvidenceTool: 'get_visual_evidence';
  evidenceTrust: AiEvidenceTrust;
}

export interface AiLinkedContextQuery {
  target: InternalLinkTarget;
  depth?: 1 | 2;
}

export type AiLinkedContextNode =
  | {
      target: { kind: 'entry'; id: string };
      entryId: string;
      effectiveDate: string;
      title?: string;
      entryTags: Tag[];
    }
  | {
      target: { kind: 'annotation'; id: string };
      entryId: string;
      effectiveDate: string;
      bounds: Bounds;
      tags: Tag[];
      result?: Result;
      text?: string;
      textLinks: TextLinkSpan[];
    };

export interface AiLinkedContext {
  nodes: AiLinkedContextNode[];
  edges: Array<{
    source: InternalLinkTarget;
    target: InternalLinkTarget;
    start: number;
    end: number;
    displayText: string;
    broken: boolean;
  }>;
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
  textLinks: TextLinkSpan[];
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

export interface AiPixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AiUniformBarAlignment {
  direction: 'left-to-right';
  anchorBar: number;
  anchorCenterX: number;
  spacingPx: number;
}

export type AiVisualArtifactSpec =
  | { kind: 'source-original'; screenshotId: string }
  | { kind: 'instance-source-window'; screenshotId: string }
  | { kind: 'source-region'; screenshotId: string; roi: AiPixelRect }
  | { kind: 'page-region'; roi: AiPixelRect; composition: 'committed-page' | 'clean-underlay' }
  | {
      kind: 'annotation-context';
      annotationId: string;
      contextPx: number;
      composition: 'committed-page' | 'source-clean';
    }
  | {
      kind: 'bar-alignment-probe';
      screenshotId: string;
      roi: AiPixelRect;
      proposal: AiUniformBarAlignment;
    }
  | {
      kind: 'bar-reveal';
      acceptedProbeId: string;
      acceptedProposalHash: string;
      fromBar: number;
      toBar: number;
    };

export interface AiVisualArtifactPlanRequest {
  bundleId: string;
  specs: AiVisualArtifactSpec[];
}

export type AiVisualArtifactKind =
  | 'source-original'
  | 'instance-source-window'
  | 'source-region'
  | 'page-region'
  | 'annotation-context'
  | 'bar-probe-clean'
  | 'bar-probe-locator'
  | 'bar-probe-magnifier-clean'
  | 'bar-probe-magnifier-locator'
  | 'bar-reveal-frame';

export interface AiVisualArtifactItem {
  id: string;
  kind: AiVisualArtifactKind;
  uri: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  filename: string;
  width: number;
  height: number;
  byteCount: number;
  sha256: string;
  screenshotId?: string;
  annotationId?: string;
  sourceRoi?: AiPixelRect;
  pageRoi?: AiPixelRect;
  derived: boolean;
  evidenceTrust: AiEvidenceTrust;
  warnings: string[];
}

export interface AiResolvedBar {
  bar: number;
  centerX: number;
  cutoffX: number;
}

export interface AiBarAlignmentProbe {
  probeId: string;
  proposalHash: string;
  screenshotId: string;
  roi: AiPixelRect;
  proposal: AiUniformBarAlignment;
  resolvedBars: AiResolvedBar[];
  assetIds: string[];
  calibrationExposedFuture: true;
  warnings: string[];
}

export interface AiProgressiveReveal {
  revealId: string;
  probeId: string;
  screenshotId: string;
  roi: AiPixelRect;
  fromBar: number;
  toBar: number;
  frameCount: number;
  calibrationExposedFuture: true;
  warnings: string[];
}

export interface AiVisualArtifactPlan {
  planId: string;
  planHash: string;
  bundleId: string;
  entryId: string;
  evidenceRevision: string;
  items: AiVisualArtifactItem[];
  probes: AiBarAlignmentProbe[];
  reveals: AiProgressiveReveal[];
  estimatedFileCount: number;
  estimatedByteCount: number;
  inlineItemIds?: string[];
  omittedInlineItemIds?: string[];
  evidenceTrust: AiEvidenceTrust;
  warnings: string[];
  expiresAt: string;
}

export interface AiProgressiveRevealAdvanceRequest {
  planId: string;
  planHash: string;
  revealId: string;
  action: 'start' | 'next' | 'previous' | 'seek';
  frameIndex?: number;
}

export interface AiProgressiveRevealFrame {
  revealId: string;
  frameIndex: number;
  highestRevealedFrame: number;
  frameCount: number;
  bar: number;
  centerX: number;
  cutoffX: number;
  width: number;
  height: number;
  mimeType: 'image/png';
  byteCount: number;
  sha256: string;
  item: AiVisualArtifactItem;
  blob: string;
  evidenceTrust: AiEvidenceTrust;
  warnings: string[];
}

export interface AiVisualArtifactChunkRequest {
  planId: string;
  planHash: string;
  itemId: string;
  offset: number;
  maxBytes: number;
}

export interface AiVisualArtifactChunk {
  planId: string;
  itemId: string;
  filename: string;
  mimeType: AiVisualArtifactItem['mimeType'];
  encoding: 'base64';
  offset: number;
  byteCount: number;
  totalByteCount: number;
  nextOffset?: number;
  sha256: string;
  data: string;
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
  | { op: 'create-visual-artifacts'; input: AiVisualArtifactPlanRequest }
  | { op: 'advance-progressive-reveal'; input: AiProgressiveRevealAdvanceRequest }
  | { op: 'read-visual-artifact-chunk'; input: AiVisualArtifactChunkRequest }
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
  | { op: 'create-visual-artifacts'; value: AiVisualArtifactPlan }
  | { op: 'advance-progressive-reveal'; value: AiProgressiveRevealFrame }
  | { op: 'read-visual-artifact-chunk'; value: AiVisualArtifactChunk }
  | { op: 'read-resource'; value: AiResourceRead }
  | { op: 'read-resources'; value: AiResourceBatchRead };