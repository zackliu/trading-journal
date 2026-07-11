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

export const journalReadRequestSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('overview') }).strict(),
  z.object({ op: z.literal('list-vocabulary'), input: vocabularyQuery }).strict(),
  z.object({ op: z.literal('search-entries'), input: entrySearchQuery }).strict(),
  z.object({ op: z.literal('search-samples'), input: sampleSearchQuery }).strict(),
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
      input: z.object({ entryId: id, annotationIds: z.array(id).min(1).max(8) }).strict(),
    })
    .strict(),
  z.object({ op: z.literal('read-resource'), input: z.object({ uri: z.string().min(1).max(2048) }).strict() }).strict(),
]);