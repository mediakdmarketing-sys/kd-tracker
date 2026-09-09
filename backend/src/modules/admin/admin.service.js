'use strict';

const bcrypt = require('bcryptjs');
const config = require('../../config');
const { db, isUniqueViolation } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toBool, toIso } = require('../../utils/http');
const { conflict, notFound, badRequest } = require('../../utils/errors');
const { publicEmployee } = require('../auth/auth.service');

/**
 * Story D-1 — "who is working right now".
 *
 * One pass over today's attendance plus the last activity ping per employee. Deliberately
 * poll-friendly (a few small queries) rather than a socket push; see the Sprint 4 deferral
 * note in docs/SPRINT_PLAN.md.
 */
async function dashboard({ date } = {}) {
  // Select only the columns the dashboard needs — avoids transferring password_hash,
  // consent fields, and other columns that are never used here.
  const employees = await db()('employees')
    .where({ status: 'active' })
    .orderBy('name')
    .select('id', 'name', 'email', 'department', 'timezone');

  // Each employee's "today" is their own local date unless a date is explicitly requested.
  const nowMs = t.now();
  const employeeDates = employees.map((e) => date || t.localDate(nowMs, e.timezone));
  const dates = new Set(employeeDates);

  const employeeIds = employees.map((e) => e.id);

  // Today's shifts, plus every shift that is still open whatever date it belongs to.
  // Load only the employees on this dashboard rather than the full table.
  const attendance = await db()('attendance')
    .whereIn('employee_id', employeeIds)
    .where((b) => b.whereIn('date', [...dates]).orWhereIn('status', ['open', 'on_break']))
    .orderBy('punch_in', 'desc');

  // Only open breaks for employees currently on the board.
  const openBreaks = attendance.length
    ? await db()('breaks')
        .whereIn(
          'attendance_id',
          attendance.filter((a) => a.status === 'on_break').map((a) => a.id)
        )
        .whereNull('break_end')
    : [];

  const since = t.hoursAgo(24);
  const lastActivity = await db()('activity_logs')
    .whereIn('employee_id', employeeIds)
    .where('timestamp', '>=', since)
    .groupBy('employee_id')
    .select('employee_id')
    .max({ last_seen: 'timestamp' });
  const lastSeenBy = Object.fromEntries(lastActivity.map((r) => [r.employee_id, Number(r.last_seen)]));

  // Group attendance by employee once, so each employee row below is O(1) not O(n).
  const attendanceByEmployee = attendance.reduce((acc, a) => {
    (acc[a.employee_id] ||= []).push(a);
    return acc;
  }, {});
  const rows = employees.map((emp) => {
    const empDate = date || t.localDate(nowMs, emp.timezone);
    const mine = attendanceByEmployee[emp.id] || [];
    const current = mine.find((s) => s.status === 'open' || s.status === 'on_break');

    const todays = mine.filter((a) => a.date === empDate);
    // An open shift that started before today still belongs on the board.
    const shifts = current && !todays.includes(current) ? [current, ...todays] : todays;

    const workedToday = shifts.reduce((sum, s) => {
      if (s.total_worked_seconds !== null && s.total_worked_seconds !== undefined) {
        return sum + s.total_worked_seconds;
      }
      // Live shift: worked time so far, net of breaks taken so far.
      const elapsed = t.secondsBetween(Number(s.punch_in), nowMs);
      return sum + Math.max(0, elapsed - (s.total_break_seconds || 0));
    }, 0);

    const breakToday = shifts.reduce((sum, s) => sum + (s.total_break_seconds || 0), 0);
    const runningBreak = current ? openBreaks.find((b) => b.attendance_id === current.id) : null;
    const liveBreak = runningBreak
      ? breakToday + t.secondsBetween(Number(runningBreak.break_start), nowMs)
      : breakToday;

    let state = 'not_started';
    if (current) state = current.status === 'on_break' ? 'on_break' : 'working';
    else if (shifts.length) state = 'punched_out';

    const lastSeen = lastSeenBy[emp.id] || null;

    return {
      employeeId: emp.id,
      name: emp.name,
      email: emp.email,
      department: emp.department,
      date: empDate,
      state,
      // True when the employee is still on a shift that began on an earlier calendar day.
      overnight: Boolean(current && current.date !== empDate),
      shiftDate: current ? current.date : shifts[0]?.date || empDate,
      punchIn: current ? toIso(current.punch_in) : shifts[0] ? toIso(shifts[0].punch_in) : null,
      punchOut: !current && shifts[0] ? toIso(shifts[0].punch_out) : null,
      workedSeconds: workedToday,
      breakSeconds: liveBreak,
      overBreak: liveBreak > config.shift.breakAllowanceSeconds,
      shiftTargetSeconds: config.shift.targetSeconds,
      lastActivityAt: toIso(lastSeen),
      // A live shift with no activity ping inside the idle window is probably idle rather
      // than working — surfaced here so HR sees it without digging through logs.
      appearsIdle:
        state === 'working' &&
        (!lastSeen || nowMs - lastSeen > config.shift.idleThresholdSeconds * 1000),
      needsReview: toBool(current?.needs_review || shifts[0]?.needs_review),
    };
  });

  const summary = {
    total: rows.length,
    working: rows.filter((r) => r.state === 'working').length,
    onBreak: rows.filter((r) => r.state === 'on_break').length,
    punchedOut: rows.filter((r) => r.state === 'punched_out').length,
    notStarted: rows.filter((r) => r.state === 'not_started').length,
    flagged: rows.filter((r) => r.needsReview || r.overBreak).length,
  };

  return { generatedAt: toIso(nowMs), summary, employees: rows };
}

