'use strict';

// The platform owner's side of the product: companies and what each of them may use.

const { db, transaction, isUniqueViolation } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { badRequest, conflict, notFound } = require('../../utils/errors');
const companies = require('../../services/companies');
const config = require('../../config');
const adminService = require('../admin/admin.service');
const auth = require('../auth/auth.service');

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
  // domainTarget: where a custom domain's CNAME must point, shown to the owner as an instruction.
  return { ...companies.shape(row), domainTarget: config.customDomain.target || null, ...EMPTY_STATS, ...stats };
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
  // The hidden company that holds platform staff accounts is not a customer.
  const rows = await db()('companies').where({ is_internal: false }).orderBy('created_at', 'asc');
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
async function create({ name, features, timezone, storageLimitBytes, maxEmployees, plan, trialDays, settings: settingsPatch, admin }) {
  if (plan !== undefined && !PLAN_NAMES.includes(plan)) throw badRequest('Unknown plan');
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
        // The plan's template first, then anything the owner typed on top of it.
        ...(plan && { plan, ...templateColumns(plan, FEATURE_COLUMN) }),
        ...(trialDays && { trial_ends_at: now + trialDays * 86400000 }),
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

  if (settingsPatch) await settingsService.ensure(id).then(() => settingsService.update(settingsPatch, { companyId: id }));
  companies.invalidate(id);
  return { company: await get(id), admin: firstAdmin };
}

