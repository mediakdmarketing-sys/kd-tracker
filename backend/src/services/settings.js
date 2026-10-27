'use strict';

// Operational settings — screenshot/audio cadence, shift rules, retention, payroll idle
// deduction — editable from the admin panel without a restart or redeploy. One set per company.
//
// Not database-backed on every read: config.js's values were previously read once at process
// startup and never changed again, and every one of the ~20 call sites that reads them (see
// attendance.service, capture.service, the close-shifts/retention jobs, /api/config) is a hot
// path or a scheduled job, not a place that can casually `await` a settings table. So this
// keeps an in-memory cache per company, refreshed on a short TTL, and every call site keeps
// calling a synchronous getter exactly as it called config.shift.X before — only the source of
// that value changed, not how it's consumed.
//
// The authenticate middleware awaits ensure(companyId) once per request, so by the time any
// handler calls get(companyId) the company's settings are loaded and fresh. Callers that have
// no company in hand (a script, an old test) get the first company's settings.
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
const { uuid } = require('../utils/ids');
const logger = require('../utils/logger');
const { DEFAULT_COMPANY_ID } = require('./companies');

const TTL_MS = 30_000;

// A day with at least this much worked counts as a half / full day until HR changes it.
const DEFAULT_HALF_DAY_SECONDS = 4 * 3600;
const DEFAULT_FULL_DAY_SECONDS = 7 * 3600;

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
      halfDaySeconds: DEFAULT_HALF_DAY_SECONDS,
      fullDaySeconds: DEFAULT_FULL_DAY_SECONDS,
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
      halfDaySeconds: row.half_day_seconds ?? DEFAULT_HALF_DAY_SECONDS,
      fullDaySeconds: row.full_day_seconds ?? DEFAULT_FULL_DAY_SECONDS,
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
    half_day_seconds: s.shift.halfDaySeconds,
    full_day_seconds: s.shift.fullDaySeconds,
    retention_days: s.retention.days,
    payroll_deduct_idle: s.payroll.deductIdle,
  };
}

// companyId -> { settings, loadedAt, loading }
const entries = new Map();

function entryFor(companyId) {
  if (!entries.has(companyId)) entries.set(companyId, { settings: defaults(), loadedAt: 0, loading: null });
  return entries.get(companyId);
}

async function load(companyId) {
  const entry = entryFor(companyId);
  try {
    let row = await db()('settings').where({ company_id: companyId }).first();
    if (!row) {
      const now = Date.now();
      // First run for this company — seed from whatever .env/config.js already says, so nothing
      // changes behaviourally until an admin actually opens the Settings page and saves.
      await db()('settings')
        .insert({
          id: companyId === DEFAULT_COMPANY_ID ? 'default' : uuid(),
          company_id: companyId,
          ...settingsToRow(defaults()),
          created_at: now,
          updated_at: now,
          updated_by: null,
        })
        .onConflict('company_id')
        .ignore();
      row = await db()('settings').where({ company_id: companyId }).first();
    }
    entry.settings = rowToSettings(row);
    entry.loadedAt = Date.now();
  } catch (err) {
    // DB unreachable, or this deployment hasn't run the settings migration yet. Keep serving
    // the last good cache (or .env defaults, on a cold start) rather than failing every
    // request that happens to read a setting.
    logger.warn('Could not load settings from the database; using cached/default values', {
      companyId,
      message: err.message,
    });
  }
}

function ensureFresh(companyId) {
  const entry = entryFor(companyId);
  if (Date.now() - entry.loadedAt > TTL_MS && !entry.loading) {
    entry.loading = load(companyId).finally(() => {
      entry.loading = null;
    });
  }
  return entry;
}

/** Synchronous read — call sites that used to read config.shift.X etc. read this instead. */
function get(companyId = DEFAULT_COMPANY_ID) {
  return ensureFresh(companyId || DEFAULT_COMPANY_ID).settings;
}

/** Waits until a company's settings are loaded and fresh. Awaited once per request. */
async function ensure(companyId = DEFAULT_COMPANY_ID) {
  const id = companyId || DEFAULT_COMPANY_ID;
  const entry = entryFor(id);
  if (Date.now() - entry.loadedAt <= TTL_MS) return entry.settings;
  if (!entry.loading) {
    entry.loading = load(id).finally(() => {
      entry.loading = null;
    });
  }
  await entry.loading;
  return entry.settings;
}

/** Awaited once at startup by the long-lived host (server.js) so it never serves defaults. */
async function init() {
  await ensure(DEFAULT_COMPANY_ID);
}

/**
 * Applies a partial patch (any subset of the four groups) and persists it, for one company.
 * Callers are expected to have already validated the values (the admin route does this with
 * zod) — this layer only merges and writes, it does not re-validate ranges.
 */
async function update(patch, { updatedBy, companyId = DEFAULT_COMPANY_ID } = {}) {
  // Guarantee the row exists before UPDATE-ing it — the very first save of a fresh
  // deployment could otherwise race ahead of anything ever having called load().
  const entry = entryFor(companyId);
  if (!entry.loadedAt) await load(companyId);

  const current = entry.settings;
  const next = {
    capture: { ...current.capture, ...patch.capture },
    shift: { ...current.shift, ...patch.shift },
    retention: { ...current.retention, ...patch.retention },
    payroll: { ...current.payroll, ...patch.payroll },
  };

  const now = Date.now();
  await db()('settings')
    .where({ company_id: companyId })
    .update({ ...settingsToRow(next), updated_at: now, updated_by: updatedBy || null });

  entry.settings = next;
  entry.loadedAt = now;
  return entry.settings;
}

module.exports = { get, ensure, init, update };
