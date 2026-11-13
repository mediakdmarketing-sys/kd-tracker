'use strict';

// "Who needs attention" for the dashboard: one score per person from five things that are already
// measured, grouped by department so the lowest in each team stand out.
//
//   Productivity   the Productivity page's score (active time and app use)
//   Punctuality    share of worked days the first punch-in was on time (needs the workday start)
//   Finishing      share of worked days the shift ended on time or later (needs the workday end)
//   Breaks         share of worked days kept within the break allowance
//   Microphone     how little of the worked time the mic was found muted (only for people who
//                  agreed to audio sampling)
//
// Each is 0 to 100. A measure that cannot be worked out for someone (no start time set, no audio
// consent, no data) is left out and the rest are re-weighted, so nobody is marked down for
// something that was never measured. It is a prompt to look and ask, never a verdict: the page
// shows the five parts next to the number so HR can see why.

const { db } = require('../../db');
const t = require('../../utils/time');
const config = require('../../config');
const settings = require('../../services/settings');
const productivity = require('../productivity/productivity.service');
const { micLog } = require('../capture/micLog');
const { badRequest } = require('../../utils/errors');

const WEIGHTS = { productivity: 0.35, punctuality: 0.2, finishing: 0.15, breaks: 0.15, mic: 0.15 };
const GRACE_MINUTES = 10; // late in, or out early, by no more than this still counts as on time
const BANDS = { attention: 50, watch: 70 };

const bandOf = (score) => (score < BANDS.attention ? 'attention' : score < BANDS.watch ? 'watch' : 'good');

/** Minutes after midnight, company time, for an instant. */
function minutesOfDay(ms, timezone = config.timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return get('hour') * 60 + get('minute');
}

const share = (good, total) => (total ? Math.round((good / total) * 100) : null);

/**
 * @param {{days?: number, department?: string}} opts
 * @returns {Promise<{from, to, days, workday, departments: Array, worst: Array}>}
 */
async function performance({ days = 14, department } = {}) {
  if (![7, 14, 30].includes(days)) throw badRequest('days must be 7, 14 or 30');
  const to = t.localDate();
  const from = t.localDate(t.now() - (days - 1) * t.DAY_MS);
  const { workdayStartMinutes: start, workdayEndMinutes: end } = settings.get().shift;

  const peopleQuery = db()('employees').where({ status: 'active' }).select('id', 'name', 'department', 'consent_audio');
  if (department) peopleQuery.andWhere({ department });
  const people = await peopleQuery;
  const ids = people.map((p) => p.id);
  if (!ids.length) return { from, to, days, workday: { start, end }, departments: [], worst: [] };

  const shifts = await db()('attendance')
    .whereIn('employee_id', ids)
    .whereBetween('date', [from, to])
    .select('employee_id', 'date', 'punch_in', 'punch_out', 'status', 'total_worked_seconds', 'over_break', 'auto_closed');

  const prod = await productivity.overview({ from, to, department });
  const prodScore = new Map(prod.employees.map((e) => [e.employeeId, e.score]));

  const mic = await micLog({ employeeIds: ids, from, to });
  const mutedSeconds = new Map();
  for (const p of mic.periods) mutedSeconds.set(p.employeeId, (mutedSeconds.get(p.employeeId) || 0) + p.durationSeconds);

  const byPerson = new Map();
  for (const s of shifts) {
    if (!byPerson.has(s.employee_id)) byPerson.set(s.employee_id, []);
    byPerson.get(s.employee_id).push(s);
  }

  const out = [];
  for (const p of people) {
    const mine = byPerson.get(p.id) || [];
    const dates = [...new Set(mine.map((s) => s.date))];
    if (!dates.length) continue; // nothing worked in the range: nothing to judge

    // One row per worked day: the earliest punch-in and the latest real punch-out.
    const perDay = dates.map((date) => {
      const day = mine.filter((s) => s.date === date);
      const closed = day.filter((s) => s.punch_out && !s.auto_closed);
      return {
        firstIn: Math.min(...day.map((s) => Number(s.punch_in))),
        lastOut: closed.length ? Math.max(...closed.map((s) => Number(s.punch_out))) : null,
        overBreak: day.some((s) => Boolean(Number(s.over_break))),
      };
    });

    const late = start == null ? null : perDay.filter((d) => minutesOfDay(d.firstIn) > start + GRACE_MINUTES).length;
    const outDays = perDay.filter((d) => d.lastOut !== null);
    const early = end == null ? null : outDays.filter((d) => minutesOfDay(d.lastOut) < end - GRACE_MINUTES).length;
    const overDays = perDay.filter((d) => d.overBreak).length;

    const worked = mine.reduce((sum, s) => sum + (Number(s.total_worked_seconds) || 0), 0);
    const muted = mutedSeconds.get(p.id) || 0;
    const micRatio = worked ? Math.min(1, muted / worked) : 0;

    const parts = {
      productivity: { score: prodScore.get(p.id) ?? null, detail: prodScore.get(p.id) == null ? 'No activity data' : `Productivity score ${prodScore.get(p.id)}` },
      punctuality: {
        score: late === null ? null : share(perDay.length - late, perDay.length),
        detail: late === null ? 'Workday start not set' : `Late on ${late} of ${perDay.length} days`,
      },
      finishing: {
        score: early === null || !outDays.length ? null : share(outDays.length - early, outDays.length),
        detail: early === null ? 'Workday end not set' : !outDays.length ? 'No finished shifts' : `Left early on ${early} of ${outDays.length} days`,
      },
      breaks: { score: share(perDay.length - overDays, perDay.length), detail: `Over the break allowance on ${overDays} of ${perDay.length} days` },
      mic: {
        score: Number(p.consent_audio) ? Math.round(100 * (1 - Math.min(1, micRatio * 2))) : null,
        detail: Number(p.consent_audio) ? `Mic muted ${Math.round(muted / 60)} min (${Math.round(micRatio * 100)}% of worked time)` : 'No audio consent',
      },
    };

    let weight = 0;
    let total = 0;
    for (const [key, w] of Object.entries(WEIGHTS)) {
      if (parts[key].score === null) continue;
      weight += w;
      total += w * parts[key].score;
    }
    if (!weight) continue;
    const score = Math.round(total / weight);
    // The weakest measured part, so the page can say what to look at first.
    const weakest = Object.entries(parts)
      .filter(([, v]) => v.score !== null)
      .sort((a, b) => a[1].score - b[1].score)[0]?.[0] || null;

    out.push({ employeeId: p.id, name: p.name, department: p.department || 'Unassigned', score, band: bandOf(score), weakest, days: perDay.length, parts });
  }

  const deptMap = new Map();
  for (const e of out) {
    if (!deptMap.has(e.department)) deptMap.set(e.department, []);
    deptMap.get(e.department).push(e);
  }
  const departments = [...deptMap.entries()]
    .map(([name, list]) => {
      const sorted = [...list].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
      const avg = Math.round(sorted.reduce((s, e) => s + e.score, 0) / sorted.length);
      return { department: name, score: avg, band: bandOf(avg), people: sorted.length, employees: sorted };
    })
    .sort((a, b) => a.score - b.score || a.department.localeCompare(b.department));

  const worst = [...out].sort((a, b) => a.score - b.score || a.name.localeCompare(b.name)).slice(0, 5);
  return { from, to, days, workday: { start: start ?? null, end: end ?? null }, departments, worst };
}

module.exports = { performance, minutesOfDay, WEIGHTS, GRACE_MINUTES };
