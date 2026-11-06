'use strict';

// An employee's own payslips. Only finalized months are shown (nothing that could still change),
// and only ever the signed-in person's own: the employee is taken from the session, never from the
// request, so there is nothing to tamper with to read someone else's.

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const { notFound } = require('../../utils/errors');
const settings = require('../../services/settings');
const finalizeService = require('./finalize.service');
const mail = require('./payslipMail.service');
const pay = require('./pay.service');
const { db } = require('../../db');

const router = express.Router();
router.use(authenticate);

const MONTH = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

/** The employee's frozen payslip for a month, or 404 when it is not finalized (or they have none). */
async function ownSlip(employeeId, month) {
  const row = await db()('payroll_summary').where({ employee_id: employeeId, month }).whereNotNull('snapshot').first('month');
  if (!row) throw notFound('There is no payslip for that month yet.');
  return pay.payslip({ employeeId, month });
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ currency: pay.CURRENCY, rows: await finalizeService.monthsFor(req.user.id) });
  })
);

router.get(
  '/:month',
  validate(MONTH, 'params'),
  asyncHandler(async (req, res) => {
    const slip = await ownSlip(req.user.id, req.params.month);
    const s = settings.get();
    res.json({
      slip,
      // What the page needs to draw it: the company's look, without the admin-only settings.
      company: { name: s.company.name, hasLogo: Boolean(s.company.logoKey), logoUpdatedAt: s.company.logoUpdatedAt },
      template: s.payslip,
    });
  })
);

router.get(
  '/:month/pdf',
  validate(MONTH, 'params'),
  asyncHandler(async (req, res) => {
    const slip = await ownSlip(req.user.id, req.params.month);
    const pdf = await mail.buildPdf(slip);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${slip.month}.pdf"`,
      'Cache-Control': 'no-store',
    });
    res.send(pdf);
  })
);

module.exports = router;
