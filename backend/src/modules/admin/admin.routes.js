'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./admin.service');
const settings = require('../../services/settings');
const mailer = require('../../services/mailer');
const payslipTemplate = require('../../services/payslipTemplate');
const projectService = require('../projects/project.service');
const leaveService = require('../leave/leave.service');
const { micLog } = require('../capture/micLog');
const { db } = require('../../db');
const productivityService = require('../productivity/productivity.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin, requireAccountAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, pagination, paged, sendWithRange, toBool } = require('../../utils/http');
const { sendCsv } = require('../../utils/csv');
const { badRequest, forbidden } = require('../../utils/errors');
const audit = require('../../services/audit');
const notifications = require('../../services/notifications');
const birthdays = require('../../services/birthdays');
const bankDetails = require('../../services/bankDetails');
const timesheetService = require('./timesheet.service');

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

// --- Live timesheet and everyone's screenshots -------------------------------------------------

const peopleFilter = {
  from: DATE.optional(),
  to: DATE.optional(),
  department: z.string().trim().max(120).optional(),
  // Part of a name: "ravi" finds "Ravi Kumar" and "Kaaviya Ravi".
  employee: z.string().trim().max(120).optional(),
  // One person picked from the list. Wins over `employee` when both are sent.
  employeeId: z.string().uuid().optional(),
};

// Everyone, name and department only, for the "pick an employee" dropdowns. Former employees are
// included (marked inactive) because their old days and screenshots can still be looked up.
router.get(
  '/employee-options',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await service.listEmployeeOptions());
  })
);

// One row per person per day, live: a shift still running counts its worked time up to now.
router.get(
  '/timesheet',
  validate(z.object(peopleFilter), 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    res.set('Cache-Control', 'no-store');
    res.json(
      await timesheetService.timesheet({
        from: query.from,
        to: query.to,
        department: query.department,
        search: query.employee,
        employeeId: query.employeeId,
      })
    );
  })
);

