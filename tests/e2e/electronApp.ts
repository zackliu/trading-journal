import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type {
  Annotation,
  AnnotationHit,
  ArchivedResults,
  ArchivedVocab,
  CreateEntryInput,
  Entry,
  EntrySummary,
  ResultDimension,
  ResultDimensionView,
  SavedView,
  Tag,
  TagGroup,
  TagGroupView,
  TagValue,
  ViewMatch,
  ViewQuery,
  WorkspaceState,
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

/**
 * Launch with NO data folder configured (no `TJ_DATA_DIR`), isolating app-config to `userDataDir` via
 * Electron's `--user-data-dir`. Used to exercise the setup gate: config.json lives under `userDataDir`,
 * so the workspace resolves from config (or unset) rather than an env override.
 */
export async function launchAppNoWorkspace(userDataDir: string): Promise<LaunchedApp> {
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, TJ_DATA_DIR: '' },
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

  listResultVocabulary: (page: Page): Promise<ResultDimensionView[]> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.listResultVocabulary()),

  deleteResultDimension: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.deleteResultDimension(x), id),

  defineResultValue: (page: Page, dimensionId: string, value: string, label?: string): Promise<void> =>
    page.evaluate(
      (a) => (globalThis as unknown as WindowWithApi).api.defineResultValue(a.dimensionId, a.value, a.label),
      { dimensionId, value, label },
    ),

  deleteResultValue: (page: Page, dimensionId: string, value: string): Promise<void> =>
    page.evaluate(
      (a) => (globalThis as unknown as WindowWithApi).api.deleteResultValue(a.dimensionId, a.value),
      { dimensionId, value },
    ),

  restoreGroup: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.restoreGroup(x), id),

  restoreValue: (page: Page, groupId: string, value: string): Promise<void> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.restoreValue(a.groupId, a.value), {
      groupId,
      value,
    }),

  purgeGroup: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.purgeGroup(x), id),

  purgeValue: (page: Page, groupId: string, value: string): Promise<void> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.purgeValue(a.groupId, a.value), {
      groupId,
      value,
    }),

  listArchivedGroups: (page: Page): Promise<ArchivedVocab> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.listArchivedGroups()),

  restoreResultDimension: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.restoreResultDimension(x), id),

  restoreResultValue: (page: Page, dimensionId: string, value: string): Promise<void> =>
    page.evaluate(
      (a) => (globalThis as unknown as WindowWithApi).api.restoreResultValue(a.dimensionId, a.value),
      { dimensionId, value },
    ),

  listArchivedResults: (page: Page): Promise<ArchivedResults> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.listArchivedResults()),

  createEntry: (page: Page, input: CreateEntryInput): Promise<Entry> =>
    page.evaluate((i) => (globalThis as unknown as WindowWithApi).api.createEntry(i), input),

  updateEntry: (page: Page, id: string, input: CreateEntryInput): Promise<Entry> =>
    page.evaluate(
      (arg) => (globalThis as unknown as WindowWithApi).api.updateEntry(arg.id, arg.input),
      { id, input },
    ),

  updateEntryCanvas: (
    page: Page,
    id: string,
    canvasJson: string,
    annotations: Annotation[] = [],
    thumbnail = '',
  ): Promise<Entry> =>
    page.evaluate(
      (arg) =>
        (globalThis as unknown as WindowWithApi).api.updateEntryCanvas(
          arg.id,
          arg.canvasJson,
          arg.annotations,
          arg.thumbnail,
        ),
      { id, canvasJson, annotations, thumbnail },
    ),

  getEntry: (page: Page, id: string): Promise<Entry | null> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.getEntry(x), id),

  queryByTag: (page: Page, tag: Tag): Promise<AnnotationHit[]> =>
    page.evaluate((t) => (globalThis as unknown as WindowWithApi).api.queryAnnotationsByTag(t), tag),

  queryEntriesByTag: (page: Page, tag: Tag): Promise<EntrySummary[]> =>
    page.evaluate((t) => (globalThis as unknown as WindowWithApi).api.queryEntriesByTag(t), tag),

  setEntryTags: (page: Page, id: string, tags: Tag[]): Promise<Entry> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.setEntryTags(a.id, a.tags), { id, tags }),

  setEntryDate: (page: Page, id: string, date: string): Promise<Entry> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.setEntryDate(a.id, a.date), { id, date }),

  listGroups: (page: Page): Promise<TagGroupView[]> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.listGroups()),

  defineGroup: (page: Page, group: TagGroup): Promise<void> =>
    page.evaluate((g) => (globalThis as unknown as WindowWithApi).api.defineGroup(g), group),

  deleteGroup: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.deleteGroup(x), id),

  defineValue: (page: Page, value: TagValue): Promise<void> =>
    page.evaluate((v) => (globalThis as unknown as WindowWithApi).api.defineValue(v), value),

  deleteValue: (page: Page, groupId: string, value: string): Promise<void> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.deleteValue(a.groupId, a.value), {
      groupId,
      value,
    }),

  setGroupPinned: (page: Page, id: string, pinned: boolean): Promise<void> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.setGroupPinned(a.id, a.pinned), { id, pinned }),

  reorderGroups: (page: Page, ids: string[]): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.reorderGroups(x), ids),

  reorderValues: (page: Page, groupId: string, values: string[]): Promise<void> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.reorderValues(a.groupId, a.values), {
      groupId,
      values,
    }),

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

  locateAnnotation: (page: Page, annotationId: string): Promise<{ entryId: string } | null> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.locateAnnotation(x), annotationId),

  getStampLibrary: (page: Page): Promise<{ canvasJson: string }> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.getStampLibrary()),

  saveStampLibrary: (page: Page, canvasJson: string): Promise<void> =>
    page.evaluate((j) => (globalThis as unknown as WindowWithApi).api.saveStampLibrary(j), canvasJson),

  runView: (page: Page, query: ViewQuery): Promise<ViewMatch[]> =>
    page.evaluate((q) => (globalThis as unknown as WindowWithApi).api.runView(q), query),

  queryEntriesByView: (page: Page, query: ViewQuery): Promise<EntrySummary[]> =>
    page.evaluate((q) => (globalThis as unknown as WindowWithApi).api.queryEntriesByView(q), query),

  countGroupValuesUnderView: (
    page: Page,
    query: ViewQuery,
    groupId: string,
  ): Promise<Array<{ value: string; count: number }>> =>
    page.evaluate(
      (a) => (globalThis as unknown as WindowWithApi).api.countGroupValuesUnderView(a.query, a.groupId),
      { query, groupId },
    ),

  distinctResultValues: (page: Page, dimensionId: string): Promise<string[]> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.distinctResultValues(x), dimensionId),

  createSavedView: (page: Page, name: string, query: ViewQuery): Promise<SavedView> =>
    page.evaluate((a) => (globalThis as unknown as WindowWithApi).api.createSavedView(a.name, a.query), { name, query }),

  listSavedViews: (page: Page): Promise<SavedView[]> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.listSavedViews()),

  getSavedView: (page: Page, id: string): Promise<SavedView | null> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.getSavedView(x), id),

  deleteSavedView: (page: Page, id: string): Promise<void> =>
    page.evaluate((x) => (globalThis as unknown as WindowWithApi).api.deleteSavedView(x), id),

  getWorkspaceState: (page: Page): Promise<WorkspaceState> =>
    page.evaluate(() => (globalThis as unknown as WindowWithApi).api.getWorkspaceState()),

  setWorkspaceFolder: (page: Page, dir: string): Promise<WorkspaceState> =>
    page.evaluate((d) => (globalThis as unknown as WindowWithApi).api.setWorkspaceFolder(d), dir),
};
