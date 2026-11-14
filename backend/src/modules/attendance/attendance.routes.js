'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./attendance.service');
const projectService = require('../projects/project.service');
const { authenticate } = require('../../middleware/auth');
const { requireSelfOrAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged } = require('../../utils/http');
const audit = require('../../services/audit');
const sse = require('../../services/sse');

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
    const result = await service.punchIn({ employee: req.user, requestedAt: req.body.at });
    res.status(201).json(result);
    // Push to the employee's own shift panel + admins/leaders so the live board updates.
    emitAttendanceChange(req.user, 'working');
  })
);

router.post(
  '/punch-out',
  validate(punchSchema),
  asyncHandler(async (req, res) => {
    const result = await service.punchOut({ employee: req.user, requestedAt: req.body.at });
    res.json(result);
    emitAttendanceChange(req.user, 'punched_out');
  })
);

// The agent says why when it starts a break itself. Only this one value is accepted from a client;
// 'signed_out' is set by the server alone.
const breakStartSchema = punchSchema.extend({ reason: z.enum(['zoom_camera_off']).optional() });

router.post(
  '/break-start',
  validate(breakStartSchema),
  asyncHandler(async (req, res) => {
    const result = await service.startBreak({ employee: req.user, requestedAt: req.body.at, reason: req.body.reason || null });
    res.json(result);
    emitAttendanceChange(req.user, 'on_break');
  })
);

router.post(
  '/break-end',
  validate(punchSchema),
  asyncHandler(async (req, res) => {
    const result = await service.endBreak({ employee: req.user, requestedAt: req.body.at });
    res.json(result);
    emitAttendanceChange(req.user, 'working');
  })
);

/**
 * Emit SSE events after every punch action so connected browsers update immediately.
 *
 * Two events are always sent:
 *   • `status_changed`      — delivered only to the acting employee's tab(s).
 *                             Their ShiftPanel can call /api/attendance/status immediately.
 *   • `attendance_changed`  — delivered to admins and leaders of the employee's department.
 *                             Their LiveBoard / Leader board can refetch /api/admin/dashboard.
 *
 * We pass the new `state` so a client that wants to do an optimistic render can do so, but
 * it should still re-fetch for authoritative data (worked seconds, break times, etc.).
 */
function emitAttendanceChange(employee, state) {
  const payload = {
    employeeId: employee.id,
    name: employee.name,
    department: employee.department || null,
    state,
  };

  // The employee's own tabs
  sse.emit('status_changed', payload, { employeeId: employee.id });

  // Admin dashboard + department leaders
  sse.emit('attendance_changed', payload, { department: employee.department });
}

const switchProjectSchema = z.object({
  // null (via JSON `"projectId": null`) returns to unassigned time; the field is required so
  // an employee cannot leave the intent ambiguous by omitting it.
  projectId: z.string().uuid().nullable(),
  at: z.string().datetime({ offset: true }).optional(),
});

/** Switches the current project for the caller's own open shift. Self only — see the
 * employeeId note on the punch endpoints above; the same reasoning applies here. */
router.post(
  '/project',
  validate(switchProjectSchema),
  asyncHandler(async (req, res) => {
    res.json(
      await projectService.switchProject({
        employee: req.user,
        projectId: req.body.projectId,
        at: req.body.at ? new Date(req.body.at).getTime() : undefined,
      })
    );
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

/** Per-project time breakdown for one calendar date — the employee/admin detail pages. */
router.get(
  '/:employeeId/projects',
  requireSelfOrAdmin('employeeId'),
  validate(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD') }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await projectService.summaryForEmployeeDate(req.params.employeeId, req.query.date));
  })
);

module.exports = router;
