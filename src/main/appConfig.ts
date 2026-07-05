import { app } from 'electron';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkspaceState } from '../shared/domain';

/**
 * App configuration = the small, machine-local pointer that says *where* the real journal data lives.
 * It is stored under the OS user-data folder (`%APPDATA%/trading-journal/config.json` on Windows),
 * deliberately separate from the data folder itself (which the user may put on OneDrive, etc.).
 *
 * Resolution order for the active workspace: `TJ_DATA_DIR` (env, for tests / dev) > `config.json` >
 * unset. There is no default data location — when nothing valid is configured the app shows the
 * setup gate instead of guessing a folder.
 */
export interface AppConfig {
  dataDir?: string;
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

export function readConfig(): AppConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const dataDir = (parsed as Record<string, unknown>).dataDir;
      if (typeof dataDir === 'string' && dataDir.trim()) return { dataDir };
    }
  } catch {
    // No config yet (first run) or unreadable — treated as unset.
  }
  return {};
}

export function writeConfig(config: AppConfig): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/**
 * Validate a candidate data folder: it must exist, be a directory, and be writable. Never creates the
 * folder — a configured-but-missing folder is a `missing` state the user resolves (re-pick or prepare
 * the folder), not something we silently recreate.
 */
export function validateWorkspaceDir(dir: string, source: WorkspaceState['source']): WorkspaceState {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      return { status: 'missing', dataDir: dir, source };
    }
    accessSync(dir, constants.W_OK);
    return { status: 'ready', dataDir: dir, source };
  } catch {
    return { status: 'unwritable', dataDir: dir, source };
  }
}

/** Resolve the active workspace from env → config → unset, validating the folder on disk. */
export function resolveWorkspace(): WorkspaceState {
  const env = process.env.TJ_DATA_DIR?.trim();
  if (env) {
    // An explicit env override (tests / dev) is treated as a deliberate selection and created if absent.
    mkdirSync(env, { recursive: true });
    return validateWorkspaceDir(env, 'env');
  }
  const { dataDir } = readConfig();
  if (!dataDir) return { status: 'unset', dataDir: null, source: 'none' };
  return validateWorkspaceDir(dataDir, 'config');
}
