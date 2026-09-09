'use strict';

// Demo data for sprint reviews and local development. Deterministic enough to be predictable,
// varied enough that the dashboard and reports actually show something (over-break days,
// auto-closed shifts, idle gaps).
//
// Never run against production: it deletes existing rows first.

const bcrypt = require('bcryptjs');
const config = require('../../config');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { storage, buildKey } = require('../../storage');
// Lives outside the seeds directory on purpose: Knex treats every file in there as a seed.
const { makePlaceholderPng } = require('../support/placeholderImage');

const TZ = 'Asia/Kolkata';
const PASSWORD = 'Password123!';

// Five real PNGs that render as mock application windows, cycled across captures. Generated
// once and reused, so seeding thousands of rows does not re-encode an image each time.
const PLACEHOLDERS = [0, 1, 2, 3, 4].map((variant) => makePlaceholderPng(variant));

const PEOPLE = [
  ['Priya Raman', 'priya.raman@kdmarketing.in', 'admin', 'HR'],
  ['Karthik Subramanian', 'karthik.s@kdmarketing.in', 'user', 'Engineering'],
  ['Divya Nair', 'divya.nair@kdmarketing.in', 'user', 'Engineering'],
  ['Arjun Menon', 'arjun.menon@kdmarketing.in', 'user', 'Engineering'],
  ['Sneha Iyer', 'sneha.iyer@kdmarketing.in', 'user', 'Design'],
  ['Rahul Verma', 'rahul.verma@kdmarketing.in', 'user', 'Design'],
  ['Meera Krishnan', 'meera.k@kdmarketing.in', 'user', 'Support'],
  ['Vignesh Anand', 'vignesh.anand@kdmarketing.in', 'user', 'Support'],
  ['Anjali Desai', 'anjali.desai@kdmarketing.in', 'user', 'Sales'],
  ['Suresh Babu', 'suresh.babu@kdmarketing.in', 'user', 'Sales'],
  ['Fathima Noor', 'fathima.noor@kdmarketing.in', 'user', 'Operations'],
  ['Nikhil Joshi', 'nikhil.joshi@kdmarketing.in', 'user', 'Operations'],
];

/** Small deterministic PRNG, so a reseed produces the same demo numbers. */
function makeRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

