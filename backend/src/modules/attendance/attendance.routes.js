'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./attendance.service');
const { authenticate } = require('../../middleware/auth');
const { requireSelfOrAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged } = require('../../utils/http');
const audit = require('../../services/audit');

const router = express.Router();
router.use(authenticate);

const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD').optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD').optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * The spec's punch endpoints take { employeeId }. It is ignored on purpose: the acting
 * employee comes from the verified token, so a client cannot punch in as somebody else.
 *
 * Sprint 6.5 — all four accept an optional `at` (ISO 8601), which an agent replaying a queued
 * event sends to say when it really happened. The server decides whether to honour it: see
 * utils/eventTime and ADR-0004. `source` is derived, never accepted from the client.
 */
const punchSchema = z.object({
  at: z.string().datetime({ offset: true }).optional(),
  // Accepted and ignored, so an agent written against the spec's payload still works.
  employeeId: z.string().optional(),
});

router.post(
  '/punch-in',
  validate(punchSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.punchIn({ employee: req.user, requestedAt: req.body.at }));
  })
);

router.post(
  '/punch-out',
  validate(punchSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.punchOut({ employee: req.user, requestedAt: req.body.at }));
  })
);

router.post(
  '/break-start',
  validate(punchSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.startBreak({ employee: req.user, requestedAt: req.body.at }));
  })
);

router.post(
  '/break-end',
  validate(punchSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.endBreak({ employee: req.user, requestedAt: req.body.at }));
  })
);

/** Live state for the tray icon / portal header. */
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    res.json(await service.currentStatus(req.user));
  })
);

router.get(
  '/me',
  validate(dateRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.history({
      employeeId: req.user.id,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });
    res.json(paged(rows, total, page));
  })
);

/** Admins may read anyone's history; an employee may read only their own. */
router.get(
  '/:employeeId',
  requireSelfOrAdmin('employeeId'),
  validate(dateRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.history({
      employeeId: req.params.employeeId,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });

    if (req.user.role === 'admin' && req.user.id !== req.params.employeeId) {
      await audit.record(req, {
        action: audit.ACTIONS.VIEWED_ATTENDANCE,
        targetEmployeeId: req.params.employeeId,
        targetType: 'attendance',
        details: { from: query.from, to: query.to, rows: rows.length },
      });
    }

    res.json(paged(rows, total, page));
  })
);

module.exports = router;
