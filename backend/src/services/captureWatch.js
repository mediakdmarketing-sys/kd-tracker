'use strict';

// The capture watch: once a minute, looks at everyone who is on a shift (working, not on a break)
// and notices two things that otherwise only show if HR happens to look at the right page.
//
//   1. The agent has gone quiet (quit, closed, no internet, or never started): while that lasts,
//      nothing is being captured. A "capture gap" is recorded for the shift, and HR and the leader are
//      told once, when it starts. It ends when the agent talks to the server again, or the shift ends
//      or goes on a break. The gap is shown on the Timesheet.
//   2. The agent is running but there has been no keyboard or mouse for a long while (30 minutes by
//      default): HR and the leader are told (not more than every two hours about the same person).
//
// It FLAGS and TELLS. It never changes hours or pay: what to do about a gap is a conversation, and
// the employees are told in the help page that the watch exists.

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const t = require('../utils/time');
const config = require('../config');
const logger = require('../utils/logger');
const notifications = require('./notifications');
const sessions = require('../modules/auth/sessions.service');

const MIN = 60 * 1000;

async function tell(employee, { type, title, body, refId }) {
  const { admins, leaders } = await notifications.reviewerAudience(employee, [employee.id]);
  await notifications.notify(admins, { type, title, body, refId, link: `/admin/employees/${employee.id}` });
  await notifications.notify(leaders, { type, title, body, refId, link: `/leader/members/${employee.id}` });
}

const minutesText = (ms) => {
  const m = Math.max(1, Math.round(ms / MIN));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};

/**
 * Agents signed in before this feature existed have no session record until their login is next
 * refreshed (within about 30 minutes), so for a short while after the first deploy "no agent has ever
 * connected" would be wrong for them. During that warm-up, a person with no agent session at all is
 * left alone; anyone whose agent was heard from and then went quiet is flagged as usual.
 */
let warmupEndsAt;
async function warmupEnd() {
  if (warmupEndsAt !== undefined) return warmupEndsAt;
  warmupEndsAt = 0;
  if (config.watch.warmupMinutes > 0) {
    try {
      const row = await db()('knex_migrations').where('name', 'like', '%capture_gaps%').first('migration_time');
      const at = row ? new Date(row.migration_time).getTime() : NaN;
      if (Number.isFinite(at)) warmupEndsAt = at + config.watch.warmupMinutes * MIN;
    } catch {
      warmupEndsAt = 0; // cannot tell: no warm-up
    }
  }
  return warmupEndsAt;
}

/**
 * One pass.
 * @param {{ now?: number }} [opts]
 * @returns {Promise<{ opened: number, closed: number, idleAlerts: number }>}
 */
