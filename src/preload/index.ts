import { contextBridge, ipcRenderer } from 'electron';
import { IpcChannel, type IpcApi } from '../shared/ipc';

// Minimal, whitelisted bridge. contextIsolation is on and nodeIntegration is off,
// so the renderer only ever sees this typed `api` surface — nothing else.
const api: IpcApi = {
  ping: () => ipcRenderer.invoke(IpcChannel.ping),
  ingestImageEntry: (bytes) => ipcRenderer.invoke(IpcChannel.ingestImageEntry, bytes),
  listEntries: () => ipcRenderer.invoke(IpcChannel.listEntries),
  newEntry: () => ipcRenderer.invoke(IpcChannel.newEntry),
  storeImage: (bytes) => ipcRenderer.invoke(IpcChannel.storeImage, bytes),
  setEntryImage: (id, hash) => ipcRenderer.invoke(IpcChannel.setEntryImage, id, hash),
  deleteEntry: (id) => ipcRenderer.invoke(IpcChannel.deleteEntry, id),
  defineResultDimension: (dimension) => ipcRenderer.invoke(IpcChannel.defineResultDimension, dimension),
  listResultDimensions: () => ipcRenderer.invoke(IpcChannel.listResultDimensions),
  createEntry: (input) => ipcRenderer.invoke(IpcChannel.createEntry, input),
  updateEntry: (id, input) => ipcRenderer.invoke(IpcChannel.updateEntry, id, input),
  updateEntryCanvas: (id, canvasJson, annotations, thumbnail) =>
    ipcRenderer.invoke(IpcChannel.updateEntryCanvas, id, canvasJson, annotations, thumbnail),
  getEntry: (id) => ipcRenderer.invoke(IpcChannel.getEntry, id),
  setEntryTags: (id, tags) => ipcRenderer.invoke(IpcChannel.setEntryTags, id, tags),
  queryAnnotationsByTag: (tag) => ipcRenderer.invoke(IpcChannel.queryAnnotationsByTag, tag),
  queryEntriesByTag: (tag) => ipcRenderer.invoke(IpcChannel.queryEntriesByTag, tag),
  locateAnnotation: (annotationId) => ipcRenderer.invoke(IpcChannel.locateAnnotation, annotationId),
  listGroups: () => ipcRenderer.invoke(IpcChannel.listGroups),
  defineGroup: (group) => ipcRenderer.invoke(IpcChannel.defineGroup, group),
  deleteGroup: (id) => ipcRenderer.invoke(IpcChannel.deleteGroup, id),
  defineValue: (value) => ipcRenderer.invoke(IpcChannel.defineValue, value),
  deleteValue: (groupId, value) => ipcRenderer.invoke(IpcChannel.deleteValue, groupId, value),
  setGroupPinned: (id, pinned) => ipcRenderer.invoke(IpcChannel.setGroupPinned, id, pinned),
  reorderGroups: (ids) => ipcRenderer.invoke(IpcChannel.reorderGroups, ids),
  reorderValues: (groupId, values) => ipcRenderer.invoke(IpcChannel.reorderValues, groupId, values),
  getStampLibrary: () => ipcRenderer.invoke(IpcChannel.getStampLibrary),
  saveStampLibrary: (canvasJson) => ipcRenderer.invoke(IpcChannel.saveStampLibrary, canvasJson),
};

contextBridge.exposeInMainWorld('api', api);
