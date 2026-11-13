'use strict';

// Leave requests (PTO). See the migration
// (backend/src/db/migrations/20260207000100_create_leave_requests.js) for the scope note —
// this is request-through-to-decision tracking only, no balances or payroll effect yet.

const config = require('../../config');
const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toIso, toBool } = require('../../utils/http');
const { conflict, notFound, badRequest, forbidden, payloadTooLarge } = require('../../utils/errors');
const { storage, buildKey, extensionFor } = require('../../storage');
const notifications = require('../../services/notifications');
const calendar = require('../../services/holidayCalendar');
const settings = require('../../services/settings');
const logger = require('../../utils/logger');

// Same set the storage layer knows an extension for, minus audio types a leave proof would
// never realistically be — a photo of a document, a scan, or a PDF.
const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Decodes a data-URL or bare base64 string, sized-checked before it's materialised — same
 * approach capture.service.js uses for screenshots/audio, kept local here since the two
 * modules don't otherwise share upload code. */
function decodeProofBase64(input) {
  const cleaned = String(input).replace(/^data:[^;]+;base64,/, '');
  const approxBytes = Math.floor((cleaned.length * 3) / 4);
  if (approxBytes > config.capture.maxUploadBytes) {
    throw payloadTooLarge(
      `Proof file exceeds the ${Math.round(config.capture.maxUploadBytes / 1024)} KB upload limit`
    );
  }
  const buffer = Buffer.from(cleaned, 'base64');
  if (buffer.length === 0) throw badRequest('Proof file is not valid base64 data');
  return buffer;
}

// Matches the company's actual leave request form — replaces the earlier sick/casual/unpaid
// placeholder set (see 20260916000100_leave_types_and_day_part.js). "Unpaid" isn't a type
// someone picks. Proof (PROOF_REQUIRED_TYPES) is so the reviewer can check the reason; it has no
// effect on pay. Whether leave is paid depends only on its type (payroll.paidLeaveTypes, which is
// Company Vacation by default), so the rest is no-pay leave with or without proof.
const TYPE_LABEL = {
  sick: 'Sick leave (Illness or Injury)',
  bereavement: 'Bereavement leave (Immediate Family)',
  personal: 'Personal leave',
  emergency: 'Emergency leave',
  vacation: 'Company Vacation (Paid)',
};
const PROOF_REQUIRED_TYPES = ['sick', 'bereavement', 'emergency'];

const DAY_PART_LABEL = { full: 'Full day', half_am: 'Half day (AM)', half_pm: 'Half day (PM)' };

const ROLE_LABEL = { admin: 'HR / Admin', leader: 'Team leader', user: 'Employee' };

function shape(row, employee, reviewer) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    employeeName: employee?.name,
    employeeDepartment: employee?.department,
    type: row.type,
    typeLabel: TYPE_LABEL[row.type] || row.type,
    proofRequired: PROOF_REQUIRED_TYPES.includes(row.type),
    dayPart: row.day_part,
    dayPartLabel: DAY_PART_LABEL[row.day_part] || row.day_part,
    hasProof: !!row.proof_key && !toBool(row.proof_deleted),
    proofFileName: row.proof_original_name,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    reviewedBy: row.reviewed_by,
    // Who made the decision, so a team leader can see that HR decided and the other way round.
    reviewedByName: reviewer?.name || null,
    reviewedByRole: reviewer ? ROLE_LABEL[reviewer.role] || reviewer.role : null,
    reviewedAt: toIso(row.reviewed_at),
    reviewNote: row.review_note,
    createdAt: toIso(row.created_at),
  };
}

/** Attaches employee name/department to a page of rows in one extra query, not N+1. */
async function withEmployees(rows) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => [r.employee_id, r.reviewed_by]).filter(Boolean))];
  const people = await db()('employees').whereIn('id', ids).select('id', 'name', 'department', 'role');
  const byId = Object.fromEntries(people.map((e) => [e.id, e]));
  const views = rows.map((r) => shape(r, byId[r.employee_id], byId[r.reviewed_by]));
  return annotateWithBalance(views, rows);
}

