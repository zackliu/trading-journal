import { app } from 'electron';
import { accessSync, constants, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AiPromptTemplate } from '../shared/aiAccess';
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
  aiAccess?: {
    port?: number;
    encryptedAccessKey?: string;
    disclosureAccepted?: boolean;
    guide?: string;
    prompts?: AiPromptTemplate[];
  };
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json');
}

export function readConfig(): AppConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath(), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      const dataDir = typeof record.dataDir === 'string' && record.dataDir.trim() ? record.dataDir : undefined;
      const aiAccess = parseAiAccessConfig(record.aiAccess);
      return { ...(dataDir ? { dataDir } : {}), ...(aiAccess ? { aiAccess } : {}) };
    }
  } catch {
    // No config yet (first run) or unreadable — treated as unset.
  }
  return {};
}

function parseAiAccessConfig(raw: unknown): AppConfig['aiAccess'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const port = typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65_535
    ? record.port
    : undefined;
  const encryptedAccessKey = typeof record.encryptedAccessKey === 'string' ? record.encryptedAccessKey : undefined;
  const disclosureAccepted = record.disclosureAccepted === true;
  const guide = typeof record.guide === 'string' && record.guide.length <= 64 * 1024 ? record.guide : undefined;
  const prompts = Array.isArray(record.prompts)
    ? record.prompts.filter(isPromptTemplate).map((prompt) => ({ ...prompt, arguments: [...prompt.arguments] }))
    : undefined;
  return { port, encryptedAccessKey, disclosureAccepted, guide, prompts };
}

function isPromptTemplate(raw: unknown): raw is AiPromptTemplate {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value = raw as Record<string, unknown>;
  if (
    typeof value.id !== 'string' ||
    !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value.id) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    typeof value.description !== 'string' ||
    !value.description.trim() ||
    typeof value.enabled !== 'boolean' ||
    typeof value.body !== 'string' ||
    value.body.length > 16 * 1024 ||
    (value.source !== 'built-in' && value.source !== 'custom') ||
    !Array.isArray(value.arguments) ||
    value.arguments.length > 12
  ) {
    return false;
  }
  const argumentNames = new Set<string>();
  const argumentsValid = value.arguments.every((argument) => {
    if (!argument || typeof argument !== 'object' || Array.isArray(argument)) return false;
    const item = argument as Record<string, unknown>;
    if (
      typeof item.name !== 'string' ||
      !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(item.name) ||
      argumentNames.has(item.name) ||
      typeof item.description !== 'string' ||
      typeof item.required !== 'boolean'
    ) {
      return false;
    }
    argumentNames.add(item.name);
    return true;
  });
  if (!argumentsValid) return false;
  return (
    [...value.body.matchAll(/\{\{([a-z0-9_]+)\}\}/g)].every((match) => argumentNames.has(match[1]))
  );
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
