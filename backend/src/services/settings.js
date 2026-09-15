'use strict';

// Operational settings — screenshot/audio cadence, shift rules, retention, payroll idle
// deduction — editable from the admin panel without a restart or redeploy.
//
// Not database-backed on every read: config.js's values were previously read once at process
// startup and never changed again, and every one of the ~20 call sites that reads them (see
// attendance.service, capture.service, the close-shifts/retention jobs, /api/config) is a hot
// path or a scheduled job, not a place that can casually `await` a settings table. So this
// keeps an in-memory cache, refreshed on a short TTL, and every call site keeps calling a
// synchronous getter exactly as it called config.shift.X before — only the source of that
// value changed, not how it's consumed.
//
// Serverless-aware: index.js (the Vercel entry) never runs src/server.js's startup sequence,
// so there is no reliable "run this once before serving requests" hook to depend on. Instead
// the cache lazily (re)loads itself — get() triggers a non-blocking refresh once the TTL has
// elapsed and, on a genuine cold start, serves config.js's .env-derived defaults for that one
// request rather than blocking or throwing. init() exists for the long-lived host (server.js
// awaits it before accepting connections) so that path never serves stale defaults at all.

const { db } = require('../db');
const config = require('../config');
const { toBool } = require('../utils/http');
const logger = require('../utils/logger');

const ROW_ID = 'default';
const TTL_MS = 30_000;

function defaults() {
  return {
    capture: {
      screenshotMinIntervalSec: config.capture.screenshotMinIntervalSec,
      screenshotMaxIntervalSec: config.capture.screenshotMaxIntervalSec,
      audioSampleDurationSec: config.capture.audioSampleDurationSec,
      audioSampleGapSec: config.capture.audioSampleGapSec,
    },
    shift: {
      targetSeconds: config.shift.targetSeconds,
      breakAllowanceSeconds: config.shift.breakAllowanceSeconds,
      idleThresholdSeconds: config.shift.idleThresholdSeconds,
      autoCloseHours: config.shift.autoCloseHours,
    },
    retention: { days: config.retention.days },
    payroll: { deductIdle: config.payroll.deductIdle },
  };
}

function rowToSettings(row) {
  return {
    capture: {
      screenshotMinIntervalSec: row.screenshot_min_interval_sec,
      screenshotMaxIntervalSec: row.screenshot_max_interval_sec,
      audioSampleDurationSec: row.audio_sample_duration_sec,
      audioSampleGapSec: row.audio_sample_gap_sec,
    },
    shift: {
      targetSeconds: row.shift_target_seconds,
      breakAllowanceSeconds: row.break_allowance_seconds,
      idleThresholdSeconds: row.idle_threshold_seconds,
      autoCloseHours: row.shift_auto_close_hours,
    },
    retention: { days: row.retention_days },
    payroll: { deductIdle: toBool(row.payroll_deduct_idle) },
  };
}

function settingsToRow(s) {
  return {
    screenshot_min_interval_sec: s.capture.screenshotMinIntervalSec,
    screenshot_max_interval_sec: s.capture.screenshotMaxIntervalSec,
    audio_sample_duration_sec: s.capture.audioSampleDurationSec,
    audio_sample_gap_sec: s.capture.audioSampleGapSec,
    shift_target_seconds: s.shift.targetSeconds,
    break_allowance_seconds: s.shift.breakAllowanceSeconds,
    idle_threshold_seconds: s.shift.idleThresholdSeconds,
    shift_auto_close_hours: s.shift.autoCloseHours,
    retention_days: s.retention.days,
    payroll_deduct_idle: s.payroll.deductIdle,
  };
}

let cache = defaults();
let lastLoadedAt = 0;
let loading = null;

async function load() {
  try {
    let row = await db()('settings').where({ id: ROW_ID }).first();
    if (!row) {
      const now = Date.now();
      // First run — seed from whatever .env/config.js already says, so nothing changes
      // behaviourally until an admin actually opens the Settings page and saves something.
      await db()('settings')
        .insert({ id: ROW_ID, ...settingsToRow(defaults()), created_at: now, updated_at: now, updated_by: null })
        .onConflict('id')
        .ignore();
      row = await db()('settings').where({ id: ROW_ID }).first();
    }
    cache = rowToSettings(row);
    lastLoadedAt = Date.now();
  } catch (err) {
    // DB unreachable, or this deployment hasn't run the settings migration yet. Keep serving
    // the last good cache (or .env defaults, on a cold start) rather than failing every
    // request that happens to read a setting.
    logger.warn('Could not load settings from the database; using cached/default values', {
      message: err.message,
    });
  }
}

function ensureFresh() {
  if (Date.now() - lastLoadedAt > TTL_MS && !loading) {
    loading = load().finally(() => {
      loading = null;
    });
  }
}

/** Synchronous read — call sites that used to read config.shift.X etc. read this instead. */
function get() {
  ensureFresh();
  return cache;
}

/** Awaited once at startup by the long-lived host (server.js) so it never serves defaults. */
async function init() {
  await load();
}

/**
 * Applies a partial patch (any subset of the four groups) and persists it. Callers are
 * expected to have already validated the values (the admin route does this with zod) — this
 * layer only merges and writes, it does not re-validate ranges.
 */
async function update(patch, { updatedBy } = {}) {
  // Guarantee the row exists before UPDATE-ing it — the very first save of a fresh
  // deployment could otherwise race ahead of anything ever having called load().
  if (!lastLoadedAt) await load();

  const next = {
    capture: { ...cache.capture, ...patch.capture },
    shift: { ...cache.shift, ...patch.shift },
    retention: { ...cache.retention, ...patch.retention },
    payroll: { ...cache.payroll, ...patch.payroll },
  };

  const now = Date.now();
  await db()('settings')
    .where({ id: ROW_ID })
    .update({ ...settingsToRow(next), updated_at: now, updated_by: updatedBy || null });

  cache = next;
  lastLoadedAt = now;
  return cache;
}

module.exports = { get, init, update };
