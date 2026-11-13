'use strict';

// Time corrections. An employee who forgot to punch out (or in) asks for the right times; HR
// decides. The times are given as a date plus HH:MM in company time, the clock the portal shows.
//
// Rules, because this changes the hours people are paid for:
//   - only the last CORRECTION_WINDOW_DAYS days, only the past, never an overlap with another shift
//   - a reason is required, and the original times are kept on the request
//   - nobody decides their own request; HR (admin) decides
//   - a finalized payroll month is frozen, so a correction cannot be made or approved in it
//   - the corrected shift is marked (`corrected`) and its review flag is cleared with a note

const { db, transaction } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const config = require('../../config');
const logger = require('../../utils/logger');
const { toIso } = require('../../utils/http');
const { badRequest, conflict, forbidden, notFound } = require('../../utils/errors');
const notifications = require('../../services/notifications');
const settings = require('../../services/settings');
const lock = require('../payroll/payrollLock');
const attendanceService = require('../attendance/attendance.service');

const CORRECTION_WINDOW_DAYS = 14;
const MAX_SHIFT_MS = 20 * 3600 * 1000;
const CLOCK_SKEW_MS = 2 * 60 * 1000;

/** The instant (ms) at which `date` HH:MM is on the wall clock of `timezone`. */
function zonedToMs(date, hhmm, timezone = config.timezone) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offsetAt = (ms) => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms;
  };
  // Two passes settle the offset even next to a clock change.
  const first = guess - offsetAt(guess);
  return guess - offsetAt(first);
}

function shape(row, people = {}) {
  const person = people[row.employee_id];
  const reviewer = row.reviewed_by ? people[row.reviewed_by] : null;
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: person?.name || null,
    department: person?.department || null,
    attendanceId: row.attendance_id,
    kind: row.attendance_id ? 'change' : 'add',
    date: row.date,
    original: row.attendance_id
      ? { punchIn: toIso(Number(row.original_punch_in)), punchOut: row.original_punch_out ? toIso(Number(row.original_punch_out)) : null }
      : null,
    requested: { punchIn: toIso(Number(row.requested_punch_in)), punchOut: toIso(Number(row.requested_punch_out)) },
    requestedSeconds: Math.round((Number(row.requested_punch_out) - Number(row.requested_punch_in)) / 1000),
    reason: row.reason,
    status: row.status,
    reviewedBy: reviewer?.name || null,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at ? toIso(Number(row.reviewed_at)) : null,
    createdAt: toIso(Number(row.created_at)),
  };
}

async function peopleFor(rows) {
  const ids = [...new Set(rows.flatMap((r) => [r.employee_id, r.reviewed_by]).filter(Boolean))];
  if (!ids.length) return {};
  const people = await db()('employees').whereIn('id', ids).select('id', 'name', 'department');
  return Object.fromEntries(people.map((p) => [p.id, p]));
}

/** Another shift of this person that the given window would run into (the shift being changed is ignored). */
async function overlappingShift(employeeId, inMs, outMs, exceptId) {
  const q = db()('attendance')
    .where({ employee_id: employeeId })
    .andWhere('punch_in', '<', outMs)
    .andWhere((b) => b.whereNull('punch_out').orWhere('punch_out', '>', inMs));
  if (exceptId) q.andWhereNot({ id: exceptId });
  return q.first();
}

async function announceRequest(row, employee) {
  try {
    const admins = (await notifications.adminIds()).filter((id) => id !== employee.id);
    await notifications.notify(admins, {
      type: 'time_correction_request',
      title: `Time correction: ${employee.name}`,
      body: `${employee.name} asked to ${row.attendance_id ? 'change' : 'add'} a shift on ${row.date}. Reason: ${row.reason}`,
      link: '/admin/corrections',
      refId: row.id,
    });
  } catch (err) {
    logger.error('Time correction notification failed', { message: err.message });
  }
}

