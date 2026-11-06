'use strict';

// Pay rates, bonuses and the payslip.
//
// Pay is the daily rate in force on each day, by how much work the day held: a full day pays all
// of it, a half day half, and a day with less pays by the hour. A day's work is its worked time
// with breaks already taken out, so a break is never paid, and someone who takes one and stays
// late to finish their hours reaches a full day just like someone who takes none.
// Money is whole cents internally and dollars (two decimals) at the API edge.

const settings = require('../../services/settings');
const lock = require('./payrollLock');
const calendar = require('../../services/holidayCalendar');
const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toIso } = require('../../utils/http');
const { badRequest, notFound, conflict } = require('../../utils/errors');

const CURRENCY = 'USD';
const MAX_DAILY_RATE_CENTS = 10_000_000; // $100,000 a day: far above real pay, below a typo
const MAX_BONUS_CENTS = 100_000_000;
const MAX_BULK_ROWS = 1000;

const toCents = (dollars) => Math.round(Number(dollars) * 100);
/** Seconds as hours with two decimals: 27000 -> 7.5 */
const hours = (seconds) => Math.round(((Number(seconds) || 0) / 3600) * 100) / 100;
const toDollars = (cents) => Math.round(Number(cents) || 0) / 100;

/** A real calendar date, not just something shaped like one ("2026-02-31" is refused). */
function isRealDate(value) {
  if (!t.isDateString(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function isRealMonth(value) {
  return t.isMonthString(value) && Number(value.slice(5, 7)) >= 1 && Number(value.slice(5, 7)) <= 12;
}

function positiveCents(dollars, max, label) {
  const n = Number(dollars);
  if (!Number.isFinite(n) || n <= 0) throw badRequest(`${label} must be a number above 0`);
  const cents = toCents(n);
  if (cents < 1) throw badRequest(`${label} must be at least 0.01`);
  if (cents > max) throw badRequest(`${label} is too large`);
  return cents;
}

// --- Pricing ------------------------------------------------------------------------------

/** The rate in force on `date`: the latest one that started on or before it. `rates` ascending. */
function rateOn(rates, date) {
  let found = null;
  for (const r of rates) {
    if (r.effective_from <= date) found = r;
    else break;
  }
  return found;
}

/**
 * Days with pay-worthy work: a date's worked time is the sum over its closed shifts, with breaks
 * already taken out. Open shifts are left out (no final total yet), as are days with no worked
 * time at all (a punch-in made by mistake and undone).
 *
 * @returns {Map<string, Array<{date: string, worked: number}>>} employee id -> days, by date
 */
async function payableDays({ start, end, employeeIds }) {
  const query = db()('attendance')
    .whereBetween('date', [start, end])
    .andWhere({ status: 'closed' })
    .groupBy('employee_id', 'date')
    .select('employee_id', 'date')
    .sum({ worked: 'total_worked_seconds' });
  if (employeeIds) query.whereIn('employee_id', employeeIds);

  const map = new Map();
  for (const row of await query) {
    const worked = Number(row.worked) || 0;
    if (worked <= 0) continue;
    if (!map.has(row.employee_id)) map.set(row.employee_id, []);
    map.get(row.employee_id).push({ date: row.date, worked });
  }
  for (const days of map.values()) days.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

/** The day-length limits to use now: from settings, with the half-day limit kept under the full one. */
function currentLimits() {
  const { fullDaySeconds, halfDaySeconds } = settings.get().payroll;
  return { fullSeconds: fullDaySeconds, halfSeconds: Math.min(halfDaySeconds, fullDaySeconds - 1) };
}

/**
 * What kind of day a day's work makes. The work is counted with breaks taken out, so someone who
 * takes a break and stays late to finish their hours gets a full day exactly like someone who takes
 * none and leaves on time.
 */
function dayKind(workedSeconds, { fullSeconds, halfSeconds }) {
  if (workedSeconds >= fullSeconds) return 'full';
  if (workedSeconds >= halfSeconds) return 'half';
  return 'partial';
}

async function ratesFor(employeeIds) {
  if (!employeeIds.length) return new Map();
  const rows = await db()('pay_rates')
    .whereIn('employee_id', employeeIds)
    .orderBy('effective_from', 'asc')
    .select('employee_id', 'daily_rate_cents', 'effective_from');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.employee_id)) map.set(r.employee_id, []);
    map.get(r.employee_id).push(r);
  }
  return map;
}

/**
 * Prices a list of days, each at the rate in force on its date:
 *   full day    -> the whole daily rate
 *   half day    -> half of it
 *   anything less -> by the hour: the daily rate spread over a full day's hours
 * Returns one line per kind and rate, the counts, and how many days had no rate at all (those pay
 * nothing and are reported so HR can fix them).
 *
 * Paid leave and company holidays ("credits") are paid on top, at the same daily rate, but only
 * for the part of the day that was not worked: someone who works a half day on a half-day leave
 * gets one whole day in all, never more.
 *
 * @param {Array<{date: string, worked: number}>} days
 * @param {Array} rates   the employee's rates, ascending by start date
 * @param {{fullSeconds: number, halfSeconds: number}} limits
 * @param {Array<{date: string, kind: 'leave'|'holiday', fraction: number}>} credits
 */
function priceDays(days, rates, limits = currentLimits(), credits = []) {
  const groups = new Map(); // "kind|rate" -> { kind, rate, days, seconds }
  let fullDays = 0;
  let halfDays = 0;
  let partialDays = 0;
  let partialSeconds = 0;
  let unpricedDays = 0;
  const workedFraction = new Map(); // date -> how much of a day was worked, 0..1

  for (const { date, worked } of days) {
    const kind = dayKind(worked, limits);
    if (kind === 'full') fullDays += 1;
    else if (kind === 'half') halfDays += 1;
    else {
      partialDays += 1;
      partialSeconds += worked;
    }
    workedFraction.set(date, kind === 'full' ? 1 : kind === 'half' ? 0.5 : Math.min(1, worked / limits.fullSeconds));

    const rate = rateOn(rates, date);
    if (!rate) {
      unpricedDays += 1;
      continue;
    }
    const key = `${kind}|${rate.daily_rate_cents}`;
    const g = groups.get(key) || { kind, rate: rate.daily_rate_cents, days: 0, seconds: 0 };
    g.days += 1;
    g.seconds += worked;
    groups.set(key, g);
  }

  // Leave and holidays: paid for what was not worked, at the rate in force that day.
  let leaveDays = 0;
  let holidayDays = 0;
  for (const { date, kind, fraction } of credits) {
    const paid = Math.min(fraction, Math.max(0, 1 - (workedFraction.get(date) || 0)));
    const rate = paid > 0 ? rateOn(rates, date) : null;
    if (!rate) continue;
    const key = `${kind}|${rate.daily_rate_cents}`;
    const g = groups.get(key) || { kind, rate: rate.daily_rate_cents, days: 0, seconds: 0 };
    g.days += paid;
    groups.set(key, g);
    if (kind === 'leave') leaveDays += paid;
    else holidayDays += paid;
  }

  const ORDER = { full: 0, half: 1, partial: 2, leave: 3, holiday: 4 };
  const lines = [...groups.values()]
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.rate - b.rate)
    .map((g) => ({
      kind: g.kind,
      dailyRateCents: g.rate,
      days: Math.round(g.days * 100) / 100,
      seconds: g.seconds,
      amountCents:
        g.kind === 'full'
          ? g.rate * g.days
          : g.kind === 'half'
            ? Math.round((g.rate * g.days) / 2)
            : g.kind === 'partial'
              ? Math.round((g.rate * g.seconds) / limits.fullSeconds)
              : Math.round(g.rate * g.days), // leave and holidays: the share of a day, at the daily rate
    }));

  return {
    lines,
    fullDays,
    halfDays,
    partialDays,
    partialSeconds,
    leaveDays: Math.round(leaveDays * 100) / 100,
    holidayDays: Math.round(holidayDays * 100) / 100,
    pricedDays: days.length - unpricedDays,
    unpricedDays,
    baseCents: lines.reduce((s, l) => s + l.amountCents, 0),
  };
}