/** Story D-2 — attendance rolled up per employee over a range, optionally by department. */
async function report({ from, to, department, employeeId }) {
  if (!from || !to) throw badRequest('from and to dates are required (YYYY-MM-DD)');
  if (from > to) throw badRequest('`from` must not be after `to`');

  const query = db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .whereBetween('a.date', [from, to]);

  if (department) query.andWhere('e.department', department);
  if (employeeId) query.andWhere('a.employee_id', employeeId);

  const rows = await query
    .groupBy('a.employee_id', 'e.name', 'e.email', 'e.department')
    .select('a.employee_id', 'e.name', 'e.email', 'e.department')
    .sum({ worked_seconds: 'a.total_worked_seconds' })
    .sum({ break_seconds: 'a.total_break_seconds' })
    .sum({ idle_seconds: 'a.idle_seconds' })
    .count({ days_present: 'a.id' })
    .orderBy('e.name');

  // Flag counts need a second pass: SUM over a boolean is not portable across SQLite/Postgres.
  const flagQuery = db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .whereBetween('a.date', [from, to])
    .andWhere((b) => b.where('a.needs_review', true).orWhere('a.over_break', true));
  if (department) flagQuery.andWhere('e.department', department);
  if (employeeId) flagQuery.andWhere('a.employee_id', employeeId);

  const flags = await flagQuery.groupBy('a.employee_id').select('a.employee_id').count({ c: '*' });
  const flagsBy = Object.fromEntries(flags.map((f) => [f.employee_id, Number(f.c)]));

  return rows.map((r) => {
    const worked = Number(r.worked_seconds) || 0;
    return {
      employeeId: r.employee_id,
      name: r.name,
      email: r.email,
      department: r.department,
      daysPresent: Number(r.days_present) || 0,
      workedSeconds: worked,
      workedHours: t.secondsToHours(worked),
      workedFormatted: t.formatDuration(worked),
      breakSeconds: Number(r.break_seconds) || 0,
      idleSeconds: Number(r.idle_seconds) || 0,
      flaggedDays: flagsBy[r.employee_id] || 0,
    };
  });
}

/** Day-by-day rows behind the summary, for drill-down and for the CSV export. */
async function detailedReport({ from, to, department, employeeId }) {
  const query = db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .whereBetween('a.date', [from, to]);

  if (department) query.andWhere('e.department', department);
  if (employeeId) query.andWhere('a.employee_id', employeeId);

  const rows = await query
    .orderBy([{ column: 'e.name' }, { column: 'a.date' }])
    .select(
      'a.id',
      'a.date',
      'a.punch_in',
      'a.punch_out',
      'a.total_worked_seconds',
      'a.total_break_seconds',
      'a.idle_seconds',
      'a.over_break',
      'a.auto_closed',
      'a.needs_review',
      'a.review_reason',
      'a.status',
      'e.name',
      'e.email',
      'e.department',
      'e.id as employee_id'
    );

  return rows.map((r) => ({
    employeeId: r.employee_id,
    name: r.name,
    email: r.email,
    department: r.department,
    date: r.date,
    punchIn: toIso(r.punch_in),
    punchOut: toIso(r.punch_out),
    status: r.status,
    workedSeconds: r.total_worked_seconds || 0,
    workedHours: t.secondsToHours(r.total_worked_seconds || 0),
    workedFormatted: t.formatDuration(r.total_worked_seconds || 0),
    breakFormatted: t.formatDuration(r.total_break_seconds || 0),
    idleFormatted: t.formatDuration(r.idle_seconds || 0),
    overBreak: toBool(r.over_break),
    autoClosed: toBool(r.auto_closed),
    needsReview: toBool(r.needs_review),
    reviewReason: r.review_reason || '',
  }));
}