async function createRequest({ employee, attendanceId, date, punchIn, punchOut, reason }) {
  const why = String(reason || '').trim();
  if (why.length < 5) throw badRequest('Please say why the times need changing (at least a few words).');

  let shift = null;
  if (attendanceId) {
    shift = await db()('attendance').where({ id: attendanceId, employee_id: employee.id }).first();
    if (!shift) throw notFound('Shift not found');
    if (shift.status !== 'closed') throw conflict('Only a finished shift can be corrected. Punch out first.');
  }
  const day = shift ? shift.date : date;
  if (!day) throw badRequest('Choose the date of the shift.');

  const today = t.localDate();
  if (day > today) throw badRequest('That date has not happened yet.');
  if (day < t.localDate(t.now() - CORRECTION_WINDOW_DAYS * t.DAY_MS)) {
    throw badRequest(`Only the last ${CORRECTION_WINDOW_DAYS} days can be corrected. Ask HR for older ones.`);
  }
  await lock.assertOpen(day.slice(0, 7), 'ask for a correction in it');

  const inMs = zonedToMs(day, punchIn);
  let outMs = zonedToMs(day, punchOut);
  if (outMs <= inMs) outMs += t.DAY_MS; // a shift that ends after midnight
  if (outMs > t.now() + CLOCK_SKEW_MS) throw badRequest('The punch-out time is in the future.');
  if (outMs - inMs > MAX_SHIFT_MS) throw badRequest('A shift cannot be longer than 20 hours.');
  if (outMs - inMs < 60 * 1000) throw badRequest('The punch-out must be after the punch-in.');

  if (await overlappingShift(employee.id, inMs, outMs, shift?.id)) {
    throw conflict('Those times overlap another shift of yours. Check the date and times.');
  }
  const pending = await db()('time_corrections')
    .where({ employee_id: employee.id, status: 'pending' })
    .andWhere((b) => (shift ? b.where({ attendance_id: shift.id }) : b.whereNull('attendance_id').andWhere({ date: day })))
    .first();
  if (pending) throw conflict('You already have a pending request for this shift. Cancel it first to send a new one.');

  const now = t.now();
  const row = {
    id: uuid(),
    employee_id: employee.id,
    attendance_id: shift?.id || null,
    date: day,
    original_punch_in: shift ? Number(shift.punch_in) : null,
    original_punch_out: shift?.punch_out ? Number(shift.punch_out) : null,
    requested_punch_in: inMs,
    requested_punch_out: outMs,
    reason: why.slice(0, 500),
    status: 'pending',
    created_at: now,
    updated_at: now,
  };
  await db()('time_corrections').insert(row);
  await announceRequest(row, employee);
  return shape(row, { [employee.id]: employee });
}

async function listForEmployee(employeeId) {
  const rows = await db()('time_corrections').where({ employee_id: employeeId }).orderBy('created_at', 'desc').limit(100);
  const people = await peopleFor(rows);
  return rows.map((r) => shape(r, people));
}

async function cancelRequest(id, employeeId) {
  const row = await db()('time_corrections').where({ id }).first();
  if (!row) throw notFound('Request not found');
  if (row.employee_id !== employeeId) throw forbidden('Not your request');
  if (row.status !== 'pending') throw conflict('Only a pending request can be cancelled');
  await db()('time_corrections').where({ id }).update({ status: 'cancelled', updated_at: t.now() });
  return shape({ ...row, status: 'cancelled' }, await peopleFor([row]));
}

/** HR's list. status 'all' shows every one; the default is what is waiting. */
async function listForReview({ status = 'pending' } = {}) {
  const query = db()('time_corrections').orderBy('created_at', status === 'pending' ? 'asc' : 'desc').limit(200);
  if (status !== 'all') query.where({ status });
  const rows = await query;
  const people = await peopleFor(rows);
  return rows.map((r) => shape(r, people));
}

