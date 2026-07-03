import { z } from 'zod';

// Boundary validation for the store IPC surface. The renderer is an untrusted
// caller of the contract, so every payload is parsed here (a system boundary)
// before it reaches the store. Structural rules only — referential checks
// (e.g. a result dimension must exist) live in the store.

const kebab = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be kebab-case (lowercase letters, digits, hyphens)');

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

export const resultDimensionSchema = z.object({
  id: kebab,
  label: z.string().min(1),
  type: z.enum(['string', 'number']),
});

export const createEntryInputSchema = z.object({
  image: z.object({ hash: z.string().min(1) }).optional(),
  canvasJson: z.string(),
  entryTags: z.array(tag),
  annotations: z.array(annotation),
});

export const canvasJsonSchema = z.string();

export const imageHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
