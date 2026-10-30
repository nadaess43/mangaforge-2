// Мост к странице: загрузчик доступен как window.mfDownload только в настольной версии.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mfDownload', {
  info: (url) => ipcRenderer.invoke('dl:info', url),
  pages: (url, link) => ipcRenderer.invoke('dl:pages', url, link),
  image: (url, link, img) => ipcRenderer.invoke('dl:image', url, link, img),
  sites: () => ipcRenderer.invoke('dl:sites'),
  status: () => ipcRenderer.invoke('dl:status'),
});
