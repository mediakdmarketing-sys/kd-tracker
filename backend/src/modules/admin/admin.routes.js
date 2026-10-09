'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./admin.service');
const settings = require('../../services/settings');
const projectService = require('../projects/project.service');
const leaveService = require('../leave/leave.service');
const productivityService = require('../productivity/productivity.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged, sendWithRange } = require('../../utils/http');
const { sendCsv } = require('../../utils/csv');
const { badRequest } = require('../../utils/errors');
const audit = require('../../services/audit');

const router = express.Router();

// Every route below is admin-only, enforced here rather than per-route so a new route cannot
// be added without the gate (story A-6).
router.use(authenticate, requireAdmin);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const dashboardQuery = z.object({ date: DATE.optional() });

const reportQuery = z.object({
  from: DATE,
  to: DATE,
  department: z.string().max(120).optional(),
  employeeId: z.string().uuid().optional(),
  format: z.enum(['json', 'csv']).optional(),
  detail: z.enum(['summary', 'daily']).optional(),
});

router.get(
  '/dashboard',
  validate(dashboardQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.dashboard(q(req)));
  })
);

router.get(
  '/reports',
  validate(reportQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const daily = query.detail === 'daily' || query.format === 'csv';
    const rows = daily ? await service.detailedReport(query) : await service.report(query);

    await audit.record(req, {
      action: audit.ACTIONS.EXPORTED_REPORT,
      targetEmployeeId: query.employeeId || null,
      targetType: 'report',
      details: {
        from: query.from,
        to: query.to,
        department: query.department || null,
        format: query.format || 'json',
        rows: rows.length,
      },
    });

    if (query.format === 'csv') {
      return sendCsv(
        res,
        `attendance_${query.from}_to_${query.to}.csv`,
        [
          { key: 'name', label: 'Employee' },
          { key: 'email', label: 'Email' },
          { key: 'department', label: 'Department' },
          { key: 'date', label: 'Date' },
          { key: 'punchIn', label: 'Punch In' },
          { key: 'punchOut', label: 'Punch Out' },
          { key: 'workedFormatted', label: 'Worked' },
          { key: 'workedHours', label: 'Worked (hours)' },
          { key: 'breakFormatted', label: 'Break' },
          { key: 'idleFormatted', label: 'Idle' },
          { key: 'overBreak', label: 'Over Break' },
          { key: 'autoClosed', label: 'Auto Closed' },
          { key: 'needsReview', label: 'Needs Review' },
          { key: 'reviewReason', label: 'Review Reason' },
        ],
        rows
      );
    }

    return res.json({ from: query.from, to: query.to, rows });
  })
);

// --- Departments CRUD -------------------------------------------------------------------

const departmentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
});

/** Full list — includes id, description, createdAt. Used by the departments page. */
router.get(
  '/departments/full',
  asyncHandler(async (req, res) => {
    res.json(await service.listDepartmentsFull());
  })
);

/** Lightweight name-only list — used by dropdowns in reports, payroll, employee form. */
router.get(
  '/departments',
  asyncHandler(async (req, res) => {
    res.json(await service.listDepartments());
  })
);

router.post(
  '/departments',
  validate(departmentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createDepartment(req.body));
  })
);

router.delete(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.deleteDepartment(req.params.id));
  })
);

// --- Employees ---------------------------------------------------------------------------

const employeeListQuery = z.object({
  department: z.string().max(120).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const createEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200).optional(),
  role: z.enum(['admin', 'leader', 'user']).optional(),
  department: z.string().max(120).optional(),
  employeeCode: z.string().max(50).optional(),
  timezone: z.string().max(64).optional(),
});

const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(['admin', 'leader', 'user']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  department: z.string().max(120).nullable().optional(),
  employeeCode: z.string().max(50).nullable().optional(),
  timezone: z.string().max(64).optional(),
  // Only revocation is accepted — consent is the employee's to give (see admin.service).
  consentAudio: z.literal(false).optional(),
  // Display preference, not consent — admin-controlled in both directions.
  blurScreenshots: z.boolean().optional(),
});

router.get(
  '/employees',
  validate(employeeListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.listEmployees({
      ...query,
      limit: page.limit,
      offset: page.offset,
    });
    res.json(paged(rows, total, page));
  })
);

router.get(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.getEmployee(req.params.id));
  })
);

router.post(
  '/employees',
  validate(createEmployeeSchema),
  asyncHandler(async (req, res) => {
    const created = await service.createEmployee(req.body);
    await audit.record(req, {
      action: audit.ACTIONS.CREATED_EMPLOYEE,
      targetEmployeeId: created.id,
      targetType: 'employee',
      targetId: created.id,
      details: { email: created.email, role: created.role },
    });
    res.status(201).json(created);
  })
);

