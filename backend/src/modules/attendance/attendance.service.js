'use strict';

const config = require('../../config');
const { db, transaction, isUniqueViolation } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toBool, toIso } = require('../../utils/http');
const { resolvePunchTime } = require('../../utils/eventTime');
const { conflict, notFound, forbidden } = require('../../utils/errors');

/** The one shift an employee may have open at a time, or null. */
async function openShift(employeeId, trx = db()) {
  return trx('attendance')
    .where({ employee_id: employeeId })
    .whereIn('status', ['open', 'on_break'])
    .orderBy('punch_in', 'desc')
    .first();
}

async function runningBreak(attendanceId, trx = db()) {
  return trx('breaks').where({ attendance_id: attendanceId }).whereNull('break_end').first();
}

function shape(row, breaks = []) {
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    date: row.date,
    punchIn: toIso(row.punch_in),
    punchOut: toIso(row.punch_out),
    status: row.status,
    totalBreakSeconds: row.total_break_seconds,
    totalWorkedSeconds: row.total_worked_seconds,
    idleSeconds: row.idle_seconds,
    overBreak: toBool(row.over_break),
    autoClosed: toBool(row.auto_closed),
    needsReview: toBool(row.needs_review),
    reviewReason: row.review_reason,
    // 'live' | 'queued' | 'admin'. A queued shift was replayed by an agent that was offline
    // when the employee punched in; the gap to `punchInReceivedAt` is how late it arrived.
    source: row.source || 'live',
    punchInReceivedAt: toIso(row.punch_in_received_at),
    breaks: breaks.map((b) => ({
      id: b.id,
      start: toIso(b.break_start),
      end: toIso(b.break_end),
      durationSeconds: b.duration_seconds,
    })),
  };
}

/**
 * Idle time (story T-5): a gap between consecutive activity logs longer than the threshold,
 * excluding time the employee was on a recognised break.
 *
 * Computed rather than stored so that late-arriving activity logs from an agent that was
 * offline correct the number instead of baking in a wrong one.
 */
async function computeIdleSeconds(attendance, trx = db()) {
  const threshold = config.shift.idleThresholdSeconds;
  const start = Number(attendance.punch_in);
  const end = Number(attendance.punch_out) || t.now();

  const logs = await trx('activity_logs')
    .where({ employee_id: attendance.employee_id })
    .andWhere('timestamp', '>=', start)
    .andWhere('timestamp', '<=', end)
    .orderBy('timestamp', 'asc')
    .select('timestamp');

  const breaks = await trx('breaks').where({ attendance_id: attendance.id }).select('break_start', 'break_end');

  // Marks: punch-in, every activity ping, and the end of the shift.
  const marks = [start, ...logs.map((l) => Number(l.timestamp)), end];

  let idleMs = 0;
  for (let i = 1; i < marks.length; i += 1) {
    let gap = marks[i] - marks[i - 1];
    if (gap <= threshold * 1000) continue;

    // A break inside the gap is break time, not idle time — the employee told us they left.
    for (const b of breaks) {
      const bStart = Number(b.break_start);
      const bEnd = Number(b.break_end) || end;
      const overlap = Math.min(marks[i], bEnd) - Math.max(marks[i - 1], bStart);
      if (overlap > 0) gap -= overlap;
    }

    if (gap > threshold * 1000) idleMs += gap;
  }

  return Math.floor(idleMs / 1000);
}

/**
 * @param {number} [at]           authoritative instant, for internal callers and tests
 * @param {string} [requestedAt]  ISO time claimed by a client replaying a queued event
 */
async function punchIn({ employee, at, requestedAt }) {
  if (!employee.consentMonitoring) {
    throw forbidden(
      'Please review and accept the monitoring notice before starting a shift (POST /api/auth/consent).'
    );
  }

  const receivedAt = t.now();
  // `source` is derived here, never taken from the request: a client must not be able to
  // label its own punch as an HR correction.
  const queued = Boolean(requestedAt);
  const resolved = queued
    ? resolvePunchTime({ requested: requestedAt, field: 'at', now: receivedAt })
    : { at: at ?? receivedAt, capped: false, reason: null };

  const attemptInsert = async (trx) => {
    const existing = await openShift(employee.id, trx);
    if (existing) {
      // A queued replay of a punch-in we already recorded lands here. The 409 carries the
      // existing shift so the agent can drop the queued item instead of retrying forever.
      throw conflict('You already have an open shift. Punch out before starting a new one.', {
        attendanceId: existing.id,
        punchIn: toIso(existing.punch_in),
      });
    }

    const row = {
      id: uuid(),
      employee_id: employee.id,
      punch_in: resolved.at,
      punch_out: null,
      date: t.localDate(resolved.at, employee.timezone),
      total_break_seconds: 0,
      total_worked_seconds: null,
      idle_seconds: 0,
      status: 'open',
      over_break: false,
      auto_closed: false,
      needs_review: Boolean(resolved.reason),
      review_reason: resolved.reason,
      source: queued ? 'queued' : 'live',
      punch_in_received_at: receivedAt,
      created_at: receivedAt,
      updated_at: receivedAt,
    };
    await trx('attendance').insert(row);
    return shape(row);
  };

  try {
    return await transaction(attemptInsert);
  } catch (err) {
    // The check-then-insert above is not itself atomic — SQLite's transaction is deferred and
    // takes no write lock until the INSERT, so two requests landing close together (a
    // double-click, a client retry, the agent and the portal racing) can both pass the
    // openShift() check. The partial unique index on attendance(employee_id) WHERE
    // status IN ('open','on_break') is the actual guarantee; this turns its violation into
    // the same 409 the non-concurrent path already returns, instead of a raw 500.
    if (!isUniqueViolation(err)) throw err;
    const existing = await openShift(employee.id);
    throw conflict('You already have an open shift. Punch out before starting a new one.', {
      attendanceId: existing?.id,
      punchIn: existing ? toIso(existing.punch_in) : undefined,
    });
  }
}

