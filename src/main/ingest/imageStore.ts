import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Content-addressed image assets: an image is stored once at images/<sha256>, and
// referenced by that hash. Bytes are never base64-embedded in the DB or canvas JSON.

const HASH_RE = /^[a-f0-9]{64}$/;

interface Magic {
  mime: string;
  matches: (bytes: Buffer) => boolean;
}

const IMAGE_MAGIC: Magic[] = [
  {
    mime: 'image/png',
    matches: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  { mime: 'image/jpeg', matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', matches: (b) => b.length > 5 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  {
    mime: 'image/webp',
    matches: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** Detect a supported raster image type from magic bytes, or null if unrecognized. */
export function detectImageMime(bytes: Buffer): string | null {
  for (const magic of IMAGE_MAGIC) {
    if (magic.matches(bytes)) return magic.mime;
  }
  return null;
}

export function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Write the bytes to images/<hash> if absent (dedupe by content) and return the hash. */
export function storeImage(imagesDir: string, bytes: Buffer): string {
  const hash = hashBytes(bytes);
  const path = join(imagesDir, hash);
  if (!existsSync(path)) {
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(path, bytes);
  }
  return hash;
}

/** Read stored image bytes by hash. Returns null for an unknown/invalid hash (no traversal). */
export function readImage(imagesDir: string, hash: string): Buffer | null {
  if (!HASH_RE.test(hash)) return null;
  const path = join(imagesDir, hash);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}
