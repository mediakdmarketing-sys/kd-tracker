'use strict';

// Bridge for the hidden audio recorder window. Context-isolated: the page gets exactly these
// functions and no access to Node.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorder', {
  onStart: (handler) => ipcRenderer.on('recorder:start', (_event, payload) => handler(payload)),
  done: (result) => ipcRenderer.send('recorder:done', result),
  // A quick "is the microphone switched on?" check: level only, nothing is recorded.
  onCheck: (handler) => ipcRenderer.on('recorder:check', () => handler()),
  checked: (result) => ipcRenderer.send('recorder:checked', result),
});
