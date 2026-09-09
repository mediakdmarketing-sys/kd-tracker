'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./leader.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdminOrLeader, requireSelfOrAdminOrLeader, loadLeaderDepts } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged } = require('../../utils/http');
const captureService = require('../capture/capture.service');
const attendanceService = require('../attendance/attendance.service');
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
              'consent_monitoring', 'consent_audio')
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

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
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

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  })
);

module.exports = router;
