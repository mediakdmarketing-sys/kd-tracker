'use strict';

// Bridge for the hidden audio recorder window. Context-isolated: the page gets exactly two
// functions and no access to Node.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('recorder', {
  onStart: (handler) => ipcRenderer.on('recorder:start', (_event, payload) => handler(payload)),
  done: (result) => ipcRenderer.send('recorder:done', result),
});