// Everyone's screenshot records, grouped by person and paged by person. Records only: opening an
// image is its own audited request, and listing is audited here with the filters that were used.
router.get(
  '/screenshots',
  validate(
    z.object({
      ...peopleFilter,
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(20).optional(),
      perPerson: z.coerce.number().int().min(1).max(200).optional(),
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const result = await timesheetService.companyScreenshots({
      from: query.from,
      to: query.to,
      department: query.department,
      search: query.employee,
      employeeId: query.employeeId,
      page: query.page,
      limit: query.limit,
      perPerson: query.perPerson,
    });
    await audit.record(req, {
      action: audit.ACTIONS.LISTED_SCREENSHOTS,
      targetType: 'screenshot',
      details: {
        scope: 'everyone',
        from: result.from,
        to: result.to,
        department: query.department || null,
        employee: query.employee || null,
        employeeId: query.employeeId || null,
        people: result.people.length,
        images: result.people.reduce((n, p) => n + p.shown, 0),
      },
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  })
);

// Company-wide microphone log: who had a muted mic, from what time to what time.
router.get(
  '/mic-log',
  validate(micLogQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    let employeeIds = null;
    if (query.department) {
      const rows = await db()('employees').where({ department: query.department }).select('id');
      employeeIds = rows.map((r) => r.id);
    }
    const log = await micLog({ employeeIds, from: query.from, to: query.to });
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
  validate(z.object({ inUse: z.enum(['0', '1']).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    // inUse=1 adds departments that employees have but nobody created (for filters over people).
    res.json(await service.listDepartments({ includeInUse: q(req).inUse === '1' }));
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
  // May see payroll and payments. Only an account admin can give it (see the route).
  accountAdmin: z.boolean().optional(),
  department: z.string().max(120).optional(),
  employeeCode: z.string().max(50).optional(),
  birthday: DATE.nullable().optional(),
  timezone: z.string().max(64).optional(),
});

const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).max(200).optional(),
  // Make a random temporary password instead of typing one; it comes back once in the response.
  generatePassword: z.boolean().optional(),
  role: z.enum(['admin', 'leader', 'user']).optional(),
  accountAdmin: z.boolean().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  department: z.string().max(120).nullable().optional(),
  employeeCode: z.string().max(50).nullable().optional(),
  birthday: DATE.nullable().optional(),
  timezone: z.string().max(64).optional(),
  // HR can switch audio off, and back on for someone who has already accepted monitoring consent
  // (see admin.service). The employee is told either way.
  consentAudio: z.boolean().optional(),
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

// Birthdays of active employees in a year, for the HR calendar.
router.get(
  '/birthdays',
  validate(z.object({ year: z.string().regex(/^\d{4}$/) }), 'query'),
  asyncHandler(async (req, res) => {
    const year = q(req).year;
    res.json({ year, rows: await birthdays.listYear(Number(year)) });
  })
);

router.get(
  '/employees/:id',
  asyncHandler(async (req, res) => {
    res.json(await service.getEmployee(req.params.id));
  })
);

// --- Bank details (where pay goes) -----------------------------------------------------------
// Account admins only (not ordinary HR admins). Every look at one person's details is audited, with
// whether the account number was shown; saving and removing are audited too (never the values).

const bankSchema = z.object({
  bank: z.string().trim().min(2, 'Enter the bank').max(100),
  branch: z.string().trim().max(100).optional().default(''),
  accountName: z.string().trim().min(2, 'Enter the name on the account').max(100),
  accountNumber: z
    .string()
    .transform((s) => s.replace(/\s+/g, ''))
    .refine((s) => /^[A-Za-z0-9][A-Za-z0-9-]{3,33}$/.test(s), 'Account number: 4 to 34 letters or digits'),
});

// Who has bank details on file (not the details): to warn about people who cannot be paid by file.
router.get(
  '/bank-details/status',
  requireAccountAdmin,
  asyncHandler(async (req, res) => {
    res.json({ rows: await bankDetails.status() });
  })
);

router.get(
  '/employees/:id/bank',
  requireAccountAdmin,
  validate(z.object({ reveal: z.enum(['0', '1']).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    await bankDetails.requireEmployee(req.params.id);
    const revealed = q(req).reveal === '1';
    const result = revealed ? await bankDetails.reveal(req.params.id) : await bankDetails.getMasked(req.params.id);
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_BANK_DETAILS,
      targetEmployeeId: req.params.id,
      targetType: 'bank_details',
      details: { accountNumberShown: revealed && result.hasDetails },
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
  })
);

router.put(
  '/employees/:id/bank',
  requireAccountAdmin,
  validate(bankSchema),
  asyncHandler(async (req, res) => {
    const saved = await bankDetails.save(req.params.id, req.body, req.user.id);
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_BANK_DETAILS,
      targetEmployeeId: req.params.id,
      targetType: 'bank_details',
      details: { bank: req.body.bank },
    });
    res.set('Cache-Control', 'no-store');
    res.json(saved);
  })
);

router.delete(
  '/employees/:id/bank',
  requireAccountAdmin,
  asyncHandler(async (req, res) => {
    await bankDetails.requireEmployee(req.params.id);
    const removed = await bankDetails.remove(req.params.id);
    await audit.record(req, {
      action: audit.ACTIONS.REMOVED_BANK_DETAILS,
      targetEmployeeId: req.params.id,
      targetType: 'bank_details',
    });
    res.json({ removed: removed > 0 });
  })
);

/**
 * The account-admin right changed hands: write it to the audit log and tell every account admin
 * (the person who did it excepted) and the person it concerns. Giving someone the right is a big
 * step, so it never happens quietly. Best effort: a notification that fails never undoes it.
 */
async function announceAccountAdminChange(req, target, granted) {
  await audit.record(req, {
    action: granted ? audit.ACTIONS.GRANTED_ACCOUNT_ADMIN : audit.ACTIONS.REVOKED_ACCOUNT_ADMIN,
    targetEmployeeId: target.id,
    targetType: 'employee',
    targetId: target.id,
    details: { byAccountAdmin: Boolean(req.user.isAccountAdmin) },
  });
  const refId = `acctadmin:${target.id}:${Date.now()}`;
  const watchers = (await notifications.accountAdminIds()).filter((id) => id !== req.user.id && id !== target.id);
  await notifications.notify(watchers, {
    type: 'account_admin_changed',
    title: granted ? `${target.name} was made an account admin` : `${target.name} is no longer an account admin`,
    body: `By ${req.user.name}${req.user.isAccountAdmin ? '' : ' (an HR admin)'}. ${granted ? 'They can now see payroll and payments.' : 'They can no longer see payroll and payments.'}`,
    link: `/admin/employees/${target.id}`,
    refId,
  });
  await notifications.notify([target.id], {
    type: 'account_admin_changed',
    title: granted ? 'You are now an account admin' : 'You are no longer an account admin',
    body: granted ? 'You can see and run payroll and payments.' : 'You can no longer see payroll and payments.',
    link: granted ? '/admin/payroll' : '/admin/dashboard',
    refId: `${refId}:self`,
  });
}

router.post(
  '/employees',
  validate(createEmployeeSchema),
  asyncHandler(async (req, res) => {
    const created = await service.createEmployee(req.body);
    if (created.isAccountAdmin) await announceAccountAdminChange(req, created, true);
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
    // Who may change the account-admin right. An account admin gives and takes it. An ordinary HR
    // admin may only GIVE it, and never to themselves: otherwise they could strip every account
    // admin and keep payroll for themselves, or simply take it. Every change is audited and every
    // account admin is told (see announceAccountAdminChange).
    if (req.body.accountAdmin !== undefined && !req.user.isAccountAdmin) {
      if (req.body.accountAdmin !== true) throw forbidden('Only an account admin can take the account-admin right away');
      if (req.params.id === req.user.id) throw forbidden('You cannot make yourself an account admin');
    }
    const before = await db()('employees').where({ id: req.params.id }).first('role', 'is_account_admin');
    const wasAccountAdmin = Boolean(before && before.role === 'admin' && toBool(before.is_account_admin));
    // An ordinary admin must not be able to reset, rename or deactivate an account admin: resetting
    // a password and signing in as them would be a way round everything above.
    if (!req.user.isAccountAdmin && wasAccountAdmin) {
      throw forbidden('Only an account admin can change an account admin');
    }
    const updated = await service.updateEmployee(req.params.id, req.body);
    if (updated.isAccountAdmin !== wasAccountAdmin) await announceAccountAdminChange(req, updated, updated.isAccountAdmin);
    if (req.body.consentAudio !== undefined) {
      await notifications.notify([updated.id], {
        type: req.body.consentAudio ? 'audio_on' : 'audio_off',
        title: req.body.consentAudio ? 'Audio sampling turned on' : 'Audio sampling turned off',
        body: `HR turned audio sampling ${req.body.consentAudio ? 'on' : 'off'} for your account.`,
        refId: `audio:${updated.id}:${Date.now()}`,
      });
    }
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
          k === 'password' || k === 'generatePassword'
            ? 'password:reset'
            : k === 'consentAudio'
              ? `consentAudio:${req.body.consentAudio ? 'on' : 'off'}`
              : k
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

const HEX_COLOUR = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1a2b3c');

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
  payroll: z
    .object({
      deductIdle: z.boolean().optional(),
      fullDaySeconds: z.number().int().min(3600).max(57600).optional(),
      halfDaySeconds: z.number().int().min(900).max(43200).optional(),
      // Which approved leave is paid, and which weekdays are working days (0 = Sunday).
      paidLeaveTypes: z.array(z.enum(['sick', 'bereavement', 'personal', 'emergency', 'vacation'])).max(5).optional(),
      // 1 = Monday ... 6 = Saturday. Sunday is always a day off and cannot be chosen.
      workDays: z.array(z.number().int().min(1).max(6)).min(1).max(6).optional(),
    })
    .optional(),
  // An empty name clears it; the portal then falls back to its default.
  company: z.object({ name: z.string().trim().max(120).optional() }).optional(),
  // The look of a payslip. Any part can be sent alone; the rest is kept.
  payslip: z
    .object({
      title: z.string().trim().min(1).max(40).optional(),
      footerNote: z.string().trim().max(600).optional(),
      font: z.enum(['sans', 'serif', 'mono']).optional(),
      colors: z
        .object({
          background: HEX_COLOUR.optional(),
          headerBackground: HEX_COLOUR.optional(),
          text: HEX_COLOUR.optional(),
          accent: HEX_COLOUR.optional(),
        })
        .optional(),
      show: z
        .object({
          logo: z.boolean().optional(),
          employeeId: z.boolean().optional(),
          email: z.boolean().optional(),
          department: z.boolean().optional(),
          totalHours: z.boolean().optional(),
          dayBreakdown: z.boolean().optional(),
          rulesNote: z.boolean().optional(),
        })
        .optional(),
    })
    .optional(),
});

/** Settings as the portal sees them: the logo's storage key stays internal. */
function publicSettings(s) {
  const { logoKey, logoContentType, ...company } = s.company;
  return { ...s, company: { name: company.name, hasLogo: Boolean(logoKey), logoUpdatedAt: company.logoUpdatedAt } };
}

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const all = {
      ...publicSettings(settings.get()),
      email: { configured: mailer.isConfigured() },
      // So the "Reset to standard" button needs no copy of the defaults in the portal.
      payslipDefaults: payslipTemplate.DEFAULT_TEMPLATE,
    };
    if (req.user.isAccountAdmin) return res.json(all);

    // An ordinary HR admin sees no payroll settings and no payslip template. The working days stay,
    // because the holiday calendar needs them to say whether a holiday falls on a working day.
    const { payslip, payslipDefaults, payroll, ...rest } = all;
    return res.json({ ...rest, payroll: { workDays: payroll.workDays } });
  })
);

router.patch(
  '/settings',
  validate(settingsPatchSchema),
  asyncHandler(async (req, res) => {
    // Pay rules and the payslip's look are payroll: for account admins only.
    if ((req.body.payroll || req.body.payslip) && !req.user.isAccountAdmin) {
      throw forbidden('Only an account admin can change payroll settings or the payslip template');
    }
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
    if (merged.payroll.halfDaySeconds >= merged.payroll.fullDaySeconds) {
      throw badRequest('The half-day limit must be shorter than the full-day limit');
    }

    const patch = { ...req.body };
    if (patch.company && patch.company.name !== undefined) {
      patch.company = { name: patch.company.name || null };
    }
    const updated = await settings.update(patch, { updatedBy: req.user.id });
    await audit.record(req, {
      action: audit.ACTIONS.UPDATED_SETTINGS,
      targetType: 'settings',
      details: { fields: Object.keys(req.body) },
    });
    res.json(publicSettings(updated));
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
  employeeId: z.string().max(64).optional(),
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
    res.json(await service.attendanceSummary(q(req)));
  })
);

router.get(
  '/productivity',
  validate(productivityQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await productivityService.overview(q(req)));
  })
);

router.get(
  '/app-categories',
  validate(appListQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await productivityService.listApps({ department: q(req).department }));
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
      details: { app: req.body.appName, category: req.body.category, department: req.body.department || null },
    });
    res.json(result);
  })
);

router.delete(
  '/app-categories',
  validate(z.object({ appName: z.string().trim().min(1).max(120), department: z.string().max(120).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { appName, department } = q(req);
    const result = await productivityService.resetCategory(appName, department);
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
