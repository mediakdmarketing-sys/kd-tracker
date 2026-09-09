'use strict';

// Electron entry point. Wiring only — the decisions live in src/core, which is why they can be
// tested without launching a window.

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, shell, powerMonitor } = require('electron');

const logger = require('../core/logger');
const { loadSettings } = require('../core/settings');
const { Outbox } = require('../core/outbox');
const { FileTokenStore } = require('../core/tokenStore');
const { ApiClient } = require('../core/apiClient');
const { Uploader } = require('../core/uploader');
const { Agent } = require('../core/agent');

const capture = require('./capture');
const activity = require('./activity');
const audio = require('./audio');
const { iconFor } = require('./trayIcon');
const notifications = require('./notifications');

const ACTIVITY_WINDOW_SECONDS = 60;
const STATUS_SYNC_MS = 60_000;

let tray = null;
let popup = null;
let agent = null;
let outbox = null;
let timers = [];

// One agent per machine. A second copy would double every capture and fight over the queue.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showPopup());
  app.whenReady().then(start).catch((err) => {
    logger.error('Agent failed to start', { message: err.message, stack: err.stack });
    app.quit();
  });
}

async function start() {
  const dataDir = app.getPath('userData');
  const settings = loadSettings(dataDir);

  outbox = await Outbox.open(dataDir);

  const tokenStore = new FileTokenStore(path.join(dataDir, 'session.bin'), {
    available: () => safeStorage.isEncryptionAvailable(),
    encrypt: (text) => safeStorage.encryptString(text),
    decrypt: (buffer) => safeStorage.decryptString(buffer),
  });

  const api = new ApiClient({ baseUrl: settings.apiBaseUrl, tokenStore });
  // `agent` is assigned below, but this callback only runs later (after uploader.start()),
  // by which point it is set — closures capture the variable, not its value at this line.
  const uploader = new Uploader({
    outbox,
    api,
    onStatus: (status) => {
      if (status.needsSignIn) {
        // Distinguish account deactivated (403 ACCOUNT_DEACTIVATED) from plain session
        // expiry (401) — the uploader does not expose the reason code, so we infer it from
        // whether the agent's current state already has a lastError set by markSignedOut.
        agent.markSignedOut();
        notifications.notifyAccountDeactivated();
      } else {
        if (status.abandoned > 0) {
          notifications.notifyQueueAbandoned(status.abandoned);
        }
        agent.refreshQueueStats();
      }
      refreshTray();
    },
  });

  agent = new Agent({
    api,
    outbox,
    uploader,
    capture: {
      screenshots: () => capture.captureAllDisplays({ quality: settings.screenshotQuality }),
      audioSample: (seconds) => audio.recordSample(seconds),
    },
    onState: () => {
      refreshTray();
      popup?.webContents.send('agent:state', agent.state);
    },
    onNotify: (event, data) => {
      switch (event) {
        case 'resetSession':          notifications.resetSession(); break;
        // User actions
        case 'punchIn':               notifications.notifyPunchIn(); break;
        case 'punchOut':              notifications.notifyPunchOut(data); break;
        case 'breakStart':            notifications.notifyBreakStart(); break;
        case 'breakEnd':              notifications.notifyBreakEnd(); break;
        // Capture health
        case 'recordingActive':       notifications.notifyRecordingActive(); break;
        case 'screenMonitoringOk':    notifications.notifyRecordingActive(); break; // same UX
        case 'screenMonitoringFailed':notifications.notifyScreenMonitoringFailed(); break;
        case 'audioDisabled':         notifications.notifyAudioDisabled(); break;
        case 'micMuted':              notifications.notifyMicMuted(); break;
        // Connectivity
        case 'offline':               notifications.notifyOffline(); break;
        case 'backOnline':            notifications.notifyBackOnline(data ?? 0); break;
        case 'queueAbandoned':        notifications.notifyQueueAbandoned(data ?? 1); break;
        // Account / session
        case 'accountDeactivated':    notifications.notifyAccountDeactivated(); break;
        case 'sessionExpired':        notifications.notifySessionExpired(); break;
        case 'wokeFromSleep':         notifications.notifyWokeFromSleep(); break;
        default: break;
      }
    },
  });

  audio.registerHandlers();
  activity.start();
  registerIpc();
  buildTray();

  if (api.isSignedIn()) {
    await agent.syncConfig();
    await agent.syncStatus();
  }

  uploader.start(settings.drainIntervalMs);

  timers.push(setInterval(() => agent.tick().catch(onTickError), 1000));
  timers.push(setInterval(() => sampleActivity(), ACTIVITY_WINDOW_SECONDS * 1000));
  timers.push(setInterval(() => agent.syncStatus().catch(onTickError), STATUS_SYNC_MS));

  // Waking from sleep means the clock jumped and the network probably changed: re-check
  // rather than carry on with stale state.
  powerMonitor.on('resume', () => {
    logger.info('Machine resumed; re-syncing');
    notifications.notifyWokeFromSleep();
    agent.syncStatus().catch(onTickError);
  });

  if (capture.screenPermissionState() !== 'granted') {
    logger.warn('Screen recording permission is missing; screenshots will be blank until it is granted');
  }

  // macOS: no dock icon, this is a tray app.
  app.dock?.hide();
  logger.info('Agent started', { api: settings.apiBaseUrl, dataDir });
}

