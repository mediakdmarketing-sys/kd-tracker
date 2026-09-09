'use strict';

const config = require('../config');
const { db } = require('../db');
const t = require('../utils/time');
const attendanceService = require('../modules/attendance/attendance.service');

/**
 * Story T-7 — an employee who closes their laptop without punching out would otherwise leave
 * a shift open forever, and their next punch-in would be rejected as a duplicate.
 *
 * Such a shift is closed at the configured cutoff, the worked time is recorded as-is, and the
 * day is flagged for HR rather than silently accepted or silently discarded. Deciding the real
 * end of that shift is a human judgement.
 */
async function closeStaleShifts({ at = t.now(), maxHours = config.shift.autoCloseHours } = {}) {
  const cutoff = t.hoursAgo(maxHours, at);

  const stale = await db()('attendance')
    .whereIn('status', ['open', 'on_break'])
    .andWhere('punch_in', '<', cutoff);

  const closed = [];

  for (const stub of stale) {
    // Re-read the row rather than trusting the batch SELECT above: time has passed since
    // then (each prior iteration does several awaited queries), and the employee may have
    // punched out for real in the meantime.
    const shift = await db()('attendance').where({ id: stub.id }).first();
    if (!shift || !['open', 'on_break'].includes(shift.status)) continue;

    // Close any break still running, so break totals are not left mid-flight.
    const openBreak = await db()('breaks')
      .where({ attendance_id: shift.id })
      .whereNull('break_end')
      .first();

    if (openBreak) {
      const duration = t.secondsBetween(Number(openBreak.break_start), Number(shift.punch_in) + maxHours * 3600 * 1000);
      await db()('breaks')
        .where({ id: openBreak.id })
        .update({ break_end: Number(shift.punch_in) + maxHours * 3600 * 1000, duration_seconds: duration });
    }

    const [{ total }] = await db()('breaks')
      .where({ attendance_id: shift.id })
      .sum({ total: 'duration_seconds' });
    const breakSeconds = Number(total) || 0;

    const punchOut = Number(shift.punch_in) + maxHours * 3600 * 1000;
    const worked = Math.max(0, t.secondsBetween(Number(shift.punch_in), punchOut) - breakSeconds);
    const idle = await attendanceService.computeIdleSeconds({ ...shift, punch_out: punchOut });

    // Guarded on status again, not just id: if the employee punched out for real in the gap
    // between the re-read above and this write, that update already moved status to
    // 'closed' and this WHERE simply matches zero rows — instead of unconditionally
    // overwriting a genuine punch-out (and its real worked time) with the sweep's estimate
    // and an incorrect "never punched out" flag.
    const affected = await db()('attendance')
      .where({ id: shift.id })
      .whereIn('status', ['open', 'on_break'])
      .update({
        punch_out: punchOut,
        status: 'closed',
        total_break_seconds: breakSeconds,
        total_worked_seconds: worked,
        idle_seconds: idle,
        over_break: breakSeconds > config.shift.breakAllowanceSeconds,
        auto_closed: true,
        needs_review: true,
        review_reason: `Shift was never punched out; auto-closed ${maxHours}h after punch-in. Worked time needs HR confirmation.`,
        updated_at: at,
      });

    if (!affected) continue;
    closed.push({ attendanceId: shift.id, employeeId: shift.employee_id, date: shift.date });
  }

  return { affected: closed.length, closed };
}

module.exports = { closeStaleShifts };
