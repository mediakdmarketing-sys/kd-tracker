'use strict';

const { db } = require('../db');
const { toBool } = require('../utils/http');
const { conflict } = require('../utils/errors');
const config = require('../config');

// Every company that existed before companies did, and any row created without naming one.
const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

// What the platform owner can switch on or off for a company. Basic time tracking (punch in
// and out, breaks, attendance) is not on this list: every company has it.
const FEATURES = ['screenCapture', 'audioCapture', 'idleTracking', 'payroll', 'leave'];

const FEATURE_COLUMN = {
  screenCapture: 'feature_screen_capture',
  audioCapture: 'feature_audio_capture',
  idleTracking: 'feature_idle_tracking',
  payroll: 'feature_payroll',
  leave: 'feature_leave',
};

// A request reads its company on every call (to know it is active and what it may use), so the
// answer is kept for a short while. A change made by the platform owner shows up within this
// time on every instance, and at once on the instance that made it (see invalidate).
const TTL_MS = 15_000;
const cache = new Map();

function shape(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    timezone: row.timezone || config.timezone,
    storageLimitBytes: row.storage_limit_bytes == null ? null : Number(row.storage_limit_bytes),
    maxEmployees: row.max_employees == null ? null : Number(row.max_employees),
    features: Object.fromEntries(FEATURES.map((f) => [f, toBool(row[FEATURE_COLUMN[f]])])),
    createdAt: Number(row.created_at),
  };
}

/** The company, from a short-lived cache. Null if there is no such company. */
async function get(id) {
  const key = id || DEFAULT_COMPANY_ID;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.company;

  const row = await db()('companies').where({ id: key }).first();
  const company = shape(row);
  cache.set(key, { company, at: Date.now() });
  return company;
}

function invalidate(id) {
  if (id) {
    cache.delete(id);
    usage.delete(id);
  } else {
    cache.clear();
    usage.clear();
  }
}

// --- Plan limits -------------------------------------------------------------------------

/** Throws 409 if adding one more active person would pass the company's employee limit. */
async function assertRoomForEmployee(companyId) {
  const company = await get(companyId);
  if (!company || company.maxEmployees == null) return;
  const [{ n }] = await db()('employees')
    .where({ company_id: company.id, status: 'active' })
    .count({ n: '*' });
  if (Number(n) >= company.maxEmployees) {
    throw conflict(
      `Your plan allows ${company.maxEmployees} active employees and you have reached it. Ask your administrator to raise the limit.`
    );
  }
}

// Bytes held on disk per company, kept for a minute and bumped as files arrive, so an upload
// does not have to add up every file the company ever stored.
const USAGE_TTL_MS = 60_000;
const usage = new Map();

async function storageBytes(companyId) {
  const hit = usage.get(companyId);
  if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.bytes;

  const sum = async (table, column, notDeleted) => {
    const [row] = await db()(`${table} as f`)
      .join('employees as e', 'e.id', 'f.employee_id')
      .where('e.company_id', companyId)
      .where(notDeleted)
      .sum({ b: `f.${column}` });
    return Number(row.b) || 0;
  };
  const bytes =
    (await sum('screenshots', 'size_bytes', { 'f.file_deleted': false })) +
    (await sum('audio_recordings', 'size_bytes', { 'f.file_deleted': false })) +
    (await sum('leave_requests', 'proof_size_bytes', { 'f.proof_deleted': false }));
  usage.set(companyId, { bytes, at: Date.now() });
  return bytes;
}

/**
 * True if a file of `bytes` fits in the company's storage limit (always true with no limit).
 * When it fits, the file is counted straight away, so a burst of uploads cannot all pass.
 */
async function reserveStorage(companyId, bytes) {
  const company = await get(companyId);
  if (!company || company.storageLimitBytes == null) return true;
  const used = await storageBytes(companyId);
  if (used + bytes > company.storageLimitBytes) return false;
  usage.set(companyId, { bytes: used + bytes, at: usage.get(companyId)?.at || Date.now() });
  return true;
}

/**
 * Ids of everyone in the company. The reviewer-scope convention used by leave and similar
 * services is "a list of employee ids you may act on", so an admin passes this instead of
 * "everyone".
 */
async function employeeIds(companyId) {
  return db()('employees').where({ company_id: companyId }).pluck('id');
}

module.exports = {
  DEFAULT_COMPANY_ID,
  FEATURES,
  FEATURE_COLUMN,
  get,
  invalidate,
  shape,
  employeeIds,
  assertRoomForEmployee,
  reserveStorage,
  storageBytes,
};
