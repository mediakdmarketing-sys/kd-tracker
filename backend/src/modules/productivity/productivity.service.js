'use strict';

// Productivity scoring.
//
//   score = 100 * (0.6 * activeRatio + 0.4 * appScore)
//
//   activeRatio  (worked - idle) / worked, from the attendance rows — how much of the shift the
//                machine was actually in use.
//   appScore     weighted share of foreground-app samples by category (categories.js WEIGHT).
//                Only present when the agent reported an app; without app data the score is
//                activeRatio alone rather than pretending we know more than we do.
//
// This is a conversation starter, not a verdict: meetings, calls and thinking time all look
// idle. The portal says so next to the numbers.

const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { badRequest } = require('../../utils/errors');
const { CATEGORIES, WEIGHT, normaliseApp, categoryFor } = require('./categories');

// The desktop agent sends at most one activity row per minute (desktop-agent/src/main/index.js
// ACTIVITY_WINDOW_SECONDS), so a row stands for this many seconds of foreground time.
const SAMPLE_SECONDS = 60;

const ACTIVE_WEIGHT = 0.6;
const APP_WEIGHT = 0.4;
const ATTENTION_BELOW = 50;

function band(score) {
  if (score >= 75) return 'great';
  if (score >= 60) return 'good';
  if (score >= ATTENTION_BELOW) return 'average';
  return 'review';
}

async function loadOverrides() {
  const rows = await db()('app_categories').select('app_key', 'category');
  return new Map(rows.map((r) => [r.app_key, r.category]));
}

function score({ workedSeconds, idleSeconds, samples }) {
  if (!workedSeconds) return null;
  const activeRatio = Math.min(1, Math.max(0, (workedSeconds - idleSeconds) / workedSeconds));

  const total = samples.productive + samples.neutral + samples.distracting;
  if (!total) return Math.round(activeRatio * 100);

  const appScore =
    (samples.productive * WEIGHT.productive +
      samples.neutral * WEIGHT.neutral +
      samples.distracting * WEIGHT.distracting) /
    total;
  return Math.round(100 * (ACTIVE_WEIGHT * activeRatio + APP_WEIGHT * appScore));
}

/** Per-department overrides as Map(`${department}|${appKey}` -> category). */
async function loadDepartmentOverrides() {
  const rows = await db()('app_department_categories').select('app_key', 'department', 'category');
  return new Map(rows.map((r) => [`${r.department}|${r.app_key}`, r.category]));
}

/**
 * Category of an app for someone in `department`: that department's own setting first, then the
 * company-wide override, then the built-in default. No department -> company-wide only.
 */
function categoryIn(appKey, department, overrides, deptOverrides) {
  return (department && deptOverrides.get(`${department}|${appKey}`)) || categoryFor(appKey, overrides);
}

const emptySamples = () => ({ productive: 0, neutral: 0, distracting: 0 });