// --- Employee administration (story D-6) ------------------------------------------------

async function listEmployees({ department, status, search, limit, offset }) {
  const base = db()('employees');
  if (department) base.andWhere({ department });
  if (status) base.andWhere({ status });
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    base.andWhere((b) =>
      b.whereRaw('LOWER(name) LIKE ?', [like]).orWhereRaw('LOWER(email) LIKE ?', [like])
    );
  }

  const [{ count }] = await base.clone().count({ count: '*' });
  const rows = await base.clone().orderBy('name').limit(limit).offset(offset);
  return { rows: rows.map(publicEmployee), total: Number(count) };
}

async function getEmployee(id) {
  const row = await db()('employees').where({ id }).first();
  if (!row) throw notFound('Employee not found');
  return publicEmployee(row);
}

async function createEmployee(input) {
  const existing = await db()('employees')
    .whereRaw('LOWER(email) = ?', [input.email.toLowerCase()])
    .first();
  if (existing) throw conflict('An employee with that work email already exists');

  const nowMs = t.now();
  const row = {
    id: uuid(),
    name: input.name,
    email: input.email.toLowerCase(),
    password_hash: input.password
      ? await bcrypt.hash(input.password, config.auth.bcryptRounds)
      : null,
    role: input.role || 'user',
    department: input.department || null,
    employee_code: input.employeeCode || null,
    status: 'active',
    timezone: input.timezone || 'Asia/Kolkata',
    consent_monitoring: false,
    consent_audio: false,
    consent_given_at: null,
    consent_version: null,
    created_at: nowMs,
    updated_at: nowMs,
  };

  try {
    await db()('employees').insert(row);
  } catch (err) {
    // The SELECT-then-INSERT above has a race: two admins (or a double-click) creating the
    // same email at once can both pass the pre-check. The DB's UNIQUE constraint is the real
    // guard; without this catch a collision here would surface as a raw 500 instead of the
    // same clean 409 the pre-check gives on the non-concurrent path.
    if (!isUniqueViolation(err)) throw err;
    throw conflict('An employee with that work email already exists');
  }
  return publicEmployee(row);
}

async function updateEmployee(id, input) {
  const row = await db()('employees').where({ id }).first();
  if (!row) throw notFound('Employee not found');

  const patch = { updated_at: t.now() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.department !== undefined) patch.department = input.department;
  if (input.employeeCode !== undefined) patch.employee_code = input.employeeCode;
  if (input.role !== undefined) patch.role = input.role;
  if (input.status !== undefined) patch.status = input.status;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.password) patch.password_hash = await bcrypt.hash(input.password, config.auth.bcryptRounds);

  // Audio consent belongs to the employee. HR may turn it off (e.g. on a written request),
  // but must never be able to turn it on for someone.
  if (input.consentAudio === false) patch.consent_audio = false;

  await db()('employees').where({ id }).update(patch);

  if (input.status === 'inactive' || input.password) {
    // Deactivating or resetting a password must end existing sessions immediately — reason
    // 'admin' so the rotation grace window does not keep them alive for another two minutes.
    await db()('refresh_tokens')
      .where({ employee_id: id })
      .whereNull('revoked_at')
      .update({ revoked_at: t.now(), revoked_reason: 'admin' });
  }

  // Construct the response from known state rather than doing a post-update re-read.
  return publicEmployee({ ...row, ...patch });
}

async function listAuditLogs({ adminId, targetEmployeeId, action, from, to, limit, offset }) {
  const base = db()('audit_logs as l').leftJoin('employees as e', 'e.id', 'l.admin_id');
  if (adminId) base.andWhere('l.admin_id', adminId);
  if (targetEmployeeId) base.andWhere('l.target_employee_id', targetEmployeeId);
  if (action) base.andWhere('l.action', action);
  if (from) base.andWhere('l.timestamp', '>=', new Date(`${from}T00:00:00Z`).getTime());
  if (to) base.andWhere('l.timestamp', '<=', new Date(`${to}T23:59:59Z`).getTime());

  const [{ count }] = await base.clone().count({ count: '*' });
  const rows = await base
    .clone()
    .orderBy('l.timestamp', 'desc')
    .limit(limit)
    .offset(offset)
    .select('l.*', 'e.name as admin_name', 'e.email as admin_email');

  return {
    rows: rows.map((r) => ({
      id: r.id,
      adminId: r.admin_id,
      adminName: r.admin_name,
      adminEmail: r.admin_email,
      action: r.action,
      targetEmployeeId: r.target_employee_id,
      targetType: r.target_type,
      targetId: r.target_id,
      ipAddress: r.ip_address,
      details: r.details ? JSON.parse(r.details) : null,
      timestamp: toIso(r.timestamp),
    })),
    total: Number(count),
  };
}

