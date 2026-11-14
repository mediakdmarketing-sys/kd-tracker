'use strict';

// Two-step sign-in with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy...).
//
//   set up    a secret is made and shown once (as text and as a QR code in the portal). It is only
//             switched on when the person types a correct code from the app, so nobody is locked out
//             by a secret they never managed to add.
//   sign in   after the password, a 6-digit code (or one recovery code) is asked for. A code works
//             once. Five wrong ones in 15 minutes hold the account for the rest of that window.
//   recovery  ten one-time codes are given when it is switched on. They are the way back in if the
//             phone is lost; they are kept only as hashes.
//   admins    HR can require it for every admin (a setting). An account admin can switch it off for
//             someone who lost their phone and recovery codes.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const config = require('../../config');
const { db } = require('../../db');
const t = require('../../utils/time');
const totp = require('../../utils/totp');
const secretBox = require('../../utils/secretBox');
const settings = require('../../services/settings');
const { ApiError, badRequest, conflict, forbidden, unauthorized, notFound } = require('../../utils/errors');
const sessions = require('./sessions.service');

const ISSUER = 'WorkInvigilator';
const RECOVERY_COUNT = 10;

const tooMany = (minutes) =>
  new ApiError(429, 'TOO_MANY_ATTEMPTS', `Too many wrong codes. Try again in ${minutes} minutes, or use a recovery code.`);

// A recovery code is 12 hex characters shown as xxxx-xxxx-xxxx. Hashed with a pepper from the server's
// own secret, so a stolen database alone is not enough to test guesses offline.
const normaliseRecovery = (code) => String(code || '').toLowerCase().replace(/[^0-9a-f]/g, '');
const hashRecovery = (code) => crypto.createHmac('sha256', config.auth.jwtSecret).update(`recovery:${normaliseRecovery(code)}`).digest('hex');

function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const hex = crypto.randomBytes(6).toString('hex');
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
  });
}

const storedCodes = (row) => {
  try {
    return row.recovery_codes ? JSON.parse(row.recovery_codes) : [];
  } catch {
    return [];
  }
};

const isOn = (row) => Boolean(row?.totp_enabled_at);

async function load(employeeId) {
  const row = await db()('employees').where({ id: employeeId }).first();
  if (!row) throw notFound('Employee not found');
  return row;
}

async function status(employeeId) {
  const row = await load(employeeId);
  return {
    enabled: isOn(row),
    enabledAt: row.totp_enabled_at ? new Date(Number(row.totp_enabled_at)).toISOString() : null,
    recoveryCodesLeft: storedCodes(row).filter((c) => !c.usedAt).length,
    // Admins must use it when HR has switched that rule on.
    required: row.role === 'admin' && settings.get().security.requireAdmin2fa,
    setupPending: Boolean(row.totp_secret) && !isOn(row),
  };
}

/** Starts set-up: a fresh secret, not yet switched on. Starting again replaces an unfinished one. */
async function beginSetup(employeeId) {
  const row = await load(employeeId);
  if (isOn(row)) throw conflict('Two-step sign-in is already on. Turn it off first to set it up again.');
  const secret = totp.generateSecret();
  await db()('employees').where({ id: employeeId }).update({ totp_secret: secretBox.seal(secret, employeeId), updated_at: t.now() });
  return { secret, otpauthUrl: totp.otpauthUrl({ secret, account: row.email, issuer: ISSUER }) };
}

/** Switches it on once the person proves the app works. Returns the recovery codes, this once. */
async function confirmSetup(employeeId, code) {
  const row = await load(employeeId);
  if (isOn(row)) throw conflict('Two-step sign-in is already on.');
  if (!row.totp_secret) throw badRequest('Start the set-up first.');

  const secret = secretBox.open(row.totp_secret, employeeId);
  const step = totp.verify(secret, code);
  if (step === null) throw badRequest('That code is not right. Check the app and try the current code.');

  const codes = newRecoveryCodes();
  await db()('employees').where({ id: employeeId }).update({
    totp_enabled_at: t.now(),
    totp_last_step: step,
    recovery_codes: JSON.stringify(codes.map((c) => ({ hash: hashRecovery(c), usedAt: null }))),
    updated_at: t.now(),
  });
  return { recoveryCodes: codes };
}

