'use strict';

// Electron entry point. Wiring only — the decisions live in src/core, which is why they can be
// tested without launching a window.

const path = require('path');
const { app, BrowserWindow, Tray, Menu, ipcMain, safeStorage, shell, powerMonitor, dialog } = require('electron');

const logger = require('../core/logger');
const { loadSettings, BUNDLED } = require('../core/settings');
const { Outbox } = require('../core/outbox');
const { FileTokenStore } = require('../core/tokenStore');
const { ApiClient } = require('../core/apiClient');
const { Uploader } = require('../core/uploader');
const { Agent } = require('../core/agent');
const { parseConnectLink, parseSyncLink, SCHEME } = require('../core/connectLink');

const capture = require('./capture');
const activity = require('./activity');
const audio = require('./audio');
const { iconFor } = require('./trayIcon');
const notifications = require('./notifications');
const { startUpdater } = require('./updater');
const linux = require('./linux');
const { startFileLog } = require('./fileLog');

const ACTIVITY_WINDOW_SECONDS = 60;
// The portal normally nudges the agent (workbuddy://sync) the moment something changes there;
// this poll is the safety net for when that link is blocked or the agent was asleep, so it is
// what bounds how long a web punch-in can go unnoticed.
const STATUS_SYNC_MS = 20_000;

let tray = null;
let popup = null;
let agent = null;
let outbox = null;
let timers = [];
let stopUpdater = () => {};

// Let the web portal sign this agent in: after an employee signs in on the portal it opens a
// workbuddy://connect?code=... link, and the OS hands it to us. In development the app is
// `electron.exe <path>`, so the registration has to name that path or the link would launch a
// bare Electron with no app.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(SCHEME);
}

// A link that arrives before the agent has finished starting waits here.
let pendingConnectCode = null;

async function connectFromLink(code) {
  if (!agent) {
    pendingConnectCode = code;
    return;
  }
  // Nothing signed in yet, so a link is about to decide whose account this laptop reports to.
  // A web page can open one of these on its own, so a person has to agree first; otherwise a
  // page could point the agent at an account it controls.
  if (!agent.state.signedIn) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Connect', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Connect WorkBuddy',
      message: 'Sign this desktop agent in from the web portal?',
      detail: 'You just signed in to the WorkBuddy portal in your browser. Choose Cancel if that was not you.',
    });
    if (response !== 0) {
      logger.info('Connect link declined by the user');
      return;
    }
  }
  try {
    const result = await agent.connect(code);
    if (!result.connected) logger.info('Connect link ignored', { reason: result.reason });
  } catch (err) {
    logger.warn('Connect link failed', { status: err.status, message: err.message });
    notifications.notifyConnectFailed(err.message);
  }
}

/**
 * Acts on a workbuddy:// link, wherever the OS delivered it. Returns whether it was one of ours,
 * so the caller can fall back to just showing the popup for a plain second launch.
 */
function handleLink(input) {
  const code = parseConnectLink(input);
  if (code) {
    connectFromLink(code);
    return true;
  }
  if (parseSyncLink(input)) {
    // Punched in, took a break or punched out on the portal: look now instead of waiting for
    // the next poll. Nothing to do if nobody is signed in.
    if (agent?.state.signedIn) agent.syncStatus().catch(onTickError);
    return true;
  }
  return false;
}

// One agent per machine. A second copy would double every capture and fight over the queue.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Windows and Linux deliver a link to the already-running copy as argv of a second launch.
  app.on('second-instance', (_event, argv) => {
    if (!handleLink(argv)) showPopup();
  });
  // macOS delivers it as an event instead.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleLink(url);
  });
  app.whenReady().then(start).catch((err) => {
    logger.error('Agent failed to start', { message: err.message, stack: err.stack });
    app.quit();
  });
}

