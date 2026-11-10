'use strict';

// The live timesheet and the company-wide screenshot list, for HR.
//
// Timesheet: one row per person per day, with what they are doing right now if a shift is open.
// Worked time for a running shift is measured up to this moment (the stored total only exists once a
// shift ends), net of breaks so far, so the page is live rather than "0 until punch-out".
//
// Screenshots: grouped by person and paged by person, so one person's pictures are never split over
// two pages. It lists records only; opening an image is a separate, audited request.

const { db } = require('../../db');
const t = require('../../utils/time');
const { toIso, toBool } = require('../../utils/http');
const { badRequest } = require('../../utils/errors');
const settings = require('../../services/settings');
const leaveService = require('../leave/leave.service');
const attendanceService = require('../attendance/attendance.service');
const { shapeScreenshot } = require('../capture/capture.service');
const { micLog, MAX_GAP_MS } = require('../capture/micLog');

const MAX_TIMESHEET_DAYS = 31;
const MAX_SCREENSHOT_DAYS = 7;

const DAY_MS = 86400000;
const spanDays = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** Dates default to today (company time); a backwards or over-long range is refused, not guessed at. */
function rangeOf({ from, to }, maxDays) {
  const today = t.localDate();
  const range = { from: from || to || today, to: to || from || today };
  if (range.from > range.to) throw badRequest('The From date must not be after the To date.');
  if (spanDays(range.from, range.to) > maxDays) throw badRequest(`Choose a range of ${maxDays} days or less.`);
  return range;
}

/** Adds the department and name filters to a query that has the employees table as `e`. */
function filterPeople(query, { department, search, employeeId }) {
  if (department) query.andWhere('e.department', department);
  // A person picked from the list is matched exactly; typed text matches part of a name. The pick
  // wins, so two people called Ravi are never mixed up.
  if (employeeId) query.andWhere('e.id', employeeId);
  else if (search) query.andWhereRaw('LOWER(e.name) LIKE ?', [`%${String(search).toLowerCase()}%`]);
  return query;
}

const secs = (ms) => Math.max(0, Math.round(ms / 1000));

/**
 * @returns {Promise<{ from, to, generatedAt, summary, rows }>}
 *   rows: one per person per day. state: working | on_break | finished | not_started | on_leave
 */
