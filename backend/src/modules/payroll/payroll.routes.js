'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./payroll.service');
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

module.exports = router;
