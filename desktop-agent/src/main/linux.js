'use strict';

// Linux-only startup behaviour: autostart at login and a one-time Wayland notice.
// The decisions live in ../core/platform.js (unit-tested); this file only touches the OS.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, dialog } = require('electron');
const logger = require('../core/logger');
const { isWaylandSession, autostartEntry } = require('../core/platform');

const IS_LINUX = process.platform === 'linux';

/**
 * Starts the agent at login. Electron's setLoginItemSettings is a no-op on Linux, so this
 * writes the standard ~/.config/autostart entry. Packaged builds only.
 */
function enableAutostart() {
  if (!IS_LINUX || !app.isPackaged) return;
  try {
    // An AppImage runs from a temporary mount; APPIMAGE is the file the user actually launched.
    const exec = process.env.APPIMAGE || process.execPath;
    const dir = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
      'autostart'
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'workbuddy.desktop'), autostartEntry({ exec }));
  } catch (err) {
    logger.warn('Could not enable autostart', { message: err.message });
  }
}

/**
 * Once per machine, explain what a Wayland session cannot do. Idle detection still works, so
 * attendance is correct; screenshots, keystroke counts and the foreground app need an X11
 * session ("Ubuntu on Xorg" on the login screen).
 */
function noteWaylandLimits(settings) {
  if (!isWaylandSession()) return false;
  logger.warn('Wayland session: screenshots, input counts and active-app tracking are limited');
  if (settings.waylandNoticeShown) return true;

  settings.save({ waylandNoticeShown: true });
  dialog
    .showMessageBox({
      type: 'info',
      title: 'WorkBuddy on Wayland',
      message: 'Some monitoring features are limited on a Wayland session.',
      detail:
        'Your attendance and idle time are still recorded. Screenshots, keyboard/mouse counts ' +
        'and the active application may be missing or blank.\n\n' +
        'For full capture, log out and choose an "Xorg" / "X11" session on the login screen ' +
        '(for example "Ubuntu on Xorg"), then sign in again.',
      buttons: ['OK'],
    })
    .catch(() => {});
  return true;
}

module.exports = { enableAutostart, noteWaylandLimits };