router.patch(
  '/employees/:id',
  validate(updateEmployeeSchema),
  asyncHandler(async (req, res) => {
    const updated = await service.updateEmployee(req.params.id, req.body);
    await audit.record(req, {
      action:
        req.body.status === 'inactive'
          ? audit.ACTIONS.DEACTIVATED_EMPLOYEE
          : audit.ACTIONS.UPDATED_EMPLOYEE,
      targetEmployeeId: updated.id,
      targetType: 'employee',
      targetId: updated.id,
      // Never log the password itself, only that one was set.
      details: { fields: Object.keys(req.body).map((k) => (k === 'password' ? 'password:reset' : k)) },
    });
    res.json(updated);
  })
);

// --- Audit trail (story D-5) --------------------------------------------------------------

const auditQuery = z.object({
  adminId: z.string().uuid().optional(),
  targetEmployeeId: z.string().uuid().optional(),
  action: z.string().max(80).optional(),
  from: DATE.optional(),
  to: DATE.optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// Read-only by design: there is no route that updates or deletes an audit row.
router.get(
  '/audit-logs',
  validate(auditQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.listAuditLogs({
      ...query,
      limit: page.limit,
      offset: page.offset,
    });
    res.json(paged(rows, total, page));
  })
);

// --- Department leaders (hierarchy management) -------------------------------------------

const deptLeaderSchema = z.object({
  department: z.string().min(1).max(120),
  employeeId: z.string().uuid(),
});

/** List all leader assignments, optionally filtered by department. */
router.get(
  '/department-leaders',
  asyncHandler(async (req, res) => {
    const { department } = req.query;
    res.json(await service.listDepartmentLeaders(department));
  })
);

/** Assign an employee as leader of a department. */
router.post(
  '/department-leaders',
  validate(deptLeaderSchema),
  asyncHandler(async (req, res) => {
    const result = await service.assignLeader({
      department: req.body.department,
      employeeId: req.body.employeeId,
      assignedBy: req.user.id,
    });
    await audit.record(req, {
      action: audit.ACTIONS.ASSIGNED_LEADER,
      targetEmployeeId: req.body.employeeId,
      targetType: 'department_leader',
      details: { department: req.body.department },
    });
    res.status(201).json(result);
  })
);

/** Remove a leader from a department. */
router.delete(
  '/department-leaders',
  validate(deptLeaderSchema),
  asyncHandler(async (req, res) => {
    await service.removeLeader({
      department: req.body.department,
      employeeId: req.body.employeeId,
    });
    await audit.record(req, {
      action: audit.ACTIONS.REMOVED_LEADER,
      targetEmployeeId: req.body.employeeId,
      targetType: 'department_leader',
      details: { department: req.body.department },
    });
    res.json({ removed: true });
  })
);

// --- Settings (Settings module) ----------------------------------------------------------
//
// Deliberately not everything in config/index.js — only the operational values that are safe
// to change without a restart/redeploy. DB connection, storage credentials, JWT secrets,
// CORS, port, and cron schedules stay in .env; see backend/src/services/settings.js's own
// comment for the full reasoning.

const settingsPatchSchema = z.object({
  capture: z
    .object({
      screenshotMinIntervalSec: z.number().int().min(30).max(3600).optional(),
      screenshotMaxIntervalSec: z.number().int().min(30).max(3600).optional(),
      audioSampleDurationSec: z.number().int().min(10).max(1800).optional(),
      audioSampleGapSec: z.number().int().min(10).max(3600).optional(),
    })
    .optional(),
  shift: z
    .object({
      targetSeconds: z.number().int().min(1800).max(57600).optional(),
      breakAllowanceSeconds: z.number().int().min(0).max(14400).optional(),
      idleThresholdSeconds: z.number().int().min(60).max(3600).optional(),
      autoCloseHours: z.number().int().min(1).max(48).optional(),
    })
    .optional(),
  retention: z.object({ days: z.number().int().min(1).max(365).optional() }).optional(),
  payroll: z.object({ deductIdle: z.boolean().optional() }).optional(),
});

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(settings.get());
  })
);

