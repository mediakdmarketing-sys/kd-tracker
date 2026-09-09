'use strict';

const { db } = require('../../db');
const config = require('../../config');
const t = require('../../utils/time');
const { toIso, toBool } = require('../../utils/http');
const { publicEmployee } = require('../auth/auth.service');

/**
 * Resolve which employee IDs a leader (or admin) may act on.
 *
 * For a senior leader (manages multiple depts), this includes:
 *  1. Regular employees in their managed departments.
 *  2. Sub-leaders whose ENTIRE set of managed departments is a subset of the
 *     senior leader's departments (i.e. they manage fewer/equal departments).
 */
async function resolveMemberIds(leaderDepts, leaderId) {
  if (leaderDepts === null) return null; // admin — no filter
  if (!leaderDepts.length) return [];

  // Regular employees in managed departments.
  const regularRows = await db()('employees')
    .whereIn('department', leaderDepts)
    .where({ status: 'active', role: 'user' })
    .select('id');

  // Sub-leaders: leaders whose all managed depts are within leaderDepts.
  const allLeaderAssignments = await db()('department_leaders')
    .whereNot({ employee_id: leaderId }) // exclude self
    .select('employee_id', 'department');

  // Group by employee_id.
  const byLeader = allLeaderAssignments.reduce((acc, r) => {
    (acc[r.employee_id] ||= []).push(r.department);
    return acc;
  }, {});

  const subLeaderIds = Object.entries(byLeader)
    .filter(([, depts]) => depts.every((d) => leaderDepts.includes(d)))
    .map(([id]) => id);

  const allIds = [
    ...regularRows.map((r) => r.id),
    ...subLeaderIds,
  ];

  return [...new Set(allIds)];
}

/**
 * GET /api/leader/departments
 * Returns each department the leader manages with member count and a summary
 * of who is currently working.
 */
async function myDepartments(user, leaderDepts) {
  const depts = leaderDepts === null
    ? await db()('employees').whereNotNull('department').distinct('department').pluck('department')
    : leaderDepts;

  const result = [];

  for (const dept of depts) {
    const members = await db()('employees')
      .where({ department: dept, status: 'active' })
      .whereNot({ role: 'admin' })
      .select('id', 'name', 'email', 'role');

    const memberIds = members.map((m) => m.id);

    // Count how many are currently working/on_break.
    const liveShifts = memberIds.length
      ? await db()('attendance')
          .whereIn('employee_id', memberIds)
          .whereIn('status', ['open', 'on_break'])
          .count('* as c')
          .first()
      : { c: 0 };

    result.push({
      department: dept,
      memberCount: members.length,
      liveCount: Number(liveShifts.c),
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        role: m.role,
      })),
    });
  }

  return result;
}

/**
 * GET /api/leader/members
 * Live dashboard — same shape as admin dashboard but scoped to the leader's departments.
 */
async function memberDashboard(user, leaderDepts) {
  const memberIds = await resolveMemberIds(leaderDepts, user.id);

  // No departments or no members.
  if (memberIds !== null && memberIds.length === 0) {
    return { generatedAt: toIso(t.now()), summary: { total: 0, working: 0, onBreak: 0, punchedOut: 0, notStarted: 0 }, employees: [] };
  }

  const base = db()('employees')
    .where({ status: 'active' })
    .whereNot({ role: 'admin' })  // Admins never visible to leaders
    .orderBy('name');
  if (memberIds !== null) base.whereIn('id', memberIds);
  const employees = await base.select('id', 'name', 'email', 'department', 'timezone');

  const nowMs = t.now();
  const dates = new Set(employees.map((e) => t.localDate(nowMs, e.timezone)));
  const empIds = employees.map((e) => e.id);

  const attendance = await db()('attendance')
    .whereIn('employee_id', empIds)
    .where((b) => b.whereIn('date', [...dates]).orWhereIn('status', ['open', 'on_break']))
    .orderBy('punch_in', 'desc');

  const openBreaks = attendance.length
    ? await db()('breaks')
        .whereIn('attendance_id', attendance.filter((a) => a.status === 'on_break').map((a) => a.id))
        .whereNull('break_end')
    : [];

  const since = t.hoursAgo(24);
  const lastActivity = await db()('activity_logs')
    .whereIn('employee_id', empIds)
    .where('timestamp', '>=', since)
    .groupBy('employee_id')
    .select('employee_id')
    .max({ last_seen: 'timestamp' });
  const lastSeenBy = Object.fromEntries(lastActivity.map((r) => [r.employee_id, Number(r.last_seen)]));

  const byEmployee = attendance.reduce((acc, a) => {
    (acc[a.employee_id] ||= []).push(a);
    return acc;
  }, {});

  const rows = employees.map((emp) => {
    const empDate = t.localDate(nowMs, emp.timezone);
    const mine = byEmployee[emp.id] || [];
    const current = mine.find((s) => s.status === 'open' || s.status === 'on_break');
    const todays = mine.filter((a) => a.date === empDate);
    const shifts = current && !todays.includes(current) ? [current, ...todays] : todays;

    const workedToday = shifts.reduce((sum, s) => {
      if (s.total_worked_seconds != null) return sum + s.total_worked_seconds;
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
      state,
      punchIn: current ? toIso(current.punch_in) : shifts[0] ? toIso(shifts[0].punch_in) : null,
      punchOut: !current && shifts[0] ? toIso(shifts[0].punch_out) : null,
      workedSeconds: workedToday,
      breakSeconds: liveBreak,
      overBreak: liveBreak > config.shift.breakAllowanceSeconds,
      lastActivityAt: toIso(lastSeen),
      appearsIdle:
        state === 'working' && (!lastSeen || nowMs - lastSeen > config.shift.idleThresholdSeconds * 1000),
      needsReview: toBool(current?.needs_review || shifts[0]?.needs_review),
    };
  });

  const summary = {
    total: rows.length,
    working: rows.filter((r) => r.state === 'working').length,
    onBreak: rows.filter((r) => r.state === 'on_break').length,
    punchedOut: rows.filter((r) => r.state === 'punched_out').length,
    notStarted: rows.filter((r) => r.state === 'not_started').length,
  };

  return { generatedAt: toIso(nowMs), summary, employees: rows };
}

module.exports = { myDepartments, memberDashboard, resolveMemberIds };
