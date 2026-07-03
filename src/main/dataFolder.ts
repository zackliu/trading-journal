import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DataFolder {
  root: string;
  sqlitePath: string;
  imagesDir: string;
}

/**
 * Resolve the portable data folder. `TJ_DATA_DIR` overrides the default so tests
 * (and future "open another data folder") can point at an isolated directory.
 */
export function resolveDataDir(): string {
  const override = process.env.TJ_DATA_DIR?.trim();
  if (override) return override;
  return join(app.getPath('userData'), 'data');
}

/** Create the data folder and its `images/` subfolder if missing, return its paths. */
export function ensureDataFolder(root = resolveDataDir()): DataFolder {
  mkdirSync(root, { recursive: true });
  const imagesDir = join(root, 'images');
  mkdirSync(imagesDir, { recursive: true });
  return { root, sqlitePath: join(root, 'app.sqlite'), imagesDir };
}