async function punchOut({ employee, at, requestedAt }) {
  const shift = await openShift(employee.id);
  if (!shift) throw conflict('No open shift to punch out of.');

  const receivedAt = t.now();
  const resolved = requestedAt
    ? resolvePunchTime({
        requested: requestedAt,
        field: 'at',
        // A punch-out cannot predate the punch-in it closes.
        floorMs: Number(shift.punch_in),
        now: receivedAt,
      })
    : { at: at ?? receivedAt, capped: false, reason: null };

  // An employee who forgets to end a break should not lose that time; close it for them.
  const open = await runningBreak(shift.id);
  if (open) await endBreak({ employee, at: resolved.at, silent: true });

  const fresh = await db()('attendance').where({ id: shift.id }).first();
  const breakSeconds = fresh.total_break_seconds || 0;
  const grossSeconds = t.secondsBetween(Number(fresh.punch_in), resolved.at);
  const workedSeconds = Math.max(0, grossSeconds - breakSeconds);
  const overBreak = breakSeconds > config.shift.breakAllowanceSeconds;
  const idleSeconds = await computeIdleSeconds({ ...fresh, punch_out: resolved.at });

  // A shift can be flagged for more than one reason; keep them all rather than the last one.
  const reasons = [];
  if (overBreak) {
    reasons.push(
      `Break time ${t.formatDuration(breakSeconds)} exceeds the ${t.formatDuration(
        config.shift.breakAllowanceSeconds
      )} allowance`
    );
  }
  if (resolved.reason) reasons.push(resolved.reason);
  if (fresh.review_reason && !reasons.includes(fresh.review_reason)) reasons.push(fresh.review_reason);

  const patch = {
    punch_out: resolved.at,
    status: 'closed',
    total_break_seconds: breakSeconds,
    total_worked_seconds: workedSeconds,
    idle_seconds: idleSeconds,
    over_break: overBreak,
    needs_review: reasons.length > 0,
    review_reason: reasons.length ? reasons.join(' · ').slice(0, 255) : null,
    updated_at: receivedAt,
  };

  await db()('attendance').where({ id: shift.id }).update(patch);
  const breaks = await db()('breaks').where({ attendance_id: shift.id }).orderBy('break_start');
  return shape({ ...fresh, ...patch }, breaks);
}

async function startBreak({ employee, at, requestedAt }) {
  const shift = await openShift(employee.id);
  if (!shift) throw conflict('You must be punched in to start a break.');
  if (shift.status === 'on_break') throw conflict('You are already on a break.');

  const receivedAt = t.now();
  const resolved = requestedAt
    ? resolvePunchTime({
        requested: requestedAt,
        field: 'at',
        floorMs: Number(shift.punch_in),
        now: receivedAt,
      })
    : { at: at ?? receivedAt };

  await transaction(async (trx) => {
    await trx('breaks').insert({
      id: uuid(),
      attendance_id: shift.id,
      employee_id: employee.id,
      break_start: resolved.at,
      break_end: null,
      duration_seconds: null,
      created_at: receivedAt,
    });
    await trx('attendance')
      .where({ id: shift.id })
      .update({ status: 'on_break', updated_at: receivedAt });
  });

  const breaks = await db()('breaks').where({ attendance_id: shift.id }).orderBy('break_start');
  return shape({ ...shift, status: 'on_break' }, breaks);
}

