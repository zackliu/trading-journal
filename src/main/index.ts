import { app, BrowserWindow, dialog, ipcMain, protocol, shell, type OpenDialogOptions } from 'electron';
import { join } from 'node:path';
import { ensureDataFolder, type DataFolder } from './dataFolder';
import { readConfig, resolveWorkspace, validateWorkspaceDir, writeConfig } from './appConfig';
import { openDatabase, stampAppVersion, type Db } from './db';
import { detectImageMime, readImage, storeImage } from './ingest/imageStore';
import { createEntry, deleteEntry, getEntry, listEntries, locateAnnotation, queryEntriesByTag, setEntryDate, setEntryImage, setEntryTags, updateEntry, updateEntryCanvas } from './store/entryStore';
import { queryAnnotationsByTag } from './store/annotationIndex';
import { defineGroup, defineValue, deleteGroup, deleteValue, listGroups, reorderGroups, reorderValues, setGroupPinned, restoreGroup, restoreValue, purgeGroup, purgeValue, listArchivedGroups } from './store/vocabulary';
import { listResultDimensions, upsertResultDimension, distinctResultValues, listResultVocabulary, deleteResultDimension, defineResultValue, deleteResultValue, restoreResultDimension, restoreResultValue, listArchivedResults } from './store/resultDimensions';
import { getStampLibrary, saveStampLibrary } from './store/stampStore';
import { countGroupValuesUnderView, queryEntriesByView, runViewQuery } from './store/viewQuery';
import { createSavedView, deleteSavedView, getSavedView, listSavedViews } from './store/savedViewStore';
import {
  annotationsSchema,
  canvasJsonSchema,
  createEntryInputSchema,
  dateValueSchema,
  entryTagsSchema,
  idListSchema,
  idSchema,
  imageHashSchema,
  kebabSchema,
  pinnedSchema,
  resultDimensionSchema,
  resultValueSchema,
  resultValueTextSchema,
  savedViewNameSchema,
  tagGroupSchema,
  tagSchema,
  tagValueSchema,
  thumbnailSchema,
  viewQuerySchema,
  workspacePathSchema,
} from './store/validation';
import { IpcChannel, type PingResult } from '../shared/ipc';
import type { WorkspaceState } from '../shared/domain';