/**
 * The second check at sign-in (and when changing the two-step settings): a code from the app, or a
 * recovery code. Wrong tries are written to the sign-in history and counted. Throws when it is not
 * right; returns how it was passed.
 */
async function checkSecondFactor(row, { code, recoveryCode }, { info = null, client = 'web' } = {}) {
  if (await sessions.recentBadCodes(row.id) >= config.auth.maxBadCodes) {
    throw tooMany(config.auth.badCodeWindowMinutes);
  }

  if (recoveryCode) {
    const wanted = hashRecovery(recoveryCode);
    const codes = storedCodes(row);
    const hit = codes.findIndex((c) => !c.usedAt && c.hash === wanted);
    if (hit >= 0) {
      codes[hit].usedAt = t.now();
      await db()('employees').where({ id: row.id }).update({ recovery_codes: JSON.stringify(codes) });
      return 'recovery';
    }
  } else if (code && row.totp_secret) {
    const lastStep = row.totp_last_step === null || row.totp_last_step === undefined ? null : Number(row.totp_last_step);
    const step = totp.verify(secretBox.open(row.totp_secret, row.id), code, { lastStep });
    if (step !== null) {
      // Compare-and-set: two requests carrying the same code cannot both succeed.
      const claimed = await db()('employees')
        .where({ id: row.id })
        .andWhere((b) => b.whereNull('totp_last_step').orWhere('totp_last_step', '<', step))
        .update({ totp_last_step: step });
      if (claimed) return 'app';
    }
  }

  await sessions.recordLogin({ employee: row, result: 'bad_code', client, info, secondFactor: true });
  throw unauthorized('That code is not right.');
}

async function requirePassword(row, password) {
  if (!password || !row.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
    throw badRequest('The password is not correct.');
  }
}

async function disable(employeeId, { password, code, recoveryCode }, ctx) {
  const row = await load(employeeId);
  if (!isOn(row)) throw conflict('Two-step sign-in is not on.');
  if (row.role === 'admin' && settings.get().security.requireAdmin2fa) {
    throw forbidden('Admins must use two-step sign-in while that rule is on. Ask an account admin if you lost your phone.');
  }
  await requirePassword(row, password);
  await checkSecondFactor(row, { code, recoveryCode }, ctx);
  await clear(employeeId);
  return { enabled: false };
}

/** New recovery codes replace all the old ones. Needs the password and a current code. */
async function regenerateRecoveryCodes(employeeId, { password, code }, ctx) {
  const row = await load(employeeId);
  if (!isOn(row)) throw conflict('Turn two-step sign-in on first.');
  await requirePassword(row, password);
  await checkSecondFactor(row, { code }, ctx);
  const codes = newRecoveryCodes();
  await db()('employees').where({ id: employeeId }).update({
    recovery_codes: JSON.stringify(codes.map((c) => ({ hash: hashRecovery(c), usedAt: null }))),
    updated_at: t.now(),
  });
  return { recoveryCodes: codes };
}

async function clear(employeeId) {
  await db()('employees').where({ id: employeeId }).update({
    totp_secret: null, totp_enabled_at: null, totp_last_step: null, recovery_codes: null, updated_at: t.now(),
  });
}

/** For someone who lost the phone and the recovery codes. Also ends their sessions. */
async function adminReset(targetId) {
  const row = await load(targetId);
  if (!isOn(row) && !row.totp_secret) throw conflict('Two-step sign-in is not on for this person.');
  await clear(targetId);
  await sessions.revokeAll(targetId, { reason: 'admin' });
  return { enabled: false };
}

module.exports = {
  status,
  beginSetup,
  confirmSetup,
  checkSecondFactor,
  disable,
  regenerateRecoveryCodes,
  adminReset,
  isOn,
};
