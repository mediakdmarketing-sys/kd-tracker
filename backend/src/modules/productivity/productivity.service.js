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

const emptySamples = () => ({ productive: 0, neutral: 0, distracting: 0 });

async function overview({ from, to, department } = {}) {
  if (!from || !to) throw badRequest('from and to dates are required (YYYY-MM-DD)');
  if (from > to) throw badRequest('`from` must not be after `to`');

  const overrides = await loadOverrides();

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
    .groupBy('l.employee_id', 'l.window_title')
    .select('l.employee_id', 'l.window_title')
    .count({ c: 'l.id' });

  // One pass: per-employee samples, per-employee top app, and the team-wide app table.
  const byEmployee = new Map();
  const teamApps = new Map();
  for (const row of activity) {
    const key = normaliseApp(row.window_title);
    if (!key) continue;
    const count = Number(row.c) || 0;
    const category = categoryFor(key, overrides);

    const emp = byEmployee.get(row.employee_id) || { samples: emptySamples(), apps: new Map() };
    emp.samples[category] += count;
    emp.apps.set(key, (emp.apps.get(key) || 0) + count);
    byEmployee.set(row.employee_id, emp);

    const team = teamApps.get(key) || { app: row.window_title, category, count: 0 };
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

/** Every app seen in the last `days` days, plus any override, with its effective category. */
async function listApps({ days = 30 } = {}) {
  const overrideRows = await db()('app_categories').select('app_key', 'app_name', 'category');
  const overrides = new Map(overrideRows.map((r) => [r.app_key, r]));

  const since = new Date(t.now() - days * 86400 * 1000).toISOString().slice(0, 10);
  const seen = await db()('activity_logs')
    .where('date', '>=', since)
    .whereNotNull('window_title')
    .groupBy('window_title')
    .select('window_title')
    .count({ c: 'id' });

  const apps = new Map();
  for (const row of seen) {
    const key = normaliseApp(row.window_title);
    if (!key) continue;
    const entry = apps.get(key) || { appKey: key, appName: row.window_title, samples: 0 };
    entry.samples += Number(row.c) || 0;
    apps.set(key, entry);
  }
  for (const [key, o] of overrides) {
    if (!apps.has(key)) apps.set(key, { appKey: key, appName: o.app_name, samples: 0 });
  }

  return [...apps.values()]
    .map((a) => ({
      ...a,
      category: categoryFor(a.appKey, new Map([...overrides].map(([k, v]) => [k, v.category]))),
      overridden: overrides.has(a.appKey),
    }))
    .sort((a, b) => b.samples - a.samples || a.appName.localeCompare(b.appName));
}

async function setCategory({ appName, category, updatedBy }) {
  const key = normaliseApp(appName);
  if (!key) throw badRequest('appName is required');
  if (!CATEGORIES.includes(category)) throw badRequest('Unknown category');

  const nowMs = t.now();
  const existing = await db()('app_categories').where({ app_key: key }).first();
  if (existing) {
    await db()('app_categories')
      .where({ id: existing.id })
      .update({ category, updated_by: updatedBy || null, updated_at: nowMs });
  } else {
    await db()('app_categories').insert({
      id: uuid(),
      app_key: key,
      app_name: String(appName).trim().slice(0, 120),
      category,
      updated_by: updatedBy || null,
      created_at: nowMs,
      updated_at: nowMs,
    });
  }
  return { appKey: key, category };
}

/** Drops the override so the app falls back to the built-in default (or neutral). */
async function resetCategory(appName) {
  const key = normaliseApp(appName);
  await db()('app_categories').where({ app_key: key }).del();
  return { appKey: key, reset: true };
}

module.exports = { overview, listApps, setCategory, resetCategory, score, band, SAMPLE_SECONDS };
