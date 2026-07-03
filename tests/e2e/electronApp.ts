import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type {
  AnnotationHit,
  CreateEntryInput,
  Entry,
  EntrySummary,
  ResultDimension,
  Tag,
} from '../../src/shared/domain';
import type { IpcApi } from '../../src/shared/ipc';

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
}

/** Launch the built Electron app against an isolated portable data folder. */
export async function launchApp(dataDir: string): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: ['.'],
    env: { ...process.env, TJ_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

type WindowWithApi = { api: IpcApi };

// Drive the real typed IPC store contract from the renderer (never touches SQLite
// directly), matching how the app itself will call the store from Slice 2/3 on.
export const store = {
  defineDimension: (page: Page, dimension: ResultDimension): Promise<void> =>
    page.evaluate((d) => (globalThis as unknown as WindowWithApi).api.defineResultDimension(d), dimension),

  createEntry: (page: Page, input: CreateEntryInput): Promise<Entry> =>
    page.evaluate((i) => (globalThis as unknown as WindowWithApi).api.createEntry(i), input),

  updateEntry: (page: Page, id: string, input: CreateEntryInput): Promise<Entry> =>
    page.evaluate(
      (arg) => (globalThis as unknown as WindowWithApi).api.updateEntry(arg.id, arg.input),
      { id, input },
    ),

  updateEntryCanvas: (page: Page, id: string, canvasJson: string): Promise<Entry> =>
    page.evaluate(
      (arg) => (globalThis as unknown as WindowWithApi).api.updateEntryCanvas(arg.id, arg.canvasJson),
      { id, canvasJson },
    ),

  getEntry: (page: Page, id: string): Promise<Entry | null> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.getEntry(x), id),

  queryByTag: (page: Page, tag: Tag): Promise<AnnotationHit[]> =>
    page.evaluate((t) => (globalThis as unknown as WindowWithApi).api.queryAnnotationsByTag(t), tag),

  ingestImage: (page: Page, base64Png: string): Promise<Entry> =>
    page.evaluate((b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return (globalThis as unknown as WindowWithApi).api.ingestImageEntry(bytes);
    }, base64Png),

  listEntries: (page: Page): Promise<EntrySummary[]> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.listEntries()),

  newEntry: (page: Page): Promise<Entry> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.newEntry()),

  storeImage: (page: Page, base64Png: string): Promise<{ hash: string }> =>
    page.evaluate((b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return (globalThis as unknown as WindowWithApi).api.storeImage(bytes);
    }, base64Png),

  setEntryImage: (page: Page, id: string, hash: string): Promise<Entry> =>
    page.evaluate(
      (arg) => (globalThis as unknown as WindowWithApi).api.setEntryImage(arg.id, arg.hash),
      { id, hash },
    ),

  deleteEntry: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.deleteEntry(x), id),
};
