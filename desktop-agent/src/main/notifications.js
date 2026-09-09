'use strict';

// OS-level notifications for every important agent event.
//
// Dedup rules:
//  'always'   — no guard; used for explicit user actions (punch-in/out, break start/end)
//  'cooldown' — at most once per COOLDOWNS[key] ms; used for background events that can
//               repeat rapidly (mic muted, offline, screen permission missing)
//  'once'     — at most once per agent lifetime (process restart resets it); used for
//               events that do not meaningfully recur (account deactivated)

const { Notification } = require('electron');
const logger = require('../core/logger');

const COOLDOWNS = {
  screen_monitoring_fail:  5 * 60_000,   // 5 min
  recording_disabled:      5 * 60_000,
  mic_muted:               5 * 60_000,
  offline:                 3 * 60_000,   // 3 min — don't spam while flapping
  queue_abandoned:         5 * 60_000,
};

const lastShown = {};       // cooldown timestamps   key → epoch ms
const shownOnce = new Set(); // lifetime once-only keys

function notify(key, title, body, mode = 'cooldown') {
  if (!Notification.isSupported()) return;

  const now = Date.now();

  if (mode === 'cooldown') {
    const ms = COOLDOWNS[key] ?? 60_000;
    if (lastShown[key] && now - lastShown[key] < ms) return;
    lastShown[key] = now;
  } else if (mode === 'once') {
    if (shownOnce.has(key)) return;
    shownOnce.add(key);
  }
  // mode === 'always' → no guard

  try {
    new Notification({ title, body, silent: false }).show();
    logger.info('Notification shown', { key, title });
  } catch (err) {
    logger.warn('Failed to show notification', { key, message: err.message });
  }
}

/**
 * Called on every punch-in so per-shift 'always' notifications
 * (screen ok, recording active) fire again on the new shift.
 * Cooldown keys are left alone — a 5-min gap between "mic muted"
 * alerts should not reset just because the employee punched in.
 */
function resetSession() {
  logger.info('Notification session reset (punch-in)');
}

// ---------------------------------------------------------------------------
// Explicit user actions — always show so the employee knows it worked
// ---------------------------------------------------------------------------

function notifyPunchIn() {
  notify('punch_in', 'Punched in', 'Your shift has started. Screen monitoring is now active.', 'always');
}

function notifyPunchOut(workedFormatted) {
  notify(
    'punch_out',
    'Punched out',
    workedFormatted ? `Shift ended. Worked: ${workedFormatted}.` : 'Your shift has ended.',
    'always'
  );
}

function notifyBreakStart() {
  notify('break_start', 'Break started', 'Capture is paused. Nothing is being recorded.', 'always');
}

function notifyBreakEnd() {
  notify('break_end', 'Break ended', 'Back to work — screen monitoring has resumed.', 'always');
}

// ---------------------------------------------------------------------------
// Capture health — cooldown so background loops do not spam
// ---------------------------------------------------------------------------

/** First screenshot of the shift came back with real data. */
function notifyRecordingActive() {
  notify(
    'recording_active',
    'Recording active',
    'Screen monitoring is enabled. Screenshots and activity are being captured.',
    'always'
  );
}

/** Screenshot came back blank — macOS screen recording permission likely missing. */
function notifyScreenMonitoringFailed() {
  notify(
    'screen_monitoring_fail',
    'Screen monitoring disabled',
    'Screenshots are blank — screen recording permission may be missing. Check System Settings → Privacy → Screen Recording.',
    'cooldown'
  );
}

/** Audio consent is on but recordSample() returned null (permission denied / timeout). */
function notifyAudioDisabled() {
  notify(
    'recording_disabled',
    'Audio recording disabled',
    'Microphone access was denied or timed out. Screen monitoring is still active.',
    'cooldown'
  );
}

/** Audio sample was silence throughout — mic is muted or disconnected. */
function notifyMicMuted() {
  notify(
    'mic_muted',
    'Microphone appears muted',
    'Please unmute your system microphone. Audio samples will be silent until it is unmuted.',
    'cooldown'
  );
}

// ---------------------------------------------------------------------------
// Connectivity & queue
// ---------------------------------------------------------------------------

/** API is unreachable — punches and captures are being queued locally. */
function notifyOffline() {
  notify(
    'offline',
    'KD Tracker is offline',
    'No connection to the server. Punches and captures are queued and will upload automatically when the connection returns.',
    'cooldown'
  );
}

/** Connection restored — queued items are uploading. */
function notifyBackOnline(pending) {
  // 'always' here: coming back online is an explicit state change worth showing every time.
  notify(
    'back_online',
    'Back online',
    pending > 0
      ? `Connection restored. Uploading ${pending} queued item${pending === 1 ? '' : 's'}.`
      : 'Connection restored.',
    'always'
  );
}

/**
 * One or more captures were permanently abandoned (e.g. outside any valid shift window).
 * Shown once per cooldown window so a stuck batch does not spam.
 */
function notifyQueueAbandoned(count) {
  notify(
    'queue_abandoned',
    'Capture upload failed',
    `${count} item${count === 1 ? '' : 's'} could not be delivered and ${count === 1 ? 'has' : 'have'} been removed from the queue. Check the audit log for details.`,
    'cooldown'
  );
}

// ---------------------------------------------------------------------------
// Account / session
// ---------------------------------------------------------------------------

/**
 * Shown once per process lifetime — if the account is deactivated the employee
 * knows immediately rather than wondering why the tray went quiet.
 */
function notifyAccountDeactivated() {
  notify(
    'account_deactivated',
    'Account deactivated',
    'Your account has been deactivated by HR. Please contact your manager.',
    'once'
  );
}

/** Session token expired or was revoked — re-login needed. */
function notifySessionExpired() {
  notify(
    'session_expired',
    'Session ended',
    'You have been signed out. Please open KD Tracker and sign in again.',
    'always'
  );
}

/** Machine woke from sleep — agent is re-syncing with the server. */
function notifyWokeFromSleep() {
  notify(
    'woke_from_sleep',
    'KD Tracker resuming',
    'Your device woke from sleep. Syncing attendance status…',
    'always'
  );
}

module.exports = {
  notify,
  resetSession,
  // User actions
  notifyPunchIn,
  notifyPunchOut,
  notifyBreakStart,
  notifyBreakEnd,
  // Capture health
  notifyRecordingActive,
  notifyScreenMonitoringFailed,
  notifyAudioDisabled,
  notifyMicMuted,
  // Connectivity
  notifyOffline,
  notifyBackOnline,
  notifyQueueAbandoned,
  // Account
  notifyAccountDeactivated,
  notifySessionExpired,
  notifyWokeFromSleep,
};