async function update(id, { name, status, features, timezone, storageLimitBytes, maxEmployees, plan, trialEndsAt, autoSuspend, billingNote }) {
  if (plan !== undefined && !PLAN_NAMES.includes(plan)) throw badRequest('Unknown plan');
  if (timezone !== undefined && !isTimezone(timezone)) throw badRequest('Unknown time zone');
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');

  // Picking a plan applies its template; features and limits sent with it win over the template.
  const patch = { updated_at: t.now(), ...(plan && { plan, ...templateColumns(plan, FEATURE_COLUMN) }), ...featureColumns(features) };
  if (trialEndsAt !== undefined) patch.trial_ends_at = trialEndsAt === null ? null : new Date(trialEndsAt).getTime();
  if (autoSuspend !== undefined) patch.auto_suspend = autoSuspend;
  if (billingNote !== undefined) patch.billing_note = billingNote;
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

const { storage } = require('../../storage');
const { PLAN_NAMES, templateColumns } = require('../../services/plans');
const settingsService = require('../../services/settings');

const RESERVED_SLUGS = new Set(['www', 'app', 'api', 'admin', 'super', 'mail', 'static', 'cdn', 'login']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const MAX_LOGO_BYTES = 512 * 1024;
const LOGO_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** True if the bytes really are the image type claimed (SVG is refused: it can carry script). */
function looksLike(type, b) {
  if (type === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (type === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (type === 'image/webp') return b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

/**
 * The company's look and address: display name, colour, logo and the slug its login address is built
 * from. A field left out is unchanged; `null` clears a name, colour or the logo.
 */
async function updateBranding(id, { slug, brandName, brandColor, logoBase64, logoContentType, removeLogo }) {
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');

  const patch = { updated_at: t.now() };
  if (slug !== undefined) {
    if (!SLUG_RE.test(slug) || RESERVED_SLUGS.has(slug)) throw badRequest('Use 2-40 letters, numbers or dashes for the address, not a reserved word');
    if (slug !== row.slug && (await db()('companies').where({ slug }).first())) throw conflict('That address is taken');
    patch.slug = slug;
  }
  if (brandName !== undefined) patch.brand_name = brandName;
  if (brandColor !== undefined) patch.brand_color = brandColor;

  let oldKey = null;
  if (logoBase64) {
    const ext = LOGO_TYPES[logoContentType];
    if (!ext) throw badRequest('The logo must be a PNG, JPEG or WebP image');
    const buffer = Buffer.from(logoBase64, 'base64');
    if (buffer.length > MAX_LOGO_BYTES) throw badRequest('The logo is larger than 512 KB');
    if (!looksLike(logoContentType, buffer)) throw badRequest('That file is not a valid image of the stated type');
    const key = `brand/${id}/logo-${t.now()}.${ext}`;
    await storage().put(key, buffer, logoContentType);
    oldKey = row.logo_key;
    patch.logo_key = key;
    patch.logo_content_type = logoContentType;
  } else if (removeLogo && row.logo_key) {
    oldKey = row.logo_key;
    patch.logo_key = null;
    patch.logo_content_type = null;
  }

  await db()('companies').where({ id }).update(patch);
  if (oldKey) await storage().remove(oldKey).catch(() => {});
  companies.invalidate(id);
  return get(id);
}

/**
 * Day-by-day activity of one company for the last `days` days (on the company's own calendar):
 * hours worked and on break, how many people punched in, and how much capture data arrived.
 */
async function usage(id, days = 30) {
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');
  const zone = row.timezone || config.timezone;
  const dates = Array.from({ length: days }, (_, i) => t.localDate(t.now() - (days - 1 - i) * 86400000, zone));
  const from = dates[0];
  const to = dates[dates.length - 1];

  const work = await db()('attendance as a')
    .join('employees as e', 'e.id', 'a.employee_id')
    .where('e.company_id', id)
    .whereBetween('a.date', [from, to])
    .groupBy('a.date')
    .select('a.date')
    .sum({ worked: 'a.total_worked_seconds' })
    .sum({ breaks: 'a.total_break_seconds' })
    .countDistinct({ people: 'a.employee_id' });
  const bytes = async (table) =>
    db()(`${table} as f`)
      .join('employees as e', 'e.id', 'f.employee_id')
      .where('e.company_id', id)
      .whereBetween('f.date', [from, to])
      .groupBy('f.date')
      .select('f.date')
      .sum({ b: 'f.size_bytes' });
  const [shots, audio] = [await bytes('screenshots'), await bytes('audio_recordings')];

  const byDate = new Map(dates.map((d) => [d, { date: d, workedSeconds: 0, breakSeconds: 0, people: 0, storageBytes: 0 }]));
  for (const r of work) {
    const d = byDate.get(r.date);
    if (d) Object.assign(d, { workedSeconds: Number(r.worked) || 0, breakSeconds: Number(r.breaks) || 0, people: Number(r.people) || 0 });
  }
  for (const r of [...shots, ...audio]) {
    const d = byDate.get(r.date);
    if (d) d.storageBytes += Number(r.b) || 0;
  }
  const series = [...byDate.values()];
  return {
    from,
    to,
    days,
    series,
    totals: {
      workedSeconds: series.reduce((n, d) => n + d.workedSeconds, 0),
      breakSeconds: series.reduce((n, d) => n + d.breakSeconds, 0),
      storageBytes: series.reduce((n, d) => n + d.storageBytes, 0),
    },
  };
}

// --- Custom domains ---------------------------------------------------------------------

const HOSTNAME_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * Gives a company its own address (track.acme.com). It only serves the company once the domain is
 * verified, which needs the owner to have pointed it at this platform (see verifyDomain).
 */
async function setDomain(id, domain) {
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');
  const value = domain === null ? null : String(domain).trim().toLowerCase();
  if (value !== null && !HOSTNAME_RE.test(value)) throw badRequest('Enter a domain like track.acme.com');
  if (value !== null && (await db()('companies').where({ custom_domain: value }).whereNot({ id }).first())) {
    throw conflict('That domain is already used by another company');
  }
  await db()('companies').where({ id }).update({
    custom_domain: value,
    // A new address starts unverified; it serves nothing until the DNS check passes.
    custom_domain_verified: false,
    updated_at: t.now(),
  });
  companies.invalidate(id);
  return get(id);
}

/**
 * Checks that the domain's DNS points at this platform: a CNAME to CUSTOM_DOMAIN_TARGET. Only then
 * is the domain marked verified and answers for the company.
 */
async function verifyDomain(id, { resolveCname = require('dns').promises.resolveCname } = {}) {
  const row = await db()('companies').where({ id }).first();
  if (!row) throw notFound('Company not found');
  if (!row.custom_domain) throw badRequest('Set a domain first');
  const target = (config.customDomain.target || '').toLowerCase().replace(/\.$/, '');
  if (!target) throw badRequest('This platform has no CUSTOM_DOMAIN_TARGET set, so domains cannot be verified');

  let found = [];
  try {
    found = (await resolveCname(row.custom_domain)).map((n) => n.toLowerCase().replace(/\.$/, ''));
  } catch {
    found = [];
  }
  const ok = found.includes(target);
  await db()('companies').where({ id }).update({ custom_domain_verified: ok, updated_at: t.now() });
  companies.invalidate(id);
  return { verified: ok, expected: target, found, company: await get(id) };
}

// --- Platform staff ----------------------------------------------------------------------

/** The hidden company platform staff accounts belong to (an account has to belong to one). */
async function internalCompany() {
  let row = await db()('companies').where({ is_internal: true }).first();
  if (!row) {
    const now = t.now();
    const id = uuid();
    await db()('companies').insert({
      id,
      name: 'Platform team',
      slug: 'platform-team',
      status: 'active',
      is_internal: true,
      plan: 'custom',
      feature_screen_capture: false,
      feature_audio_capture: false,
      feature_idle_tracking: false,
      feature_payroll: false,
      feature_leave: false,
      created_at: now,
      updated_at: now,
    });
    row = await db()('companies').where({ id }).first();
  }
  return row;
}

async function listStaff() {
  const rows = await db()('employees').where({ is_super_admin: true }).orderBy('name');
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    platformRole: r.platform_role || 'owner',
    status: r.status,
    twoFactorEnabled: r.totp_enabled === true || r.totp_enabled === 1,
  }));
}

/** A support account: can look at every company and step into one to help, but change nothing. */
async function createStaff({ name, email }) {
  const company = await internalCompany();
  const person = await adminService.createEmployee({ name, email, role: 'user', companyId: company.id });
  await db()('employees').where({ id: person.id }).update({ is_super_admin: true, platform_role: 'support' });
  return { ...person, platformRole: 'support' };
}

async function removeStaff(actorId, id) {
  if (id === actorId) throw badRequest('You cannot remove your own account');
  const person = await db()('employees').where({ id, platform_role: 'support' }).first();
  if (!person) throw notFound('Support account not found');
  await db()('employees').where({ id }).update({ status: 'inactive', updated_at: t.now() });
  await db()('refresh_tokens').where({ employee_id: id }).whereNull('revoked_at').update({ revoked_at: t.now(), revoked_reason: 'admin' });
  return { removed: true, email: person.email };
}

async function resetStaffPassword(id) {
  const person = await db()('employees').where({ id, platform_role: 'support' }).first();
  if (!person) throw notFound('Support account not found');
  return adminService.updateEmployee(id, { generatePassword: true }, person.company_id);
}

// How long a view-as session lasts, in all. Refreshing it does not extend this.
const IMPERSONATION_MS = 60 * 60 * 1000;

/** Active people of a company the platform owner may step into. */
async function people(companyId, { search } = {}) {
  if (!(await db()('companies').where({ id: companyId }).first())) throw notFound('Company not found');
  const query = db()('employees')
    .where({ company_id: companyId, status: 'active' })
    .andWhere((b) => b.whereNull('is_super_admin').orWhere('is_super_admin', false));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    query.andWhere((b) => b.whereRaw('LOWER(name) LIKE ?', [like]).orWhereRaw('LOWER(email) LIKE ?', [like]));
  }
  const rows = await query.orderBy([{ column: 'role' }, { column: 'name' }]).limit(300);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    department: r.department,
  }));
}

