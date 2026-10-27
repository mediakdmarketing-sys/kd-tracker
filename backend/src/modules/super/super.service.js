'use strict';

// The platform owner's side of the product: companies and what each of them may use.

const { db, transaction, isUniqueViolation } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { badRequest, conflict, notFound } = require('../../utils/errors');
const companies = require('../../services/companies');
const config = require('../../config');
const adminService = require('../admin/admin.service');

const { FEATURES, FEATURE_COLUMN } = companies;

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'company'
  );
}

async function uniqueSlug(base) {
  let slug = base;
  for (let n = 2; await db()('companies').where({ slug }).first(); n += 1) slug = `${base}-${n}`;
  return slug;
}

const EMPTY_STATS = {
  employees: 0,
  admins: 0,
  workingNow: 0,
  storage: { bytes: 0, screenshots: 0, audio: 0, proofs: 0, files: 0 },
  hours: {
    thisMonth: { workedSeconds: 0, breakSeconds: 0 },
    allTime: { workedSeconds: 0, breakSeconds: 0 },
    range: null,
  },
};

function shape(row, stats = {}) {
  return { ...companies.shape(row), ...EMPTY_STATS, ...stats };
}

function isTimezone(zone) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Bytes and file counts of what a table holds on disk for each company (deleted files excluded). */
async function storageOf(table, sizeColumn, ownerColumn, notDeleted, ids) {
  const rows = await db()(`${table} as f`)
    .join('employees as e', 'e.id', `f.${ownerColumn}`)
    .whereIn('e.company_id', ids)
    .where(notDeleted)
    .groupBy('e.company_id')
    .select('e.company_id')
    .sum({ bytes: `f.${sizeColumn}` })
    .count({ n: '*' });
  return new Map(rows.map((r) => [r.company_id, { bytes: Number(r.bytes) || 0, n: Number(r.n) || 0 }]));
}

/**
 * Hours worked and on break between two dates (either may be open). Finished shifts are summed
 * from their stored totals; a shift still running is added at what it has made so far, so the
 * number moves while people are working.
 */
async function hoursOf(companyId, from, to, openShifts = []) {
  const query = db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .where('e.company_id', companyId);
  if (from) query.where('a.date', '>=', from);
  if (to) query.where('a.date', '<=', to);
  const [row] = await query
    .sum({ worked: 'a.total_worked_seconds' })
    .sum({ breaks: 'a.total_break_seconds' });

  let worked = Number(row.worked) || 0;
  let breaks = Number(row.breaks) || 0;
  const now = t.now();
  for (const s of openShifts) {
    if ((from && s.date < from) || (to && s.date > to)) continue;
    const spent = Math.max(0, t.secondsBetween(Number(s.punch_in), now));
    const onBreak = s.total_break_seconds || 0;
    worked += Math.max(0, spent - onBreak);
    breaks += onBreak;
  }
  return { workedSeconds: worked, breakSeconds: breaks };
}

/**
 * What the platform owner watches per company: active people, who is working now, disk used and
 * hours worked. Hours count finished shifts only, in the company's own calendar month.
 */
async function statsFor(rows, { from, to } = {}) {
  const ids = rows.map((r) => r.id);
  const out = new Map(ids.map((id) => [id, structuredClone(EMPTY_STATS)]));
  if (!ids.length) return out;

  const people = await db()('employees')
    .whereIn('company_id', ids)
    .andWhere({ status: 'active' })
    .groupBy('company_id', 'role')
    .select('company_id', 'role')
    .count({ n: '*' });
  for (const r of people) {
    const s = out.get(r.company_id);
    s.employees += Number(r.n);
    if (r.role === 'admin') s.admins += Number(r.n);
  }

  const working = await db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .whereIn('e.company_id', ids)
    .whereIn('a.status', ['open', 'on_break'])
    .groupBy('e.company_id')
    .select('e.company_id')
    .count({ n: '*' });
  for (const r of working) out.get(r.company_id).workingNow = Number(r.n);

  const shots = await storageOf('screenshots', 'size_bytes', 'employee_id', { 'f.file_deleted': false }, ids);
  const audio = await storageOf('audio_recordings', 'size_bytes', 'employee_id', { 'f.file_deleted': false }, ids);
  const proofs = await storageOf('leave_requests', 'proof_size_bytes', 'employee_id', { 'f.proof_deleted': false }, ids);
  for (const id of ids) {
    const s = out.get(id).storage;
    const a = shots.get(id) || { bytes: 0, n: 0 };
    const b = audio.get(id) || { bytes: 0, n: 0 };
    const c = proofs.get(id) || { bytes: 0, n: 0 };
    s.screenshots = a.bytes;
    s.audio = b.bytes;
    s.proofs = c.bytes;
    s.bytes = a.bytes + b.bytes + c.bytes;
    s.files = a.n + b.n + c.n;
  }

  const open = await db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .whereIn('e.company_id', ids)
    .whereIn('a.status', ['open', 'on_break'])
    .select('e.company_id', 'a.date', 'a.punch_in', 'a.total_break_seconds');
  const openBy = new Map(ids.map((id) => [id, []]));
  for (const s of open) openBy.get(s.company_id).push(s);

  for (const row of rows) {
    const zone = row.timezone || config.timezone;
    const monthStart = `${t.localDate(t.now(), zone).slice(0, 7)}-01`;
    const live = openBy.get(row.id);
    out.get(row.id).hours = {
      thisMonth: await hoursOf(row.id, monthStart, null, live),
      allTime: await hoursOf(row.id, null, null, live),
      range: from || to ? { from: from || null, to: to || null, ...(await hoursOf(row.id, from, to, live)) } : null,
    };
  }
  return out;
}

