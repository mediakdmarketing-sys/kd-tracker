'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./admin.service');
const settings = require('../../services/settings');
const leaveService = require('../leave/leave.service');
const { micLog } = require('../capture/micLog');
const { db } = require('../../db');
const productivityService = require('../productivity/productivity.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged, sendWithRange } = require('../../utils/http');
const { sendCsv } = require('../../utils/csv');
const { badRequest } = require('../../utils/errors');
const audit = require('../../services/audit');
const companies = require('../../services/companies');
const { requireFeature } = require('../../middleware/features');

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

const micLogQuery = z.object({
  from: DATE.optional(),
  to: DATE.optional(),
  department: z.string().trim().max(120).optional(),
});

// Company-wide microphone log: who had a muted mic, from what time to what time.
router.get(
  '/mic-log',
  requireFeature('audioCapture'),
  validate(micLogQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    let employeeIds = null;
    if (query.department) {
      const rows = await db()('employees')
        .where({ department: query.department, company_id: req.user.companyId })
        .select('id');
      employeeIds = rows.map((r) => r.id);
    } else {
      employeeIds = await companies.employeeIds(req.user.companyId);
    }
    const log = await micLog({ employeeIds, from: query.from, to: query.to, timezone: req.user.timezone });
    await audit.record(req, {
      action: audit.ACTIONS.LISTED_AUDIO,
      targetType: 'audio',
      details: { kind: 'mic-log', from: log.from, to: log.to, department: query.department || null, periods: log.periods.length },
    });
    res.json(log);
  })
);

router.get(
  '/dashboard',
  validate(dashboardQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.dashboard({ ...q(req), companyId: req.user.companyId }));
  })
);

router.get(
  '/reports',
  validate(reportQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    // A CSV is one row per shift unless the summary (one row per person) is asked for.
    const daily = query.detail === 'daily' || (query.format === 'csv' && query.detail !== 'summary');
    const rows = daily ? await service.detailedReport({ ...query, companyId: req.user.companyId })
      : await service.report({ ...query, companyId: req.user.companyId });

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

    if (query.format === 'csv' && !daily) {
      return sendCsv(
        res,
        `attendance_summary_${query.from}_to_${query.to}.csv`,
        [
          { key: 'name', label: 'Employee' },
          { key: 'email', label: 'Email' },
          { key: 'department', label: 'Department' },
          { key: 'fullDays', label: 'Full days' },
          { key: 'halfDays', label: 'Half days' },
          { key: 'shortDays', label: 'Less than half day' },
          { key: 'daysPresent', label: 'Shifts' },
          { key: 'workedHours', label: 'Worked (hours)' },
          { key: 'workedFormatted', label: 'Worked' },
          { key: 'leaveDays', label: 'Leave days' },
          { key: 'flaggedDays', label: 'Flagged days' },
        ],
        rows
      );
    }

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
          { key: 'dayWorkedFormatted', label: 'Day total' },
          { key: 'dayType', label: 'Day type' },
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
    res.json(await service.listDepartmentsFull(req.user.companyId));
  })
);

/** Lightweight name-only list — used by dropdowns in reports, payroll, employee form. */
router.get(
  '/departments',
  asyncHandler(async (req, res) => {
    res.json(await service.listDepartments(req.user.companyId));
  })
);

router.post(
  '/departments',
  validate(departmentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.createDepartment({ ...req.body, companyId: req.user.companyId }));
  })
);

router.delete(
  '/departments/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.deleteDepartment(req.params.id, req.user.companyId));
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
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).max(200).optional(),
  // Make a random temporary password instead of typing one; it comes back once in the response.
  generatePassword: z.boolean().optional(),
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
      companyId: req.user.companyId,
      limit: page.limit,
      offset: page.offset,
    });
    res.json(paged(rows, total, page));
  })
);

const CSV_EMPLOYEE_COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'employeeCode', label: 'Employee code' },
  { key: 'department', label: 'Department' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'timezone', label: 'Time zone' },
];

router.get(
  '/employees/export',
  asyncHandler(async (req, res) => {
    const rows = await service.exportEmployees(req.user.companyId);
    await audit.record(req, {
      action: audit.ACTIONS.EXPORTED_REPORT,
      targetType: 'employees',
      details: { kind: 'employees', rows: rows.length },
    });
    sendCsv(res, 'employees.csv', CSV_EMPLOYEE_COLUMNS, rows);
  })
);

