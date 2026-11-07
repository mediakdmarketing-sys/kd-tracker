'use strict';

// Employees' bank details: where their pay goes.
//
//   - Bank, branch, account name and account number are encrypted together (AES-256-GCM) with a key
//     that lives in the server's environment, never in the database or in git.
//   - The ciphertext is bound to the employee it belongs to, so a blob copied onto another
//     employee's row does not decrypt.
//   - Nothing here is called for anyone but HR; the routes that use it audit every view.
//
// The account number is the part that matters. It is shown as ****1234 unless HR asks for it.

const crypto = require('crypto');
const config = require('../config');
const { db } = require('../db');
const t = require('../utils/time');
const { ApiError, badRequest, notFound } = require('../utils/errors');

const VERSION = 'v1';

/** The 32-byte key, from 64 hex characters or base64. Refuses to guess when it is missing or wrong. */
function key() {
  const raw = String(config.bank.dataKey || '').trim();
  if (!raw) {
    throw new ApiError(503, 'BANK_KEY_MISSING', 'Bank details are switched off: BANK_DATA_KEY is not set on the server.');
  }
  const bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (bytes.length !== 32) {
    throw new ApiError(503, 'BANK_KEY_INVALID', 'BANK_DATA_KEY must be 32 bytes: 64 hex characters, or base64 of 32 bytes.');
  }
  return bytes;
}

function encrypt(employeeId, details) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(employeeId));
  const body = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join('.');
}

function decrypt(employeeId, blob) {
  const [version, iv, tag, body] = String(blob).split('.');
  if (version !== VERSION || !iv || !tag || !body) throw new Error('Unreadable bank details');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(employeeId));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const text = Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(text);
}

const maskOf = (last4) => `****${last4}`;

/** What HR typed, cleaned up. Spaces inside an account number are dropped. */
function clean(input) {
  return {
    bank: String(input.bank || '').trim(),
    branch: String(input.branch || '').trim(),
    accountName: String(input.accountName || '').trim(),
    accountNumber: String(input.accountNumber || '').replace(/\s+/g, ''),
  };
}

async function requireEmployee(employeeId) {
  const row = await db()('employees').where({ id: employeeId }).first('id');
  if (!row) throw notFound('Employee not found');
}

/** Saves (or replaces) an employee's bank details. Returns the masked view. */
async function save(employeeId, input, actorId) {
  await requireEmployee(employeeId);
  const details = clean(input);
  if (!details.bank || !details.accountName || !details.accountNumber) {
    throw badRequest('Bank, account name and account number are all needed.');
  }
  const nowMs = t.now();
  const row = {
    employee_id: employeeId,
    details_enc: encrypt(employeeId, details),
    bank_name: details.bank.slice(0, 100),
    account_last4: details.accountNumber.slice(-4),
    updated_by: actorId || null,
    updated_at: nowMs,
  };
  await db()('employee_bank_details')
    .insert({ ...row, created_at: nowMs })
    .onConflict('employee_id')
    .merge(row);
  return { ...mask(details), hasDetails: true };
}

function mask(details) {
  return {
    bank: details.bank,
    branch: details.branch,
    accountName: details.accountName,
    accountNumberMasked: maskOf(details.accountNumber.slice(-4)),
  };
}

/** The details with the account number hidden, or { hasDetails: false }. */
async function getMasked(employeeId) {
  const row = await db()('employee_bank_details').where({ employee_id: employeeId }).first();
  if (!row) return { hasDetails: false };
  return { hasDetails: true, ...mask(decrypt(employeeId, row.details_enc)), updatedAt: new Date(Number(row.updated_at)).toISOString() };
}

/** The whole record, account number included. Callers must audit this. */
async function reveal(employeeId) {
  const row = await db()('employee_bank_details').where({ employee_id: employeeId }).first();
  if (!row) return { hasDetails: false };
  return { hasDetails: true, ...decrypt(employeeId, row.details_enc), updatedAt: new Date(Number(row.updated_at)).toISOString() };
}

/**
 * Full details for several people at once (the payment file). A Map of employee id to details;
 * people with none are simply absent. Needs the key only if someone actually has details.
 */
async function revealMany(employeeIds) {
  const out = new Map();
  if (!employeeIds.length) return out;
  const rows = await db()('employee_bank_details').whereIn('employee_id', employeeIds);
  for (const r of rows) out.set(r.employee_id, decrypt(r.employee_id, r.details_enc));
  return out;
}

/** Who has details on file, without decrypting anything: for "N people have no bank details". */
async function status() {
  const rows = await db()('employee_bank_details').select('employee_id', 'bank_name', 'account_last4');
  return rows.map((r) => ({ employeeId: r.employee_id, bank: r.bank_name, accountNumberMasked: maskOf(r.account_last4) }));
}

async function remove(employeeId) {
  return db()('employee_bank_details').where({ employee_id: employeeId }).del();
}

module.exports = { save, getMasked, reveal, revealMany, status, remove, requireEmployee, encrypt, decrypt };
