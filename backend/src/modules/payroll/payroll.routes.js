'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./payroll.service');
const pay = require('./pay.service');
const mail = require('./payslipMail.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const { sendCsv } = require('../../utils/csv');
const audit = require('../../services/audit');

const router = express.Router();
router.use(authenticate, requireAdmin);

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
