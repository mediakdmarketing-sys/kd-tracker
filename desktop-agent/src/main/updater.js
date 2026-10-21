'use strict';

// Auto-update, so a new build reaches every laptop without anyone re-sharing an installer.
//
// The feed is a plain folder of files (the installer, its .blockmap and `latest.yml`) on any
// static host, such as a public Cloudflare R2 bucket. Nothing runs unless the app is packaged
// and an update URL is configured, so `npm start` in development never touches it.
//
// An update downloads in the background and installs the next time the agent is idle: either
// the employee is punched out, or the app is quit (autoInstallOnAppQuit). It never restarts
// the app in the middle of a shift, which would drop a capture or interrupt a break.

const { app } = require('electron');
const logger = require('../core/logger');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const RETRY_RESTART_MS = 5 * 60 * 1000;

/**
 * @param {object} opts
 * @param {string} opts.url             base URL of the update feed; empty disables updating
 * @param {() => boolean} opts.isIdle   true when it is safe to restart (punched out)
 * @returns {() => void}                stop function
 */
function startUpdater({ url, isIdle }) {
  if (!app.isPackaged || !url) return () => {};

  // Loaded here, not at the top of the file, so development and the unit tests never load it.
  const { autoUpdater } = require('electron-updater');

  autoUpdater.setFeedURL({ provider: 'generic', url });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => logger.info(String(m)),
    warn: (m) => logger.warn(String(m)),
    error: (m) => logger.error(String(m)),
    debug: () => {},
  };

  let restartTimer = null;

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      // Offline or the host is down: try again at the next interval, never surface it.
      logger.warn('Update check failed', { message: err.message });
    });
  };

  const restartWhenIdle = () => {
    if (isIdle()) {
      autoUpdater.quitAndInstall(true, true);
      return;
    }
    restartTimer = setTimeout(restartWhenIdle, RETRY_RESTART_MS);
  };

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded', { version: info.version });
    clearTimeout(restartTimer);
    restartWhenIdle();
  });

  check();
  const timer = setInterval(check, CHECK_EVERY_MS);

  return () => {
    clearInterval(timer);
    clearTimeout(restartTimer);
  };
}

module.exports = { startUpdater };