/**
 * Full department list from the departments table — includes id, name, description.
 * Used by the departments management page and employee form dropdown.
 */
async function listDepartmentsFull() {
  const rows = await db()('departments').orderBy('name').select('id', 'name', 'description', 'created_at');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || null,
    createdAt: toIso(r.created_at),
  }));
}

/**
 * Lightweight name-only list — used by filter dropdowns in reports/payroll.
 * Still reads from the departments table so only admin-created departments appear.
 */
async function listDepartments() {
  return db()('departments').orderBy('name').pluck('name');
}

async function createDepartment({ name, description }) {
  const existing = await db()('departments').whereRaw('LOWER(name) = ?', [name.toLowerCase()]).first();
  if (existing) throw conflict('A department with that name already exists');

  const nowMs = t.now();
  const row = {
    id: uuid(),
    name: name.trim(),
    description: description ? description.trim() : null,
    created_at: nowMs,
    updated_at: nowMs,
  };
  await db()('departments').insert(row);
  return { id: row.id, name: row.name, description: row.description, createdAt: toIso(nowMs) };
}

async function deleteDepartment(id) {
  const dept = await db()('departments').where({ id }).first();
  if (!dept) throw notFound('Department not found');

  // Unassign all employees from this department.
  await db()('employees').where({ department: dept.name }).update({ department: null, updated_at: t.now() });
  // Remove leader assignments for this department.
  await db()('department_leaders').where({ department: dept.name }).del();
  // Delete the department record.
  await db()('departments').where({ id }).del();

  return { deleted: true, name: dept.name };
}

// --- Department leader management -------------------------------------------------------

async function listDepartmentLeaders(department) {
  const base = db()('department_leaders as dl')
    .join('employees as e', 'e.id', 'dl.employee_id')
    .select('dl.department', 'dl.employee_id', 'dl.assigned_at', 'e.name', 'e.email', 'e.role', 'e.status')
    .orderBy(['dl.department', 'e.name']);
  if (department) base.where('dl.department', department);
  const rows = await base;
  return rows.map((r) => ({
    department: r.department,
    employeeId: r.employee_id,
    name: r.name,
    email: r.email,
    role: r.role,
    status: r.status,
    assignedAt: toIso(r.assigned_at),
  }));
}

async function assignLeader({ department, employeeId, assignedBy }) {
  const employee = await db()('employees').where({ id: employeeId }).first();
  if (!employee) throw notFound('Employee not found');
  if (employee.status !== 'active') throw badRequest('Cannot assign an inactive employee as leader');

  // Upgrade role to 'leader' if they are a plain user.
  if (employee.role === 'user') {
    await db()('employees').where({ id: employeeId }).update({ role: 'leader', updated_at: t.now() });
    // Revoke active sessions so the new role takes effect on next sign-in.
    await db()('refresh_tokens')
      .where({ employee_id: employeeId })
      .whereNull('revoked_at')
      .update({ revoked_at: t.now(), revoked_reason: 'admin' });
  }

  try {
    await db()('department_leaders').insert({
      department,
      employee_id: employeeId,
      assigned_at: t.now(),
      assigned_by: assignedBy || null,
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Already a leader of this department — idempotent, not an error.
  }

  return { department, employeeId, assigned: true };
}

async function removeLeader({ department, employeeId }) {
  await db()('department_leaders').where({ department, employee_id: employeeId }).del();

  // If this employee no longer leads any department, downgrade role back to 'user'.
  const remaining = await db()('department_leaders')
    .where({ employee_id: employeeId })
    .count('* as c')
    .first();

  if (Number(remaining.c) === 0) {
    const emp = await db()('employees').where({ id: employeeId }).first();
    if (emp && emp.role === 'leader') {
      await db()('employees').where({ id: employeeId }).update({ role: 'user', updated_at: t.now() });
    }
  }

  return { department, employeeId, removed: true };
}

module.exports = {
  dashboard,
  report,
  detailedReport,
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  listAuditLogs,
  listDepartments,
  listDepartmentsFull,
  createDepartment,
  deleteDepartment,
  listDepartmentLeaders,
  assignLeader,
  removeLeader,
};