async function run({ now = t.now() } = {}) {
  const watch = config.watch;
  const result = { opened: 0, closed: 0, idleAlerts: 0, patternAlerts: 0 };

  // Everyone on a shift right now. A person on a break is not expected to be captured.
  const onShift = await db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .where('a.status', 'open')
    .andWhere('e.status', 'active')
    .select('a.id as attendance_id', 'a.employee_id', 'a.punch_in', 'e.name', 'e.department', 'e.role', 'e.id as id');
  const ids = onShift.map((s) => s.employee_id);

  const agents = await sessions.agentStatus(ids);
  const contact = await sessions.lastAgentContact(ids);

  // Gaps that are still going on.
  const openGaps = await db()('capture_gaps').whereNull('ended_at');
  const gapOf = new Map(openGaps.map((g) => [g.attendance_id, g]));

  // The agent's own activity samples (one a minute) are the proof it is really running: a session that
  // is merely kept alive by a script does not produce them. Measured by when the server RECEIVED them,
  // never by the time they claim. After a break the clock restarts, since nothing is sampled during one.
  const lastData = new Map();
  const lastBreakEnd = new Map();
  if (ids.length) {
    const sampled = await db()('activity_logs').whereIn('employee_id', ids).groupBy('employee_id').select('employee_id').max({ at: 'created_at' });
    for (const r of sampled) lastData.set(r.employee_id, Number(r.at));
    const ended = await db()('breaks')
      .whereIn('attendance_id', onShift.map((s) => s.attendance_id))
      .groupBy('attendance_id')
      .select('attendance_id')
      .max({ at: 'break_end' });
    for (const r of ended) lastBreakEnd.set(r.attendance_id, Number(r.at) || 0);
  }
  const freshData = new Set();

  for (const s of onShift) {
    const online = agents.get(s.employee_id).state === 'online';
    const open = gapOf.get(s.attendance_id);

    const dataSince = Math.max(lastData.get(s.employee_id) || 0, Number(s.punch_in), lastBreakEnd.get(s.attendance_id) || 0);
    const dataFresh = watch.noDataMinutes <= 0 || now - dataSince < watch.noDataMinutes * MIN;
    if (online && dataFresh) {
      freshData.add(s.employee_id);
      if (open) {
        await db()('capture_gaps').where({ id: open.id }).update({ ended_at: now });
        result.closed += 1;
      }
      continue;
    }
    if (open) continue; // already counted, still going

    if (online) {
      // Connected, but not a single sample has arrived: nothing is being captured.
      const gap = { id: uuid(), employee_id: s.employee_id, attendance_id: s.attendance_id, started_at: dataSince, ended_at: null, reason: 'agent_no_data', created_at: now };
      await db()('capture_gaps').insert(gap);
      result.opened += 1;
      await tell(s, {
        type: 'agent_offline',
        title: `Agent not sending data: ${s.name}`,
        body: `${s.name}'s agent is connected but has delivered no activity for ${minutesText(now - dataSince)}. Nothing is being captured, or something other than the agent is keeping the connection alive.`,
        refId: gap.id,
      });
      continue;
    }

    // Silent since the agent was last heard from, or since the shift began if that was earlier.
    const lastHeard = contact.get(s.employee_id) || 0;
    if (!lastHeard && now < (await warmupEnd())) continue; // see warmupEnd
    const punchIn = Number(s.punch_in);
    const heardThisShift = lastHeard > punchIn;
    const silentSince = heardThisShift ? lastHeard : punchIn;
    const allowed = (heardThisShift ? watch.agentSilentMinutes : watch.noAgentGraceMinutes) * MIN;
    if (now - silentSince < allowed) continue;

    const gap = { id: uuid(), employee_id: s.employee_id, attendance_id: s.attendance_id, started_at: silentSince, ended_at: null, reason: 'agent_offline', created_at: now };
    await db()('capture_gaps').insert(gap);
    result.opened += 1;
    await tell(s, {
      type: 'agent_offline',
      title: `Agent offline: ${s.name}`,
      body: heardThisShift
        ? `${s.name} is on a shift but their agent has not been heard from for ${minutesText(now - silentSince)}. Nothing is being captured.`
        : `${s.name} punched in ${minutesText(now - punchIn)} ago and no agent has connected. Nothing is being captured.`,
      refId: gap.id,
    });
  }

  // Gaps whose shift is no longer running normally: closed, or on a break. Nothing is expected then.
  for (const g of openGaps) {
    if (onShift.some((s) => s.attendance_id === g.attendance_id)) continue;
    const shift = await db()('attendance').where({ id: g.attendance_id }).first('status', 'punch_out');
    const end = shift?.status === 'closed' && shift.punch_out ? Math.max(Number(shift.punch_out), Number(g.started_at)) : now;
    await db()('capture_gaps').where({ id: g.id }).update({ ended_at: end });
    result.closed += 1;
  }

  // Long idle: the agent is running, so this is "no keyboard or mouse", not "no agent".
  if (watch.idleAlertMinutes > 0) {
    const limit = watch.idleAlertMinutes * MIN;
    const idleCandidates = onShift.filter((s) => freshData.has(s.employee_id) && now - Number(s.punch_in) >= limit);
    if (idleCandidates.length) {
      const last = await db()('activity_logs')
        .whereIn('employee_id', idleCandidates.map((s) => s.employee_id))
        .andWhere('timestamp', '>', now - limit)
        .groupBy('employee_id')
        .select('employee_id')
        .max({ at: 'timestamp' });
      const active = new Set(last.map((r) => r.employee_id));
      for (const s of idleCandidates) {
        if (active.has(s.employee_id)) continue; // some activity inside the window
        if (await notifications.recentlyNotified('long_idle', s.employee_id, watch.idleRepeatMinutes * MIN)) continue;
        await tell(s, {
          type: 'long_idle',
          title: `No activity: ${s.name}`,
          body: `${s.name} is working but there has been no keyboard or mouse activity for ${minutesText(limit)} or more. They may be in a meeting or a call.`,
          refId: s.employee_id,
        });
        result.idleAlerts += 1;
      }
    }
  }

  // Scripted activity: a mouse jiggler or macro gives the same busy reading minute after minute, which
  // a person's real work never does. Flag only; a genuine repetitive task can look like this, so the
  // message says "check", not "cheating".
  if (watch.patternMinutes > 0 && freshData.size) {
    const since = now - watch.patternMinutes * MIN;
    const who = onShift.filter((s) => freshData.has(s.employee_id) && now - Number(s.punch_in) >= watch.patternMinutes * MIN);
    if (who.length) {
      const samples = await db()('activity_logs')
        .whereIn('employee_id', who.map((s) => s.employee_id))
        .andWhere('timestamp', '>', since)
        .select('employee_id', 'keystroke_count', 'mouse_count');
      const byPerson = new Map();
      for (const r of samples) {
        if (!byPerson.has(r.employee_id)) byPerson.set(r.employee_id, []);
        byPerson.get(r.employee_id).push(r);
      }
      for (const s of who) {
        if (!looksScripted(byPerson.get(s.employee_id) || [], watch.patternMinSamples)) continue;
        if (await notifications.recentlyNotified('scripted_activity', s.employee_id, watch.patternRepeatMinutes * MIN)) continue;
        await tell(s, {
          type: 'scripted_activity',
          title: `Repeating activity pattern: ${s.name}`,
          body: `For the last ${minutesText(watch.patternMinutes * MIN)} ${s.name}'s keyboard and mouse readings have been almost identical every minute, which real work rarely is. It may be a mouse jiggler or macro, or a repetitive task. Worth a look.`,
          refId: s.employee_id,
        });
        result.patternAlerts += 1;
      }
    }
  }

  return result;
}

