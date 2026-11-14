'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { db } = require('../../db');
const { uuid, randomToken, sha256 } = require('../../utils/ids');
const { now } = require('../../utils/time');
const { toBool } = require('../../utils/http');
const logger = require('../../utils/logger');
const passwordPolicy = require('../../utils/passwordPolicy');
const { unauthorized, forbidden, notFound, badRequest } = require('../../utils/errors');
const settings = require('../../services/settings');
const sessions = require('./sessions.service');
const twoFactor = require('./twoFactor.service');

/** The disclosure shown before the first punch-in (story A-4). Versioned so a change re-prompts. */
const CONSENT_VERSION = '1.0';

const CONSENT_DISCLOSURE = {
  version: CONSENT_VERSION,
  captured: [
    {
      key: 'screenshots',
      title: 'Periodic screenshots',
      detail:
        'A screenshot of your screen is taken at random intervals of 5 to 10 minutes, only while you are punched in and not on a break.',
      required: true,
    },
    {
      key: 'activity',
      title: 'Activity counts',
      detail:
        'The number of keystrokes and mouse actions, and the name of the active application. The content of what you type is never captured or stored.',
      required: true,
    },
    {
      key: 'audio',
      title: 'Periodic audio samples',
      detail:
        'Short microphone samples (5 minutes of recording followed by an 8-minute gap), only while you are punched in and not on a break. This is optional and off unless you accept it.',
      required: false,
    },
  ],
  retention:
    'Screenshot and audio files are automatically deleted after 31 days. The record that a capture happened (date and time) is retained for reporting.',
  access:
    'Only HR and Admin users can view captured media, and every time they do, it is recorded in an audit log with their name and the time.',
  purpose:
    'Attendance verification and payroll calculation for remote work. It is not used for individual performance ranking.',
};

function signAccessToken(employee, sessionId = null) {
  return jwt.sign(
    // `sid` is the session this token belongs to: the server checks it on every request, so ending
    // the session ends the token too.
    { sub: employee.id, role: employee.role, type: 'access', ...(sessionId ? { sid: sessionId } : {}) },
    config.auth.jwtSecret,
    { expiresIn: config.auth.expiresIn, algorithm: 'HS256' }
  );
}

function parseDuration(spec) {
  const match = /^(\d+)([smhd])$/.exec(String(spec));
  if (!match) {
    // Warn rather than silently defaulting to 14 days, so a misconfigured
    // JWT_REFRESH_EXPIRES_IN is visible in logs rather than quietly wrong.
    const logger = require('../../utils/logger');
    logger.warn('parseDuration: unrecognised duration spec, falling back to 14d', { spec });
    return 14 * 24 * 60 * 60 * 1000;
  }
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return Number(match[1]) * mult;
}

async function issueRefreshToken(employeeId, client, sessionId = null) {
  const token = randomToken();
  await db()('refresh_tokens').insert({
    id: uuid(),
    employee_id: employeeId,
    session_id: sessionId,
    token_hash: sha256(token),
    client: client || null,
    expires_at: now() + parseDuration(config.auth.refreshExpiresIn),
    created_at: now(),
  });
  return token;
}

/** Public shape of an employee. `password_hash` must never leave this function. */
function publicEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department,
    employeeCode: row.employee_code,
    birthday: row.birth_date || null,
    // May see and run payroll and payments. Only ever true for an admin.
    isAccountAdmin: row.role === 'admin' && toBool(row.is_account_admin),
    timezone: config.timezone,
    status: row.status,
    // True while the password is a temporary one from HR; the portal sends the person to
    // choose their own before anything else.
    mustChangePassword: toBool(row.must_change_password),
    blurScreenshots: toBool(row.blur_screenshots),
    twoFactorEnabled: Boolean(row.totp_enabled_at),
    // HR requires two-step sign-in for admins and this admin has not set it up yet: the portal sends
    // them to Security first, and the server refuses everything else until they have.
    twoFactorSetupRequired: row.role === 'admin' && settings.get().security.requireAdmin2fa && !row.totp_enabled_at,
    consent: {
      monitoring: toBool(row.consent_monitoring),
      audio: toBool(row.consent_audio),
      givenAt: row.consent_given_at ? new Date(Number(row.consent_given_at)).toISOString() : null,
      version: row.consent_version,
      // The client uses this to decide whether to show the consent screen before punch-in.
      required: !toBool(row.consent_monitoring) || row.consent_version !== CONSENT_VERSION,
    },
  };
}

