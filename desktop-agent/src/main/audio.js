'use strict';

// Audio sampling.
//
// The main process has no MediaRecorder, so recording happens in a hidden renderer that owns
// the microphone and hands the encoded sample back over IPC. The window exists only while a
// sample is being taken — the microphone is not held open between samples, which is the
// difference between periodic sampling and continuous surveillance (spec 6.3).

const path = require('path');
const { BrowserWindow, ipcMain, systemPreferences } = require('electron');
const logger = require('../core/logger');

let recorderWindow = null;
let pending = null;

function ensureWindow() {
  if (recorderWindow && !recorderWindow.isDestroyed()) return recorderWindow;

  recorderWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'recorderPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  recorderWindow.loadFile(path.join(__dirname, '..', 'renderer', 'recorder.html'));
  return recorderWindow;
}

/** macOS gates the microphone behind TCC; ask once, and report honestly if refused. */
async function ensureMicrophonePermission() {
  if (process.platform !== 'darwin') return true;

  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted') return true;
  if (status === 'denied') return false;

  return systemPreferences.askForMediaAccess('microphone');
}

/**
 * Records one sample.
 *
 * @param {number} durationSeconds
 * @returns {Promise<{buffer: Buffer, durationSeconds: number, contentType: string}|null>}
 */
async function recordSample(durationSeconds) {
  if (pending) {
    // Non-overlapping by construction: a second request while one is running is refused
    // rather than queued, so two recorders can never be open at once.
    logger.warn('Audio sample already in progress; skipping this one');
    return null;
  }

  if (!(await ensureMicrophonePermission())) {
    logger.warn('Microphone permission not granted; no audio recorded');
    return null;
  }

  const win = ensureWindow();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Belt and braces: if the renderer never answers, do not leave the promise (and the
      // "already in progress" guard) hanging for the rest of the shift.
      pending = null;
      logger.warn('Audio recorder did not respond in time');
      resolve(null);
    }, (durationSeconds + 20) * 1000);

    pending = (result) => {
      clearTimeout(timeout);
      pending = null;
      resolve(result);
    };

    win.webContents.send('recorder:start', { durationSeconds });
  });
}

function registerHandlers() {
  ipcMain.on('recorder:done', (_event, { data, durationSeconds, mimeType, micMuted, error }) => {
    if (!pending) return;

    if (error) {
      logger.warn('Audio capture failed in the renderer', { error });
      pending(null);
      return;
    }

    pending({
      buffer: Buffer.from(data),
      durationSeconds,
      contentType: (mimeType || 'audio/webm').split(';')[0],
      // Passed through from the renderer's silence detection. May be undefined for old
      // renderer builds; caller treats undefined as null (unknown).
      micMuted: typeof micMuted === 'boolean' ? micMuted : null,
    });
  });
}

function destroy() {
  if (recorderWindow && !recorderWindow.isDestroyed()) recorderWindow.destroy();
  recorderWindow = null;
}

module.exports = { recordSample, registerHandlers, destroy };