// --- Notifications ---------------------------------------------------------------------------
//
// Who hears about what:
//  - a new request or a cancellation: HR (admins) and, for a regular employee, the leaders of
//    their department. A leader's own request goes to HR only, because leaders never decide on
//    other leaders (see resolveLeaveMemberIds in leader.service.js).
//  - a decision: the employee, plus the *other* side of the review. If HR decided, the
//    department's leaders are told; if a leader decided, HR and the other leaders are told.
// All of it is best effort: a failure to notify never blocks the leave action itself.

function spanOf(row) {
  return row.start_date === row.end_date ? row.start_date : `${row.start_date} to ${row.end_date}`;
}

const reviewerAudience = notifications.reviewerAudience;

async function announceRequest(row, kind) {
  try {
    const employee = await db()('employees').where({ id: row.employee_id }).first();
    if (!employee) return;
    const { admins, leaders } = await reviewerAudience(employee, [employee.id]);
    const label = TYPE_LABEL[row.type] || row.type;
    const cancelled = kind === 'cancelled';
    const note = {
      type: cancelled ? 'leave_cancelled' : 'leave_requested',
      title: cancelled ? 'Leave request cancelled' : 'New leave request',
      body: cancelled
        ? `${employee.name} cancelled their ${label} request for ${spanOf(row)}.`
        : `${employee.name} requested ${label} for ${spanOf(row)}.`,
      refId: row.id,
    };
    await notifications.notify(admins, { ...note, link: '/admin/leave' });
    await notifications.notify(leaders, { ...note, link: '/leader/leave' });
  } catch (err) {
    logger.error('Leave notification failed', { message: err.message });
  }
}

async function announceDecision(row, reviewerId) {
  try {
    const [employee, reviewer] = await Promise.all([
      db()('employees').where({ id: row.employee_id }).first(),
      db()('employees').where({ id: reviewerId }).first(),
    ]);
    if (!employee || !reviewer) return;
    const verdict = row.status === 'approved' ? 'approved' : 'rejected';
    const by = `${reviewer.name} (${ROLE_LABEL[reviewer.role] || reviewer.role})`;
    const label = TYPE_LABEL[row.type] || row.type;

    // The employee always hears the outcome.
    await notifications.notify([employee.id], {
      type: `leave_${verdict}`,
      title: `Leave ${verdict}`,
      body: `${by} ${verdict} your ${label} request for ${spanOf(row)}.${row.review_note ? ` Note: ${row.review_note}` : ''}`,
      link: '/me/leave',
      refId: row.id,
    });

    // The other side of the review hears it too, so nobody decides twice or wonders.
    const { admins, leaders } = await reviewerAudience(employee, [employee.id, reviewer.id]);
    const note = {
      type: `leave_${verdict}_by_reviewer`,
      title: `Leave ${verdict} by ${reviewer.role === 'admin' ? 'HR' : 'the team leader'}`,
      body: `${by} ${verdict} ${employee.name}'s ${label} request for ${spanOf(row)}.`,
      refId: row.id,
    };
    await notifications.notify(admins, { ...note, link: '/admin/leave' });
    await notifications.notify(leaders, { ...note, link: '/leader/leave' });
  } catch (err) {
    logger.error('Leave notification failed', { message: err.message });
  }
}

