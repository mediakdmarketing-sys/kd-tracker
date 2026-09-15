'use strict';

// Project/task time tracking. See the projects migration
// (backend/src/db/migrations/20260206000100_create_projects.js) for the data-model reasoning —
// time entries are segments with a nullable end, the same shape as breaks, and the absence of
// a row *is* "unassigned time" rather than a stored state.

const { db, transaction } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toIso } = require('../../utils/http');
const { conflict, notFound, badRequest } = require('../../utils/errors');

function shapeProject(row) {
  return {
    id: row.id,
    name: row.name,
    client: row.client,
    department: row.department,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function listProjects({ status, department } = {}) {
  const base = db()('projects');
  if (status) base.andWhere({ status });
  if (department) base.andWhere({ department });
  const rows = await base.orderBy('name');
  return rows.map(shapeProject);
}

async function getProject(id) {
  const row = await db()('projects').where({ id }).first();
  if (!row) throw notFound('Project not found');
  return shapeProject(row);
}

async function createProject({ name, client, department }) {
  const nowMs = t.now();
  const row = {
    id: uuid(),
    name: name.trim(),
    client: client || null,
    department: department || null,
    status: 'active',
    created_at: nowMs,
    updated_at: nowMs,
  };
  try {
    await db()('projects').insert(row);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('A project with that name already exists');
    throw err;
  }
  return shapeProject(row);
}

function isUniqueViolation(err) {
  // Matches the check already used elsewhere in this codebase (employees, departments) —
  // SQLite and Postgres report a unique-constraint violation differently.
  return err.code === 'SQLITE_CONSTRAINT' || err.code === '23505';
}

async function updateProject(id, input) {
  const row = await db()('projects').where({ id }).first();
  if (!row) throw notFound('Project not found');

  const patch = { updated_at: t.now() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.client !== undefined) patch.client = input.client;
  if (input.department !== undefined) patch.department = input.department;
  if (input.status !== undefined) patch.status = input.status;

  try {
    await db()('projects').where({ id }).update(patch);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('A project with that name already exists');
    throw err;
  }
  return shapeProject({ ...row, ...patch });
}

/** The time entry currently open for this shift, or null if the employee is unassigned. */
async function runningEntry(attendanceId, trx = db()) {
  return trx('project_time_entries').where({ attendance_id: attendanceId }).whereNull('ended_at').first();
}

/**
 * Ends whatever project entry is running for this shift, if any. Called from
 * attendance.service.js at punch-out and break-start so project time never overlaps a break
 * or a closed shift. Safe to call when nothing is running (no-op).
 */
async function endRunningEntry(attendanceId, at, trx = db()) {
  const open = await runningEntry(attendanceId, trx);
  if (!open) return;
  const duration = t.secondsBetween(Number(open.started_at), at);
  await trx('project_time_entries').where({ id: open.id }).update({ ended_at: at, duration_seconds: duration });
}

/**
 * Switches the employee's current project for their open shift. `projectId` may be null to
 * return to unassigned time. Collapsed into one action (end-then-maybe-start) rather than
 * separate switchStart/switchEnd endpoints, since there is no "stop tracking but stay
 * punched in and not on a break" state worth representing beyond "unassigned".
 */
async function switchProject({ employee, projectId, at }) {
  const shift = await db()('attendance')
    .where({ employee_id: employee.id })
    .whereIn('status', ['open', 'on_break'])
    .orderBy('punch_in', 'desc')
    .first();
  if (!shift) throw conflict('You must be punched in to select a project.');
  if (shift.status === 'on_break') throw conflict('End your break before switching projects.');

  let project = null;
  if (projectId) {
    project = await db()('projects').where({ id: projectId }).first();
    if (!project) throw notFound('Project not found');
    if (project.status !== 'active') throw badRequest('That project is archived and cannot accept new time');
  }

  const receivedAt = t.now();
  const atMs = at ?? receivedAt;

  await transaction(async (trx) => {
    await endRunningEntry(shift.id, atMs, trx);
    if (projectId) {
      await trx('project_time_entries').insert({
        id: uuid(),
        attendance_id: shift.id,
        employee_id: employee.id,
        project_id: projectId,
        started_at: atMs,
        ended_at: null,
        duration_seconds: null,
        created_at: receivedAt,
      });
    }
  });

  return {
    projectId: projectId || null,
    project: project ? shapeProject(project) : null,
    since: toIso(atMs),
  };
}

/** The project currently running for this shift (for the live status view), or null. */
async function currentForShift(attendanceId) {
  const open = await runningEntry(attendanceId);
  if (!open || !open.project_id) return null;
  const project = await db()('projects').where({ id: open.project_id }).first();
  return {
    projectId: open.project_id,
    project: project ? shapeProject(project) : null,
    since: toIso(open.started_at),
  };
}

/** Per-project totals for one shift — computed in JS, not SQL, so it works identically on
 * SQLite (dev) and Postgres (prod) without dialect-specific arithmetic on bigint columns. */
async function summaryForShift(attendanceId) {
  const rows = await db()('project_time_entries')
    .where({ attendance_id: attendanceId })
    .select('project_id', 'started_at', 'ended_at', 'duration_seconds');
  if (!rows.length) return [];

  const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
  const projects = projectIds.length
    ? await db()('projects').whereIn('id', projectIds).select('id', 'name')
    : [];
  const nameById = Object.fromEntries(projects.map((p) => [p.id, p.name]));

  const nowMs = t.now();
  const totals = new Map();
  for (const r of rows) {
    const seconds =
      r.duration_seconds ?? Math.max(0, Math.floor((nowMs - Number(r.started_at)) / 1000));
    const key = r.project_id || 'unassigned';
    totals.set(key, (totals.get(key) || 0) + seconds);
  }

  return [...totals.entries()]
    .map(([key, seconds]) => ({
      projectId: key === 'unassigned' ? null : key,
      projectName: key === 'unassigned' ? 'Unassigned' : nameById[key] || 'Deleted project',
      seconds,
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

/** Per-project totals across every shift an employee had on one calendar date — what the
 * employee/admin detail pages show, keyed the same way the rest of the attendance API is
 * (employeeId + date), not by an attendance id the frontend would otherwise have to track. */
async function summaryForEmployeeDate(employeeId, date) {
  const shifts = await db()('attendance').where({ employee_id: employeeId, date }).select('id');
  if (!shifts.length) return [];

  const perShift = await Promise.all(shifts.map((s) => summaryForShift(s.id)));
  const totals = new Map();
  for (const rows of perShift) {
    for (const row of rows) {
      const key = row.projectId || 'unassigned';
      const existing = totals.get(key);
      totals.set(key, {
        projectId: row.projectId,
        projectName: row.projectName,
        seconds: (existing?.seconds || 0) + row.seconds,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
}

module.exports = {
  listProjects,
  getProject,
  createProject,
  updateProject,
  switchProject,
  endRunningEntry,
  currentForShift,
  summaryForShift,
  summaryForEmployeeDate,
};
