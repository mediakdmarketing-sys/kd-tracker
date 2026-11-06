'use strict';

// Company holidays, as HR manages them: add, edit, remove, upload. Each is a day off for everyone
// (no punch-in) and is paid at the daily rate on a working day, see pay.service.creditDays.
// Sundays are always a day off and are not stored here.
//
// A holiday repeats every year by default: the next year's calendar fills itself in with the same
// dates (see services/holidayCalendar), and HR changes whatever is different that year.

const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { badRequest, conflict, notFound } = require('../../utils/errors');
const calendar = require('../../services/holidayCalendar');
const lock = require('./payrollLock');

const MAX_BULK_ROWS = 400;

async function list({ year }) {
  if (!/^\d{4}$/.test(String(year))) throw badRequest('year must be YYYY');
  return calendar.listYear(Number(year));
}

async function add({ date, name, repeats = true, actorId }) {
  if (!calendar.isRealDate(date)) throw badRequest('date must be a real date, YYYY-MM-DD');
  const clean = String(name || '').trim().slice(0, 120);
  if (!clean) throw badRequest('Give the holiday a name');
  if (calendar.isSunday(date)) throw badRequest('Sunday is already a holiday every week. Pick another day.');
  await lock.assertOpen(date.slice(0, 7), 'add a holiday in it');
  await calendar.ensureYear(date.slice(0, 4)); // so a copy made later cannot clash with what is added now

  if (await db()('company_holidays').where({ date }).first('id')) {
    throw conflict(`${date} is already a holiday.`);
  }
  const row = { id: uuid(), date, name: clean, repeats: Boolean(repeats), auto_copied: false, created_by: actorId || null, created_at: t.now() };
  await db()('company_holidays').insert(row);
  await calendar.carryForward(row);
  return calendar.shape(row);
}

/**
 * Changes a holiday. Any edit counts as HR having checked it, so it stops being flagged as copied
 * from last year. Moving it to another date needs both months to be open.
 */
async function update(id, { name, date, repeats, keep }) {
  const row = await db()('company_holidays').where({ id }).first();
  if (!row) throw notFound('Holiday not found');
  await lock.assertOpen(row.date.slice(0, 7), 'change its holidays');

  const patch = {};
  if (name !== undefined) {
    const clean = String(name).trim().slice(0, 120);
    if (!clean) throw badRequest('Give the holiday a name');
    patch.name = clean;
  }
  if (repeats !== undefined) patch.repeats = Boolean(repeats);
  if (date !== undefined && date !== row.date) {
    if (!calendar.isRealDate(date)) throw badRequest('date must be a real date, YYYY-MM-DD');
    if (calendar.isSunday(date)) throw badRequest('Sunday is already a holiday every week. Pick another day.');
    await lock.assertOpen(date.slice(0, 7), 'move a holiday into it');
    if (await db()('company_holidays').where({ date }).whereNot({ id }).first('id')) {
      throw conflict(`${date} is already a holiday.`);
    }
    patch.date = date;
  }
  if (!Object.keys(patch).length && !keep) throw badRequest('Nothing to change');

  patch.auto_copied = false;
  await db()('company_holidays').where({ id }).update(patch);
  return calendar.shape({ ...row, ...patch });
}

async function remove(id) {
  const row = await db()('company_holidays').where({ id }).first();
  if (!row) throw notFound('Holiday not found');
  await lock.assertOpen(row.date.slice(0, 7), 'remove a holiday from it');
  await db()('company_holidays').where({ id }).del();
  return calendar.shape(row);
}

/** All or nothing. A row for a date that is already a holiday renames it. @param {Array<{date, name}>} rows */
async function bulkAdd(rows, actorId) {
  if (!rows.length) throw badRequest('There are no rows to upload');
  if (rows.length > MAX_BULK_ROWS) throw badRequest(`Upload at most ${MAX_BULK_ROWS} rows at a time`);

  const errors = [];
  const clean = [];
  const seen = new Set();
  const months = new Set();
  rows.forEach((r, i) => {
    const problems = [];
    if (!calendar.isRealDate(r.date)) problems.push('date must be a real date, YYYY-MM-DD');
    else if (calendar.isSunday(r.date)) problems.push('that day is a Sunday, which is already a holiday');
    const name = String(r.name || '').trim().slice(0, 120);
    if (!name) problems.push('name is missing');
    if (calendar.isRealDate(r.date) && seen.has(r.date)) problems.push('the same date appears twice in this upload');
    seen.add(r.date);
    if (problems.length) errors.push({ row: i + 1, field: r.date || undefined, message: problems.join('; ') });
    else {
      clean.push({ date: r.date, name });
      months.add(r.date.slice(0, 7));
    }
  });
  if (errors.length) {
    throw badRequest(
      `${errors.length} row${errors.length === 1 ? ' has a problem' : 's have problems'}; nothing was saved. Fix them and upload again.`,
      errors
    );
  }
  for (const month of months) await lock.assertOpen(month, 'change its holidays');
  for (const year of new Set(clean.map((r) => r.date.slice(0, 4)))) await calendar.ensureYear(year);

  let created = 0;
  let renamed = 0;
  const nowMs = t.now();
  const added = [];
  await db().transaction(async (trx) => {
    for (const r of clean) {
      const existing = await trx('company_holidays').where({ date: r.date }).first('id');
      if (existing) {
        await trx('company_holidays').where({ id: existing.id }).update({ name: r.name, auto_copied: false });
        renamed += 1;
      } else {
        const row = { id: uuid(), date: r.date, name: r.name, repeats: true, auto_copied: false, created_by: actorId || null, created_at: nowMs };
        await trx('company_holidays').insert(row);
        added.push(row);
        created += 1;
      }
    }
  });
  for (const row of added) await calendar.carryForward(row);
  return { created, renamed };
}

module.exports = { list, add, update, remove, bulkAdd };
