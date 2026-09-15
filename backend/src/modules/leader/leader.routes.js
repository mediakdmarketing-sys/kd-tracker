'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./leader.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdminOrLeader, requireSelfOrAdminOrLeader, loadLeaderDepts } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged, sendWithRange } = require('../../utils/http');
const captureService = require('../capture/capture.service');
const attendanceService = require('../attendance/attendance.service');
const projectService = require('../projects/project.service');
const leaveService = require('../leave/leave.service');
const audit = require('../../services/audit');

const router = express.Router();
router.use(authenticate, requireAdminOrLeader);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const listQuerySchema = z.object({
  date: DATE.optional(),
  from: DATE.optional(),
  to: DATE.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// ---------------------------------------------------------------------------
// GET /api/leader/departments
// My departments + their members summary
// ---------------------------------------------------------------------------
router.get(
  '/departments',
  loadLeaderDepts(),
  asyncHandler(async (req, res) => {
    res.json(await service.myDepartments(req.user, req.leaderDepts));
  })
);

// ---------------------------------------------------------------------------
// GET /api/leader/members
// All members across all my departments — live board style
// ---------------------------------------------------------------------------
router.get(
  '/members',
  loadLeaderDepts(),
  asyncHandler(async (req, res) => {
    res.json(await service.memberDashboard(req.user, req.leaderDepts));
  })
);

// GET /api/leader/members/:id — basic member info accessible by leaders
router.get(
  '/members/:employeeId/info',
  requireSelfOrAdminOrLeader('employeeId'),
  asyncHandler(async (req, res) => {
    const row = await require('../../db').db()('employees')
      .where({ id: req.params.employeeId })
      .select('id', 'name', 'email', 'department', 'timezone', 'role', 'status',
              'consent_monitoring', 'consent_audio', 'blur_screenshots')
      .first();
    if (!row) throw require('../../utils/errors').notFound('Employee not found');
    const { toBool } = require('../../utils/http');
    res.json({
      id: row.id,
      name: row.name,
      email: row.email,
      department: row.department,
      timezone: row.timezone,
      role: row.role,
      status: row.status,
      blurScreenshots: toBool(row.blur_screenshots),
      consent: {
        monitoring: toBool(row.consent_monitoring),
        audio: toBool(row.consent_audio),
      },
    });
  })
);

// Attendance history for a member
router.get(
  '/members/:employeeId/attendance',
  requireSelfOrAdminOrLeader('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await attendanceService.history({
      employeeId: req.params.employeeId,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });

    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_ATTENDANCE,
      targetEmployeeId: req.params.employeeId,
      targetType: 'attendance',
      details: { from: query.from, to: query.to, rows: rows.length, via: 'leader' },
    });

    res.json(paged(rows, total, page));
  })
);

// Screenshots for a member
router.get(
  '/members/:employeeId/screenshots',
  requireSelfOrAdminOrLeader('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await captureService.listScreenshots({
      employeeId: req.params.employeeId,
      date: query.date,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });

    await audit.record(req, {
      action: audit.ACTIONS.LISTED_SCREENSHOTS,
      targetEmployeeId: req.params.employeeId,
      targetType: 'screenshot',
      details: { date: query.date, count: rows.length, via: 'leader' },
    });

    res.json(paged(rows, total, page));
  })
);

// View individual screenshot file
router.get(
  '/members/:employeeId/screenshots/file/:id',
  requireSelfOrAdminOrLeader('employeeId'),
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await captureService.readFile('screenshots', req.params.id);

    // Verify this screenshot belongs to the stated employee (prevent id-fishing).
    if (row.employee_id !== req.params.employeeId) {
      const { forbidden } = require('../../utils/errors');
      return next(forbidden('Screenshot does not belong to this employee'));
    }

    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_SCREENSHOT,
      targetEmployeeId: row.employee_id,
      targetType: 'screenshot',
      targetId: row.id,
      details: { capturedAt: new Date(Number(row.captured_at)).toISOString(), via: 'leader' },
    });

    sendWithRange(req, res, buffer, contentType);
  })
);

// Audio recordings for a member
router.get(
  '/members/:employeeId/audio',
  requireSelfOrAdminOrLeader('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await captureService.listAudio({
      employeeId: req.params.employeeId,
      date: query.date,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });

    await audit.record(req, {
      action: audit.ACTIONS.LISTED_AUDIO,
      targetEmployeeId: req.params.employeeId,
      targetType: 'audio',
      details: { date: query.date, count: rows.length, via: 'leader' },
    });

    res.json(paged(rows, total, page));
  })
);

// Play individual audio file
router.get(
  '/members/:employeeId/audio/file/:id',
  requireSelfOrAdminOrLeader('employeeId'),
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await captureService.readFile('audio_recordings', req.params.id);

    if (row.employee_id !== req.params.employeeId) {
      const { forbidden } = require('../../utils/errors');
      return next(forbidden('Audio does not belong to this employee'));
    }

    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_AUDIO,
      targetEmployeeId: row.employee_id,
      targetType: 'audio',
      targetId: row.id,
      details: { recordedAt: new Date(Number(row.recorded_at)).toISOString(), via: 'leader' },
    });

    sendWithRange(req, res, buffer, contentType);
  })
);

// Activity summary for a member — counts only, mirrors /api/activity/:id (admin).
router.get(
  '/members/:employeeId/activity',
  requireSelfOrAdminOrLeader('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await captureService.listActivity({
      employeeId: req.params.employeeId,
      date: query.date,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });
    res.json(paged(rows, total, page));
  })
);

// Per-project time breakdown for one calendar date.
router.get(
  '/members/:employeeId/projects',
  requireSelfOrAdminOrLeader('employeeId'),
  validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD') }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await projectService.summaryForEmployeeDate(req.params.employeeId, req.query.date));
  })
);

// --- Leave requests (own-department approval queue) ---------------------------------------

const leaveListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const leaveReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().max(500).optional(),
});

router.get(
  '/leave',
  loadLeaderDepts(),
  validate(leaveListQuery, 'query'),
  asyncHandler(async (req, res) => {
    // Leave review is scoped to regular employees only — never sub-leaders — so a leader's
    // own request (or a sub-leader's) is never visible here and always falls to Admin.
    const memberIds = await service.resolveLeaveMemberIds(req.leaderDepts);
    res.json(await leaveService.listForReviewer({ memberIds, ...q(req) }));
  })
);

router.patch(
  '/leave/:id',
  loadLeaderDepts(),
  validate(leaveReviewSchema),
  asyncHandler(async (req, res) => {
    const memberIds = await service.resolveLeaveMemberIds(req.leaderDepts);
    const updated = await leaveService.review(req.params.id, {
      ...req.body,
      reviewedBy: req.user.id,
      memberIds,
    });
    await audit.record(req, {
      action: audit.ACTIONS.REVIEWED_LEAVE_REQUEST,
      targetEmployeeId: updated.employeeId,
      targetType: 'leave_request',
      targetId: updated.id,
      details: { status: updated.status, via: 'leader' },
    });
    res.json(updated);
  })
);

router.get(
  '/leave/:id/proof',
  loadLeaderDepts(),
  asyncHandler(async (req, res) => {
    const memberIds = await service.resolveLeaveMemberIds(req.leaderDepts);
    const { buffer, contentType, row } = await leaveService.getProof(req.params.id, { memberIds });
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_LEAVE_PROOF,
      targetEmployeeId: row.employee_id,
      targetType: 'leave_request',
      targetId: row.id,
      details: { via: 'leader' },
    });
    sendWithRange(req, res, buffer, contentType);
  })
);

module.exports = router;