async function list(range) {
  const rows = await db()('companies').orderBy('created_at', 'asc');
  const stats = await statsFor(rows, range);
  return rows.map((r) => shape(r, stats.get(r.id)));
}

async function get(id, range) {
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');
  const stats = await statsFor([row], range);
  return shape(row, stats.get(id));
}

function featureColumns(features = {}) {
  const out = {};
  for (const f of FEATURES) {
    if (features[f] !== undefined) out[FEATURE_COLUMN[f]] = Boolean(features[f]);
  }
  return out;
}

/**
 * A new company with its first HR administrator. The administrator gets a temporary password,
 * returned once, that they replace on first sign-in; they then add their own people.
 */
async function create({ name, features, timezone, storageLimitBytes, maxEmployees, admin }) {
  if (timezone !== undefined && !isTimezone(timezone)) throw badRequest('Unknown time zone');
  if (await db()('employees').whereRaw('LOWER(email) = ?', [admin.email.toLowerCase()]).first()) {
    throw conflict('That email already belongs to an account');
  }

  const now = t.now();
  const id = uuid();
  const slug = await uniqueSlug(slugify(name));
  try {
    await transaction(async (trx) => {
      await trx('companies').insert({
        id,
        name: name.trim(),
        slug,
        status: 'active',
        ...(timezone && { timezone }),
        ...(storageLimitBytes != null && { storage_limit_bytes: storageLimitBytes }),
        ...(maxEmployees != null && { max_employees: maxEmployees }),
        created_at: now,
        updated_at: now,
        ...featureColumns(features),
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('A company with that name already exists');
    throw err;
  }

  let firstAdmin;
  try {
    firstAdmin = await adminService.createEmployee({
      name: admin.name,
      email: admin.email,
      role: 'admin',
      companyId: id,
    });
  } catch (err) {
    // No company without somebody to run it.
    await db()('companies').where({ id }).del();
    throw err;
  }

  companies.invalidate(id);
  return { company: await get(id), admin: firstAdmin };
}

async function update(id, { name, status, features, timezone, storageLimitBytes, maxEmployees }) {
  if (timezone !== undefined && !isTimezone(timezone)) throw badRequest('Unknown time zone');
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');

  const patch = { updated_at: t.now(), ...featureColumns(features) };
  if (name !== undefined) patch.name = name.trim();
  if (timezone !== undefined) patch.timezone = timezone;
  // null clears a limit; a number sets it.
  if (storageLimitBytes !== undefined) patch.storage_limit_bytes = storageLimitBytes;
  if (maxEmployees !== undefined) patch.max_employees = maxEmployees;
  if (status !== undefined) patch.status = status;
  await db()('companies').where({ id }).update(patch);

  // A suspended company's sessions must stop at once, not when their tokens next refresh.
  if (status === 'suspended') {
    await db()('refresh_tokens')
      .whereIn('employee_id', db()('employees').where({ company_id: id }).select('id'))
      .whereNull('revoked_at')
      .update({ revoked_at: t.now(), revoked_reason: 'admin' });
  }

  companies.invalidate(id);
  return get(id);
}

/** Everyone who administers a company, so the platform owner can reach the right person. */
async function admins(id) {
  if (!(await db()('companies').where({ id }).first())) throw notFound('Company not found');
  const rows = await db()('employees')
    .where({ company_id: id, role: 'admin' })
    .orderBy('name')
    .select('id', 'name', 'email', 'status');
  return rows;
}

/** Sets a fresh temporary password for one of a company's admins (a locked-out first admin). */
async function resetAdminPassword(companyId, employeeId) {
  const person = await db()('employees').where({ id: employeeId, company_id: companyId, role: 'admin' }).first();
  if (!person) throw notFound('Admin not found');
  if (person.status !== 'active') throw badRequest('That account is inactive');
  return adminService.updateEmployee(employeeId, { generatePassword: true }, companyId);
}

module.exports = { list, get, create, update, admins, resetAdminPassword };