async function createRequest({
  employeeId, type, startDate, endDate, dayPart, reason,
  proofBase64, proofContentType, proofFileName,
}) {
  if (endDate < startDate) throw badRequest('End date must not be before the start date');
  if (dayPart !== 'full' && startDate !== endDate) {
    throw badRequest('A half day request must have the same start and end date');
  }
  if (proofBase64 && !ALLOWED_PROOF_TYPES.includes(proofContentType)) {
    throw badRequest(`proofContentType must be one of: ${ALLOWED_PROOF_TYPES.join(', ')}`);
  }

  const nowMs = t.now();
  const id = uuid();
  const row = {
    id,
    employee_id: employeeId,
    type,
    start_date: startDate,
    end_date: endDate,
    day_part: dayPart || 'full',
    reason: reason || null,
    status: 'pending',
    created_at: nowMs,
    updated_at: nowMs,
  };

  if (proofBase64) {
    const buffer = decodeProofBase64(proofBase64);
    const key = buildKey({
      type: 'leave-proof',
      employeeId,
      date: startDate,
      id,
      extension: extensionFor(proofContentType, 'bin'),
    });
    await storage().put(key, buffer, proofContentType);
    row.proof_key = key;
    row.proof_content_type = proofContentType;
    row.proof_size_bytes = buffer.length;
    row.proof_original_name = proofFileName ? String(proofFileName).slice(0, 200) : null;
  }

  await db()('leave_requests').insert(row);
  await announceRequest(row, 'requested');
  return shape(row);
}

async function listForEmployee(employeeId, { status } = {}) {
  const base = db()('leave_requests').where({ employee_id: employeeId });
  if (status) base.andWhere({ status });
  const rows = await base.orderBy('start_date', 'desc');
  return withEmployees(rows);
}

/**
 * Requests visible to an admin (memberIds === null) or a leader (scoped to memberIds, from
 * resolveMemberIds — see leader.service.js). Optionally filtered to just the pending queue.
 */
async function listForReviewer({ memberIds, status, from, to }) {
  const base = db()('leave_requests');
  if (memberIds !== null) {
    if (!memberIds.length) return [];
    base.whereIn('employee_id', memberIds);
  }
  if (status) base.andWhere({ status });
  if (from) base.andWhere('end_date', '>=', from);
  if (to) base.andWhere('start_date', '<=', to);
  const rows = await base.orderBy('created_at', 'desc');
  return withEmployees(rows);
}

async function cancelRequest(id, employeeId) {
  const row = await db()('leave_requests').where({ id }).first();
  if (!row) throw notFound('Leave request not found');
  if (row.employee_id !== employeeId) throw forbidden('Not your leave request');
  if (row.status !== 'pending') throw conflict('Only a pending request can be cancelled');

  await db()('leave_requests').where({ id }).update({ status: 'cancelled', updated_at: t.now() });
  await announceRequest({ ...row, status: 'cancelled' }, 'cancelled');
  return shape({ ...row, status: 'cancelled' });
}

/**
 * Approves or rejects a request. `memberIds` (from resolveMemberIds) scopes what a leader may
 * decide on — null for an admin, an explicit id list for a leader; the caller (the route) is
 * responsible for having resolved that list from the reviewer's own managed departments.
 */
async function review(id, { status, reviewedBy, reviewNote, memberIds }) {
  const row = await db()('leave_requests').where({ id }).first();
  if (!row) throw notFound('Leave request not found');
  if (row.status !== 'pending') throw conflict('This request has already been decided');
  // Nobody decides their own leave. An admin's request goes to another admin (it is announced to
  // the other admins when it is made); a leader's goes to HR, as leaders never decide on leaders.
  if (row.employee_id === reviewedBy) {
    throw forbidden('You cannot approve or reject your own leave request. Another admin has to decide it.');
  }
  if (memberIds !== null && !memberIds.includes(row.employee_id)) {
    throw forbidden('This employee is outside the departments you manage');
  }

  const patch = {
    status,
    reviewed_by: reviewedBy,
    reviewed_at: t.now(),
    review_note: reviewNote || null,
    updated_at: t.now(),
  };
  await db()('leave_requests').where({ id }).update(patch);
  const decided = { ...row, ...patch };
  await announceDecision(decided, reviewedBy);
  const reviewer = await db()('employees').where({ id: reviewedBy }).select('id', 'name', 'role').first();
  return shape(decided, undefined, reviewer);
}

