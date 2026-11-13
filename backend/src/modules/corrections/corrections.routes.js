'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./corrections.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const audit = require('../../services/audit');

const router = express.Router();
router.use(authenticate);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const CLOCK = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM');

const createSchema = z.object({
  // A shift being changed, or just a date when a whole shift was forgotten.
  attendanceId: z.string().max(64).optional(),
  date: DATE.optional(),
  punchIn: CLOCK,
  punchOut: CLOCK,
  reason: z.string().trim().min(1).max(500),
});

router.post(
  '/',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createRequest({ employee: req.user, ...req.body }));
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json(await service.listForEmployee(req.user.id));
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await service.cancelRequest(req.params.id, req.user.id));
  })
);

// HR: what is waiting, and the decision.
router.get(
  '/review',
  requireAdmin,
  validate(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await service.listForReview({ status: q(req).status }));
  })
);

router.post(
  '/:id/review',
  requireAdmin,
  validate(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() })),
  asyncHandler(async (req, res) => {
    const { row, view } = await service.review(req.params.id, {
      status: req.body.status,
      reviewedBy: req.user.id,
      note: req.body.note,
    });
    await audit.record(req, {
      action: audit.ACTIONS.REVIEWED_TIME_CORRECTION,
      targetEmployeeId: row.employee_id,
      targetType: 'time_correction',
      targetId: row.id,
      details: { status: req.body.status, date: row.date, attendanceId: row.attendance_id },
    });
    res.json(view);
  })
);

module.exports = router;
