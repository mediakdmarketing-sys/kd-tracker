'use strict';

// Closing a payroll month.
//
// Finalizing freezes every person's payslip for the month: the figures are saved as they are at
// that moment, so later changes to rates, attendance or settings can no longer alter a payslip
// that has been paid. The month then cannot be regenerated and its bonuses and holidays cannot
// change until HR reopens it (which needs a reason and is audited). Employees see their payslip
// only once the month is finalized, so nobody is shown a number that might still move.

const { db } = require('../../db');
const t = require('../../utils/time');
const { toIso } = require('../../utils/http');
const { badRequest, conflict } = require('../../utils/errors');
const notifications = require('../../services/notifications');
const pay = require('./pay.service');
const lock = require('./payrollLock');

const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function status(month) {
  if (!pay.isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  const row = await db()('payroll_months').where({ month }).first();
  if (!row) return { month, final: false };
  return {
    month,
    final: true,
    finalizedAt: toIso(row.finalized_at),
    employees: row.employees,
    netTotal: pay.toDollars(row.net_total_cents),
  };
}

/**
 * @param {object} opts
 * @param {boolean} [opts.force]  go ahead despite warnings (open shifts, days with no rate)
 */
async function finalize({ month, actorId, force = false }) {
  if (!pay.isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  if (await lock.isFinal(month)) throw conflict(`Payroll for ${month} is already finalized.`);

  const rows = await db()('payroll_summary').where({ month }).select('employee_id', 'rate_missing_days');
  if (!rows.length) throw badRequest(`There is no payroll for ${month} yet. Generate the month first.`);

  // A payslip that no longer matches the table cannot be frozen: it would freeze the wrong figures.
  const slips = [];
  const stale = [];
  for (const r of rows) {
    const slip = await pay.payslip({ employeeId: r.employee_id, month });
    slips.push(slip);
    if (slip.stale) stale.push(slip.employee.name);
  }
  if (stale.length) {
    throw conflict(
      `${stale.length} payslip${stale.length === 1 ? ' is' : 's are'} out of date (rates, attendance or settings changed since the month was generated). Regenerate the month first.`,
      stale.map((name) => ({ message: name }))
    );
  }

  // Things HR may want to look at first. Finalizing anyway is allowed, once confirmed.
  const { start, end } = t.monthBounds(month);
  const open = await db()('attendance').whereBetween('date', [start, end]).whereIn('status', ['open', 'on_break']).count({ c: '*' }).first();
  const warnings = [];
  if (Number(open?.c) > 0) {
    warnings.push({ code: 'open_shifts', message: `${open.c} shift${Number(open.c) === 1 ? ' is' : 's are'} still open and not counted.` });
  }
  const unpaid = rows.filter((r) => Number(r.rate_missing_days) > 0).length;
  if (unpaid > 0) {
    warnings.push({ code: 'no_rate', message: `${unpaid} ${unpaid === 1 ? 'person has' : 'people have'} worked days with no pay rate (paid nothing for those days).` });
  }
  if (warnings.length && !force) {
    throw conflict('Check these before finalizing, then confirm to go ahead.', warnings);
  }

  const nowMs = t.now();
  const netCents = slips.reduce((s, slip) => s + pay.toCents(slip.netPay), 0);
  await db().transaction(async (trx) => {
    for (const slip of slips) {
      await trx('payroll_summary')
        .where({ employee_id: slip.employee.id, month })
        .update({ snapshot: JSON.stringify(slip), finalized_at: nowMs });
    }
    await trx('payroll_months').insert({
      month,
      finalized_at: nowMs,
      finalized_by: actorId || null,
      employees: slips.length,
      net_total_cents: netCents,
    });
  });

  // Tell each person their payslip is ready (best effort: never undoes the finalize).
  const title = MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));
  await notifications.notify(
    slips.map((s) => s.employee.id),
    {
      type: 'payslip_ready',
      title: `Your payslip for ${title} is ready`,
      body: 'Open Payslips to view or download it.',
      link: `/me/payslips/${month}`,
      refId: month,
    }
  );

  return { month, employees: slips.length, netTotal: pay.toDollars(netCents), warnings };
}

/** Unfreezes a month so it can be regenerated or its bonuses changed. The reason goes in the audit log. */
async function reopen({ month }) {
  if (!pay.isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  if (!(await lock.isFinal(month))) throw conflict(`Payroll for ${month} is not finalized.`);

  await db().transaction(async (trx) => {
    await trx('payroll_summary').where({ month }).update({ snapshot: null, finalized_at: null });
    await trx('payroll_months').where({ month }).del();
  });
  return { month, final: false };
}

/** Months an employee can see: finalized ones in which they have a payslip, newest first. */
async function monthsFor(employeeId) {
  const rows = await db()('payroll_summary as p')
    .join('payroll_months as m', 'm.month', 'p.month')
    .where('p.employee_id', employeeId)
    .whereNotNull('p.snapshot')
    .orderBy('p.month', 'desc')
    .select('p.month', 'p.snapshot', 'm.finalized_at');
  return rows.map((r) => {
    const slip = JSON.parse(r.snapshot);
    return { month: r.month, netPay: slip.netPay, daysWorked: slip.daysWorked, finalizedAt: toIso(r.finalized_at) };
  });
}

module.exports = { status, finalize, reopen, monthsFor };