/** The session, its tokens, the history entry and (for an unfamiliar device) the alert. */
async function completeSignIn(row, { client, info, secondFactor }) {
  const sessionId = await sessions.createSession({ employeeId: row.id, client, info, secondFactor });
  const event = await sessions.recordLogin({ employee: row, result: 'success', client, info, secondFactor, sessionId });
  if (event.newDevice) await sessions.announceNewDevice(row, { device: event.device, info, client });

  return {
    accessToken: signAccessToken(row, sessionId),
    refreshToken: await issueRefreshToken(row.id, client, sessionId),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(row),
  };
}

const CHALLENGE_TTL = '5m';

/** Proof that the password step was passed, good for five minutes, only for the code step. */
function signChallenge(row, client) {
  return jwt.sign({ sub: row.id, type: '2fa', client: client || 'web' }, config.auth.jwtSecret, {
    expiresIn: CHALLENGE_TTL,
    algorithm: 'HS256',
  });
}

async function login({ email, password, client, info }) {
  const row = await db()('employees').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first();

  // Same message and comparable timing whether the email is unknown or the password is wrong,
  // so the endpoint is not an account-enumeration oracle.
  if (!row || !row.password_hash) {
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw unauthorized('Invalid email or password');
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    await sessions.recordLogin({ employee: row, result: 'bad_password', client, info });
    throw unauthorized('Invalid email or password');
  }
  if (row.status !== 'active') {
    await sessions.recordLogin({ employee: row, result: 'deactivated', client, info });
    throw forbidden('Account is deactivated. Contact HR.');
  }

  if (twoFactor.isOn(row)) {
    // Only the web portal can ask for a code. Other apps sign in through it (the desktop agent's
    // connect link), so a stolen password alone does not open a session from them either.
    if (client && client !== 'web') {
      throw forbidden('This account uses two-step sign-in. Sign in on the web portal, then connect the app from there.');
    }
    return { twoFactorRequired: true, challengeToken: signChallenge(row, client), expiresInSeconds: 300 };
  }

  return completeSignIn(row, { client, info, secondFactor: false });
}

