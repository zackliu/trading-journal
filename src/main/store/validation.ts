import { z } from 'zod';

// Boundary validation for the store IPC surface. The renderer is an untrusted
// caller of the contract, so every payload is parsed here (a system boundary)
// before it reaches the store. Structural rules only — referential checks
// (e.g. a result dimension must exist) live in the store.

// A tag / group / value id is a slug: letters or digits (any script, incl. CJK), hyphen-separated.
// The renderer derives this from free-typed text (see shell/slug.ts), so users never type kebab.
const kebab = z
  .string()
  .regex(/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u, 'must be a slug (letters/digits, hyphen-separated)');

const tag = z.object({ group: kebab, value: kebab });

const bounds = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});

const result = z.record(z.string().min(1), z.union([z.string(), z.number().finite()]));

const annotation = z.object({
  id: z.string().min(1),
  bounds,
  tags: z.array(tag),
  result: result.optional(),
  links: z.array(z.string().min(1)).optional(),
});

export const idSchema = z.string().min(1);

export const tagSchema = tag;

// A filesystem path chosen by the user for the data folder (any non-empty string; existence /
// writability are checked in appConfig, not here).
export const workspacePathSchema = z.string().min(1).max(4096);

// Vocabulary registry payloads. Group / value ids are the stable kebab keys.
export const kebabSchema = kebab;
export const pinnedSchema = z.boolean();
export const entryTagsSchema = z.array(tag);
export const idListSchema = z.array(kebab);
export const tagGroupSchema = z.object({ id: kebab, label: z.string().min(1), pinned: z.boolean() });
export const tagValueSchema = z.object({ groupId: kebab, value: kebab, label: z.string().min(1).optional() });

// Slice 7 view query: two dimensions (entry existence + annotation co-occurrence) + typed result predicates.
const tagPredicate = z.object({ group: kebab, values: z.array(kebab).min(1) });
const resultPredicate = z
  .object({
    dimension: kebab,
    in: z.array(z.string().min(1)).min(1).optional(),
    gte: z.number().finite().optional(),
    lte: z.number().finite().optional(),
  })
  .refine(
    (p) => p.in !== undefined || p.gte !== undefined || p.lte !== undefined,
    'a result predicate must constrain a value',
  );
export const viewQuerySchema = z.object({
  entry: z.array(tagPredicate),
  annotation: z.array(tagPredicate),
  results: z.array(resultPredicate),
});
export const savedViewNameSchema = z.string().min(1).max(200);

export const resultDimensionSchema = z.object({
  id: kebab,
  label: z.string().min(1),
  type: z.enum(['string', 'number']),
});

// A result preset value is the exact outcome text ("1R", "-1R", "BE"): the sign / case are data, so it
// is stored verbatim — unlike a tag value's kebab slug id, which would collapse "1R" and "-1R" to "1r".
export const resultValueTextSchema = z.string().min(1).max(80);
export const resultValueSchema = z.object({
  dimensionId: kebab,
  value: resultValueTextSchema,
  label: z.string().min(1).optional(),
});

export const createEntryInputSchema = z.object({
  image: z.object({ hash: z.string().min(1) }).optional(),
  canvasJson: z.string(),
  entryTags: z.array(tag),
  annotations: z.array(annotation),
});

export const canvasJsonSchema = z.string();

export const annotationsSchema = z.array(annotation);

export const imageHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

// The list thumbnail is a rendered page snapshot: empty, or a bounded data: image URL.
export const thumbnailSchema = z
  .string()
  .max(4_000_000)
  .refine((value) => value === '' || value.startsWith('data:image/'), 'must be empty or a data: image URL');