/**
 * Streams a request's proof file. Three ways in, checked in order:
 *  - isAdmin: unrestricted.
 *  - requesterId matches the request's own employee: always allowed, from any route.
 *  - memberIds (a leader's resolveLeaveMemberIds) includes the request's employee.
 * The employee-facing route passes neither isAdmin nor memberIds — self-ownership is the
 * only thing that can let it through, same as cancelRequest().
 */
async function getProof(id, { requesterId, isAdmin = false, memberIds = [] } = {}) {
  const row = await db()('leave_requests').where({ id }).first();
  if (!row) throw notFound('Leave request not found');

  const isOwner = row.employee_id === requesterId;
  const inScope = memberIds.includes(row.employee_id);
  if (!isAdmin && !isOwner && !inScope) {
    throw forbidden('You are not allowed to view this file');
  }

  if (!row.proof_key || toBool(row.proof_deleted)) {
    throw notFound('No proof file was attached to this request');
  }

  const buffer = await storage().get(row.proof_key);
  return { buffer, contentType: row.proof_content_type || 'application/octet-stream', row };
}

/** The approved leave covering this one date, or null — what the Live Board checks. */
async function approvedLeaveOn(employeeId, date) {
  return db()('leave_requests')
    .where({ employee_id: employeeId, status: 'approved' })
    .andWhere('start_date', '<=', date)
    .andWhere('end_date', '>=', date)
    .first();
}

/**
 * Bulk version of approvedLeaveOn for a dashboard listing several employees at once, each
 * possibly on a different calendar date (different timezones) — one query instead of N, then
 * matched up in memory the same way admin.service.js already groups attendance/activity rows.
 * Returns a Map of employeeId -> the covering row (only one can be approved+overlapping at a
 * time in practice), or no entry if that employee isn't on leave on their date.
 */
async function approvedLeaveByEmployeeForDates(employeeDatePairs) {
  if (!employeeDatePairs.length) return new Map();
  const employeeIds = [...new Set(employeeDatePairs.map((p) => p.employeeId))];
  const dateValues = employeeDatePairs.map((p) => p.date);
  const minDate = dateValues.reduce((a, b) => (a < b ? a : b));
  const maxDate = dateValues.reduce((a, b) => (a > b ? a : b));

  const rows = await db()('leave_requests')
    .whereIn('employee_id', employeeIds)
    .andWhere({ status: 'approved' })
    .andWhere('start_date', '<=', maxDate)
    .andWhere('end_date', '>=', minDate);

  const result = new Map();
  for (const { employeeId, date } of employeeDatePairs) {
    const match = rows.find(
      (r) => r.employee_id === employeeId && r.start_date <= date && r.end_date >= date
    );
    if (match) result.set(employeeId, match);
  }
  return result;
}

/**
 * Approved leave days per employee overlapping a report's date range — clamped to the range
 * so a request that started before `from` or ends after `to` doesn't over-count. A half day
 * (day_part half_am/half_pm) contributes 0.5 rather than a full day — createRequest() only
 * ever allows those on a single date, so there's no multi-day span to partially clamp.
 */
async function approvedDaysInRange({ employeeIds, from, to }) {
  if (!employeeIds.length) return {};
  const rows = await db()('leave_requests')
    .whereIn('employee_id', employeeIds)
    .andWhere({ status: 'approved' })
    .andWhere('start_date', '<=', to)
    .andWhere('end_date', '>=', from)
    .select('employee_id', 'start_date', 'end_date', 'day_part');

  const days = {};
  for (const r of rows) {
    if (r.day_part !== 'full') {
      days[r.employee_id] = (days[r.employee_id] || 0) + 0.5;
      continue;
    }
    const start = r.start_date < from ? from : r.start_date;
    const end = r.end_date > to ? to : r.end_date;
    const count = Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1;
    days[r.employee_id] = (days[r.employee_id] || 0) + count;
  }
  return days;
}