router.patch(
  '/settings',
  validate(settingsPatchSchema),
  asyncHandler(async (req, res) => {
    // zod validates each field's own type/range; a screenshot min > max (or similar
    // cross-field mistake) only becomes checkable once the patch is merged onto whatever is
    // NOT being changed in this request — so that check happens here, against the merged
    // result, rather than as a zod .refine() on the raw partial patch.
    const current = settings.get();
    const merged = {
      capture: { ...current.capture, ...req.body.capture },
      shift: { ...current.shift, ...req.body.shift },
      retention: { ...current.retention, ...req.body.retention },
      payroll: { ...current.payroll, ...req.body.payroll },
    };
    if (merged.capture.screenshotMinIntervalSec > merged.capture.screenshotMaxIntervalSec) {
      throw badRequest('Screenshot minimum interval must not exceed the maximum interval');
    }

    const updated = await settings.update(req.body, { updatedBy: req.user.id });
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_SETTINGS,
      targetType: 'settings',
      details: { fields: Object.keys(req.body) },
    });
    res.json(updated);
  })
);

// --- Projects (project/task time tracking) ------------------------------------------------
//
// Employees only ever see active projects, via GET /api/projects (project.routes.js) — this
// admin surface is where they get created, edited, and archived. Projects are never deleted:
// archiving is the only removal, so historical time entries (project_time_entries) always
// resolve to a real name instead of "unknown project".

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
  client: z.string().trim().max(200).optional(),
  department: z.string().max(120).optional(),
});

const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  client: z.string().trim().max(200).nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  status: z.enum(['active', 'archived']).optional(),
});

router.get(
  '/projects',
  asyncHandler(async (req, res) => {
    res.json(await projectService.listProjects({ status: req.query.status }));
  })
);

router.post(
  '/projects',
  validate(createProjectSchema),
  asyncHandler(async (req, res) => {
    const created = await projectService.createProject(req.body);
    res.status(201).json(created);
  })
);

router.patch(
  '/projects/:id',
  validate(updateProjectSchema),
  asyncHandler(async (req, res) => {
    res.json(await projectService.updateProject(req.params.id, req.body));
  })
);

// --- Productivity (score + app categories) -------------------------------------------------

const productivityQuery = z.object({
  from: DATE,
  to: DATE,
  department: z.string().max(120).optional(),
});

const appCategorySchema = z.object({
  appName: z.string().trim().min(1).max(120),
  category: z.enum(['productive', 'neutral', 'distracting']),
});

router.get(
  '/productivity',
  validate(productivityQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await productivityService.overview(q(req)));
  })
);

router.get(
  '/app-categories',
  asyncHandler(async (req, res) => {
    res.json(await productivityService.listApps());
  })
);

router.patch(
  '/app-categories',
  validate(appCategorySchema),
  asyncHandler(async (req, res) => {
    const result = await productivityService.setCategory({ ...req.body, updatedBy: req.user.id });
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_SETTINGS,
      targetType: 'app_category',
      details: { app: req.body.appName, category: req.body.category },
    });
    res.json(result);
  })
);

router.delete(
  '/app-categories',
  validate(z.object({ appName: z.string().trim().min(1).max(120) }), 'query'),
  asyncHandler(async (req, res) => {
    const { appName } = q(req);
    const result = await productivityService.resetCategory(appName);
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_SETTINGS,
      targetType: 'app_category',
      details: { app: appName, category: 'reset' },
    });
    res.json(result);
  })
);

// --- Leave requests (approval queue) -------------------------------------------------------
//
// Admin sees and decides on every request, unfiltered by department (memberIds: null —
// leave.service.js's convention for "no restriction", matching resolveMemberIds elsewhere).

const leaveListQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  from: DATE.optional(),
  to: DATE.optional(),
});

const leaveReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  reviewNote: z.string().trim().max(500).optional(),
});

router.get(
  '/leave',
  validate(leaveListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    res.json(await leaveService.listForReviewer({ memberIds: null, ...query }));
  })
);

router.patch(
  '/leave/:id',
  validate(leaveReviewSchema),
  asyncHandler(async (req, res) => {
    const updated = await leaveService.review(req.params.id, {
      ...req.body,
      reviewedBy: req.user.id,
      memberIds: null,
    });
    await audit.record(req, {
      action: audit.ACTIONS.REVIEWED_LEAVE_REQUEST,
      targetEmployeeId: updated.employeeId,
      targetType: 'leave_request',
      targetId: updated.id,
      details: { status: updated.status },
    });
    res.json(updated);
  })
);

router.get(
  '/leave/:id/proof',
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await leaveService.getProof(req.params.id, { isAdmin: true });
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_LEAVE_PROOF,
      targetEmployeeId: row.employee_id,
      targetType: 'leave_request',
      targetId: row.id,
    });
    sendWithRange(req, res, buffer, contentType);
  })
);

module.exports = router;
