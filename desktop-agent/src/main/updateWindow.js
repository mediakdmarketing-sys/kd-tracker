'use strict';

// The "Update" window shown when a newer version of the agent is found. It is a small frameless card
// in the middle of the screen. Showing, progress and the buttons are driven from index.js.

const path = require('path');
const { BrowserWindow, ipcMain } = require('electron');

let win = null;
let current = null; // what the window shows: { version, notes, mandatory, phase, percent, ... }

function open() {
  if (win && !win.isDestroyed()) return win;
  win = new BrowserWindow({
    width: 380,
    height: 540,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    hasShadow: false,
    title: 'WorkInvigilator update',
    icon: path.join(__dirname, '..', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'updatePreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win && !win.isDestroyed() && win.show());
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'update.html'));
  return win;
}

/** Shows the window (or brings it up) with this information. */
function show(info) {
  current = { ...current, ...info };
  const w = open();
  if (!w.isVisible() && !w.webContents.isLoading()) w.show();
  w.webContents.send('update:change', current);
}

/** Changes what an open window shows, without opening one. */
function push(info) {
  current = { ...current, ...info };
  if (win && !win.isDestroyed()) win.webContents.send('update:change', current);
}

function isOpen() {
  return Boolean(win && !win.isDestroyed());
}

function close() {
  if (win && !win.isDestroyed()) win.close();
}

/** Wires the window's buttons. `onStart` runs when Update is pressed, `onLater` for Later. */
function registerHandlers({ onStart, onLater }) {
  ipcMain.handle('update:get', () => current);
  ipcMain.handle('update:start', () => onStart());
  ipcMain.handle('update:later', () => {
    onLater();
    close();
  });
}

module.exports = { show, push, isOpen, close, registerHandlers };
