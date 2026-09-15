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
// someone picks anymore: PROOF_REQUIRED_TYPES leave taken without proof just gets treated as
// no-pay after the fact (a review-time decision, not something captured at request time).
const TYPE_LABEL = {
  sick: 'Sick leave (Illness or Injury)',
  bereavement: 'Bereavement leave (Immediate Family)',
  personal: 'Personal leave',
  emergency: 'Emergency leave',
  vacation: 'Company Vacation (Paid)',
};
const PROOF_REQUIRED_TYPES = ['sick', 'bereavement', 'emergency'];

const DAY_PART_LABEL = { full: 'Full day', half_am: 'Half day (AM)', half_pm: 'Half day (PM)' };

function shape(row, employee) {
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
    reviewedAt: toIso(row.reviewed_at),
    reviewNote: row.review_note,
    createdAt: toIso(row.created_at),
  };
}

/** Attaches employee name/department to a page of rows in one extra query, not N+1. */
async function withEmployees(rows) {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.employee_id))];
  const employees = await db()('employees').whereIn('id', ids).select('id', 'name', 'department');
  const byId = Object.fromEntries(employees.map((e) => [e.id, e]));
  return rows.map((r) => shape(r, byId[r.employee_id]));
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
  return shape({ ...row, ...patch });
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

module.exports = {
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
