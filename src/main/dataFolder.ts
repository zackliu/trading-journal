import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DataFolder {
  root: string;
  sqlitePath: string;
  imagesDir: string;
}

/**
 * Materialize a data folder: ensure `root` and its `images/` subfolder exist, and return the
 * resolved paths. `root` is always chosen explicitly by the user (or an env override) — there is no
 * default location. Which folder is the active workspace is resolved in `appConfig.ts`.
 */
export function ensureDataFolder(root: string): DataFolder {
  mkdirSync(root, { recursive: true });
  const imagesDir = join(root, 'images');
  mkdirSync(imagesDir, { recursive: true });
  return { root, sqlitePath: join(root, 'app.sqlite'), imagesDir };
}
