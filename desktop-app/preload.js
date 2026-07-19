const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('waSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (data) => ipcRenderer.invoke('settings:set', data),
});

contextBridge.exposeInMainWorld('waApp', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkForUpdate: () => ipcRenderer.invoke('app:checkForUpdate'),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, version) => cb(version)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update:downloaded', (_e, version) => cb(version)),
  onUpdateChecked: (cb) => ipcRenderer.on('update:checked', (_e, version) => cb(version)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', (_e, message) => cb(message)),
});