async function overview({ from, to, department } = {}) {
  if (!from || !to) throw badRequest('from and to dates are required (YYYY-MM-DD)');
  if (from > to) throw badRequest('`from` must not be after `to`');

  const overrides = await loadOverrides();
  const deptOverrides = await loadDepartmentOverrides();

  const attendanceQuery = db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .whereBetween('a.date', [from, to]);
  if (department) attendanceQuery.andWhere('e.department', department);

  const attendance = await attendanceQuery
    .groupBy('a.employee_id', 'e.name', 'e.department')
    .select('a.employee_id', 'e.name', 'e.department')
    .sum({ worked: 'a.total_worked_seconds' })
    .sum({ idle: 'a.idle_seconds' });

  const activityQuery = db()('activity_logs as l')
    .join('employees as e', 'e.id', 'l.employee_id')
    .whereBetween('l.date', [from, to])
    .whereNotNull('l.window_title');
  if (department) activityQuery.andWhere('e.department', department);

  const activity = await activityQuery
    .groupBy('l.employee_id', 'e.department', 'l.window_title')
    .select('l.employee_id', 'e.department', 'l.window_title')
    .count({ c: 'l.id' });

  // One pass: per-employee samples, per-employee top app, and the team-wide app table.
  const byEmployee = new Map();
  const teamApps = new Map();
  for (const row of activity) {
    const key = normaliseApp(row.window_title);
    if (!key) continue;
    const count = Number(row.c) || 0;
    // Each person's samples are scored with their own department's categories.
    const category = categoryIn(key, row.department, overrides, deptOverrides);

    const emp = byEmployee.get(row.employee_id) || { samples: emptySamples(), apps: new Map() };
    emp.samples[category] += count;
    emp.apps.set(key, (emp.apps.get(key) || 0) + count);
    byEmployee.set(row.employee_id, emp);

    // Top apps: a department view shows that department's category; "All departments" shows the
    // company-wide one, so one team's setting never leaks into the overall picture.
    const shown = categoryIn(key, department, overrides, deptOverrides);
    const team = teamApps.get(key) || { app: row.window_title, category: shown, count: 0 };
    team.count += count;
    teamApps.set(key, team);
  }

  const displayName = (key) => teamApps.get(key)?.app || key;

  const employees = attendance
    .map((r) => {
      const workedSeconds = Number(r.worked) || 0;
      const idleSeconds = Number(r.idle) || 0;
      const emp = byEmployee.get(r.employee_id);
      const samples = emp?.samples || emptySamples();
      const s = score({ workedSeconds, idleSeconds, samples });

      let topApp = null;
      if (emp) topApp = displayName([...emp.apps.entries()].sort((x, y) => y[1] - x[1])[0][0]);

      return {
        employeeId: r.employee_id,
        name: r.name,
        department: r.department,
        workedSeconds,
        idleSeconds,
        activeSeconds: Math.max(0, workedSeconds - idleSeconds),
        topApp,
        hasAppData: Boolean(emp),
        score: s,
        band: s === null ? null : band(s),
        _samples: samples,
      };
    })
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));

  // Department roll-up: sum the raw inputs and score once, so a large team is not diluted by
  // averaging averages.
  const deptMap = new Map();
  for (const e of employees) {
    const name = e.department || 'Unassigned';
    const d = deptMap.get(name) || {
      department: name,
      employees: 0,
      workedSeconds: 0,
      idleSeconds: 0,
      samples: emptySamples(),
    };
    d.employees += 1;
    d.workedSeconds += e.workedSeconds;
    d.idleSeconds += e.idleSeconds;
    for (const c of CATEGORIES) d.samples[c] += e._samples[c];
    deptMap.set(name, d);
  }
  const departments = [...deptMap.values()]
    .map((d) => {
      const total = d.samples.productive + d.samples.neutral + d.samples.distracting;
      const share = (c) => (total ? Math.round((d.samples[c] / total) * 100) : 0);
      return {
        department: d.department,
        employees: d.employees,
        score: score(d),
        mix: { productive: share('productive'), neutral: share('neutral'), distracting: share('distracting') },
      };
    })
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const totals = employees.reduce(
    (acc, e) => ({
      worked: acc.worked + e.workedSeconds,
      idle: acc.idle + e.idleSeconds,
      samples: {
        productive: acc.samples.productive + e._samples.productive,
        neutral: acc.samples.neutral + e._samples.neutral,
        distracting: acc.samples.distracting + e._samples.distracting,
      },
    }),
    { worked: 0, idle: 0, samples: emptySamples() }
  );

  const apps = [...teamApps.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((a) => ({ app: a.app, category: a.category, seconds: a.count * SAMPLE_SECONDS }));

  const n = employees.length;
  return {
    from,
    to,
    department: department || null,
    summary: {
      employees: n,
      score: score({ workedSeconds: totals.worked, idleSeconds: totals.idle, samples: totals.samples }),
      avgActiveSeconds: n ? Math.round((totals.worked - totals.idle) / n) : 0,
      avgIdleSeconds: n ? Math.round(totals.idle / n) : 0,
      needsAttention: employees.filter((e) => e.score !== null && e.score < ATTENTION_BELOW).length,
    },
    departments,
    apps,
    employees: employees.map(({ _samples, ...rest }) => rest),
  };
}

/**
 * Every app seen in the last `days` days, plus any override, with its effective category.
 * With a `department`, only apps that department's members used are listed, with the category
 * that applies to that department. Without one, the company-wide category is shown.
 */