/** The code step of a two-step sign-in. */
async function verifyTwoFactor({ challengeToken, code, recoveryCode, info }) {
  let payload;
  try {
    payload = jwt.verify(challengeToken, config.auth.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('This sign-in took too long. Enter your password again.');
  }
  if (payload.type !== '2fa') throw unauthorized('This sign-in took too long. Enter your password again.');

  const row = await db()('employees').where({ id: payload.sub }).first();
  if (!row || row.status !== 'active' || !twoFactor.isOn(row)) {
    throw unauthorized('This sign-in took too long. Enter your password again.');
  }

  await twoFactor.checkSecondFactor(row, { code, recoveryCode }, { info, client: payload.client });
  return completeSignIn(row, { client: payload.client, info, secondFactor: true });
}

async function refresh({ refreshToken, info }) {
  const hash = sha256(refreshToken);
  const stored = await db()('refresh_tokens').where({ token_hash: hash }).first();

  if (!stored) throw unauthorized('Invalid refresh token');
  if (Number(stored.expires_at) < now()) throw unauthorized('Refresh token expired');

  // A session that was ended (signed out from another device, or by HR) takes its tokens with it,
  // even one that was only just rotated and would still be inside the grace window.
  if (stored.session_id && (await sessions.isLive(stored.session_id)) === false) {
    throw unauthorized('This session was ended. Please sign in again.');
  }

  if (stored.revoked_at) {
    // Sprint 6.5 (ADR-0004). Rotation has a race: if the server rotates and the response is
    // lost on a bad connection, the client still holds the old token through no fault of its
    // own. Without a grace window that signs an employee out mid-shift, which is exactly the
    // situation the offline work is meant to survive.
    //
    // The window applies only to rotation. A token revoked by a sign-out, an HR action or a
    // previous theft response is dead on arrival — otherwise ending a session would leave a
    // two-minute hole in which it still worked.
    const sinceRevoked = now() - Number(stored.revoked_at);
    const withinGrace =
      stored.revoked_reason === 'rotated' &&
      sinceRevoked <= config.auth.refreshGraceSeconds * 1000;

    if (!withinGrace) {
      if (stored.revoked_reason === 'rotated') {
        // Reuse long after rotation is the signature of a stolen token: the legitimate client
        // has a replacement and would not present this one. End every session for the account.
        await db()('refresh_tokens')
          .where({ employee_id: stored.employee_id })
          .whereNull('revoked_at')
          .update({ revoked_at: now(), revoked_reason: 'security' });

        logger.warn('Refresh token reused long after rotation; revoked all sessions', {
          employeeId: stored.employee_id,
          tokenId: stored.id,
          secondsSinceRotation: Math.round(sinceRevoked / 1000),
        });
      }

      throw unauthorized('This session was ended for security reasons. Please sign in again.');
    }
  }

  const employee = await db()('employees').where({ id: stored.employee_id }).first();
  if (!employee) throw unauthorized('Account no longer exists');
  if (employee.status !== 'active') throw forbidden('Account is deactivated');

  // Rotate: the presented token is retired and a fresh one issued, so a stolen refresh token
  // is usable only inside the grace window before the legitimate client's next refresh.
  // `revoked_at` is left at its original value on a grace-window reuse, so repeated retries
  // cannot slide the window forward indefinitely.
  await db()('refresh_tokens')
    .where({ id: stored.id })
    .update({
      last_used_at: now(),
      reuse_count: Number(stored.reuse_count || 0) + 1,
      ...(stored.revoked_at ? {} : { revoked_at: now(), revoked_reason: 'rotated' }),
    });

  // Tokens from before sessions existed get one now, so they can be seen and ended like the rest.
  let sessionId = stored.session_id;
  if (!sessionId) {
    sessionId = await sessions.createSession({ employeeId: employee.id, client: stored.client, info });
  } else {
    await sessions.touch(sessionId, info);
  }

  return {
    accessToken: signAccessToken(employee, sessionId),
    refreshToken: await issueRefreshToken(employee.id, stored.client, sessionId),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(employee),
  };
}

async function logout({ refreshToken }) {
  if (!refreshToken) return { revoked: 0, employeeId: null };
  const hash = sha256(refreshToken);
  // Who is signing out, but only for a session that is still live: a token that was already
  // signed out, expired or rotated away must not be able to start anything.
  const live = await db()('refresh_tokens').where({ token_hash: hash }).whereNull('revoked_at').first('employee_id', 'session_id');
  // Reason 'logout', not 'rotated': signing out must take effect immediately, with no grace.
  const revoked = await db()('refresh_tokens')
    .where({ token_hash: hash })
    .whereNull('revoked_at')
    .update({ revoked_at: now(), revoked_reason: 'logout' });
  // The token first, then its session: ending the session also ends the session's other tokens.
  if (revoked && live?.session_id) await sessions.revoke(live.employee_id, live.session_id, 'logout');
  return { revoked, employeeId: revoked && live ? live.employee_id : null };
}

async function logoutEverywhere(employeeId) {
  const revoked = await db()('refresh_tokens')
    .where({ employee_id: employeeId })
    .whereNull('revoked_at')
    .update({ revoked_at: now(), revoked_reason: 'logout' });
  await sessions.revokeAll(employeeId, { reason: 'logout' });
  return { revoked };
}

/**
 * The person chooses their own password. Works whether or not the current one is temporary.
 * Every session is ended afterwards (this browser's included), so a temporary password that
 * was shared through a chat app cannot leave a signed-in session behind it; they sign in again
 * with the new one.
 */
async function changePassword(employeeId, { currentPassword, newPassword }) {
  const row = await db()('employees').where({ id: employeeId }).first();
  if (!row) throw notFound('Employee not found');

  const ok = row.password_hash && (await bcrypt.compare(currentPassword, row.password_hash));
  if (!ok) throw badRequest('The current password is not correct.');
  if (currentPassword === newPassword) {
    throw badRequest('Choose a password that is different from the current one.');
  }
  const weakness = passwordPolicy.check(newPassword, { role: row.role, email: row.email, name: row.name });
  if (weakness) throw badRequest(weakness);

  await db()('employees')
    .where({ id: employeeId })
    .update({
      password_hash: await bcrypt.hash(newPassword, config.auth.bcryptRounds),
      must_change_password: false,
      updated_at: now(),
    });
  await logoutEverywhere(employeeId);
  return { changed: true };
}

async function me(employeeId) {
  const row = await db()('employees').where({ id: employeeId }).first();
  if (!row) throw notFound('Employee not found');
  return publicEmployee(row);
}

/**
 * Story A-5. Monitoring consent is required before punch-in; audio consent is independent and
 * may be declined or later revoked without affecting the rest of the system.
 */
async function recordConsent(employeeId, { monitoring, audio }) {
  const row = await db()('employees').where({ id: employeeId }).first();
  if (!row) throw notFound('Employee not found');

  if (monitoring === false && toBool(row.consent_monitoring)) {
    // Withdrawing baseline monitoring consent is an HR conversation, not an API call: it
    // means the employee cannot be tracked at all, which is an employment matter.
    throw badRequest(
      'Monitoring consent cannot be withdrawn through the app. Contact HR to discuss this.'
    );
  }

  const patch = { updated_at: now() };
  if (monitoring !== undefined) {
    patch.consent_monitoring = monitoring;
    if (monitoring) {
      patch.consent_given_at = now();
      patch.consent_version = CONSENT_VERSION;
    }
  }
  if (audio !== undefined) patch.consent_audio = audio;

  await db()('employees').where({ id: employeeId }).update(patch);

  const updated = await db()('employees').where({ id: employeeId }).first();
  return publicEmployee(updated);
}

// --- Desktop agent hand-off ---------------------------------------------------------------
//
// Signed in on the web portal => the agent signs in too, no second password prompt. The portal
// mints a one-time code for the authenticated employee, passes it to the agent in a
// workbuddy:// link, and the agent trades it for its own session. See the migration for why only
// a hash is stored.

const AGENT_CODE_TTL_MS = 60 * 1000;

async function createAgentCode(employeeId) {
  const nowMs = now();
  // Housekeeping on the write path: old rows are useless after the TTL and nothing else prunes
  // them. An hour of slack keeps a just-expired row around for debugging.
  await db()('agent_connect_codes').where('expires_at', '<', nowMs - 60 * 60 * 1000).del();

  const code = randomToken();
  await db()('agent_connect_codes').insert({
    id: uuid(),
    employee_id: employeeId,
    code_hash: sha256(code),
    expires_at: nowMs + AGENT_CODE_TTL_MS,
    created_at: nowMs,
  });
  return { code, expiresInSeconds: AGENT_CODE_TTL_MS / 1000 };
}

async function exchangeAgentCode({ code, info }) {
  const nowMs = now();
  const hash = sha256(code);

  // Claim the code in one statement. A select-then-update would let two simultaneous exchanges
  // both pass the "unused" check; the WHERE on used_at makes exactly one of them win.
  const claimed = await db()('agent_connect_codes')
    .where({ code_hash: hash })
    .whereNull('used_at')
    .where('expires_at', '>', nowMs)
    .update({ used_at: nowMs });

  // One message for unknown, used and expired alike: nothing here should help someone guess.
  if (!claimed) throw unauthorized('This connect link has expired. Sign in on the web portal again.');

  const stored = await db()('agent_connect_codes').where({ code_hash: hash }).first();
  const row = await db()('employees').where({ id: stored.employee_id }).first();
  if (!row) throw unauthorized('This connect link has expired. Sign in on the web portal again.');
  if (row.status !== 'active') throw forbidden('Account is deactivated. Contact HR.');

  // The agent is a session of its own, so it shows in Security and can be ended there. It is not a
  // sign-in from a new device (it is the same computer, already signed in on the portal), so no
  // history entry or alert is made for it.
  const sessionId = await sessions.createSession({ employeeId: row.id, client: 'desktop', info });
  return {
    accessToken: signAccessToken(row, sessionId),
    refreshToken: await issueRefreshToken(row.id, 'desktop', sessionId),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(row),
  };
}

module.exports = {
  verifyTwoFactor,
  login,
  createAgentCode,
  exchangeAgentCode,
  refresh,
  logout,
  logoutEverywhere,
  changePassword,
  me,
  recordConsent,
  publicEmployee,
  signAccessToken,
  CONSENT_DISCLOSURE,
  CONSENT_VERSION,
};