async function endBreak({ employee, at, requestedAt, silent = false }) {
  const shift = await openShift(employee.id);
  if (!shift) throw conflict('You must be punched in to end a break.');

  const open = await runningBreak(shift.id);
  if (!open) {
    if (silent) return shape(shift);
    throw conflict('You are not currently on a break.');
  }

  const receivedAt = t.now();
  const resolved = requestedAt
    ? resolvePunchTime({
        requested: requestedAt,
        field: 'at',
        floorMs: Number(open.break_start),
        now: receivedAt,
      })
    : { at: at ?? receivedAt };

  const duration = t.secondsBetween(Number(open.break_start), resolved.at);

  let totalBreak = 0;
  await transaction(async (trx) => {
    await trx('breaks')
      .where({ id: open.id })
      .update({ break_end: resolved.at, duration_seconds: duration });

    // Recompute from the rows rather than incrementing: an auto-closed break or a corrected
    // row would otherwise drift the running total permanently.
    const [{ total }] = await trx('breaks')
      .where({ attendance_id: shift.id })
      .sum({ total: 'duration_seconds' });
    totalBreak = Number(total) || 0;

    await trx('attendance')
      .where({ id: shift.id })
      .update({
        status: 'open',
        total_break_seconds: totalBreak,
        over_break: totalBreak > config.shift.breakAllowanceSeconds,
        updated_at: receivedAt,
      });
  });

  // Build the response from known state — the transaction above has all the values we need,
  // so a post-transaction re-read of both tables is unnecessary.
  const updatedBreak = { ...open, break_end: resolved.at, duration_seconds: duration };
  const allBreaks = await db()('breaks').where({ attendance_id: shift.id }).orderBy('break_start');
  const attendancePatch = {
    status: 'open',
    total_break_seconds: totalBreak,
    over_break: totalBreak > config.shift.breakAllowanceSeconds,
    updated_at: receivedAt,
  };
  return shape({ ...shift, ...attendancePatch }, allBreaks);
}

/** What the tray UI and the portal header show: the employee's live state. */
async function currentStatus(employee) {
  const shift = await openShift(employee.id);
  if (!shift) {
    const last = await db()('attendance')
      .where({ employee_id: employee.id })
      .orderBy('punch_in', 'desc')
      .first();
    return {
      state: 'punched_out',
      shift: last ? shape(last) : null,
      canPunchIn: employee.consentMonitoring,
      consentRequired: !employee.consentMonitoring,
    };
  }

  const breaks = await db()('breaks').where({ attendance_id: shift.id }).orderBy('break_start');
  const elapsed = t.secondsBetween(Number(shift.punch_in), t.now());
  const breakSeconds = shift.total_break_seconds || 0;
  const openBreak = breaks.find((b) => !b.break_end);
  const liveBreakSeconds = openBreak
    ? breakSeconds + t.secondsBetween(Number(openBreak.break_start), t.now())
    : breakSeconds;

  return {
    state: shift.status === 'on_break' ? 'on_break' : 'working',
    shift: shape(shift, breaks),
    elapsedSeconds: elapsed,
    workedSeconds: Math.max(0, elapsed - liveBreakSeconds),
    breakSeconds: liveBreakSeconds,
    breakRemainingSeconds: Math.max(0, config.shift.breakAllowanceSeconds - liveBreakSeconds),
    // Sent explicitly: once the break is over the allowance, `breakRemainingSeconds` is 0 and
    // a client cannot work out what the allowance was.
    breakAllowanceSeconds: config.shift.breakAllowanceSeconds,
    overBreak: liveBreakSeconds > config.shift.breakAllowanceSeconds,
    shiftTargetSeconds: config.shift.targetSeconds,
    // The agent captures only while working, never on a break (spec 6.2 / 6.3).
    captureAllowed: shift.status === 'open',
    audioAllowed: shift.status === 'open' && employee.consentAudio,
  };
}

async function history({ employeeId, from, to, limit, offset }) {
  const base = db()('attendance').where({ employee_id: employeeId });
  if (from) base.andWhere('date', '>=', from);
  if (to) base.andWhere('date', '<=', to);

  const [{ count }] = await base.clone().clearOrder().count({ count: '*' });
  const rows = await base.clone().orderBy('punch_in', 'desc').limit(limit).offset(offset);

  const ids = rows.map((r) => r.id);
  const breaks = ids.length ? await db()('breaks').whereIn('attendance_id', ids).orderBy('break_start') : [];
  const byShift = breaks.reduce((acc, b) => {
    (acc[b.attendance_id] ||= []).push(b);
    return acc;
  }, {});

  return { rows: rows.map((r) => shape(r, byShift[r.id] || [])), total: Number(count) };
}

async function byId(attendanceId) {
  const row = await db()('attendance').where({ id: attendanceId }).first();
  if (!row) throw notFound('Attendance record not found');
  const breaks = await db()('breaks').where({ attendance_id: row.id }).orderBy('break_start');
  return shape(row, breaks);
}

module.exports = {
  punchIn,
  punchOut,
  startBreak,
  endBreak,
  currentStatus,
  history,
  byId,
  openShift,
  computeIdleSeconds,
  shape,
};