async function listApps({ days = 30, department } = {}) {
  const overrideRows = await db()('app_categories').select('app_key', 'app_name', 'category');
  const overrides = new Map(overrideRows.map((r) => [r.app_key, r]));
  const categoryMap = new Map([...overrides].map(([k, v]) => [k, v.category]));
  const deptOverrides = await loadDepartmentOverrides();

  const since = new Date(t.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const seenQuery = db()('activity_logs as l')
    .join('employees as e', 'e.id', 'l.employee_id')
    .where('l.date', '>=', since)
    .whereNotNull('l.window_title');
  if (department) seenQuery.andWhere('e.department', department);
  const seen = await seenQuery.groupBy('l.window_title').select('l.window_title').count({ c: 'l.id' });

  const apps = new Map();
  for (const row of seen) {
    const key = normaliseApp(row.window_title);
    if (!key) continue;
    const entry = apps.get(key) || { appKey: key, appName: row.window_title, samples: 0 };
    entry.samples += Number(row.c) || 0;
    apps.set(key, entry);
  }
  // Apps an admin added by hand stay listed even with no samples. A department view lists only
  // that department's own additions, so the table stays that team's apps.
  if (!department) {
    for (const [key, o] of overrides) {
      if (!apps.has(key)) apps.set(key, { appKey: key, appName: o.app_name, samples: 0 });
    }
  } else {
    const own = await db()('app_department_categories')
      .where({ department })
      .select('app_key', 'app_name');
    for (const r of own) {
      if (!apps.has(r.app_key)) apps.set(r.app_key, { appKey: r.app_key, appName: r.app_name, samples: 0 });
    }
  }

  return [...apps.values()]
    .map((a) => {
      const own = department ? deptOverrides.get(`${department}|${a.appKey}`) : undefined;
      return {
        ...a,
        category: own || categoryFor(a.appKey, categoryMap),
        // Set specifically for this department / company-wide (so "Reset" has something to undo).
        overridden: department ? Boolean(own) : overrides.has(a.appKey),
      };
    })
    .sort((a, b) => b.samples - a.samples || a.appName.localeCompare(b.appName));
}

/**
 * With a `department`, sets the category for that department only. Without one it applies to
 * every department, so any department-specific settings for the app are cleared.
 */
async function setCategory({ appName, category, department, updatedBy }) {
  const key = normaliseApp(appName);
  if (!key) throw badRequest('appName is required');
  if (!CATEGORIES.includes(category)) throw badRequest('Unknown category');
  const scope = (department || '').trim();
  const nowMs = t.now();
  const name = String(appName).trim().slice(0, 120);

  if (scope) {
    const existing = await db()('app_department_categories')
      .where({ app_key: key, department: scope })
      .first();
    if (existing) {
      await db()('app_department_categories')
        .where({ id: existing.id })
        .update({ category, updated_by: updatedBy || null, updated_at: nowMs });
    } else {
      await db()('app_department_categories').insert({
        id: uuid(),
        app_key: key,
        app_name: name,
        department: scope,
        category,
        updated_by: updatedBy || null,
        created_at: nowMs,
        updated_at: nowMs,
      });
    }
    return { appKey: key, category, department: scope };
  }

  await db()('app_department_categories').where({ app_key: key }).del();
  const existing = await db()('app_categories').where({ app_key: key }).first();
  if (existing) {
    await db()('app_categories')
      .where({ id: existing.id })
      .update({ category, updated_by: updatedBy || null, updated_at: nowMs });
  } else {
    await db()('app_categories').insert({
      id: uuid(),
      app_key: key,
      app_name: name,
      category,
      updated_by: updatedBy || null,
      created_at: nowMs,
      updated_at: nowMs,
    });
  }
  return { appKey: key, category };
}

/**
 * Drops the override so the app falls back to the next level: a department view removes that
 * department's setting (back to company-wide / default); the All view removes the company-wide
 * one and every department's.
 */
async function resetCategory(appName, department) {
  const key = normaliseApp(appName);
  if (department) {
    await db()('app_department_categories').where({ app_key: key, department }).del();
  } else {
    await db()('app_categories').where({ app_key: key }).del();
    await db()('app_department_categories').where({ app_key: key }).del();
  }
  return { appKey: key, reset: true };
}

module.exports = { overview, listApps, setCategory, resetCategory, score, band, SAMPLE_SECONDS };
