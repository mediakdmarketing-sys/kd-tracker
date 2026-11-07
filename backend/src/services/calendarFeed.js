'use strict';

// One month of the company calendar for one signed-in person: what they are allowed to see.
//
//   everyone   Sundays (the apps know them), company holidays
//   employee   + their own leave
//   leader     + leave and birthdays of the people they lead (same reach as the Live board)
//   HR / admin + everyone's leave and birthdays, and the holiday details needed to edit them
//
// Leave shown is approved and pending (pending is marked, so a plan is not mistaken for a decision);
// rejected and cancelled never appear.

const { db } = require('../db');
const t = require('../utils/time');
const holidayCalendar = require('./holidayCalendar');
const birthdays = require('./birthdays');

/**
 * Who a person may see on the calendar. null means everybody (admin); otherwise a list of ids.
 * A leader sees the regular employees of the departments they lead, sub-leaders whose departments
 * they all lead, and themselves; never an admin.
 */
async function visibleIds(user) {
  if (user.role === 'admin') return null;
  if (user.role !== 'leader') return [user.id];

  const mine = await db()('department_leaders').where({ employee_id: user.id }).pluck('department');
  if (!mine.length) return [user.id];

  const members = await db()('employees')
    .where({ status: 'active', role: 'user' })
    .whereIn('department', mine)
    .pluck('id');

  const ledBy = await db()('department_leaders as dl')
    .join('employees as e', 'e.id', 'dl.employee_id')
    .where('e.status', 'active')
    .andWhere('e.role', 'leader')
    .select('dl.employee_id', 'dl.department');
  const departmentsOf = new Map();
  for (const r of ledBy) departmentsOf.set(r.employee_id, [...(departmentsOf.get(r.employee_id) || []), r.department]);
  const subLeaders = [...departmentsOf]
    .filter(([id, depts]) => id !== user.id && depts.every((d) => mine.includes(d)))
    .map(([id]) => id);

  return [...new Set([user.id, ...members, ...subLeaders])];
}

/**
 * @param {{ id: string, role: 'admin'|'leader'|'user' }} user
 * @param {string} month "YYYY-MM"
 */
async function forMonth(user, month) {
  const { start, end } = t.monthBounds(month);
  const admin = user.role === 'admin';
  const ids = await visibleIds(user);

  const holidays = (await holidayCalendar.holidaysBetween(start, end)).map((h) =>
    admin ? h : { date: h.date, name: h.name }
  );

  // Leave overlapping the month.
  const leaveQuery = db()('leave_requests as l')
    .join('employees as e', 'e.id', 'l.employee_id')
    .whereIn('l.status', ['approved', 'pending'])
    .andWhere('l.start_date', '<=', end)
    .andWhere('l.end_date', '>=', start)
    .orderBy([{ column: 'l.start_date' }, { column: 'e.name' }]);
  if (ids) leaveQuery.whereIn('l.employee_id', ids);
  const leave = (await leaveQuery.select('l.id', 'l.employee_id', 'l.type', 'l.day_part', 'l.status', 'l.start_date', 'l.end_date', 'e.name')).map(
    (r) => ({
      id: r.id,
      employeeId: r.employee_id,
      name: r.name,
      type: r.type,
      dayPart: r.day_part,
      status: r.status,
      start: r.start_date,
      end: r.end_date,
    })
  );

  // Birthdays: HR sees everybody's, a leader their team's (the same people they are reminded of),
  // an employee none.
  let people = [];
  if (user.role !== 'user') {
    people = await birthdays.listYear(Number(month.slice(0, 4)));
    people = people.filter((b) => b.date >= start && b.date <= end);
    if (ids) people = people.filter((b) => ids.includes(b.employeeId) && b.employeeId !== user.id);
  }

  return { month, start, end, holidays, leave, birthdays: people };
}

module.exports = { forMonth, visibleIds };
