'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./admin.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged } = require('../../utils/http');
const { sendCsv } = require('../../utils/csv');
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

module.exports = router;
