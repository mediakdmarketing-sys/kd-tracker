'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { db } = require('../../db');
const { uuid, randomToken, sha256 } = require('../../utils/ids');
const { now } = require('../../utils/time');
const { toBool } = require('../../utils/http');
const logger = require('../../utils/logger');
const { unauthorized, forbidden, notFound, badRequest } = require('../../utils/errors');

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

function signAccessToken(employee) {
  return jwt.sign(
    { sub: employee.id, role: employee.role, type: 'access' },
    config.auth.jwtSecret,
    { expiresIn: config.auth.expiresIn }
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

async function issueRefreshToken(employeeId, client) {
  const token = randomToken();
  await db()('refresh_tokens').insert({
    id: uuid(),
    employee_id: employeeId,
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
    timezone: row.timezone,
    status: row.status,
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

async function login({ email, password, client }) {
  const row = await db()('employees').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first();

  // Same message and comparable timing whether the email is unknown or the password is wrong,
  // so the endpoint is not an account-enumeration oracle.
  if (!row || !row.password_hash) {
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw unauthorized('Invalid email or password');
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) throw unauthorized('Invalid email or password');
  if (row.status !== 'active') throw forbidden('Account is deactivated. Contact HR.');

  return {
    accessToken: signAccessToken(row),
    refreshToken: await issueRefreshToken(row.id, client),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(row),
  };
}

async function refresh({ refreshToken }) {
  const hash = sha256(refreshToken);
  const stored = await db()('refresh_tokens').where({ token_hash: hash }).first();

  if (!stored) throw unauthorized('Invalid refresh token');
  if (Number(stored.expires_at) < now()) throw unauthorized('Refresh token expired');

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

  return {
    accessToken: signAccessToken(employee),
    refreshToken: await issueRefreshToken(employee.id, stored.client),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(employee),
  };
}

async function logout({ refreshToken }) {
  if (!refreshToken) return { revoked: 0 };
  // Reason 'logout', not 'rotated': signing out must take effect immediately, with no grace.
  const revoked = await db()('refresh_tokens')
    .where({ token_hash: sha256(refreshToken) })
    .whereNull('revoked_at')
    .update({ revoked_at: now(), revoked_reason: 'logout' });
  return { revoked };
}

async function logoutEverywhere(employeeId) {
  const revoked = await db()('refresh_tokens')
    .where({ employee_id: employeeId })
    .whereNull('revoked_at')
    .update({ revoked_at: now(), revoked_reason: 'logout' });
  return { revoked };
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

module.exports = {
  login,
  refresh,
  logout,
  logoutEverywhere,
  me,
  recordConsent,
  publicEmployee,
  signAccessToken,
  CONSENT_DISCLOSURE,
  CONSENT_VERSION,
};