function onTickError(err) {
  logger.error('Agent tick failed', { message: err.message });
}

function sampleActivity() {
  if (!agent?.state.signedIn || !agent.state.captureAllowed) return;

  const sample = activity.sample(ACTIVITY_WINDOW_SECONDS);
  // An idle window produces no row. That absence is exactly what the server's idle detection
  // looks for, so sending a zero row would erase the signal.
  if (!sample.active) return;

  agent.recordActivity(sample);
}

// --- Tray ---------------------------------------------------------------------------------

function trayState() {
  if (!agent?.state.signedIn) return 'off';
  if (!agent.state.online && agent.state.queue.pending > 0) return 'offline';
  if (agent.state.shiftState === 'working') return 'working';
  if (agent.state.shiftState === 'on_break') return 'break';
  return 'off';
}

function trayTooltip() {
  if (!agent?.state.signedIn) return 'KD Tracker — not signed in';

  const bits = [];
  bits.push(
    {
      working: 'Working — screen is being captured',
      on_break: 'On break — nothing is being captured',
      punched_out: 'Punched out',
      unknown: 'Checking…',
    }[agent.state.shiftState] || 'Punched out'
  );

  if (agent.state.audioAllowed && agent.state.shiftState === 'working') {
    bits.push('Audio sampling is on');
  }
  if (agent.state.queue.pending) {
    bits.push(`${agent.state.queue.pending} item(s) waiting to upload`);
  }
  if (!agent.state.online) bits.push('Offline');

  return `KD Tracker — ${bits.join(' · ')}`;
}

function buildTray() {
  tray = new Tray(iconFor('off'));
  tray.on('click', () => showPopup());
  refreshTray();
}

function refreshTray() {
  if (!tray) return;

  tray.setImage(iconFor(trayState()));
  tray.setToolTip(trayTooltip());

  const state = agent?.state || {};
  const menu = Menu.buildFromTemplate([
    { label: trayTooltip(), enabled: false },
    { type: 'separator' },
    {
      label: 'Punch in',
      enabled: state.signedIn && state.shiftState === 'punched_out',
      click: () => agent.punch('punchIn'),
    },
    {
      label: state.shiftState === 'on_break' ? 'End break' : 'Start break',
      enabled: state.signedIn && ['working', 'on_break'].includes(state.shiftState),
      click: () => agent.punch(state.shiftState === 'on_break' ? 'breakEnd' : 'breakStart'),
    },
    {
      label: 'Punch out',
      enabled: state.signedIn && ['working', 'on_break'].includes(state.shiftState),
      click: () => agent.punch('punchOut'),
    },
    { type: 'separator' },
    { label: 'Open…', click: () => showPopup() },
    {
      label: 'What is recorded',
      // The employee can read the disclosure at any time, not just at first sign-in.
      click: () => shell.openExternal(`${agentPortalUrl()}/consent`),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => quit() },
  ]);

  tray.setContextMenu(menu);
}

function agentPortalUrl() {
  // The portal usually sits alongside the API; good enough for a "read the policy" link.
  return (process.env.KD_PORTAL_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// --- Popup --------------------------------------------------------------------------------

function showPopup() {
  if (popup && !popup.isDestroyed()) {
    popup.show();
    popup.focus();
    return;
  }

  // Position the popup near the tray icon so it feels like a panel rather than a random
  // window. On Windows the tray is at the bottom-right; we put the popup just above it.
  // tray.getBounds() can return {x:0,y:0} if the icon is in the hidden overflow area —
  // fall back to the bottom-right corner of the primary work area in that case.
  const { screen } = require('electron');
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const trayBounds = tray?.getBounds() ?? {};
  const W = 380;
  const H = 560;
  const x = Math.max(0, Math.min(Math.round(trayBounds.x ?? sw - W - 8), sw - W - 8));
  const y = Math.max(0, Math.round(sh - H - 8));

  popup = new BrowserWindow({
    width: W,
    height: H,
    x,
    y,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'KD Tracker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popup.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));
  // Dismiss on blur (clicking anywhere else), like a real tray panel.
  popup.on('blur', () => { if (popup && !popup.isDestroyed()) popup.hide(); });
  popup.on('closed', () => { popup = null; });
}

function registerIpc() {
  ipcMain.handle('agent:getState', () => agent.state);
  ipcMain.handle('agent:signIn', (_e, { email, password }) => agent.signIn(email, password));
  ipcMain.handle('agent:signOut', () => agent.signOut());
  ipcMain.handle('agent:punch', (_e, action) => agent.punch(action));
  ipcMain.handle('agent:sync', () => agent.syncStatus());
  ipcMain.handle('agent:drainNow', () => agent.uploader.drain());
}

function quit() {
  timers.forEach(clearInterval);
  timers = [];
  agent?.uploader.stop();
  activity.stop();
  audio.destroy();
  // The queue is on disk; anything undelivered is picked up on next start.
  outbox?.close();
  app.quit();
}

// A tray app stays running with no windows open.
app.on('window-all-closed', () => {});
app.on('before-quit', () => activity.stop());
