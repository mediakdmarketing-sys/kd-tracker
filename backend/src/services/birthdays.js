'use strict';

// Employee birthdays: the calendar feed for HR, and the reminders to HR and leaders.
//
// A birthday is stored as a full date (YYYY-MM-DD) but only its month and day matter here; the year
// is never shown on the calendar. Only active employees count: a deactivated person drops off the
// calendar and gets no reminders. 29 February is celebrated on 28 February in years without one.

const { db } = require('../db');
const t = require('../utils/time');
const notifications = require('./notifications');
const { badRequest } = require('../utils/errors');

const pad = (n) => String(n).padStart(2, '0');

/** True for a real calendar date written YYYY-MM-DD. */
function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Validates what HR typed. null/'' clears the birthday. Returns the value to store. */
function parse(value, today = t.localDate()) {
  if (value === null || value === '') return null;
  if (!isRealDate(value)) throw badRequest('Birthday must be a real date, written YYYY-MM-DD');
  if (value < '1900-01-01') throw badRequest('Birthday is too long ago');
  if (value > today) throw badRequest('Birthday cannot be in the future');
  return value;
}

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The date a stored birthday falls on in `year`. */
function inYear(birthDate, year) {
  const month = birthDate.slice(5, 7);
  let day = birthDate.slice(8, 10);
  if (month === '02' && day === '29' && !isLeapYear(year)) day = '28';
  return `${year}-${month}-${day}`;
}

/** Adds days to a YYYY-MM-DD date. */
function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function activeWithBirthday() {
  return db()('employees')
    .where({ status: 'active' })
    .whereNotNull('birth_date')
    .select('id', 'name', 'role', 'department', 'birth_date');
}

/** Everyone's birthday in `year`, for the HR calendar, in date order. */
async function listYear(year) {
  const rows = await activeWithBirthday();
  return rows
    .map((r) => ({
      date: inYear(r.birth_date, year),
      employeeId: r.id,
      name: r.name,
      department: r.department || null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/**
 * Tells HR and the person's leaders about the birthdays that are tomorrow and today. Safe to run as
 * often as you like: each reminder is written once (by a reference of person and date).
 */
async function sendReminders({ today = t.localDate() } = {}) {
  const year = Number(today.slice(0, 4));
  const tomorrow = addDays(today, 1);
  const rows = await activeWithBirthday();
  let sent = 0;

  for (const person of rows) {
    // Check both this year's and next year's date, so 31 December sees a 1 January birthday.
    const dates = [inYear(person.birth_date, year), inYear(person.birth_date, year + 1)];
    const when = dates.includes(today) ? 'today' : dates.includes(tomorrow) ? 'tomorrow' : null;
    if (!when) continue;

    // "tomorrow" and "today" about the same date are two different reminders.
    const refId = `birthday:${when}:${person.id}:${when === 'today' ? today : tomorrow}`;
    const [{ count }] = await db()('notifications').where({ type: 'birthday', ref_id: refId }).count({ count: '*' });
    if (Number(count) > 0) continue;

    const { admins, leaders } = await notifications.reviewerAudience(person, [person.id]);
    const message = {
      type: 'birthday',
      title: when === 'today' ? `Today is ${person.name}'s birthday` : `${person.name}'s birthday is tomorrow`,
      body: person.department ? `${person.name} (${person.department})` : person.name,
      refId,
    };
    sent += await notifications.notify(admins, { ...message, link: `/admin/employees/${person.id}` });
    sent += await notifications.notify(leaders, { ...message, link: `/leader/members/${person.id}` });
  }
  return { affected: sent };
}

module.exports = { isRealDate, parse, inYear, addDays, listYear, sendReminders };
