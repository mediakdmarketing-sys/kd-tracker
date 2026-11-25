'use strict';

// Auto-update, so a new build reaches every laptop without anyone re-sharing an installer.
//
// The feed is a plain folder of files (the installer, its .blockmap and `latest.yml`) on any
// static host, such as a public Cloudflare R2 bucket. Nothing runs unless the app is packaged
// and an update URL is configured, so `npm start` in development never touches it.
//
// A new version is OFFERED, not forced on the person: the main process shows an "Update" window with
// what is new. Only when they press Update does the new build download, and then the installer runs
// silently over the old one (the old copy is removed, the new one installed and started again). The
// agent's sign-in and its queue of captures stay on disk, so work carries on where it stopped.

const { app } = require('electron');
const logger = require('../core/logger');
const { isNewer, versionFromFeed } = require('../core/version');

const CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * @param {object} opts
 * @param {string} opts.url             base URL of the update feed; empty disables updating
 * @param {(status: object) => void} [opts.onStatus]  told about each step:
 *        { phase: 'available' | 'downloading' | 'installing' | 'error' | 'manual', version, percent?, message? }
 * @returns {{ stop: () => void, check: () => void, download: () => boolean }}
 *        download() starts fetching the update the person agreed to; false when there is none to fetch.
 */
function startUpdater({ url, onStatus = () => {} }) {
  const none = { stop: () => {}, check: () => {}, download: () => false };
  if (!app.isPackaged || !url) return none;

  // macOS only installs an update over an app that is signed with an Apple Developer ID, and this
  // one is not. So instead of downloading, just tell the employee a newer version exists and let
  // them fetch the new .dmg themselves.
  if (process.platform === 'darwin') return startNotifyOnly({ url, onStatus });

  // Loaded here, not at the top of the file, so development and the unit tests never load it.
  const { autoUpdater } = require('electron-updater');

  autoUpdater.setFeedURL({ provider: 'generic', url });
  autoUpdater.autoDownload = false; // the person decides
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = {
    info: (m) => logger.info(String(m)),
    warn: (m) => logger.warn(String(m)),
    error: (m) => logger.error(String(m)),
    debug: () => {},
  };

  let available = null;
  let downloading = false;

  const check = () => {
    if (downloading) return;
    autoUpdater.checkForUpdates().catch((err) => {
      // Offline or the host is down: try again at the next interval, never surface it.
      logger.warn('Update check failed', { message: err.message });
    });
  };

  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version });
    available = info;
    onStatus({ phase: 'available', version: info.version });
  });

  autoUpdater.on('download-progress', (p) => {
    onStatus({ phase: 'downloading', version: available?.version, percent: Math.round(p.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded; installing', { version: info.version });
    onStatus({ phase: 'installing', version: info.version });
    // Silent, and start again afterwards. A short pause lets the window show "Installing".
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 1200);
  });

  autoUpdater.on('error', (err) => {
    downloading = false;
    logger.error('Update failed', { message: err?.message });
    onStatus({ phase: 'error', version: available?.version, message: 'The update could not be downloaded. Check your internet and try again.' });
  });

  check();
  const timer = setInterval(check, CHECK_EVERY_MS);

  return {
    stop: () => clearInterval(timer),
    check,
    download: () => {
      if (!available || downloading) return false;
      downloading = true;
      onStatus({ phase: 'downloading', version: available.version, percent: 0 });
      autoUpdater.downloadUpdate().catch((err) => {
        downloading = false;
        logger.error('Update download failed', { message: err.message });
        onStatus({ phase: 'error', version: available.version, message: 'The update could not be downloaded. Check your internet and try again.' });
      });
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
  return { stop: () => clearInterval(timer), check, download: () => false };
}

module.exports = { startUpdater };