/** Writes the approved times into attendance, in one transaction. */
async function applyApproved(row) {
  const inMs = Number(row.requested_punch_in);
  const outMs = Number(row.requested_punch_out);
  await lock.assertOpen(row.date.slice(0, 7), 'approve a correction in it');
  if (await overlappingShift(row.employee_id, inMs, outMs, row.attendance_id)) {
    throw conflict('The requested times now overlap another shift. Reject this request and ask the employee to send it again.');
  }

  const now = t.now();
  const allowance = settings.get().shift.breakAllowanceSeconds;
  // The original times stay on the request itself; this just tells anyone reading the shift.
  const note = row.attendance_id ? 'Times corrected by HR at the employee’s request' : 'Shift added by HR at the employee’s request';

  await transaction(async (trx) => {
    if (row.attendance_id) {
      const shift = await trx('attendance').where({ id: row.attendance_id }).first();
      if (!shift) throw notFound('The shift no longer exists');
      const breakSeconds = shift.total_break_seconds || 0;
      const worked = Math.max(0, t.secondsBetween(inMs, outMs) - breakSeconds);
      const idle = await attendanceService.computeIdleSeconds({ ...shift, punch_in: inMs, punch_out: outMs }, trx);
      await trx('attendance').where({ id: shift.id }).update({
        punch_in: inMs,
        punch_out: outMs,
        date: row.date,
        status: 'closed',
        total_worked_seconds: worked,
        idle_seconds: idle,
        over_break: breakSeconds > allowance,
        auto_closed: false,
        needs_review: false,
        review_reason: note.slice(0, 255),
        corrected: true,
        updated_at: now,
      });
    } else {
      await trx('attendance').insert({
        id: uuid(),
        employee_id: row.employee_id,
        punch_in: inMs,
        punch_out: outMs,
        date: row.date,
        total_break_seconds: 0,
        total_worked_seconds: t.secondsBetween(inMs, outMs),
        idle_seconds: 0,
        status: 'closed',
        over_break: false,
        auto_closed: false,
        needs_review: false,
        review_reason: note.slice(0, 255),
        corrected: true,
        source: 'correction',
        created_at: now,
        updated_at: now,
      });
    }
  });
}

/** @param {{status:'approved'|'rejected', reviewedBy:string, note?:string}} decision */
async function review(id, { status, reviewedBy, note }) {
  const row = await db()('time_corrections').where({ id }).first();
  if (!row) throw notFound('Request not found');
  if (row.employee_id === reviewedBy) {
    throw forbidden('You cannot approve or reject your own correction. Another admin has to decide it.');
  }
  if (row.status !== 'pending') throw conflict(`This request was already ${row.status}.`);
  const why = String(note || '').trim();
  if (status === 'rejected' && why.length < 3) throw badRequest('Please give a short reason for rejecting.');

  if (status === 'approved') await applyApproved(row);

  const now = t.now();
  await db()('time_corrections').where({ id }).update({
    status,
    reviewed_by: reviewedBy,
    review_note: why ? why.slice(0, 500) : null,
    reviewed_at: now,
    updated_at: now,
  });

  try {
    await notifications.notify([row.employee_id], {
      type: `time_correction_${status}`,
      title: `Time correction ${status}`,
      body: status === 'approved'
        ? `Your times for ${row.date} were changed.${why ? ` Note: ${why}` : ''}`
        : `Your request for ${row.date} was rejected. ${why}`,
      link: '/me/corrections',
      refId: row.id,
    });
  } catch (err) {
    logger.error('Time correction notification failed', { message: err.message });
  }

  const fresh = await db()('time_corrections').where({ id }).first();
  return { row: fresh, view: shape(fresh, await peopleFor([fresh])) };
}

module.exports = { createRequest, listForEmployee, cancelRequest, listForReview, review, zonedToMs, CORRECTION_WINDOW_DAYS };
