'use strict';

// All timestamps in this system are epoch milliseconds (ADR-0001). All calendar dates are
// "YYYY-MM-DD" strings in the *employee's* timezone, never the server's.

const DAY_MS = 24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

/**
 * Calendar date for an instant, in the given IANA timezone.
 * en-CA formats as YYYY-MM-DD, which is exactly the shape we store.
 */
function localDate(ms = Date.now(), timezone = 'Asia/Kolkata') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    // An invalid zone on one employee record must not break attendance for everyone.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  }
}

/** "2026-08-14" -> "2026-08" */
function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

/** First and last calendar date of a "YYYY-MM" month, inclusive. */
function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last of this
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, '0')}` };
}

/** The "YYYY-MM" preceding the given month (or the current one). */
function previousMonth(month) {
  const base = month || new Date().toISOString().slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function daysAgo(days, from = Date.now()) {
  return from - days * DAY_MS;
}

function hoursAgo(hours, from = Date.now()) {
  return from - hours * 60 * 60 * 1000;
}

/** Seconds between two epoch-ms instants, floored, never negative. */
function secondsBetween(startMs, endMs) {
  return Math.max(0, Math.floor((endMs - startMs) / 1000));
}

function secondsToHours(seconds) {
  return Math.round((seconds / 3600) * 100) / 100;
}

/** Human-readable "7h 45m" or "37s", for CSV exports and dashboards. */
function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-\d{2}$/;

function isDateString(value) {
  return typeof value === 'string' && ISO_DATE.test(value);
}

function isMonthString(value) {
  return typeof value === 'string' && ISO_MONTH.test(value);
}

module.exports = {
  DAY_MS,
  now,
  localDate,
  monthOf,
  monthBounds,
  previousMonth,
  daysAgo,
  hoursAgo,
  secondsBetween,
  secondsToHours,
  formatDuration,
  isDateString,
  isMonthString,
};