// Register the image-serving scheme before app 'ready' (privileged + secure).
protocol.registerSchemesAsPrivileged([
  { scheme: 'tj-image', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let db: Db | null = null;
let dataFolder: DataFolder | null = null;
let mainWindow: BrowserWindow | null = null;
// How the currently-open workspace was resolved (env override vs config pointer); reported to the UI.
let workspaceSource: WorkspaceState['source'] = 'none';

function requireDb(): Db {
  if (!db) {
    throw new Error('database is not initialized');
  }
  return db;
}

function requireDataFolder(): DataFolder {
  if (!dataFolder) {
    throw new Error('data folder is not initialized');
  }
  return dataFolder;
}

/** Open the database + image folder at `dir`, becoming the active workspace. */
function openWorkspaceAt(dir: string, source: WorkspaceState['source']): void {
  dataFolder = ensureDataFolder(dir);
  db = openDatabase(dataFolder.sqlitePath).db;
  stampAppVersion(db, app.getVersion());
  workspaceSource = source;
}

/** Close the active workspace (used before switching to a different data folder). */
function closeWorkspace(): void {
  db?.close();
  db = null;
  dataFolder = null;
  workspaceSource = 'none';
}

/** The live workspace state: an open DB reports ready; otherwise re-resolve (folder may have appeared). */
function currentWorkspaceState(): WorkspaceState {
  if (db && dataFolder) return { status: 'ready', dataDir: dataFolder.root, source: workspaceSource };
  const resolved = resolveWorkspace();
  if (resolved.status === 'ready' && resolved.dataDir) {
    openWorkspaceAt(resolved.dataDir, resolved.source);
    return { status: 'ready', dataDir: resolved.dataDir, source: resolved.source };
  }
  return resolved;
}

function toImageBuffer(raw: unknown): Buffer {
  if (!(raw instanceof Uint8Array)) {
    throw new Error('ingest expects raw image bytes');
  }
  const bytes = Buffer.from(raw);
  if (detectImageMime(bytes) === null) {
    throw new Error('unsupported or unrecognized image format');
  }
  return bytes;
}

function todayLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Serve stored image bytes to the renderer via `tj-image://<hash>` (no base64 in the DOM).
function registerImageProtocol(): void {
  protocol.handle('tj-image', (request) => {
    if (!dataFolder) {
      return new Response('no workspace', { status: 404 });
    }
    const hash = new URL(request.url).hostname;
    const bytes = readImage(dataFolder.imagesDir, hash);
    if (!bytes) {
      return new Response('not found', { status: 404 });
    }
    const mime = detectImageMime(bytes) ?? 'application/octet-stream';
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': mime } });
  });
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.ping, (): PingResult => {
    return {
      ok: true,
      ts: Date.now(),
      dataDir: dataFolder?.root ?? '',
      sqliteReady: db !== null,
      userVersion: db ? (db.pragma('user_version', { simple: true }) as number) : -1,
    };
  });

  // ---- Workspace (which data folder is active) -------------------------------------------------
  // These never touch the store, so they are safe to call while the DB is closed (the setup gate).
  ipcMain.handle(IpcChannel.getWorkspaceState, (): WorkspaceState => currentWorkspaceState());

  ipcMain.handle(IpcChannel.pickWorkspaceFolder, async (): Promise<string | null> => {
    const opts: OpenDialogOptions = {
      title: 'Choose your journal data folder',
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle(IpcChannel.setWorkspaceFolder, (_event, raw: unknown): WorkspaceState => {
    const dir = workspacePathSchema.parse(raw);
    const validated = validateWorkspaceDir(dir, 'config');
    if (validated.status !== 'ready' || !validated.dataDir) return validated; // don't switch to a bad folder
    closeWorkspace();
    writeConfig({ ...readConfig(), dataDir: validated.dataDir });
    openWorkspaceAt(validated.dataDir, 'config');
    return { status: 'ready', dataDir: validated.dataDir, source: 'config' };
  });

  ipcMain.handle(IpcChannel.revealWorkspace, () => {
    if (dataFolder) void shell.openPath(dataFolder.root);
  });

  ipcMain.handle(IpcChannel.quitApp, () => app.quit());

  ipcMain.handle(IpcChannel.ingestImageEntry, (_event, raw: unknown) => {
    const bytes = toImageBuffer(raw);
    const hash = storeImage(requireDataFolder().imagesDir, bytes);
    return createEntry(requireDb(), {
      image: { hash },
      canvasJson: '{}',
      entryTags: [{ group: 'date', value: todayLocal() }],
      annotations: [],
    });
  });
  ipcMain.handle(IpcChannel.listEntries, () => listEntries(requireDb()));

  ipcMain.handle(IpcChannel.newEntry, () =>
    createEntry(requireDb(), {
      canvasJson: '{}',
      entryTags: [{ group: 'date', value: todayLocal() }],
      annotations: [],
    }),
  );
  ipcMain.handle(IpcChannel.storeImage, (_event, raw: unknown) => ({
    hash: storeImage(requireDataFolder().imagesDir, toImageBuffer(raw)),
  }));
  ipcMain.handle(IpcChannel.setEntryImage, (_event, id: unknown, hash: unknown) =>
    setEntryImage(requireDb(), idSchema.parse(id), imageHashSchema.parse(hash)),
  );
  ipcMain.handle(IpcChannel.deleteEntry, (_event, id: unknown) => deleteEntry(requireDb(), idSchema.parse(id)));

  ipcMain.handle(IpcChannel.defineResultDimension, (_event, raw: unknown) => {
    upsertResultDimension(requireDb(), resultDimensionSchema.parse(raw));
  });
  ipcMain.handle(IpcChannel.listResultDimensions, () => listResultDimensions(requireDb()));
  ipcMain.handle(IpcChannel.listResultVocabulary, () => listResultVocabulary(requireDb()));
  ipcMain.handle(IpcChannel.deleteResultDimension, (_event, id: unknown) =>
    deleteResultDimension(requireDb(), kebabSchema.parse(id)),
  );
  ipcMain.handle(IpcChannel.defineResultValue, (_event, dimensionId: unknown, value: unknown, label: unknown) => {
    const parsed = resultValueSchema.parse({ dimensionId, value, label: label === undefined ? undefined : label });
    defineResultValue(requireDb(), parsed.dimensionId, parsed.value, parsed.label);
  });
  ipcMain.handle(IpcChannel.deleteResultValue, (_event, dimensionId: unknown, value: unknown) =>
    deleteResultValue(requireDb(), kebabSchema.parse(dimensionId), resultValueTextSchema.parse(value)),
  );
  ipcMain.handle(IpcChannel.restoreResultDimension, (_event, id: unknown) =>
    restoreResultDimension(requireDb(), kebabSchema.parse(id)),
  );
  ipcMain.handle(IpcChannel.restoreResultValue, (_event, dimensionId: unknown, value: unknown) =>
    restoreResultValue(requireDb(), kebabSchema.parse(dimensionId), resultValueTextSchema.parse(value)),
  );
  ipcMain.handle(IpcChannel.listArchivedResults, () => listArchivedResults(requireDb()));
  ipcMain.handle(IpcChannel.createEntry, (_event, raw: unknown) =>
    createEntry(requireDb(), createEntryInputSchema.parse(raw)),
  );
  ipcMain.handle(IpcChannel.updateEntry, (_event, id: unknown, raw: unknown) =>
    updateEntry(requireDb(), idSchema.parse(id), createEntryInputSchema.parse(raw)),
  );
  ipcMain.handle(IpcChannel.updateEntryCanvas, (_event, id: unknown, canvasJson: unknown, annotations: unknown, thumbnail: unknown) =>
    updateEntryCanvas(
      requireDb(),
      idSchema.parse(id),
      canvasJsonSchema.parse(canvasJson),
      annotationsSchema.parse(annotations),
      thumbnailSchema.parse(thumbnail),
    ),
  );
  ipcMain.handle(IpcChannel.getEntry, (_event, id: unknown) => getEntry(requireDb(), idSchema.parse(id)));
  ipcMain.handle(IpcChannel.queryAnnotationsByTag, (_event, raw: unknown) =>
    queryAnnotationsByTag(requireDb(), tagSchema.parse(raw)),
  );
  ipcMain.handle(IpcChannel.locateAnnotation, (_event, annotationId: unknown) =>
    locateAnnotation(requireDb(), idSchema.parse(annotationId)),
  );
  ipcMain.handle(IpcChannel.setEntryTags, (_event, id: unknown, tags: unknown) =>
    setEntryTags(requireDb(), idSchema.parse(id), entryTagsSchema.parse(tags)),
  );
  ipcMain.handle(IpcChannel.setEntryDate, (_event, id: unknown, date: unknown) =>
    setEntryDate(requireDb(), idSchema.parse(id), dateValueSchema.parse(date)),
  );
  ipcMain.handle(IpcChannel.queryEntriesByTag, (_event, raw: unknown) =>
    queryEntriesByTag(requireDb(), tagSchema.parse(raw)),
  );
  ipcMain.handle(IpcChannel.listGroups, () => listGroups(requireDb()));
  ipcMain.handle(IpcChannel.defineGroup, (_event, raw: unknown) => {
    defineGroup(requireDb(), tagGroupSchema.parse(raw));
  });
  ipcMain.handle(IpcChannel.deleteGroup, (_event, id: unknown) => {
    deleteGroup(requireDb(), kebabSchema.parse(id));
  });
  ipcMain.handle(IpcChannel.defineValue, (_event, raw: unknown) => {
    defineValue(requireDb(), tagValueSchema.parse(raw));
  });
  ipcMain.handle(IpcChannel.deleteValue, (_event, groupId: unknown, value: unknown) => {
    deleteValue(requireDb(), kebabSchema.parse(groupId), kebabSchema.parse(value));
  });
  ipcMain.handle(IpcChannel.restoreGroup, (_event, id: unknown) => {
    restoreGroup(requireDb(), kebabSchema.parse(id));
  });
  ipcMain.handle(IpcChannel.restoreValue, (_event, groupId: unknown, value: unknown) => {
    restoreValue(requireDb(), kebabSchema.parse(groupId), kebabSchema.parse(value));
  });
  ipcMain.handle(IpcChannel.purgeGroup, (_event, id: unknown) => {
    purgeGroup(requireDb(), kebabSchema.parse(id));
  });
  ipcMain.handle(IpcChannel.purgeValue, (_event, groupId: unknown, value: unknown) => {
    purgeValue(requireDb(), kebabSchema.parse(groupId), kebabSchema.parse(value));
  });
  ipcMain.handle(IpcChannel.listArchivedGroups, () => listArchivedGroups(requireDb()));
  ipcMain.handle(IpcChannel.setGroupPinned, (_event, id: unknown, pinned: unknown) => {
    setGroupPinned(requireDb(), kebabSchema.parse(id), pinnedSchema.parse(pinned));
  });
  ipcMain.handle(IpcChannel.reorderGroups, (_event, ids: unknown) => {
    reorderGroups(requireDb(), idListSchema.parse(ids));
  });
  ipcMain.handle(IpcChannel.reorderValues, (_event, groupId: unknown, values: unknown) => {
    reorderValues(requireDb(), kebabSchema.parse(groupId), idListSchema.parse(values));
  });

  ipcMain.handle(IpcChannel.runView, (_event, raw: unknown) => runViewQuery(requireDb(), viewQuerySchema.parse(raw)));
  ipcMain.handle(IpcChannel.queryEntriesByView, (_event, raw: unknown) =>
    queryEntriesByView(requireDb(), viewQuerySchema.parse(raw)),
  );
  ipcMain.handle(IpcChannel.countGroupValuesUnderView, (_event, raw: unknown, groupId: unknown) =>
    countGroupValuesUnderView(requireDb(), viewQuerySchema.parse(raw), kebabSchema.parse(groupId)),
  );
  ipcMain.handle(IpcChannel.distinctResultValues, (_event, id: unknown) =>
    distinctResultValues(requireDb(), kebabSchema.parse(id)),
  );
  ipcMain.handle(IpcChannel.createSavedView, (_event, name: unknown, raw: unknown) =>
    createSavedView(requireDb(), savedViewNameSchema.parse(name), JSON.stringify(viewQuerySchema.parse(raw))),
  );
  ipcMain.handle(IpcChannel.listSavedViews, () => listSavedViews(requireDb()));
  ipcMain.handle(IpcChannel.getSavedView, (_event, id: unknown) => getSavedView(requireDb(), idSchema.parse(id)));
  ipcMain.handle(IpcChannel.deleteSavedView, (_event, id: unknown) => deleteSavedView(requireDb(), idSchema.parse(id)));

  ipcMain.handle(IpcChannel.getStampLibrary, () => getStampLibrary(requireDb()));
  ipcMain.handle(IpcChannel.saveStampLibrary, (_event, canvasJson: unknown) =>
    saveStampLibrary(requireDb(), canvasJsonSchema.parse(canvasJson)),
  );
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#f1eee7',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app
  .whenReady()
  .then(() => {
    // Resolve which data folder is active. If nothing valid is configured we still boot the window —
    // the renderer shows the setup gate and opens the workspace once the user picks a folder.
    const ws = resolveWorkspace();
    if (ws.status === 'ready' && ws.dataDir) {
      openWorkspaceAt(ws.dataDir, ws.source);
    }
    registerImageProtocol();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err: unknown) => {
    // Fail fast and loud: a broken boot must never present as healthy. Surface the reason (e.g. a
    // journal written by a newer app version) instead of a silent quit, so review data is never risked.
    console.error('[main] failed to start:', err);
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox('Trading Journal — cannot open your journal', message);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close();
    db = null;
    app.quit();
  }
});