/**
 * Steps the platform owner into a company as one of its people. The session is that person's, for
 * one hour at most, refused anything that is the person's own doing (see middleware/auth.js), and
 * written to the company's audit trail at both ends.
 */
async function impersonate(owner, employeeId) {
  const target = await db()('employees').where({ id: employeeId }).first();
  if (!target) throw notFound('Person not found');
  if (target.status !== 'active') throw badRequest('That account is inactive');
  if (target.is_super_admin === true || target.is_super_admin === 1) {
    throw badRequest('You cannot view as another platform owner');
  }
  const company = await companies.get(target.company_id);
  if (!company) throw notFound('Company not found');
  if (companies.blockReason(company)) throw badRequest('That company is suspended or its trial has ended. Reactivate it first.');

  const expiresAt = t.now() + IMPERSONATION_MS;
  await db()('audit_logs').insert({
    id: uuid(),
    admin_id: target.id,
    action: 'impersonation_started',
    target_employee_id: target.id,
    target_type: 'employee',
    details: JSON.stringify({ impersonatedBy: owner.name }),
    timestamp: t.now(),
  });

  return {
    accessToken: auth.signAccessToken(target, owner.id),
    refreshToken: await auth.issueRefreshToken(target.id, 'web', { impersonatedBy: owner.id, expiresAt }),
    expiresIn: config.auth.expiresIn,
    employee: auth.publicEmployee(target, company),
    impersonation: { by: { id: owner.id, name: owner.name }, expiresAt: new Date(expiresAt).toISOString() },
  };
}

module.exports = { list, get, create, update, updateBranding, admins, resetAdminPassword, people, impersonate, setDomain, verifyDomain, usage, listStaff, createStaff, removeStaff, resetStaffPassword };
