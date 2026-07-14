const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('waSettings', {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (data) => ipcRenderer.invoke('settings:set', data),
});
