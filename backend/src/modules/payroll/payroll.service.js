'use strict';

const config = require('../../config');
const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toBool, toIso } = require('../../utils/http');
const { badRequest, notImplemented } = require('../../utils/errors');

/**
 * Story P-1 — aggregate a month into `payroll_summary`.
 *
 * Idempotent: re-running a month overwrites its rows rather than adding to them, so a failed
 * or partial run can simply be repeated. Only *closed* shifts count — an open shift has no
 * final worked total and would otherwise be paid as zero.
 *
 * Open question for the PO (backlog): idle seconds are reported but not deducted from pay.
 */
async function generate({ month }) {
  if (!t.isMonthString(month)) throw badRequest('month must be YYYY-MM');

  const { start, end } = t.monthBounds(month);
  const generatedOn = t.now();

  const aggregates = await db()('attendance')
    .whereBetween('date', [start, end])
    .andWhere({ status: 'closed' })
    .groupBy('employee_id')
    .select('employee_id')
    .sum({ worked: 'total_worked_seconds' })
    .sum({ breaks: 'total_break_seconds' })
    .sum({ idle: 'idle_seconds' })
    .count({ days: 'id' });

  // Boolean SUM is not portable, so flagged days are counted with a second query (ADR-0001).
  const flagged = await db()('attendance')
    .whereBetween('date', [start, end])
    .andWhere({ status: 'closed' })
    .andWhere((b) => b.where('needs_review', true).orWhere('over_break', true))
    .groupBy('employee_id')
    .select('employee_id')
    .count({ c: '*' });
  const flaggedBy = Object.fromEntries(flagged.map((f) => [f.employee_id, Number(f.c)]));

  // Build all records in memory first — no DB round-trips yet.
  // When PAYROLL_DEDUCT_IDLE=true, idle time is subtracted from billable hours.
  // The raw worked_seconds and idle_seconds are always stored so HR can audit the
  // deduction or regenerate with a different setting later.
  const records = aggregates.map((row) => {
    const workedSeconds = Number(row.worked) || 0;
    const idleSeconds   = Number(row.idle)   || 0;
    const billableSeconds = config.payroll.deductIdle
      ? Math.max(0, workedSeconds - idleSeconds)
      : workedSeconds;
    return {
      id: uuid(),
      employee_id: row.employee_id,
      month,
      total_hours: t.secondsToHours(billableSeconds),
      total_worked_seconds: workedSeconds,
      total_break_seconds: Number(row.breaks) || 0,
      total_idle_seconds: idleSeconds,
      idle_deducted: config.payroll.deductIdle,
      days_present: Number(row.days) || 0,
      days_flagged: flaggedBy[row.employee_id] || 0,
      generated_on: generatedOn,
    };
  });

  // Single bulk upsert: one INSERT for all employees, ON CONFLICT updates the existing row.
  // Replaces the old per-row SELECT + INSERT/UPDATE loop (was N*2 round-trips; now 1).
  // Regenerating resets synced_to_payroll: numbers that changed have not been sent anywhere.
  if (records.length) {
    await db()('payroll_summary')
      .insert(records.map((r) => ({ ...r, synced_to_payroll: false })))
      .onConflict(['employee_id', 'month'])
      .merge({
        total_hours:          db().raw('excluded.total_hours'),
        total_worked_seconds: db().raw('excluded.total_worked_seconds'),
        total_break_seconds:  db().raw('excluded.total_break_seconds'),
        total_idle_seconds:   db().raw('excluded.total_idle_seconds'),
        idle_deducted:        db().raw('excluded.idle_deducted'),
        days_present:         db().raw('excluded.days_present'),
        days_flagged:         db().raw('excluded.days_flagged'),
        generated_on:         db().raw('excluded.generated_on'),
        synced_to_payroll:    false,
        synced_at:            null,
      });
  }

  // Re-read the ids for rows that already existed (ON CONFLICT reuses the original id).
  const saved = records.length
    ? await db()('payroll_summary')
        .where({ month })
        .whereIn('employee_id', records.map((r) => r.employee_id))
        .select('id', 'employee_id')
    : [];
  const idByEmployee = Object.fromEntries(saved.map((r) => [r.employee_id, r.id]));
  const results = records.map((r) => ({ ...r, id: idByEmployee[r.employee_id] ?? r.id }));

  // Warn about employees who have open (not yet closed) shifts in this month — their worked
  // time is incomplete and they will appear with zero hours until those shifts are closed.
  const openShifts = await db()('attendance')
    .whereBetween('date', [start, end])
    .whereIn('status', ['open', 'on_break'])
    .select('employee_id', 'id', 'date', 'punch_in');

  return {
    month,
    range: { from: start, to: end },
    employeesProcessed: results.length,
    generatedAt: toIso(generatedOn),
    openShiftsExcluded: openShifts.length,
    // Surface enough detail so HR knows which employees to chase before finalising payroll.
    openShiftWarnings: openShifts.map((s) => ({
      employeeId: s.employee_id,
      attendanceId: s.id,
      date: s.date,
      punchIn: toIso(s.punch_in),
    })),
  };
}

function shape(row) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    name: row.name,
    email: row.email,
    department: row.department,
    month: row.month,
    totalHours: Number(row.total_hours),
    workedFormatted: t.formatDuration(row.total_worked_seconds),
    breakFormatted: t.formatDuration(row.total_break_seconds),
    idleFormatted: t.formatDuration(row.total_idle_seconds),
    // True when idle seconds were subtracted from total_hours at generation time.
    idleDeducted: toBool(row.idle_deducted),
    daysPresent: row.days_present,
    daysFlagged: row.days_flagged,
    generatedOn: toIso(row.generated_on),
    syncedToPayroll: toBool(row.synced_to_payroll),
    syncedAt: toIso(row.synced_at),
  };
}

async function list({ month, department }) {
  if (!t.isMonthString(month)) throw badRequest('month must be YYYY-MM');

  const query = db()('payroll_summary as p')
    .join('employees as e', 'e.id', 'p.employee_id')
    .where('p.month', month);
  if (department) query.andWhere('e.department', department);

  const rows = await query
    .orderBy('e.name')
    .select('p.*', 'e.name', 'e.email', 'e.department');

  return rows.map(shape);
}

/**
 * Story P-6 (icebox I-2) — pushing to Zoho/GreytHR needs provider credentials and a sandbox
 * tenant. CSV export is the agreed interim path. `synced_to_payroll` is flipped by whoever
 * confirms the upload, so the column is honest about what actually happened.
 */
async function markSynced({ month, employeeIds }) {
  if (!t.isMonthString(month)) throw badRequest('month must be YYYY-MM');

  // `undefined` means "mark the whole month synced". An explicit `[]` means "these zero
  // employees" — a no-op — and must not silently fall through to "everyone", which the old
  // `employeeIds?.length` check (falsy for both `undefined` and `[]`) could not tell apart.
  if (Array.isArray(employeeIds) && employeeIds.length === 0) {
    return { month, updated: 0 };
  }

  const query = db()('payroll_summary').where({ month });
  if (employeeIds) query.whereIn('employee_id', employeeIds);
  const updated = await query.update({ synced_to_payroll: true, synced_at: t.now() });
  return { month, updated };
}

async function pushToProvider() {
  throw notImplemented(
    'Live payroll provider sync is not wired yet (backlog I-2). Use GET /api/payroll/export?month=YYYY-MM and confirm with POST /api/payroll/mark-synced.'
  );
}

module.exports = { generate, list, markSynced, pushToProvider, shape };