async function start() {
  const dataDir = app.getPath('userData');
  const logFile = startFileLog(dataDir);
  logger.info('Agent starting', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    logFile,
  });
  const settings = loadSettings(dataDir);

  outbox = await Outbox.open(dataDir);
  logger.info('Outbox ready');

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
      micCheck: () => audio.checkMic(),
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
        case 'breakOverdue':          notifications.notifyBreakOverdue(data ?? 0); break;
        // Capture health
        case 'screenMonitoringFailed':notifications.notifyScreenMonitoringFailed(); break;
        case 'audioDisabled':         notifications.notifyAudioDisabled(); break;
        case 'micMuted':              notifications.notifyMicMuted(); break;
        // Connectivity
        case 'offline':               notifications.notifyOffline(); break;
        // Account / session
        case 'accountDeactivated':    notifications.notifyAccountDeactivated(); break;
        case 'sessionExpired':        notifications.notifySessionExpired(); break;
        case 'connected':             notifications.notifyConnected(data); break;
        case 'wokeFromSleep':         notifications.notifyWokeFromSleep(); break;
        default: break;
      }
    },
  });

  // Start with Windows/macOS so a reboot or power cut does not leave capture off until the
  // employee remembers to open it. Packaged builds only: `npm start` in development must not
  // register the dev Electron binary as a login item.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });
  // Electron's login item does nothing on Linux; these two are the Linux equivalents.
  linux.enableAutostart();
  linux.noteWaylandLimits(settings);

  // New builds arrive on their own. A restart is only allowed while the employee is punched out
  // (or the app is quit), never mid-shift. A no-op in development or with no update URL set.
  stopUpdater = startUpdater({
    url: process.env.KD_UPDATE_URL || BUNDLED.updateUrl,
    isIdle: () => agent.state.shiftState === 'punched_out',
  });

  audio.registerHandlers();
  activity.start();
  registerIpc();
  buildTray();

  if (api.isSignedIn()) {
    await agent.syncConfig();
    await agent.syncStatus();
  } else {
    // First run or a lapsed session: Windows often tucks a new tray icon into the hidden ^
    // overflow, so without this the employee launches the app and sees nothing happen.
    showPopup();
  }

  // Launched by a workbuddy:// link (agent was not running yet), or a link arrived mid-startup.
  const launchCode = pendingConnectCode || parseConnectLink(process.argv);
  pendingConnectCode = null;
  if (launchCode) connectFromLink(launchCode);

  uploader.start(settings.drainIntervalMs);

  timers.push(setInterval(() => agent.tick().catch(onTickError), 1000));
  timers.push(setInterval(() => sampleActivity(), ACTIVITY_WINDOW_SECONDS * 1000));
  // Guarded on signedIn: syncStatus() hits an authenticated endpoint with no other check of
  // its own, so an unguarded interval spams the UI's error banner with "Missing bearer token"
  // every minute for as long as the agent sits signed out — drowning out real errors and
  // making a fresh sign-in attempt look broken when it isn't.
  timers.push(
    setInterval(() => {
      if (agent.state.signedIn) agent.syncStatus().catch(onTickError);
    }, STATUS_SYNC_MS)
  );

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
  if (!agent?.state.signedIn || !agent.state.captureAllowed || agent.state.activityAllowed === false) return;

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
  if (!agent?.state.signedIn) return 'WorkBuddy — not signed in';

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

  return `WorkBuddy — ${bits.join(' · ')}`;
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
  return (process.env.KD_PORTAL_URL || BUNDLED.portalUrl).replace(/\/$/, '');
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
    title: 'WorkBuddy',
    // The tray icon is this same logo plus a status dot (see trayIcon.js). This is the window's
    // own identity: the title-bar icon and what Alt-Tab shows for it.
    // Lives under src/ (not build/) so it is packaged with the app; build/ is gitignored and
    // not shipped, which left this pointing at a missing file and Electron's atom icon showing.
    icon: path.join(__dirname, '..', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  popup.loadFile(path.join(__dirname, '..', 'renderer', 'popup.html'));
  // On Windows, hide() then show() quietly puts the taskbar button back even though the window
  // was created with skipTaskbar. This is a tray panel, so re-assert it on every show.
  popup.on('show', () => {
    if (popup && !popup.isDestroyed()) popup.setSkipTaskbar(true);
  });
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
}

function quit() {
  timers.forEach(clearInterval);
  timers = [];
  stopUpdater();
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
