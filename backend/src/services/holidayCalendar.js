'use strict';

// The company calendar: Sundays (always a day off) and the holidays HR marks.
//
// One place answers "is this date a day off?" for everything that needs it: payroll (holiday pay),
// the punch-in check, and the calendar pages. Holidays repeat yearly: a later year is filled in from
// the year before the first time anything looks at it (see the migration for why it is stored).

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const t = require('../utils/time');

const MAX_YEARS_AHEAD = 10;

const isSunday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

function isRealDate(value) {
  if (!t.isDateString(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

function shape(h) {
  return { id: h.id, date: h.date, name: h.name, repeats: Boolean(h.repeats), autoCopied: Boolean(h.auto_copied) };
}

/** The same calendar day in `year`: 29 February becomes 28 February in a year with none. */
function sameDayIn(date, year) {
  const mmdd = date.slice(5);
  return `${year}-${mmdd === '02-29' && !isLeap(year) ? '02-28' : mmdd}`;
}

/**
 * Makes sure `year` has been filled in from the year before. Idempotent and safe to call from
 * anywhere, as often as needed: after the first time it is a single lookup.
 */
async function ensureYear(year) {
  year = Number(year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return;
  if (await db()('holiday_years').where({ year }).first('year')) return;

  // Nothing is copied before the first year that has any holiday, nor absurdly far ahead.
  const first = await db()('company_holidays').min({ d: 'date' }).first();
  const firstYear = first?.d ? Number(String(first.d).slice(0, 4)) : null;
  if (firstYear === null || year <= firstYear || year > firstYear + MAX_YEARS_AHEAD) return;

  await ensureYear(year - 1); // fill the chain in order, so a gap of a few years still carries forward

  const previous = await db()('company_holidays')
    .whereBetween('date', [`${year - 1}-01-01`, `${year - 1}-12-31`])
    .andWhere({ repeats: true });
  const nowMs = t.now();
  const copies = previous.map((h) => ({
    id: uuid(),
    date: sameDayIn(h.date, year),
    name: h.name,
    repeats: true,
    auto_copied: true,
    created_by: null,
    created_at: nowMs,
  }));
  if (copies.length) await db()('company_holidays').insert(copies).onConflict('date').ignore();
  await db()('holiday_years').insert({ year, generated_at: nowMs }).onConflict('year').ignore();
}

/** Years touched by a date range, each made ready. */
async function ensureRange(start, end) {
  for (let y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y += 1) await ensureYear(y);
}

async function holidaysBetween(start, end) {
  await ensureRange(start, end);
  const rows = await db()('company_holidays').whereBetween('date', [start, end]).orderBy('date');
  return rows.map(shape);
}

async function listYear(year) {
  await ensureYear(year);
  const rows = await db()('company_holidays')
    .whereBetween('date', [`${year}-01-01`, `${year}-12-31`])
    .orderBy('date');
  return rows.map(shape);
}

/**
 * Why nobody works on this date, or null on a normal working day.
 * @returns {Promise<{ kind: 'sunday'|'holiday', name: string }|null>}
 */
async function dayOff(date) {
  if (isSunday(date)) return { kind: 'sunday', name: 'Sunday' };
  await ensureYear(date.slice(0, 4));
  const h = await db()('company_holidays').where({ date }).first('name');
  return h ? { kind: 'holiday', name: h.name } : null;
}

/** Puts a newly marked repeating holiday into the later years that have already been filled in. */
async function carryForward(holiday) {
  if (!holiday.repeats) return;
  const year = Number(holiday.date.slice(0, 4));
  const later = await db()('holiday_years').where('year', '>', year).select('year');
  const nowMs = t.now();
  for (const { year: y } of later) {
    await db()('company_holidays')
      .insert({
        id: uuid(),
        date: sameDayIn(holiday.date, y),
        name: holiday.name,
        repeats: true,
        auto_copied: true,
        created_by: null,
        created_at: nowMs,
      })
      .onConflict('date')
      .ignore();
  }
}

module.exports = { isSunday, isRealDate, ensureYear, holidaysBetween, listYear, dayOff, carryForward, shape };
