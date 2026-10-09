'use strict';

// Activity sampling.
//
// The spec asks for keystroke and mouse *counts* and is emphatic that content is never
// captured. Counting real key events needs a global input hook, which is a native module and —
// worth being clear-eyed about — is the same mechanism a keylogger uses. So it is optional,
// and the agent works without it.
//
//   With `uiohook-napi` installed : real keystroke and mouse counts.
//   Without it                    : presence of activity only, via the OS idle timer.
//
// The fallback is enough for idle detection, which is what the attendance calculation
// actually depends on: the server derives idle time from the gaps *between* activity rows,
// not from the numbers in them. It is not enough for a report that shows counts, so a
// deployment that wants those has to install the module deliberately.

const { powerMonitor, BrowserWindow } = require('electron');
const logger = require('../core/logger');

let hook = null;
let counts = { keystrokes: 0, mouse: 0 };

function tryLoadNativeHook() {
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const { uIOhook } = require('uiohook-napi');

    // Only the fact that an event happened is read. There is no handler that looks at which
    // key it was, and no field anywhere in this system that could carry one.
    uIOhook.on('keydown', () => {
      counts.keystrokes += 1;
    });
    uIOhook.on('mousedown', () => {
      counts.mouse += 1;
    });
    uIOhook.on('wheel', () => {
      counts.mouse += 1;
    });
    uIOhook.start();

    hook = uIOhook;
    logger.info('Input counting enabled (uiohook-napi)');
    return true;
  } catch {
    logger.warn(
      'uiohook-napi is not installed: recording activity presence only, with zero counts. ' +
        'Install it if HR reports need keystroke and mouse counts.'
    );
    return false;
  }
}

/**
 * Reads and resets the counters for the window that just ended.
 *
 * @param {number} windowSeconds  length of the sampling window
 * @returns {{keystrokeCount: number, mouseCount: number, windowTitle: string|null, active: boolean}}
 */
function sample(windowSeconds) {
  // Seconds since the last input of any kind, as the OS sees it. Cheap, needs no permission,
  // and cannot observe what was typed.
  const idleSeconds = powerMonitor.getSystemIdleTime();
  const active = idleSeconds < windowSeconds;

  const taken = counts;
  counts = { keystrokes: 0, mouse: 0 };

  return {
    keystrokeCount: taken.keystrokes,
    mouseCount: taken.mouse,
    windowTitle: takeActiveApp(),
    // Presence, used to decide whether to send a row at all. An idle machine produces no row,
    // which is exactly the gap the server's idle detection looks for.
    active: hook ? taken.keystrokes + taken.mouse > 0 || active : active,
    countsAvailable: Boolean(hook),
  };
}

// Foreground application tracking.
//
// Electron can only see its own windows, so the foreground app of the *OS* needs a native call
// per platform. `active-win` wraps those and is optional, like the input hook: without it the
// agent reports only its own popup when focused. Only the application name (e.g. "Code",
// "chrome.exe") is kept — never the window title, which carries document names, email
// subjects and URLs. The portal's column is documented as "active application name only".
const APP_POLL_MS = 5000;
const MAX_APP_NAME = 120;

let activeWin = null;
let appTimer = null;
let appPolling = false;
let appTally = new Map(); // app name -> polls seen in the current window

async function tryLoadActiveWin() {
  try {
    // active-win >= 8 is ESM-only, so it cannot be require()d from this CommonJS file.
    const mod = await import('active-win');
    activeWin = mod.default || mod;
    logger.info('Active application tracking enabled (active-win)');
  } catch {
    logger.warn(
      'active-win is not installed: the active application will not be recorded. ' +
        'On macOS it also needs the Screen Recording permission.'
    );
  }
}

async function pollActiveApp() {
  if (!activeWin || appPolling) return;
  appPolling = true;
  try {
    const win = await activeWin({ screenRecordingPermission: false });
    const name = win?.owner?.name;
    if (name) {
      const key = String(name).slice(0, MAX_APP_NAME);
      appTally.set(key, (appTally.get(key) || 0) + 1);
    }
  } catch (err) {
    logger.debug?.('Active app lookup failed', { message: err.message });
  } finally {
    appPolling = false;
  }
}

/** The app that was in the foreground for most of the window that just ended, then resets. */
function takeActiveApp() {
  let best = null;
  let bestCount = 0;
  for (const [name, count] of appTally) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  appTally = new Map();

  if (best) return best;
  const focused = BrowserWindow.getFocusedWindow();
  return focused ? focused.getTitle() : null;
}

function start() {
  tryLoadNativeHook();
  tryLoadActiveWin().then(() => {
    if (!activeWin) return;
    pollActiveApp();
    appTimer = setInterval(pollActiveApp, APP_POLL_MS);
  });
}

function stop() {
  try {
    hook?.stop();
  } catch (err) {
    logger.warn('Could not stop the input hook', { message: err.message });
  }
  hook = null;
  clearInterval(appTimer);
  appTimer = null;
}

module.exports = { start, stop, sample, countsAvailable: () => Boolean(hook) };
