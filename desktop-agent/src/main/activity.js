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
    windowTitle: activeWindowTitle(),
    // Presence, used to decide whether to send a row at all. An idle machine produces no row,
    // which is exactly the gap the server's idle detection looks for.
    active: hook ? taken.keystrokes + taken.mouse > 0 || active : active,
    countsAvailable: Boolean(hook),
  };
}

/**
 * Active application name. Electron can only see its own windows, so this reports the agent's
 * own popup when it is focused and nothing otherwise — a real implementation needs a native
 * call per platform. Left honest rather than guessing.
 */
function activeWindowTitle() {
  const focused = BrowserWindow.getFocusedWindow();
  return focused ? focused.getTitle() : null;
}

function start() {
  tryLoadNativeHook();
}

function stop() {
  try {
    hook?.stop();
  } catch (err) {
    logger.warn('Could not stop the input hook', { message: err.message });
  }
  hook = null;
}

module.exports = { start, stop, sample, countsAvailable: () => Boolean(hook) };