// --- Balances ----------------------------------------------------------------------------------
//
// HR sets a yearly allowance per leave type (Settings). A request's days are its working days: not
// Sundays, company holidays or the days the company does not work (payroll work days), and a half
// day is 0.5. The year is the calendar year. A type with no allowance set has no balance, only a
// count of days taken. A balance never blocks a request: leave over the allowance is simply shown
// to the reviewer as over.

/** Working days a request covers inside [from, to] (the part inside the year when it spans two). */
function requestDays(row, from, to, holidays, workDays) {
  const start = row.start_date < from ? from : row.start_date;
  const end = row.end_date > to ? to : row.end_date;
  let days = 0;
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const date = d.toISOString().slice(0, 10);
    if (!workDays.includes(d.getUTCDay()) || holidays.has(date)) continue;
    days += row.day_part === 'full' ? 1 : 0.5;
  }
  return days;
}

async function loadCalendar(year) {
  const holidays = new Set((await calendar.holidaysBetween(`${year}-01-01`, `${year}-12-31`)).map((h) => h.date));
  return { holidays, workDays: settings.get().payroll.workDays };
}

/** Days approved and days waiting, per type, for one person in one calendar year. */
async function usedInYear(employeeId, year, calendarInfo) {
  const { holidays, workDays } = calendarInfo || (await loadCalendar(year));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = await db()('leave_requests')
    .where({ employee_id: employeeId })
    .whereIn('status', ['approved', 'pending'])
    .andWhere('start_date', '<=', to)
    .andWhere('end_date', '>=', from);
  const used = {};
  for (const r of rows) {
    const bucket = (used[r.type] = used[r.type] || { approved: 0, pending: 0 });
    bucket[r.status] += requestDays(r, from, to, holidays, workDays);
  }
  return used;
}

/** One person's balance for every leave type, for the My leave page. */
async function balanceFor(employeeId, year = Number(t.localDate().slice(0, 4))) {
  const used = await usedInYear(employeeId, year);
  const allowances = settings.get().leave.allowances;
  return {
    year,
    balances: Object.keys(TYPE_LABEL).map((type) => {
      const allowance = allowances[type] ?? null;
      const approved = used[type]?.approved || 0;
      const pending = used[type]?.pending || 0;
      return {
        type,
        label: TYPE_LABEL[type],
        allowance,
        used: approved,
        pending,
        left: allowance === null ? null : allowance - approved - pending,
      };
    }),
  };
}

/**
 * For the reviewer's list: the days each waiting request asks for, and what would be left of the
 * allowance if it were approved (negative means over). Null when that type has no allowance set.
 */
async function annotateWithBalance(views, rows) {
  const allowances = settings.get().leave.allowances;
  const calendars = new Map();
  const usedCache = new Map();
  for (let i = 0; i < views.length; i += 1) {
    const row = rows[i];
    const year = Number(row.start_date.slice(0, 4));
    if (!calendars.has(year)) calendars.set(year, await loadCalendar(year));
    const info = calendars.get(year);
    views[i].days = requestDays(row, `${year}-01-01`, `${year}-12-31`, info.holidays, info.workDays);

    const allowance = allowances[row.type] ?? null;
    if (row.status !== 'pending' || allowance === null) {
      views[i].balance = null;
      continue;
    }
    const key = `${row.employee_id}|${year}`;
    if (!usedCache.has(key)) usedCache.set(key, await usedInYear(row.employee_id, year, info));
    const approved = usedCache.get(key)[row.type]?.approved || 0;
    views[i].balance = { allowance, used: approved, leftIfApproved: allowance - approved - views[i].days };
  }
  return views;
}

module.exports = {
  balanceFor,
  createRequest,
  listForEmployee,
  listForReviewer,
  cancelRequest,
  review,
  getProof,
  approvedLeaveOn,
  approvedLeaveByEmployeeForDates,
  approvedDaysInRange,
  TYPE_LABEL,
  ALLOWED_PROOF_TYPES,
};