exports.seed = async function seed(knex) {
  if (config.isProd) throw new Error('Refusing to seed demo data with NODE_ENV=production');

  // Child rows first — foreign keys are enforced.
  await knex('job_runs').del();
  await knex('payroll_summary').del();
  await knex('audit_logs').del();
  await knex('activity_logs').del();
  await knex('audio_recordings').del();
  await knex('screenshots').del();
  await knex('breaks').del();
  await knex('attendance').del();
  await knex('refresh_tokens').del();
  await knex('employees').del();

  const nowMs = t.now();
  const hash = await bcrypt.hash(PASSWORD, config.auth.bcryptRounds);
  const rand = makeRandom(20260101);

  const employees = PEOPLE.map(([name, email, role, department], i) => ({
    id: uuid(),
    name,
    email,
    password_hash: hash,
    role,
    department,
    employee_code: `KD${String(101 + i).padStart(4, '0')}`,
    status: 'active',
    timezone: TZ,
    consent_monitoring: true,
    // Two employees have declined audio — the 403 path is demoable without editing the DB.
    consent_audio: !['sneha.iyer@kdmarketing.in', 'suresh.babu@kdmarketing.in'].includes(email),
    consent_given_at: nowMs - 30 * t.DAY_MS,
    consent_version: '1.0',
    created_at: nowMs - 60 * t.DAY_MS,
    updated_at: nowMs,
  }));

  await knex('employees').insert(employees);

  const attendance = [];
  const breaks = [];
  const activity = [];
  const screenshots = [];
  const audio = [];
  const files = [];

  // 20 calendar days back, weekdays only. Day 0 is today and is left partly open so the live
  // dashboard has people currently working and on break.
  for (let dayOffset = 20; dayOffset >= 0; dayOffset -= 1) {
    const dayStart = new Date(nowMs - dayOffset * t.DAY_MS);
    const weekday = dayStart.getDay();
    if (weekday === 0 || weekday === 6) continue;

    for (const [index, emp] of employees.entries()) {
      // Roughly one absence per person per month.
      if (dayOffset !== 0 && rand() < 0.06) continue;

      const date = t.localDate(dayStart.getTime(), TZ);
      const isToday = dayOffset === 0;
      const shiftId = uuid();

      // Past days start mid-morning. Today has to start in the *past*: a seeded shift that
      // begins later this morning would give a live board full of people who have not worked
      // a minute yet, with no screenshots or activity behind them.
      const startHour = 9 + Math.floor(rand() * 2);
      const punchIn = isToday
        ? nowMs - Math.floor((4.5 + rand() * 2.5) * HOUR)
        : new Date(dayStart).setHours(startHour, Math.floor(rand() * 45), 0, 0);

      // One person per week forgets to punch out.
      const forgotPunchOut = !isToday && rand() < 0.04;

      // Today: the first few people are still working, one is on a break.
      let status = 'closed';
      let punchOut = punchIn + (8 * HOUR + Math.floor(rand() * 90) * MINUTE);
      let onBreakNow = false;

      if (isToday) {
        if (index % 4 === 0) {
          status = 'open';
          punchOut = null;
        } else if (index % 4 === 1) {
          status = 'on_break';
          punchOut = null;
          onBreakNow = true;
        } else {
          punchOut = Math.min(punchOut, nowMs - 5 * MINUTE);
        }
      }
      if (forgotPunchOut) punchOut = punchIn + config.shift.autoCloseHours * HOUR;

      const shiftEnd = punchOut === null ? nowMs : punchOut;

      const breakCount = 1 + Math.floor(rand() * 2);
      let totalBreak = 0;
      const dayBreaks = [];

      for (let b = 0; b < breakCount; b += 1) {
        const breakStart = punchIn + (2 + b * 3) * HOUR + Math.floor(rand() * 30) * MINUTE;
        // Occasionally a long lunch, so the over-break flag has real data behind it.
        const minutes = b === 0 ? 30 + Math.floor(rand() * 50) : 10 + Math.floor(rand() * 20);
        const breakEnd = breakStart + minutes * MINUTE;
        // A break cannot run past the end of the shift.
        if (breakEnd > shiftEnd) continue;

        totalBreak += minutes * 60;
        dayBreaks.push({
          id: uuid(),
          attendance_id: shiftId,
          employee_id: emp.id,
          break_start: breakStart,
          break_end: breakEnd,
          duration_seconds: minutes * 60,
          created_at: breakStart,
        });
      }

      if (onBreakNow) {
        // A break with no end — exactly what the live dashboard has to cope with.
        const breakStart = nowMs - (5 + Math.floor(rand() * 15)) * MINUTE;
        dayBreaks.push({
          id: uuid(),
          attendance_id: shiftId,
          employee_id: emp.id,
          break_start: breakStart,
          break_end: null,
          duration_seconds: null,
          created_at: breakStart,
        });
      }

      const autoClosed = forgotPunchOut;

      const worked =
        punchOut === null ? null : Math.max(0, Math.floor((punchOut - punchIn) / 1000) - totalBreak);
      const overBreak = totalBreak > config.shift.breakAllowanceSeconds;

      attendance.push({
        id: shiftId,
        employee_id: emp.id,
        punch_in: punchIn,
        punch_out: punchOut,
        date,
        total_break_seconds: totalBreak,
        total_worked_seconds: worked,
        idle_seconds: Math.floor(rand() * 40) * 60,
        status,
        over_break: overBreak,
        auto_closed: autoClosed,
        needs_review: overBreak || autoClosed,
        review_reason: autoClosed
          ? 'Shift was never punched out; auto-closed and needs HR confirmation.'
          : overBreak
            ? `Break time ${t.formatDuration(totalBreak)} exceeds the allowance`
            : null,
        created_at: punchIn,
        updated_at: punchOut || nowMs,
      });
      breaks.push(...dayBreaks);

      // Activity pings every ~10 minutes, with a deliberate gap so idle detection has
      // something to find.
      const activityEnd = punchOut || nowMs;
      for (let ts = punchIn; ts < activityEnd; ts += 10 * MINUTE) {
        if (rand() < 0.1) continue; // the gap
        activity.push({
          id: uuid(),
          employee_id: emp.id,
          attendance_id: shiftId,
          keystroke_count: Math.floor(rand() * 900),
          mouse_count: Math.floor(rand() * 500),
          window_title: ['VS Code', 'Chrome', 'Slack', 'Figma', 'Excel', 'Zoom'][
            Math.floor(rand() * 6)
          ],
          timestamp: ts,
          date,
          created_at: ts,
        });
      }

      // Screenshots roughly every 7 minutes. Files are only written for the last 3 days —
      // enough to demo the viewer without filling a disk.
      const writeFiles = dayOffset <= 2;
      let shotIndex = 0;
      // Every third employee works on two monitors, so the multi-display viewer has real data
      // behind it rather than only ever showing groups of one.
      const displayCount = index % 3 === 0 ? 2 : 1;
      const displayLabels = ['Built-in Display', 'DELL U2720Q'];

      for (let ts = punchIn; ts < activityEnd; ts += 7 * MINUTE) {
        const captureGroupId = uuid();
        // Older than the retention window: the file is gone, the row remains (spec 6.4).
        const purged = dayOffset > config.retention.days || !writeFiles;

        for (let displayIndex = 0; displayIndex < displayCount; displayIndex += 1) {
          const id = uuid();
          const key = buildKey({
            type: 'screenshots',
            employeeId: emp.id,
            date,
            id,
            extension: 'png',
          });
          const image = PLACEHOLDERS[shotIndex % PLACEHOLDERS.length];
          shotIndex += 1;
          if (writeFiles) files.push({ key, buffer: image });

          screenshots.push({
            id,
            employee_id: emp.id,
            attendance_id: shiftId,
            capture_id: uuid(),
            capture_group_id: captureGroupId,
            display_index: displayIndex,
            display_count: displayCount,
            display_label: displayLabels[displayIndex],
            image_url: purged ? null : key,
            captured_at: ts,
            date,
            size_bytes: image.length,
            content_type: 'image/png',
            file_deleted: purged,
            created_at: ts,
          });
        }
      }

      // Audio only where consent exists — the table must never contain a row without it.
      if (emp.consent_audio) {
        for (let ts = punchIn; ts < activityEnd; ts += 13 * MINUTE) {
          audio.push({
            id: uuid(),
            employee_id: emp.id,
            attendance_id: shiftId,
            file_url: null, // no placeholder audio; the metadata is what the demo needs
            recorded_at: ts,
            date,
            duration_seconds: config.capture.audioSampleDurationSec,
            size_bytes: 0,
            content_type: 'audio/webm',
            consent_verified: true,
            file_deleted: true,
            created_at: ts,
          });
        }
      }
    }
  }

  await knex.batchInsert('attendance', attendance, 200);
  await knex.batchInsert('breaks', breaks, 200);
  await knex.batchInsert('activity_logs', activity, 300);
  await knex.batchInsert('screenshots', screenshots, 300);
  await knex.batchInsert('audio_recordings', audio, 300);

  for (const f of files) {
    await storage().put(f.key, f.buffer, 'image/png');
  }

  const admin = employees.find((e) => e.role === 'admin');
  console.log(`
Seeded ${employees.length} employees, ${attendance.length} shifts, ${activity.length} activity logs,
${screenshots.length} screenshots (${files.length} with real files), ${audio.length} audio records.

  Admin login : ${admin.email} / ${PASSWORD}
  User login  : ${employees[1].email} / ${PASSWORD}
  No audio consent (403 demo): sneha.iyer@kdmarketing.in / ${PASSWORD}
`);
};
