'use strict';

const settings = require('../../services/settings');
const pay = require('./pay.service');
const lock = require('./payrollLock');
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
  await lock.assertOpen(month, 'regenerate it');

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

  // Pay: each day is a full day, a half day or plain hours by how much work it held (breaks already
  // taken out), priced at the daily rate in force that day. The limits used are kept on the row.
  // Paid leave and company holidays are paid on top, so a person with no shifts at all in the month
  // (a week of vacation, a holiday) still gets a row when it earns something.
  const credits = await pay.creditDays({ start, end });
  const workedIds = new Set(aggregates.map((a) => a.employee_id));
  const creditOnly = [...credits.keys()].filter((id) => !workedIds.has(id));
  const rows = [
    ...aggregates,
    ...creditOnly.map((id) => ({ employee_id: id, worked: 0, breaks: 0, idle: 0, days: 0 })),
  ];

  const employeeIds = rows.map((a) => a.employee_id);
  const days = await pay.payableDays({ start, end, employeeIds });
  const rates = await pay.ratesFor(employeeIds);
  const limits = pay.currentLimits();

  // Build all records in memory first — no DB round-trips yet.
  // When PAYROLL_DEDUCT_IDLE=true, idle time is subtracted from billable hours.
  // The raw worked_seconds and idle_seconds are always stored so HR can audit the
  // deduction or regenerate with a different setting later.
  const allRecords = rows.map((row) => {
    const workedSeconds = Number(row.worked) || 0;
    const idleSeconds   = Number(row.idle)   || 0;
    const billableSeconds = settings.get().payroll.deductIdle
      ? Math.max(0, workedSeconds - idleSeconds)
      : workedSeconds;
    const priced = pay.priceDays(
      days.get(row.employee_id) || [],
      rates.get(row.employee_id) || [],
      limits,
      credits.get(row.employee_id) || []
    );
    return {
      leave_days: priced.leaveDays,
      holiday_days: priced.holidayDays,
      base_pay_cents: priced.baseCents,
      priced_days: priced.pricedDays,
      rate_missing_days: priced.unpricedDays,
      full_days: priced.fullDays,
      half_days: priced.halfDays,
      partial_days: priced.partialDays,
      partial_seconds: priced.partialSeconds,
      full_day_seconds: limits.fullSeconds,
      half_day_seconds: limits.halfSeconds,
      id: uuid(),
      employee_id: row.employee_id,
      month,
      total_hours: t.secondsToHours(billableSeconds),
      total_worked_seconds: workedSeconds,
      total_break_seconds: Number(row.breaks) || 0,
      total_idle_seconds: idleSeconds,
      idle_deducted: settings.get().payroll.deductIdle,
      days_present: Number(row.days) || 0,
      days_flagged: flaggedBy[row.employee_id] || 0,
      generated_on: generatedOn,
    };
  });
  // A person who only has leave or a holiday in the month and earns nothing from it (no rate) gets no row.
  const records = allRecords.filter((r) => workedIds.has(r.employee_id) || r.base_pay_cents > 0);

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
        base_pay_cents:       db().raw('excluded.base_pay_cents'),
        priced_days:          db().raw('excluded.priced_days'),
        rate_missing_days:    db().raw('excluded.rate_missing_days'),
        full_days:            db().raw('excluded.full_days'),
        half_days:            db().raw('excluded.half_days'),
        partial_days:         db().raw('excluded.partial_days'),
        partial_seconds:      db().raw('excluded.partial_seconds'),
        full_day_seconds:     db().raw('excluded.full_day_seconds'),
        half_day_seconds:     db().raw('excluded.half_day_seconds'),
        leave_days:           db().raw('excluded.leave_days'),
        holiday_days:         db().raw('excluded.holiday_days'),
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
    // Employees who worked days no rate covers: those days pay nothing until HR sets a rate and
    // the month is regenerated.
    missingRates: results
      .filter((r) => r.rate_missing_days > 0)
      .map((r) => ({ employeeId: r.employee_id, days: r.rate_missing_days })),
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

function shape(row, bonusCents = 0) {
  const baseCents = Number(row.base_pay_cents) || 0;
  return {
    // Pay (USD). Bonuses are added when read, so one entered after generating still shows.
    basePay: pay.toDollars(baseCents),
    bonusTotal: pay.toDollars(bonusCents),
    netPay: pay.toDollars(baseCents + bonusCents),
    pricedDays: Number(row.priced_days) || 0,
    rateMissingDays: Number(row.rate_missing_days) || 0,
    // Days by kind. "Other" is work on days that were neither a full nor a half day, paid by the hour.
    fullDays: Number(row.full_days) || 0,
    halfDays: Number(row.half_days) || 0,
    otherDays: Number(row.partial_days) || 0,
    otherHours: Math.round(((Number(row.partial_seconds) || 0) / 3600) * 100) / 100,
    paidLeaveDays: Number(row.leave_days) || 0,
    holidayDays: Number(row.holiday_days) || 0,
    finalized: Boolean(row.finalized_at),
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

  const bonuses = await pay.bonusTotals(month, rows.map((r) => r.employee_id));
  return rows.map((r) => shape(r, bonuses.get(r.employee_id) || 0));
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
