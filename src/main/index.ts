import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import { join } from 'node:path';
import { ensureDataFolder, type DataFolder } from './dataFolder';
import { openDatabase, type Db } from './db';
import { detectImageMime, readImage, storeImage } from './ingest/imageStore';
import { createEntry, deleteEntry, getEntry, listEntries, locateAnnotation, queryEntriesByTag, setEntryImage, setEntryTags, updateEntry, updateEntryCanvas } from './store/entryStore';
import { queryAnnotationsByTag } from './store/annotationIndex';
import { defineGroup, defineValue, deleteGroup, deleteValue, listGroups, reorderGroups, reorderValues, setGroupPinned } from './store/vocabulary';
import { listResultDimensions, upsertResultDimension } from './store/resultDimensions';
import { getStampLibrary, saveStampLibrary } from './store/stampStore';
import {
  annotationsSchema,
  canvasJsonSchema,
  createEntryInputSchema,
  entryTagsSchema,
  idListSchema,
  idSchema,
  imageHashSchema,
  kebabSchema,
  pinnedSchema,
  resultDimensionSchema,
  tagGroupSchema,
  tagSchema,
  tagValueSchema,
  thumbnailSchema,
} from './store/validation';
import { IpcChannel, type PingResult } from '../shared/ipc';

// Register the image-serving scheme before app 'ready' (privileged + secure).
protocol.registerSchemesAsPrivileged([
  { scheme: 'tj-image', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let db: Db | null = null;
let dataFolder: DataFolder | null = null;

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
    const hash = new URL(request.url).hostname;
    const bytes = readImage(requireDataFolder().imagesDir, hash);
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
  ipcMain.handle(IpcChannel.setGroupPinned, (_event, id: unknown, pinned: unknown) => {
    setGroupPinned(requireDb(), kebabSchema.parse(id), pinnedSchema.parse(pinned));
  });
  ipcMain.handle(IpcChannel.reorderGroups, (_event, ids: unknown) => {
    reorderGroups(requireDb(), idListSchema.parse(ids));
  });
  ipcMain.handle(IpcChannel.reorderValues, (_event, groupId: unknown, values: unknown) => {
    reorderValues(requireDb(), kebabSchema.parse(groupId), idListSchema.parse(values));
  });

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
    dataFolder = ensureDataFolder();
    db = openDatabase(dataFolder.sqlitePath).db;
    registerImageProtocol();
    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch((err: unknown) => {
    // Fail fast and loud: a broken boot must never present as healthy.
    console.error('[main] failed to start:', err);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    db?.close();
    db = null;
    app.quit();
  }
});