// --- Paid leave and holidays ----------------------------------------------------------------

/** Every date from `start` to `end`, inclusive, as "YYYY-MM-DD". */
function datesBetween(start, end) {
  const out = [];
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d = new Date(d.getTime() + t.DAY_MS)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Sunday is never a working day, whatever the setting says: nothing is paid for leave or a holiday on it.
const isWorkingDay = (date, workDays) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && workDays.includes(day);
};

/**
 * The days a person is paid for without working them, within [start, end]:
 *  - a company holiday on a working day: a whole day, for every active employee who had joined;
 *  - approved leave of a paid type on a working day: a whole day, or half for a half-day leave.
 * A holiday wins over a leave on the same date (it is never paid twice).
 *
 * @param {object} opts
 * @param {string[]} [opts.employeeIds]  limit to these people; omit for everyone eligible
 * @returns {Promise<Map<string, Array<{date: string, kind: 'leave'|'holiday', fraction: number}>>>}
 */
async function creditDays({ start, end, employeeIds }) {
  const { paidLeaveTypes, workDays } = settings.get().payroll;
  const byEmployee = new Map(); // employee id -> Map(date -> credit)
  const put = (employeeId, credit) => {
    if (!byEmployee.has(employeeId)) byEmployee.set(employeeId, new Map());
    byEmployee.get(employeeId).set(credit.date, credit);
  };

  if (paidLeaveTypes.length) {
    const query = db()('leave_requests')
      .where({ status: 'approved' })
      .whereIn('type', paidLeaveTypes)
      .andWhere('start_date', '<=', end)
      .andWhere('end_date', '>=', start);
    if (employeeIds) query.whereIn('employee_id', employeeIds);
    for (const leave of await query.select('employee_id', 'start_date', 'end_date', 'day_part')) {
      const from = leave.start_date > start ? leave.start_date : start;
      const to = leave.end_date < end ? leave.end_date : end;
      const fraction = leave.day_part === 'full' || !leave.day_part ? 1 : 0.5;
      for (const date of datesBetween(from, to)) {
        if (!isWorkingDay(date, workDays)) continue;
        const existing = byEmployee.get(leave.employee_id)?.get(date);
        put(leave.employee_id, { date, kind: 'leave', fraction: Math.min(1, Math.max(fraction, existing?.fraction || 0)) });
      }
    }
  }

  const holidays = (await calendar.holidaysBetween(start, end))
    .map((h) => h.date)
    .filter((date) => isWorkingDay(date, workDays));
  if (holidays.length) {
    const query = db()('employees').where({ status: 'active' });
    if (employeeIds) query.whereIn('id', employeeIds);
    for (const e of await query.select('id', 'created_at')) {
      const joined = t.localDate(Number(e.created_at));
      for (const date of holidays) {
        if (date >= joined) put(e.id, { date, kind: 'holiday', fraction: 1 });
      }
    }
  }

  const out = new Map();
  for (const [id, byDate] of byEmployee) out.set(id, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
  return out;
}

// --- Rates --------------------------------------------------------------------------------

function shapeRate(r) {
  return {
    id: r.id,
    employeeId: r.employee_id,
    dailyRate: toDollars(r.daily_rate_cents),
    effectiveFrom: r.effective_from,
    note: r.note,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

/** Every employee with the rate in force today and the next one scheduled, for the rates screen. */
async function listCurrentRates({ department } = {}) {
  const query = db()('employees').where({ status: 'active' }).orderBy('name');
  if (department) query.andWhere({ department });
  const employees = await query.select('id', 'name', 'email', 'department');

  const rates = await ratesFor(employees.map((e) => e.id));
  const today = t.localDate();

  return employees.map((e) => {
    const list = rates.get(e.id) || [];
    const current = rateOn(list, today);
    const upcoming = list.find((r) => r.effective_from > today) || null;
    return {
      employeeId: e.id,
      name: e.name,
      email: e.email,
      department: e.department,
      currentRate: current ? toDollars(current.daily_rate_cents) : null,
      currentFrom: current ? current.effective_from : null,
      upcomingRate: upcoming ? toDollars(upcoming.daily_rate_cents) : null,
      upcomingFrom: upcoming ? upcoming.effective_from : null,
      changes: list.length,
    };
  });
}

async function rateHistory(employeeId) {
  const employee = await db()('employees').where({ id: employeeId }).first('id', 'name', 'email');
  if (!employee) throw notFound('Employee not found');
  const rows = await db()('pay_rates').where({ employee_id: employeeId }).orderBy('effective_from', 'desc');
  return { employee: { id: employee.id, name: employee.name, email: employee.email }, rates: rows.map(shapeRate) };
}

async function setRate({ employeeId, dailyRate, effectiveFrom, note, actorId }) {
  const cents = positiveCents(dailyRate, MAX_DAILY_RATE_CENTS, 'dailyRate');
  if (!isRealDate(effectiveFrom)) throw badRequest('effectiveFrom must be a real date, YYYY-MM-DD');

  const employee = await db()('employees').where({ id: employeeId }).first('id');
  if (!employee) throw notFound('Employee not found');

  const existing = await db()('pay_rates').where({ employee_id: employeeId, effective_from: effectiveFrom }).first('id');
  if (existing) {
    throw conflict('A rate already starts on that date for this employee. Edit that one instead.');
  }

  const nowMs = t.now();
  const row = {
    id: uuid(),
    employee_id: employeeId,
    daily_rate_cents: cents,
    effective_from: effectiveFrom,
    note: note || null,
    created_by: actorId || null,
    created_at: nowMs,
    updated_at: nowMs,
  };
  await db()('pay_rates').insert(row);
  return shapeRate(row);
}

async function updateRate(id, { dailyRate, effectiveFrom, note }) {
  const row = await db()('pay_rates').where({ id }).first();
  if (!row) throw notFound('Rate not found');

  const patch = { updated_at: t.now() };
  if (dailyRate !== undefined) patch.daily_rate_cents = positiveCents(dailyRate, MAX_DAILY_RATE_CENTS, 'dailyRate');
  if (note !== undefined) patch.note = note || null;
  if (effectiveFrom !== undefined) {
    if (!isRealDate(effectiveFrom)) throw badRequest('effectiveFrom must be a real date, YYYY-MM-DD');
    const clash = await db()('pay_rates')
      .where({ employee_id: row.employee_id, effective_from: effectiveFrom })
      .whereNot({ id })
      .first('id');
    if (clash) throw conflict('Another rate already starts on that date for this employee.');
    patch.effective_from = effectiveFrom;
  }

  await db()('pay_rates').where({ id }).update(patch);
  return shapeRate({ ...row, ...patch });
}

/** Looks emails up in one query. Returns a Map of lower-cased email -> employee id. */
async function employeesByEmail(rows) {
  const emails = [...new Set(rows.map((r) => String(r.email || '').trim().toLowerCase()).filter(Boolean))];
  if (!emails.length) return new Map();
  const found = await db()('employees').whereIn(db().raw('lower(email)'), emails).select('id', 'email');
  return new Map(found.map((e) => [e.email.toLowerCase(), e.id]));
}

function bulkFailed(errors) {
  return badRequest(
    `${errors.length} row${errors.length === 1 ? ' has a problem' : 's have problems'}; nothing was saved. Fix them and upload again.`,
    errors
  );
}

/**
 * Sets many rates at once, from an uploaded sheet. All or nothing: if any row is wrong nothing is
 * saved, so a half-applied upload can never leave some people on the new rates and some on the old.
 * A row for a date that already has a rate for that person replaces it.
 *
 * @param {Array<{email: string, dailyRate: number, effectiveFrom: string, note?: string}>} rows
 */
async function bulkSetRates(rows, actorId) {
  if (!rows.length) throw badRequest('There are no rows to upload');
  if (rows.length > MAX_BULK_ROWS) throw badRequest(`Upload at most ${MAX_BULK_ROWS} rows at a time`);

  const ids = await employeesByEmail(rows);
  const errors = [];
  const clean = [];
  const seen = new Set();

  rows.forEach((r, i) => {
    const line = i + 1;
    const email = String(r.email || '').trim().toLowerCase();
    const employeeId = ids.get(email);
    const problems = [];
    if (!email) problems.push('email is missing');
    else if (!employeeId) problems.push(`no employee with the email ${email}`);

    let cents = null;
    try {
      cents = positiveCents(r.dailyRate, MAX_DAILY_RATE_CENTS, 'dailyRate');
    } catch (err) {
      problems.push(err.message);
    }
    if (!isRealDate(r.effectiveFrom)) problems.push('effectiveFrom must be a real date, YYYY-MM-DD');

    const key = `${employeeId}|${r.effectiveFrom}`;
    if (!problems.length && seen.has(key)) problems.push('the same employee and start date appear twice in this upload');
    seen.add(key);

    if (problems.length) errors.push({ row: line, field: email || undefined, message: problems.join('; ') });
    else clean.push({ employeeId, cents, effectiveFrom: r.effectiveFrom, note: r.note ? String(r.note).slice(0, 255) : null });
  });

  if (errors.length) throw bulkFailed(errors);

  let created = 0;
  let updated = 0;
  const nowMs = t.now();
  await db().transaction(async (trx) => {
    for (const r of clean) {
      const existing = await trx('pay_rates')
        .where({ employee_id: r.employeeId, effective_from: r.effectiveFrom })
        .first('id');
      if (existing) {
        await trx('pay_rates')
          .where({ id: existing.id })
          .update({ daily_rate_cents: r.cents, note: r.note, updated_at: nowMs });
        updated += 1;
      } else {
        await trx('pay_rates').insert({
          id: uuid(),
          employee_id: r.employeeId,
          daily_rate_cents: r.cents,
          effective_from: r.effectiveFrom,
          note: r.note,
          created_by: actorId || null,
          created_at: nowMs,
          updated_at: nowMs,
        });
        created += 1;
      }
    }
  });

  return { created, updated };
}

// --- Bonuses ------------------------------------------------------------------------------

function shapeBonus(b) {
  return {
    id: b.id,
    employeeId: b.employee_id,
    name: b.name,
    email: b.email,
    department: b.department,
    month: b.month,
    amount: toDollars(b.amount_cents),
    reason: b.reason,
    createdAt: toIso(b.created_at),
  };
}

async function listBonuses({ month, employeeId }) {
  if (!isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  const query = db()('payroll_bonuses as b')
    .join('employees as e', 'e.id', 'b.employee_id')
    .where('b.month', month);
  if (employeeId) query.andWhere('b.employee_id', employeeId);
  const rows = await query.orderBy('e.name').orderBy('b.created_at').select('b.*', 'e.name', 'e.email', 'e.department');
  return rows.map(shapeBonus);
}

async function addBonus({ employeeId, month, amount, reason, actorId }) {
  if (!isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  const cents = positiveCents(amount, MAX_BONUS_CENTS, 'amount');
  await lock.assertOpen(month, 'add a bonus');
  const employee = await db()('employees').where({ id: employeeId }).first('id');
  if (!employee) throw notFound('Employee not found');

  const row = {
    id: uuid(),
    employee_id: employeeId,
    month,
    amount_cents: cents,
    reason: String(reason).trim().slice(0, 255),
    created_by: actorId || null,
    created_at: t.now(),
  };
  await db()('payroll_bonuses').insert(row);
  return { id: row.id, employeeId, month, amount: toDollars(cents), reason: row.reason };
}

async function deleteBonus(id) {
  const row = await db()('payroll_bonuses').where({ id }).first('id', 'employee_id', 'month', 'amount_cents', 'reason');
  if (!row) throw notFound('Bonus not found');
  await lock.assertOpen(row.month, 'remove a bonus');
  await db()('payroll_bonuses').where({ id }).del();
  return { id, employeeId: row.employee_id, month: row.month, amount: toDollars(row.amount_cents), reason: row.reason };
}

/** All or nothing, like the rates upload. @param {Array<{email,month,amount,reason}>} rows */
async function bulkAddBonuses(rows, actorId) {
  if (!rows.length) throw badRequest('There are no rows to upload');
  if (rows.length > MAX_BULK_ROWS) throw badRequest(`Upload at most ${MAX_BULK_ROWS} rows at a time`);

  const ids = await employeesByEmail(rows);
  const errors = [];
  const clean = [];

  rows.forEach((r, i) => {
    const email = String(r.email || '').trim().toLowerCase();
    const employeeId = ids.get(email);
    const problems = [];
    if (!email) problems.push('email is missing');
    else if (!employeeId) problems.push(`no employee with the email ${email}`);
    if (!isRealMonth(r.month)) problems.push('month must be YYYY-MM');
    let cents = null;
    try {
      cents = positiveCents(r.amount, MAX_BONUS_CENTS, 'amount');
    } catch (err) {
      problems.push(err.message);
    }
    const reason = String(r.reason || '').trim();
    if (!reason) problems.push('reason is missing');

    if (problems.length) errors.push({ row: i + 1, field: email || undefined, message: problems.join('; ') });
    else clean.push({ employeeId, month: r.month, cents, reason: reason.slice(0, 255) });
  });

  if (errors.length) throw bulkFailed(errors);
  for (const month of new Set(clean.map((r) => r.month))) await lock.assertOpen(month, 'add bonuses');

  const nowMs = t.now();
  await db().transaction(async (trx) => {
    await trx('payroll_bonuses').insert(
      clean.map((r) => ({
        id: uuid(),
        employee_id: r.employeeId,
        month: r.month,
        amount_cents: r.cents,
        reason: r.reason,
        created_by: actorId || null,
        created_at: nowMs,
      }))
    );
  });
  return { created: clean.length };
}

/** Bonus total in cents per employee for a month. */
async function bonusTotals(month, employeeIds) {
  const query = db()('payroll_bonuses').where({ month }).groupBy('employee_id').select('employee_id').sum({ total: 'amount_cents' });
  if (employeeIds) query.whereIn('employee_id', employeeIds);
  return new Map((await query).map((r) => [r.employee_id, Number(r.total) || 0]));
}

// --- Payslip ------------------------------------------------------------------------------

/**
 * One employee's payslip for a month: days worked priced by the rate that applied on each day,
 * plus the bonuses entered for the month. Needs the month's payroll to have been generated, so
 * the slip and the payroll table can never disagree about the day count.
 */
async function payslip({ employeeId, month }) {
  if (!isRealMonth(month)) throw badRequest('month must be YYYY-MM');

  const employee = await db()('employees').where({ id: employeeId }).first('id', 'name', 'email', 'department', 'employee_code');
  if (!employee) throw notFound('Employee not found');

  const summary = await db()('payroll_summary').where({ employee_id: employeeId, month }).first();
  if (!summary) throw notFound(`No payroll for ${month} yet. Generate the month first.`);

  // A finalized month is read back exactly as it was frozen, whatever has changed since.
  if (summary.snapshot) {
    return { ...JSON.parse(summary.snapshot), finalized: true, finalizedAt: toIso(summary.finalized_at), stale: false };
  }

  const { start, end } = t.monthBounds(month);
  const days = (await payableDays({ start, end, employeeIds: [employeeId] })).get(employeeId) || [];
  const rates = (await ratesFor([employeeId])).get(employeeId) || [];
  // The limits the month was generated with, not today's: changing them later must not alter a
  // payslip that was already produced.
  const limits = { fullSeconds: summary.full_day_seconds, halfSeconds: summary.half_day_seconds };
  const credits = (await creditDays({ start, end, employeeIds: [employeeId] })).get(employeeId) || [];
  const priced = priceDays(days, rates, limits, credits);
  const totalSeconds = days.reduce((s, d) => s + d.worked, 0);

  const bonuses = await listBonuses({ month, employeeId });
  const bonusTotalCents = bonuses.reduce((s, b) => s + toCents(b.amount), 0);

  return {
    currency: CURRENCY,
    month,
    generatedOn: toIso(summary.generated_on),
    employee: {
      id: employee.id,
      name: employee.name,
      email: employee.email,
      department: employee.department,
      employeeCode: employee.employee_code,
    },
    // How the days broke down. "Other" is work on days that were neither a full nor a half day.
    daysWorked: days.length,
    fullDays: priced.fullDays,
    halfDays: priced.halfDays,
    otherDays: priced.partialDays,
    otherHours: hours(priced.partialSeconds),
    // Paid without working: approved leave of a paid type, and company holidays (in days).
    paidLeaveDays: priced.leaveDays,
    holidayDays: priced.holidayDays,
    totalHours: hours(totalSeconds),
    dayLimits: { fullDayHours: hours(limits.fullSeconds), halfDayHours: hours(limits.halfSeconds) },
    lines: priced.lines.map((l) => ({
      kind: l.kind,
      dailyRate: toDollars(l.dailyRateCents),
      days: l.days,
      hours: hours(l.seconds),
      // What one hour is worth, for the "other hours" line: the daily rate over a full day's hours.
      hourlyRate: l.kind === 'partial' ? toDollars((l.dailyRateCents * 3600) / limits.fullSeconds) : null,
      amount: toDollars(l.amountCents),
    })),
    unpricedDays: priced.unpricedDays,
    // True when rates or days changed after the month was generated, so this slip no longer
    // matches the payroll table until the month is regenerated.
    stale: priced.baseCents !== Number(summary.base_pay_cents),
    basePay: toDollars(priced.baseCents),
    bonuses: bonuses.map((b) => ({ id: b.id, reason: b.reason, amount: b.amount })),
    bonusTotal: toDollars(bonusTotalCents),
    netPay: toDollars(priced.baseCents + bonusTotalCents),
  };
}

module.exports = {
  CURRENCY,
  toDollars,
  toCents,
  isRealDate,
  isRealMonth,
  rateOn,
  creditDays,
  currentLimits,
  dayKind,
  payableDays,
  ratesFor,
  priceDays,
  bonusTotals,
  listCurrentRates,
  rateHistory,
  setRate,
  updateRate,
  bulkSetRates,
  listBonuses,
  addBonus,
  deleteBonus,
  bulkAddBonuses,
  payslip,
};
