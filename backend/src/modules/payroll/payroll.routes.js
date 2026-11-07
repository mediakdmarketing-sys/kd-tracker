'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./payroll.service');
const pay = require('./pay.service');
const mail = require('./payslipMail.service');
const finalizeService = require('./finalize.service');
const holidays = require('./holidays.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin, requireAccountAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const { sendCsv } = require('../../utils/csv');
const audit = require('../../services/audit');

const router = express.Router();
router.use(authenticate, requireAdmin);
// Everything here is payroll and payments, so it is for account admins only, EXCEPT the company
// holidays: those are the company calendar and HR admins keep them. Gating by default means a
// route added later is protected until someone decides otherwise.
router.use((req, res, next) => (req.path === '/holidays' || req.path.startsWith('/holidays/') ? next() : requireAccountAdmin(req, res, next)));

const MONTH = z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM');

router.post(
  '/generate',
  validate(z.object({ month: MONTH })),
  asyncHandler(async (req, res) => {
    const result = await service.generate({ month: req.body.month });
    await audit.record(req, {
      action: audit.ACTIONS.GENERATED_PAYROLL,
      targetType: 'payroll',
      details: result,
    });
    res.json(result);
  })
);

router.get(
  '/',
  validate(z.object({ month: MONTH, department: z.string().max(120).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    res.json({ month: query.month, rows: await service.list(query) });
  })
);

router.get(
  '/export',
  validate(
    z.object({
      month: MONTH,
      department: z.string().max(120).optional(),
      format: z.enum(['csv', 'json']).optional(),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const rows = await service.list(query);

    await audit.record(req, {
      action: audit.ACTIONS.EXPORTED_PAYROLL,
      targetType: 'payroll',
      details: { month: query.month, department: query.department || null, rows: rows.length },
    });

    if (query.format === 'json') return res.json({ month: query.month, rows });

    return sendCsv(
      res,
      `payroll_${query.month}.csv`,
      [
        { key: 'employeeId', label: 'Employee ID' },
        { key: 'name', label: 'Employee' },
        { key: 'email', label: 'Email' },
        { key: 'department', label: 'Department' },
        { key: 'month', label: 'Month' },
        { key: 'daysPresent', label: 'Days Present' },
        { key: 'totalHours', label: 'Total Hours' },
        { key: 'workedFormatted', label: 'Worked' },
        { key: 'breakFormatted', label: 'Break' },
        { key: 'idleFormatted', label: 'Idle' },
        { key: 'daysFlagged', label: 'Flagged Days' },
        { key: 'fullDays', label: 'Full Days' },
        { key: 'halfDays', label: 'Half Days' },
        { key: 'otherDays', label: 'Other Days' },
        { key: 'otherHours', label: 'Other Hours' },
        { key: 'basePay', label: 'Base Pay (USD)' },
        { key: 'bonusTotal', label: 'Bonus (USD)' },
        { key: 'netPay', label: 'Net Pay (USD)' },
        { key: 'rateMissingDays', label: 'Days Without Rate' },
        { key: 'syncedToPayroll', label: 'Synced' },
      ],
      rows
    );
  })
);

// The month-end payment list: everyone to be paid, and how much, from the frozen payslips of a
// finalized month. The last three columns are left empty for HR to fill in as they pay.
router.get(
  '/payment-list',
  validate(
    z.object({
      month: MONTH,
      department: z.string().max(120).optional(),
      format: z.enum(['csv', 'json']).optional(),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const query = q(req);
    // The CSV is the file for the bank, so it carries the full account numbers; the JSON view (the
    // screen, a quick look) only ever shows them masked as ****1234.
    const asCsv = query.format !== 'json';
    const list = await finalizeService.paymentList({ ...query, accountNumbers: asCsv });

    await audit.record(req, {
      action: audit.ACTIONS.EXPORTED_PAYROLL,
      targetType: 'payroll',
      details: {
        month: query.month,
        department: query.department || null,
        rows: list.rows.length,
        kind: 'payment-list',
        total: list.total,
        accountNumbersIncluded: asCsv,
        missingBankDetails: list.missingBank,
      },
    });

    res.set('Cache-Control', 'no-store');
    if (!asCsv) {
      return res.json({ ...list, rows: list.rows.map(({ cents, ...row }) => row) });
    }

    const rows = list.rows.map((r) => ({ ...r, month: query.month, paidOn: '', method: '', reference: '' }));
    // A closing line so the sheet adds up on its own. Every other cell stays empty.
    rows.push({ name: `TOTAL (${list.rows.length} ${list.rows.length === 1 ? 'person' : 'people'})`, netPay: list.total });
    return sendCsv(
      res,
      `payment-list_${query.month}.csv`,
      [
        { key: 'number', label: 'No.' },
        { key: 'employeeCode', label: 'Employee Code' },
        { key: 'name', label: 'Employee' },
        { key: 'email', label: 'Email' },
        { key: 'department', label: 'Department' },
        { key: 'month', label: 'Month' },
        { key: 'bank', label: 'Bank' },
        { key: 'branch', label: 'Branch' },
        { key: 'accountName', label: 'Account Name' },
        { key: 'accountNumber', label: 'Account Number' },
        { key: 'bankNote', label: 'Note' },
        { key: 'daysWorked', label: 'Days Worked' },
        { key: 'fullDays', label: 'Full Days' },
        { key: 'halfDays', label: 'Half Days' },
        { key: 'otherHours', label: 'Other Hours' },
        { key: 'paidLeaveDays', label: 'Paid Leave Days' },
        { key: 'holidayDays', label: 'Holidays' },
        { key: 'basePay', label: 'Base Pay (USD)' },
        { key: 'bonusTotal', label: 'Bonus (USD)' },
        { key: 'netPay', label: 'Amount To Pay (USD)' },
        { key: 'paidOn', label: 'Paid On' },
        { key: 'method', label: 'Payment Method' },
        { key: 'reference', label: 'Reference' },
      ],
      rows
    );
  })
);

router.post(
  '/mark-synced',
  validate(z.object({ month: MONTH, employeeIds: z.array(z.string().uuid()).optional() })),
  asyncHandler(async (req, res) => {
    res.json(await service.markSynced(req.body));
  })
);

router.post('/sync', asyncHandler(async (req, res) => {
  res.json(await service.pushToProvider());
}));

// --- Pay rates ----------------------------------------------------------------------------
// A rate is "$X a day from this date". An increment is a new rate with a later start date.

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const MONEY = z.coerce.number().positive().max(1_000_000);

const RATE_ROW = z.object({
  email: z.string().trim().min(1).max(255),
  dailyRate: MONEY,
  effectiveFrom: DATE,
  note: z.string().trim().max(255).optional(),
});

router.get(
  '/rates',
  validate(z.object({ department: z.string().max(120).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    res.json({ currency: pay.CURRENCY, rows: await pay.listCurrentRates(q(req)) });
  })
);

router.post(
  '/rates/bulk',
  validate(z.object({ rows: z.array(RATE_ROW).min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const result = await pay.bulkSetRates(req.body.rows, req.user.id);
    await audit.record(req, { action: audit.ACTIONS.UPLOADED_PAY_RATES, targetType: 'pay_rate', details: result });
    res.status(201).json(result);
  })
);

router.get(
  '/rates/:employeeId',
  validate(z.object({ employeeId: UUID }), 'params'),
  asyncHandler(async (req, res) => {
    res.json({ currency: pay.CURRENCY, ...(await pay.rateHistory(req.params.employeeId)) });
  })
);

router.post(
  '/rates',
  validate(
    z.object({
      employeeId: UUID,
      dailyRate: MONEY,
      effectiveFrom: DATE,
      note: z.string().trim().max(255).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const rate = await pay.setRate({ ...req.body, actorId: req.user.id });
    await audit.record(req, {
      action: audit.ACTIONS.SET_PAY_RATE,
      targetEmployeeId: rate.employeeId,
      targetType: 'pay_rate',
      targetId: rate.id,
      details: { dailyRate: rate.dailyRate, effectiveFrom: rate.effectiveFrom },
    });
    res.status(201).json(rate);
  })
);

router.patch(
  '/rates/:id',
  validate(z.object({ id: UUID }), 'params'),
  validate(
    z
      .object({
        dailyRate: MONEY.optional(),
        effectiveFrom: DATE.optional(),
        note: z.string().trim().max(255).optional(),
      })
      .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
  ),
  asyncHandler(async (req, res) => {
    const rate = await pay.updateRate(req.params.id, req.body);
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_PAY_RATE,
      targetEmployeeId: rate.employeeId,
      targetType: 'pay_rate',
      targetId: rate.id,
      details: { dailyRate: rate.dailyRate, effectiveFrom: rate.effectiveFrom },
    });
    res.json(rate);
  })
);

// --- Bonuses ------------------------------------------------------------------------------

const BONUS_ROW = z.object({
  email: z.string().trim().min(1).max(255),
  month: MONTH,
  amount: MONEY,
  reason: z.string().trim().min(1).max(255),
});

router.get(
  '/bonuses',
  validate(z.object({ month: MONTH, employeeId: UUID.optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    res.json({ currency: pay.CURRENCY, month: query.month, rows: await pay.listBonuses(query) });
  })
);

router.post(
  '/bonuses/bulk',
  validate(z.object({ rows: z.array(BONUS_ROW).min(1).max(1000) })),
  asyncHandler(async (req, res) => {
    const result = await pay.bulkAddBonuses(req.body.rows, req.user.id);
    await audit.record(req, { action: audit.ACTIONS.UPLOADED_BONUSES, targetType: 'bonus', details: result });
    res.status(201).json(result);
  })
);

router.post(
  '/bonuses',
  validate(z.object({ employeeId: UUID, month: MONTH, amount: MONEY, reason: z.string().trim().min(1).max(255) })),
  asyncHandler(async (req, res) => {
    const bonus = await pay.addBonus({ ...req.body, actorId: req.user.id });
    await audit.record(req, {
      action: audit.ACTIONS.ADDED_BONUS,
      targetEmployeeId: bonus.employeeId,
      targetType: 'bonus',
      targetId: bonus.id,
      details: { month: bonus.month, amount: bonus.amount, reason: bonus.reason },
    });
    res.status(201).json(bonus);
  })
);

router.delete(
  '/bonuses/:id',
  validate(z.object({ id: UUID }), 'params'),
  asyncHandler(async (req, res) => {
    const bonus = await pay.deleteBonus(req.params.id);
    await audit.record(req, {
      action: audit.ACTIONS.DELETED_BONUS,
      targetEmployeeId: bonus.employeeId,
      targetType: 'bonus',
      targetId: bonus.id,
      details: { month: bonus.month, amount: bonus.amount, reason: bonus.reason },
    });
    res.json({ deleted: true });
  })
);

// --- Finalizing a month -------------------------------------------------------------------

router.get(
  '/finalize/status',
  validate(z.object({ month: MONTH }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await finalizeService.status(q(req).month));
  })
);

router.post(
  '/finalize',
  validate(z.object({ month: MONTH, force: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const result = await finalizeService.finalize({ ...req.body, actorId: req.user.id });
    await audit.record(req, {
      action: audit.ACTIONS.FINALIZED_PAYROLL,
      targetType: 'payroll',
      details: { month: result.month, employees: result.employees, netTotal: result.netTotal, warnings: result.warnings.length },
    });
    res.json(result);
  })
);

router.post(
  '/reopen',
  validate(z.object({ month: MONTH, reason: z.string().trim().min(5, 'Say why in a few words').max(255) })),
  asyncHandler(async (req, res) => {
    const result = await finalizeService.reopen(req.body);
    await audit.record(req, {
      action: audit.ACTIONS.REOPENED_PAYROLL,
      targetType: 'payroll',
      details: { month: result.month, reason: req.body.reason },
    });
    res.json(result);
  })
);

// --- Company holidays ---------------------------------------------------------------------

router.get(
  '/holidays',
  validate(z.object({ year: z.string().regex(/^\d{4}$/) }), 'query'),
  asyncHandler(async (req, res) => {
    res.json({ year: q(req).year, rows: await holidays.list(q(req)) });
  })
);

router.post(
  '/holidays/bulk',
  validate(z.object({ rows: z.array(z.object({ date: DATE, name: z.string().trim().min(1).max(120) })).min(1).max(400) })),
  asyncHandler(async (req, res) => {
    const result = await holidays.bulkAdd(req.body.rows, req.user.id);
    await audit.record(req, { action: audit.ACTIONS.UPLOADED_HOLIDAYS, targetType: 'holiday', details: result });
    res.status(201).json(result);
  })
);

router.post(
  '/holidays',
  validate(z.object({ date: DATE, name: z.string().trim().min(1).max(120), repeats: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const holiday = await holidays.add({ ...req.body, actorId: req.user.id });
    await audit.record(req, { action: audit.ACTIONS.ADDED_HOLIDAY, targetType: 'holiday', targetId: holiday.id, details: holiday });
    res.status(201).json(holiday);
  })
);

// Rename, move to another date, switch "repeats every year" on or off, or just confirm that a
// holiday copied from last year is right (keep).
router.patch(
  '/holidays/:id',
  validate(z.object({ id: UUID }), 'params'),
  validate(
    z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        date: DATE.optional(),
        repeats: z.boolean().optional(),
        keep: z.boolean().optional(),
      })
      .refine((b) => Object.keys(b).length > 0, 'Nothing to change')
  ),
  asyncHandler(async (req, res) => {
    const holiday = await holidays.update(req.params.id, req.body);
    await audit.record(req, { action: audit.ACTIONS.UPDATED_HOLIDAY, targetType: 'holiday', targetId: holiday.id, details: holiday });
    res.json(holiday);
  })
);

router.delete(
  '/holidays/:id',
  validate(z.object({ id: UUID }), 'params'),
  asyncHandler(async (req, res) => {
    const holiday = await holidays.remove(req.params.id);
    await audit.record(req, { action: audit.ACTIONS.REMOVED_HOLIDAY, targetType: 'holiday', targetId: holiday.id, details: holiday });
    res.json({ deleted: true });
  })
);

// --- Emailing payslips --------------------------------------------------------------------

// A handful are sent before the request returns, so "email this payslip" can say how it went.
// Anything larger is left to the background worker and followed through /payslips/status.
const SEND_NOW_LIMIT = 5;

router.post(
  '/payslips/send',
  validate(z.object({ month: MONTH, employeeIds: z.array(UUID).min(1).max(500).optional() })),
  asyncHandler(async (req, res) => {
    const { month, employeeIds } = req.body;
    const queued = await mail.queue({ month, employeeIds, requestedBy: req.user.id });

    await audit.record(req, {
      action: audit.ACTIONS.EMAILED_PAYSLIPS,
      targetType: 'payslip',
      details: { month, everyone: !employeeIds, queued: queued.queued, skipped: queued.skipped.length },
    });

    if (queued.queued > 0 && queued.queued <= SEND_NOW_LIMIT) await mail.processQueue();
    else if (queued.queued > 0) mail.kick();

    res.status(202).json({ ...queued, ...(await mail.status(month)) });
  })
);

router.get(
  '/payslips/status',
  validate(z.object({ month: MONTH }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await mail.status(q(req).month));
  })
);

// --- Payslip ------------------------------------------------------------------------------

// HR's own copy as a PDF. Never stamped DUPLICATE: that mark belongs to a repeat email to the
// employee, not to HR opening the payslip.
router.get(
  '/payslip.pdf',
  validate(z.object({ employeeId: UUID, month: MONTH }), 'query'),
  asyncHandler(async (req, res) => {
    const slip = await pay.payslip(q(req));
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_PAYSLIP,
      targetEmployeeId: slip.employee.id,
      targetType: 'payslip',
      details: { month: slip.month, pdf: true },
    });
    const pdf = await mail.buildPdf(slip);
    const who = slip.employee.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'employee';
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${slip.month}-${who}.pdf"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  })
);

router.get(
  '/payslip',
  validate(z.object({ employeeId: UUID, month: MONTH }), 'query'),
  asyncHandler(async (req, res) => {
    const slip = await pay.payslip(q(req));
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_PAYSLIP,
      targetEmployeeId: slip.employee.id,
      targetType: 'payslip',
      details: { month: slip.month },
    });
    res.json(slip);
  })
);

module.exports = router;