/**
 * Many busy samples with near-identical (keys, mouse) readings — a mouse jiggler or macro.
 *
 * Two checks, either is enough:
 *   1. At most 2 distinct exact readings across all samples (the original check).
 *   2. All readings are "busy" (never quiet) AND the coefficient of variation of the combined
 *      count is under 15% — values that are always high with low scatter are scripted even
 *      when slightly randomised (attacker adds Math.random()*20 to bypass check 1).
 *
 * @param {{ keystroke_count: number, mouse_count: number }[]} rows
 */
function looksScripted(rows, minSamples) {
  if (rows.length < minSamples) return false;
  const busy = rows.filter((r) => Number(r.keystroke_count) + Number(r.mouse_count) > 0);
  if (busy.length < rows.length * 0.8) return false; // plenty of quiet minutes → real person

  // Check 1: at most 2 distinct exact (keys, mouse) pairs.
  const distinct = new Set(rows.map((r) => `${r.keystroke_count}|${r.mouse_count}`));
  if (distinct.size <= 2) return true;

  // Check 2: near-identical values (low coefficient of variation).
  // A CV below 15% across always-high samples is a strong scripted signal.
  if (busy.length === rows.length) {
    const vals = busy.map((r) => Number(r.keystroke_count) + Number(r.mouse_count));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    if (mean > 20) {
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      const cv = Math.sqrt(variance) / mean;
      if (cv < 0.15) return true;
    }
  }

  return false;
}

/** Seconds of "no capture" per attendance id, counting a gap that is still going up to `now`. */
async function gapSecondsByShift(attendanceIds, now = t.now()) {
  const out = new Map();
  if (!attendanceIds.length) return out;
  const rows = await db()('capture_gaps').whereIn('attendance_id', attendanceIds);
  for (const g of rows) {
    const end = g.ended_at ? Number(g.ended_at) : now;
    out.set(g.attendance_id, (out.get(g.attendance_id) || 0) + Math.max(0, Math.round((end - Number(g.started_at)) / 1000)));
  }
  return out;
}

/** Called by the scheduler; a failure is logged and the next minute tries again. */
async function safeRun() {
  try {
    return await run();
  } catch (err) {
    logger.error('Capture watch failed', { message: err.message });
    return null;
  }
}

module.exports = { run, safeRun, gapSecondsByShift };
