import { z } from 'zod';
import { viewQuerySchema } from '../store/validation';

const id = z.string().min(1).max(200);
const cursor = z.string().min(1).max(200).optional();
const limit = z.number().int().min(1).max(50).optional();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dateRange = z.object({ from: date, to: date }).strict().refine((value) => value.from <= value.to, 'from must not follow to');

const vocabularyQuery = z
  .object({
    kind: z.enum(['groups', 'results', 'saved-views']),
    includeArchived: z.boolean().optional(),
    cursor,
    limit,
  })
  .strict();

const entrySearchQuery = z
  .object({
    query: viewQuerySchema.optional(),
    savedViewId: id.optional(),
    dateRange: dateRange.optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
    cursor,
    limit,
  })
  .strict()
  .refine((value) => !(value.query && value.savedViewId), 'query and savedViewId are mutually exclusive');

const sampleSearchQuery = z
  .object({
    query: viewQuerySchema,
    dateRange: dateRange.optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
    cursor,
    limit,
  })
  .strict();

const sampleStudyQuery = z
  .object({
    query: viewQuerySchema,
    dateRange: dateRange.optional(),
    sort: z.enum(['newest', 'oldest']).optional(),
    resultDimensions: z.array(id).max(20).optional(),
    maxSamples: z.number().int().min(1).max(500).optional(),
    nearbyTextLimitPerEntry: z.number().int().min(0).max(12).optional(),
  })
  .strict()
  .refine(
    (value) => value.query.annotation.length > 0 || value.query.results.length > 0,
    'prepare_sample_study requires an explicit annotation or result population',
  );

const visualEvidenceQuery = z.object({ entryId: id, annotationIds: z.array(id).max(8) }).strict();
const visualEvidenceBatch = z
  .object({ requests: z.array(visualEvidenceQuery).min(1).max(4) })
  .strict()
  .refine(
    (value) => value.requests.reduce((total, request) => total + request.annotationIds.length, 0) <= 8,
    'visual evidence batch supports at most 8 annotations total',
  );

const pixelRect = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
  })
  .strict();

const uniformBarAlignment = z
  .object({
    direction: z.literal('left-to-right'),
    anchorBar: z.number().int().nonnegative(),
    anchorCenterX: z.number().finite(),
    spacingPx: z.number().finite().min(2),
  })
  .strict();

const visualArtifactSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('source-original'), screenshotId: id }).strict(),
  z.object({ kind: z.literal('instance-source-window'), screenshotId: id }).strict(),
  z.object({ kind: z.literal('source-region'), screenshotId: id, roi: pixelRect }).strict(),
  z
    .object({
      kind: z.literal('page-region'),
      roi: pixelRect,
      composition: z.enum(['committed-page', 'clean-underlay']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('annotation-context'),
      annotationId: id,
      contextPx: z.number().int().min(0).max(2_000),
      composition: z.enum(['committed-page', 'source-clean']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('bar-alignment-probe'),
      screenshotId: id,
      roi: pixelRect,
      proposal: uniformBarAlignment,
    })
    .strict(),
  z
    .object({
      kind: z.literal('bar-reveal'),
      acceptedProbeId: id,
      acceptedProposalHash: z.string().regex(/^[a-f0-9]{64}$/),
      fromBar: z.number().int().nonnegative(),
      toBar: z.number().int().nonnegative(),
    })
    .strict(),
]);

const visualArtifactPlan = z
  .object({ bundleId: id, specs: z.array(visualArtifactSpec).min(1).max(16) })
  .strict();

const progressiveRevealAdvance = z
  .object({
    planId: id,
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    revealId: id,
    action: z.enum(['start', 'next', 'previous', 'seek']),
    frameIndex: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine((value) => (value.action === 'seek') === (value.frameIndex !== undefined), 'frameIndex is required only for seek');

const visualArtifactChunk = z
  .object({
    planId: id,
    planHash: z.string().regex(/^[a-f0-9]{64}$/),
    itemId: id,
    offset: z.number().int().nonnegative(),
    maxBytes: z.number().int().min(1).max(786_432),
  })
  .strict();

export const journalReadRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('overview') }).strict(),
  z.object({ op: z.literal('list-vocabulary'), input: vocabularyQuery }).strict(),
  z.object({ op: z.literal('search-entries'), input: entrySearchQuery }).strict(),
  z.object({ op: z.literal('search-samples'), input: sampleSearchQuery }).strict(),
  z.object({ op: z.literal('prepare-sample-study'), input: sampleStudyQuery }).strict(),
  z
    .object({
      op: z.literal('entry-context'),
      input: z.object({ entryId: id, expectedUpdatedAt: z.number().int().nonnegative().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      op: z.literal('linked-context'),
      input: z.object({ annotationId: id, depth: z.union([z.literal(1), z.literal(2)]).optional() }).strict(),
    })
    .strict(),
  z
    .object({
      op: z.literal('visual-evidence'),
      input: visualEvidenceQuery,
    })
    .strict(),
  z.object({ op: z.literal('visual-evidence-batch'), input: visualEvidenceBatch }).strict(),
  z.object({ op: z.literal('create-visual-artifacts'), input: visualArtifactPlan }).strict(),
  z.object({ op: z.literal('advance-progressive-reveal'), input: progressiveRevealAdvance }).strict(),
  z.object({ op: z.literal('read-visual-artifact-chunk'), input: visualArtifactChunk }).strict(),
  z.object({ op: z.literal('read-resource'), input: z.object({ uri: z.string().min(1).max(2048) }).strict() }).strict(),
  z
    .object({
      op: z.literal('read-resources'),
      input: z.object({ uris: z.array(z.string().min(1).max(2048)).min(1).max(40) }).strict(),
    })
    .strict(),
]);