async function timesheet({ from, to, department, search, employeeId }) {
  const range = rangeOf({ from, to }, MAX_TIMESHEET_DAYS);
  const nowMs = t.now();

  const shifts = await filterPeople(
    db()('attendance as a').join('employees as e', 'e.id', 'a.employee_id').whereBetween('a.date', [range.from, range.to]),
    { department, search, employeeId }
  )
    .orderBy([{ column: 'e.name' }, { column: 'a.date' }, { column: 'a.punch_in' }])
    .select('a.*', 'e.name as person_name', 'e.department as person_department');

  // A break that is running right now has no end yet: count it up to this moment.
  const onBreakIds = shifts.filter((s) => s.status === 'on_break').map((s) => s.id);
  const running = onBreakIds.length
    ? await db()('breaks').whereIn('attendance_id', onBreakIds).whereNull('break_end').select('attendance_id', 'break_start')
    : [];
  const runningStart = new Map(running.map((b) => [b.attendance_id, Number(b.break_start)]));

  const byDay = new Map();
  for (const s of shifts) {
    const key = `${s.employee_id}|${s.date}`;
    if (!byDay.has(key)) {
      byDay.set(key, {
        employeeId: s.employee_id,
        name: s.person_name,
        department: s.person_department || null,
        date: s.date,
        shifts: 0,
        open: null,
        punchInMs: Number(s.punch_in),
        punchOutMs: null,
        workedSeconds: 0,
        breakSeconds: 0,
        idleSeconds: 0,
        overBreak: false,
        needsReview: false,
        reviewReason: '',
      });
    }
    const day = byDay.get(key);
    day.shifts += 1;
    day.punchInMs = Math.min(day.punchInMs, Number(s.punch_in));

    const isOpen = s.status === 'open' || s.status === 'on_break';
    if (isOpen) {
      const sinceBreak = runningStart.has(s.id) ? secs(nowMs - runningStart.get(s.id)) : 0;
      const breakSoFar = (s.total_break_seconds || 0) + sinceBreak;
      day.open = s.status; // 'open' or 'on_break'
      day.breakSeconds += breakSoFar;
      day.workedSeconds += Math.max(0, secs(nowMs - Number(s.punch_in)) - breakSoFar);
      day.idleSeconds += await attendanceService.computeIdleSeconds(s);
      day.overBreak = day.overBreak || breakSoFar > settings.get().shift.breakAllowanceSeconds;
    } else {
      day.punchOutMs = Math.max(day.punchOutMs || 0, Number(s.punch_out) || 0) || null;
      day.workedSeconds += s.total_worked_seconds || 0;
      day.breakSeconds += s.total_break_seconds || 0;
      day.idleSeconds += s.idle_seconds || 0;
      day.overBreak = day.overBreak || toBool(s.over_break);
    }
    day.needsReview = day.needsReview || toBool(s.needs_review);
    if (s.review_reason && !day.reviewReason) day.reviewReason = s.review_reason;
  }

  // How many captures each person has on each day, so the table can point at them.
  const ids = [...new Set(shifts.map((s) => s.employee_id))];
  const shotRows = ids.length
    ? await db()('screenshots')
        .whereIn('employee_id', ids)
        .whereBetween('date', [range.from, range.to])
        // One row per display; the first display marks one capture moment.
        .andWhere((b) => b.whereNull('display_index').orWhere('display_index', 0))
        .groupBy('employee_id', 'date')
        .select('employee_id', 'date')
        .count({ n: '*' })
    : [];
  const shotsBy = new Map(shotRows.map((r) => [`${r.employee_id}|${r.date}`, Number(r.n)]));

  // How many times each person's microphone was found muted (or unusable), and for how long in all,
  // from the same periods the Mic log shows. A stretch counts on the day it began.
  const mic = ids.length ? await micLog({ employeeIds: ids, from: range.from, to: range.to }) : { periods: [] };
  const micBy = new Map();
  for (const p of mic.periods) {
    const key = `${p.employeeId}|${t.localDate(new Date(p.start).getTime())}`;
    const cur = micBy.get(key) || { times: 0, seconds: 0, now: false };
    cur.times += 1;
    cur.seconds += p.durationSeconds;
    // Still silent at the last sample and that sample is recent: muted right now.
    if (p.endedBy === 'ongoing' && nowMs - new Date(p.end).getTime() <= MAX_GAP_MS) cur.now = true;
    micBy.set(key, cur);
  }

  const rows = [...byDay.values()].map((d) => ({
    employeeId: d.employeeId,
    name: d.name,
    department: d.department,
    date: d.date,
    shifts: d.shifts,
    state: d.open === 'on_break' ? 'on_break' : d.open ? 'working' : 'finished',
    punchIn: toIso(d.punchInMs),
    // Null while a shift is still running: the page says "Working now" instead of a time.
    punchOut: d.open ? null : toIso(d.punchOutMs),
    workedSeconds: d.workedSeconds,
    breakSeconds: d.breakSeconds,
    idleSeconds: d.idleSeconds,
    overBreak: d.overBreak,
    needsReview: d.needsReview,
    reviewReason: d.reviewReason,
    screenshots: shotsBy.get(`${d.employeeId}|${d.date}`) || 0,
    micMutedTimes: micBy.get(`${d.employeeId}|${d.date}`)?.times || 0,
    micMutedSeconds: micBy.get(`${d.employeeId}|${d.date}`)?.seconds || 0,
    micMutedNow: micBy.get(`${d.employeeId}|${d.date}`)?.now || false,
  }));

  // One day: everyone who matches the filters and has not punched in appears too, as "not started"
  // or "on leave", because "who is missing" is half of what a live timesheet is for.
  if (range.from === range.to) {
    const seen = new Set(rows.map((r) => r.employeeId));
    const absent = (
      await filterPeople(db()('employees as e').where('e.status', 'active'), { department, search, employeeId })
        .orderBy('e.name')
        .select('e.id', 'e.name', 'e.department')
    ).filter((p) => !seen.has(p.id));
    const onLeave = await leaveService.approvedLeaveByEmployeeForDates(absent.map((p) => ({ employeeId: p.id, date: range.from })));
    for (const p of absent) {
      rows.push({
        employeeId: p.id,
        name: p.name,
        department: p.department || null,
        date: range.from,
        shifts: 0,
        state: onLeave.has(p.id) ? 'on_leave' : 'not_started',
        punchIn: null,
        punchOut: null,
        workedSeconds: 0,
        breakSeconds: 0,
        idleSeconds: 0,
        overBreak: false,
        needsReview: false,
        reviewReason: '',
        screenshots: 0,
        micMutedTimes: 0,
        micMutedSeconds: 0,
        micMutedNow: false,
      });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  const count = (state) => rows.filter((r) => r.state === state).length;
  return {
    from: range.from,
    to: range.to,
    generatedAt: toIso(nowMs),
    summary: {
      people: new Set(rows.map((r) => r.employeeId)).size,
      working: count('working'),
      onBreak: count('on_break'),
      finished: count('finished'),
      notStarted: count('not_started'),
      onLeave: count('on_leave'),
      workedSeconds: rows.reduce((sum, r) => sum + r.workedSeconds, 0),
      breakSeconds: rows.reduce((sum, r) => sum + r.breakSeconds, 0),
      flagged: rows.filter((r) => r.needsReview || r.overBreak).length,
      micMutedTimes: rows.reduce((sum, r) => sum + r.micMutedTimes, 0),
      micMutedPeople: new Set(rows.filter((r) => r.micMutedTimes > 0).map((r) => r.employeeId)).size,
      micMutedNow: rows.filter((r) => r.micMutedNow).length,
    },
    rows,
  };
}

/**
 * Everyone's screenshot records for a short range, grouped by person.
 * Paged by person (`limit` people a page); each person's newest `perPerson` images are returned
 * with their true total, so the page can say "showing 60 of 212".
 */
async function companyScreenshots({ from, to, department, search, employeeId, page = 1, limit = 8, perPerson = 60 }) {
  const range = rangeOf({ from, to }, MAX_SCREENSHOT_DAYS);

  const base = () =>
    filterPeople(
      db()('screenshots as s').join('employees as e', 'e.id', 's.employee_id').whereBetween('s.date', [range.from, range.to]),
      { department, search, employeeId }
    );

  const [{ n }] = await base().countDistinct({ n: 's.employee_id' });
  const total = Number(n) || 0;
  // Every image the filters match, across all pages of people.
  const [{ c: imageCount }] = await base().count({ c: 's.id' });

  const people = await base()
    .groupBy('e.id', 'e.name', 'e.department', 'e.blur_screenshots')
    .orderBy('e.name')
    .limit(limit)
    .offset((page - 1) * limit)
    .select('e.id', 'e.name', 'e.department', 'e.blur_screenshots')
    .count({ images: 's.id' });

  const out = [];
  for (const p of people) {
    const rows = await db()('screenshots')
      .where({ employee_id: p.id })
      .whereBetween('date', [range.from, range.to])
      .orderBy([{ column: 'captured_at', order: 'desc' }, { column: 'display_index', order: 'asc' }])
      .limit(perPerson);
    out.push({
      employeeId: p.id,
      name: p.name,
      department: p.department || null,
      blurScreenshots: toBool(p.blur_screenshots),
      images: Number(p.images) || 0,
      shown: rows.length,
      items: rows.map(shapeScreenshot),
    });
  }

  return {
    from: range.from,
    to: range.to,
    people: out,
    images: Number(imageCount) || 0,
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

module.exports = { timesheet, companyScreenshots, MAX_TIMESHEET_DAYS, MAX_SCREENSHOT_DAYS };
