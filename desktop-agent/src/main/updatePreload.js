'use strict';

// The update window's only bridge to the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateWin', {
  get: () => ipcRenderer.invoke('update:get'),
  start: () => ipcRenderer.invoke('update:start'),
  later: () => ipcRenderer.invoke('update:later'),
  onChange: (handler) => ipcRenderer.on('update:change', (_event, data) => handler(data)),
});
