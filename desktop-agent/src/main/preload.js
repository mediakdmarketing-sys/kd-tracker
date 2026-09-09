'use strict';

// The popup's only bridge to the main process. Context-isolated, with an explicit surface —
// the renderer never gets Node, the filesystem, or the session tokens.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  getState: () => ipcRenderer.invoke('agent:getState'),
  signIn: (email, password) => ipcRenderer.invoke('agent:signIn', { email, password }),
  signOut: () => ipcRenderer.invoke('agent:signOut'),
  punch: (action) => ipcRenderer.invoke('agent:punch', action),
  sync: () => ipcRenderer.invoke('agent:sync'),
  drainNow: () => ipcRenderer.invoke('agent:drainNow'),
  onState: (handler) => ipcRenderer.on('agent:state', (_event, state) => handler(state)),
});
