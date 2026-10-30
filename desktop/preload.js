// Мост к странице: загрузчик доступен как window.mfDownload только в настольной версии.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mfDownload', {
  info: (url) => ipcRenderer.invoke('dl:info', url),
  pages: (url, link) => ipcRenderer.invoke('dl:pages', url, link),
  image: (url, link, img) => ipcRenderer.invoke('dl:image', url, link, img),
  sites: () => ipcRenderer.invoke('dl:sites'),
  status: () => ipcRenderer.invoke('dl:status'),
  folder: () => ipcRenderer.invoke('dl:folder'),
  pickFolder: () => ipcRenderer.invoke('dl:pickFolder'),
  openFolder: (rel) => ipcRenderer.invoke('dl:openFolder', rel),
  save: (rel, bytes) => ipcRenderer.invoke('dl:save', rel, bytes),
  readChapter: (rel) => ipcRenderer.invoke('dl:readChapter', rel),
  hasChapters: (rels) => ipcRenderer.invoke('dl:hasChapters', rels),
});

// Журнал: файл в «Документы\MangaForge\Логи» и живая лента для окна «Журнал»
contextBridge.exposeInMainWorld('mfLog', {
  write: (level, source, msg, data) => ipcRenderer.send('log:write', level, source, msg, data),
  recent: () => ipcRenderer.invoke('log:recent'),
  openFile: () => ipcRenderer.invoke('log:openFile'),
  openFolder: () => ipcRenderer.invoke('log:openFolder'),
  path: () => ipcRenderer.invoke('log:path'),
  onEntry: (fn) => ipcRenderer.on('log:entry', (e, entry) => fn(entry)),
});
