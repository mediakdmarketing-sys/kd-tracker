'use strict';

// Sprint 6.5 (ADR-0004) — deciding what time an event actually happened at.
//
// Once an agent queues work offline, timestamps arrive from the employee's machine rather
// than from the server clock. That is necessary — a punch-in replayed two hours late must not
// be recorded as two hours late — but it is also the one place a client can influence its own
// attendance record, so every claimed time passes through here.

const config = require('../config');
const { badRequest } = require('./errors');
const t = require('./time');

/** Parses an ISO timestamp, rejecting anything unusable. */
function parseInstant(value, field) {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) throw badRequest(`${field} is not a valid timestamp`);
  return ms;
}

/**
 * A claimed time may be a little ahead of the server (clocks drift), but not meaningfully:
 * a future timestamp is a broken clock or an attempt to extend a shift, and neither should
 * be written to the record.
 */
function rejectFuture(ms, field, now = t.now()) {
  const skewMs = config.offline.maxClockSkewSeconds * 1000;
  if (ms > now + skewMs) {
    throw badRequest(
      `${field} is ${Math.round((ms - now) / 1000)}s in the future. Check the clock on this device.`
    );
  }
}

/**
 * Time for a capture (screenshot, audio sample, activity ping).
 *
 * Backdating is expected here and has no effect on pay, so the window is generous — it only
 * has to be short enough that a capture is not already at the end of its retention life when
 * it arrives.
 */
function resolveCaptureTime(requested, field, now = t.now()) {
  if (!requested) return now;

  const ms = parseInstant(requested, field);
  rejectFuture(ms, field, now);

  const oldestAllowed = t.daysAgo(config.offline.maxCaptureAgeDays, now);
  if (ms < oldestAllowed) {
    throw badRequest(
      `${field} is older than the ${config.offline.maxCaptureAgeDays}-day upload window and was not stored.`
    );
  }

  return ms;
}

/**
 * Time for a punch event (punch in/out, break start/end).
 *
 * This one does affect pay, so the policy is deliberate: a queued event may be backdated up
 * to MAX_BACKDATE_HOURS, which covers a genuine network outage. Beyond that the server
 * records its own time and flags the shift, because a gap that long is not a blip and the
 * real answer needs a human.
 *
 * @param {number|undefined} floorMs  an instant the event cannot precede (e.g. punch-in for a punch-out)
 * @returns {{ at: number, backdated: boolean, capped: boolean, reason: string|null }}
 */
function resolvePunchTime({ requested, field = 'at', floorMs, now = t.now() }) {
  if (!requested) return { at: now, backdated: false, capped: false, reason: null };

  const ms = parseInstant(requested, field);
  rejectFuture(ms, field, now);

  if (floorMs !== undefined && ms < floorMs) {
    throw badRequest(`${field} is before the shift started.`);
  }

  const earliestAllowed = t.hoursAgo(config.offline.maxBackdateHours, now);
  if (ms < earliestAllowed) {
    return {
      at: now,
      backdated: true,
      capped: true,
      reason: `A queued punch event was dated ${t.formatDuration(
        Math.floor((now - ms) / 1000)
      )} ago, beyond the ${config.offline.maxBackdateHours}-hour limit. The server's own time was recorded instead and needs HR confirmation.`,
    };
  }

  return { at: ms, backdated: true, capped: false, reason: null };
}

module.exports = { parseInstant, rejectFuture, resolveCaptureTime, resolvePunchTime };
