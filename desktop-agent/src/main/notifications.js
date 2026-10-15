'use strict';

// OS-level notifications for agent events. Only the keys in ENABLED (below) are shown.
//
// Dedup rules:
//  'always'   — no guard; used for explicit user actions (punch-in/out, break start/end)
//  'cooldown' — at most once per COOLDOWNS[key] ms; used for background events that can
//               repeat rapidly (mic muted, offline, screen permission missing)
//  'once'     — at most once per agent lifetime (process restart resets it); used for
//               events that do not meaningfully recur (account deactivated)

const path = require('path');
const { Notification } = require('electron');
const logger = require('../core/logger');

const ICON_PATH = path.join(__dirname, '..', 'assets', 'logo.png');

const COOLDOWNS = {
  screen_monitoring_fail:  5 * 60_000,   // 5 min
  recording_disabled:      5 * 60_000,
  mic_muted:               5 * 60_000,
  offline:                 3 * 60_000,   // 3 min — don't spam while flapping
};

const lastShown = {};       // cooldown timestamps   key → epoch ms
const shownOnce = new Set(); // lifetime once-only keys

// The only notifications that actually pop up. Everything else in this file still runs its logic
// and is wired up, but is dropped here, so turning one back on is adding its key to this set
// rather than rewriting anything. The tray icon and the popup still show the live state.
const ENABLED = new Set(['break_overdue']);

function notify(key, title, body, mode = 'cooldown') {
  if (!ENABLED.has(key)) return;
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
    new Notification({ title, body, silent: false, icon: ICON_PATH }).show();
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

/**
 * The day's break allowance is used up and the break is still running. The agent decides when
 * to repeat this (every few minutes), so it is 'always' here rather than double-throttled.
 */
function notifyBreakOverdue(overSeconds = 0) {
  const mins = Math.floor(overSeconds / 60);
  notify(
    'break_overdue',
    'Break time is over',
    mins >= 1
      ? `Your break allowance ended ${mins} min ago. Please end your break and get back to work.`
      : 'Your break allowance has ended. Please end your break and get back to work.',
    'always'
  );
}

// ---------------------------------------------------------------------------
// Capture health — cooldown so background loops do not spam
// ---------------------------------------------------------------------------

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
    'WorkBuddy is offline',
    'No connection to the server. Punches and captures are queued and will upload automatically when the connection returns.',
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

/** The web portal handed this laptop a sign-in (workbuddy:// link). */
function notifyConnected(name) {
  notify(
    'connected',
    'WorkBuddy connected',
    name
      ? `Signed in as ${name} from the web portal. Punch in when you are ready to start.`
      : 'Signed in from the web portal. Punch in when you are ready to start.',
    'always'
  );
}

/** The link could not be used — expired, already used, or the server was unreachable. */
function notifyConnectFailed(message) {
  notify(
    'connect_failed',
    'Could not connect WorkBuddy',
    `${message || 'The link did not work.'} You can sign in from the WorkBuddy tray icon instead.`,
    'cooldown'
  );
}

/** Session token expired or was revoked — re-login needed. */
function notifySessionExpired() {
  notify(
    'session_expired',
    'Session ended',
    'You have been signed out. Please open WorkBuddy and sign in again.',
    'always'
  );
}

/** Machine woke from sleep — agent is re-syncing with the server. */
function notifyWokeFromSleep() {
  notify(
    'woke_from_sleep',
    'WorkBuddy resuming',
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
  notifyBreakOverdue,
  // Capture health
  notifyScreenMonitoringFailed,
  notifyAudioDisabled,
  notifyMicMuted,
  // Connectivity
  notifyOffline,
  // Account
  notifyAccountDeactivated,
  notifySessionExpired,
  notifyWokeFromSleep,
  notifyConnected,
  notifyConnectFailed,
};
