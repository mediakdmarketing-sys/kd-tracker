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
const { isNewer, versionFromFeed } = require('../core/version');

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;
const RETRY_RESTART_MS = 5 * 60 * 1000;

/**
 * @param {object} opts
 * @param {string} opts.url             base URL of the update feed; empty disables updating
 * @param {() => boolean} opts.isIdle   true when it is safe to restart (punched out)
 * @param {(status: object) => void} [opts.onStatus]  told about each step so the popup can show it:
 *        { phase: 'available' | 'downloading' | 'ready', version, percent? }
 * @returns {{ stop: () => void, install: () => boolean }}  install() restarts into the downloaded
 *        update when it is ready and the agent is idle; false when it did nothing
 */
function startUpdater({ url, isIdle, onStatus = () => {} }) {
  if (!app.isPackaged || !url) return { stop: () => {}, install: () => false };

  // macOS only installs an update over an app that is signed with an Apple Developer ID, and this
  // one is not. So instead of downloading, just tell the employee a newer version exists and let
  // them fetch the new .dmg themselves.
  if (process.platform === 'darwin') return startNotifyOnly({ url, onStatus });

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

  let ready = false;

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version });
    onStatus({ phase: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (p) => {
    onStatus({ phase: 'downloading', percent: Math.round(p.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded', { version: info.version });
    ready = true;
    onStatus({ phase: 'ready', version: info.version });
    clearTimeout(restartTimer);
    restartWhenIdle();
  });

  check();
  const timer = setInterval(check, CHECK_EVERY_MS);

  return {
    stop: () => {
      clearInterval(timer);
      clearTimeout(restartTimer);
    },
    install: () => {
      // Never mid-shift: a restart would drop a capture or cut a break short.
      if (!ready || !isIdle()) return false;
      autoUpdater.quitAndInstall(true, true);
      return true;
    },
  };
}

function startNotifyOnly({ url, onStatus }) {
  const check = async () => {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/latest-mac.yml`);
      if (!res.ok) return;
      const latest = versionFromFeed(await res.text());
      if (latest && isNewer(latest, app.getVersion())) {
        logger.info('Newer version available (macOS, manual install)', { version: latest });
        onStatus({ phase: 'manual', version: latest });
      }
    } catch (err) {
      // Offline or the host is down: try again at the next interval, never surface it.
      logger.warn('Update check failed', { message: err.message });
    }
  };

  check();
  const timer = setInterval(check, CHECK_EVERY_MS);
  return { stop: () => clearInterval(timer), install: () => false };
}

module.exports = { startUpdater };