const importEmployeesSchema = z.object({
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        email: z.string().trim().toLowerCase().email(),
        department: z.string().trim().max(120).optional(),
        employeeCode: z.string().trim().max(50).optional(),
        timezone: z.string().trim().max(64).optional(),
      })
    )
    .min(1)
    .max(500),
});

router.post(
  '/employees/import',
  validate(importEmployeesSchema),
  asyncHandler(async (req, res) => {
    const result = await service.importEmployees({ rows: req.body.rows, companyId: req.user.companyId });
    await audit.record(req, {
      action: audit.ACTIONS.CREATED_EMPLOYEE,
      targetType: 'employee',
      details: { import: true, created: result.created.length, skipped: result.skipped.length },
    });
    res.status(201).json(result);
  })
);

router.get(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.getEmployee(req.params.id, req.user.companyId));
  })
);

router.post(
  '/employees',
  validate(createEmployeeSchema),
  asyncHandler(async (req, res) => {
    const created = await service.createEmployee({ ...req.body, companyId: req.user.companyId });
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
    const updated = await service.updateEmployee(req.params.id, req.body, req.user.companyId);
    await audit.record(req, {
      action:
        req.body.status === 'inactive'
          ? audit.ACTIONS.DEACTIVATED_EMPLOYEE
          : audit.ACTIONS.UPDATED_EMPLOYEE,
      targetEmployeeId: updated.id,
      targetType: 'employee',
      targetId: updated.id,
      // Never log the password itself, only that one was set.
      details: {
        fields: Object.keys(req.body).map((k) =>
          k === 'password' || k === 'generatePassword' ? 'password:reset' : k
        ),
      },
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
      companyId: req.user.companyId,
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
    res.json(await service.listDepartmentLeaders(department, req.user.companyId));
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
      companyId: req.user.companyId,
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
      companyId: req.user.companyId,
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

const { settingsPatchSchema, assertValidSettings } = require('./settingsSchema');

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json(settings.get(req.user.companyId));
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
    assertValidSettings(settings.get(req.user.companyId), req.body);
    const updated = await settings.update(req.body, { updatedBy: req.user.id, companyId: req.user.companyId });
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_SETTINGS,
      targetType: 'settings',
      details: { fields: Object.keys(req.body) },
    });
    res.json(updated);
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
  // With a department the category applies to that department only; omitted = every department.
  category: z.enum(['productive', 'neutral', 'distracting']),
  department: z.string().trim().max(120).optional(),
});

const appListQuery = z.object({ department: z.string().max(120).optional() });

const attendanceSummaryQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM'),
  to: z.string().regex(/^\d{4}-\d{2}$/, 'must be YYYY-MM'),
});

router.get(
  '/attendance-summary',
  validate(attendanceSummaryQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.attendanceSummary({ ...q(req), companyId: req.user.companyId }));
  })
);

router.get(
  '/productivity',
  requireFeature('idleTracking'),
  validate(productivityQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await productivityService.overview({ ...q(req), companyId: req.user.companyId }));
  })
);

router.get(
  '/app-categories',
  requireFeature('idleTracking'),
  validate(appListQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await productivityService.listApps({ department: q(req).department, companyId: req.user.companyId }));
  })
);

router.patch(
  '/app-categories',
  requireFeature('idleTracking'),
  validate(appCategorySchema),
  asyncHandler(async (req, res) => {
    const result = await productivityService.setCategory({
      ...req.body,
      updatedBy: req.user.id,
      companyId: req.user.companyId,
    });
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_SETTINGS,
      targetType: 'app_category',
      details: { app: req.body.appName, category: req.body.category, department: req.body.department || null },
    });
    res.json(result);
  })
);

router.delete(
  '/app-categories',
  requireFeature('idleTracking'),
  validate(z.object({ appName: z.string().trim().min(1).max(120), department: z.string().max(120).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { appName, department } = q(req);
    const result = await productivityService.resetCategory(appName, department, req.user.companyId);
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
  requireFeature('leave'),
  validate(leaveListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    res.json(await leaveService.listForReviewer({
        memberIds: await companies.employeeIds(req.user.companyId),
        ...query,
      }));
  })
);

router.patch(
  '/leave/:id',
  requireFeature('leave'),
  validate(leaveReviewSchema),
  asyncHandler(async (req, res) => {
    const updated = await leaveService.review(req.params.id, {
      ...req.body,
      reviewedBy: req.user.id,
      memberIds: await companies.employeeIds(req.user.companyId),
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
  requireFeature('leave'),
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await leaveService.getProof(req.params.id, {
      memberIds: await companies.employeeIds(req.user.companyId),
    });
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
