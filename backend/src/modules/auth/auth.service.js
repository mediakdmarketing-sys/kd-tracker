'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../../config');
const { db } = require('../../db');
const { uuid, randomToken, sha256 } = require('../../utils/ids');
const { now } = require('../../utils/time');
const { toBool } = require('../../utils/http');
const logger = require('../../utils/logger');
const { unauthorized, forbidden, notFound, badRequest, conflict, companySuspended } = require('../../utils/errors');
const companies = require('../../services/companies');

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

const totp = require('../../utils/totp');

/** Proof that the password was right, good for five minutes, to be traded for a session with a code. */
function signChallenge(employee) {
  return jwt.sign({ sub: employee.id, type: '2fa' }, config.auth.jwtSecret, { expiresIn: '5m' });
}

function signAccessToken(employee, impersonatedBy) {
  return jwt.sign(
    { sub: employee.id, role: employee.role, type: 'access', ...(impersonatedBy && { imp: impersonatedBy }) },
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

async function issueRefreshToken(employeeId, client, { impersonatedBy, expiresAt } = {}) {
  const token = randomToken();
  await db()('refresh_tokens').insert({
    id: uuid(),
    employee_id: employeeId,
    token_hash: sha256(token),
    client: client || null,
    // A view-as session keeps the end time it started with, however often it is refreshed.
    expires_at: expiresAt || now() + parseDuration(config.auth.refreshExpiresIn),
    impersonated_by: impersonatedBy || null,
    created_at: now(),
  });
  return token;
}

/**
 * Public shape of an employee. `password_hash` must never leave this function.
 * With the person's company passed in, the shape also carries what that company may use.
 */
function publicEmployee(row, company) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    department: row.department,
    companyId: row.company_id,
    isSuperAdmin: toBool(row.is_super_admin),
    platformRole: toBool(row.is_super_admin) ? row.platform_role || 'owner' : null,
    ...(toBool(row.is_super_admin) && { twoFactorEnabled: toBool(row.totp_enabled) }),
    ...(company && {
      company: {
        id: company.id,
        name: company.name,
        slug: company.slug,
        features: company.features,
        brand: company.brand,
        plan: company.plan,
        // So the portal can warn HR before a trial runs out.
        trialEndsAt: company.trialEndsAt ? new Date(company.trialEndsAt).toISOString() : null,
      },
    }),
    employeeCode: row.employee_code,
    timezone: config.timezone,
    status: row.status,
    // True while the password is a temporary one from HR; the portal sends the person to
    // choose their own before anything else.
    mustChangePassword: toBool(row.must_change_password),
    blurScreenshots: toBool(row.blur_screenshots),
    consent: {
      monitoring: toBool(row.consent_monitoring),
      audio: toBool(row.consent_audio),
      givenAt: row.consent_given_at ? new Date(Number(row.consent_given_at)).toISOString() : null,
      version: row.consent_version,
      // The client uses this to decide whether to show the consent screen before punch-in.
      // Platform accounts are not monitored (they have no shifts), so they are not asked.
      required: !toBool(row.is_super_admin) && (!toBool(row.consent_monitoring) || row.consent_version !== CONSENT_VERSION),
    },
  };
}

async function login({ email, password, client, companySlug }) {
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
  const company = await activeCompanyOf(row);
  // Signing in on a company's own address (acme.<domain>) is for that company's people only. The
  // answer is the same as a wrong password, so the address does not reveal who works where.
  if (companySlug && company.slug !== String(companySlug).toLowerCase()) {
    throw unauthorized('Invalid email or password');
  }

  // A platform account with two-factor on is only half signed in until it gives a code.
  if (toBool(row.is_super_admin) && toBool(row.totp_enabled)) {
    return { twoFactorRequired: true, challenge: signChallenge(row) };
  }

  return {
    accessToken: signAccessToken(row),
    refreshToken: await issueRefreshToken(row.id, client),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(row, company),
  };
}

const sha = (text) => require('crypto').createHash('sha256').update(String(text)).digest('hex');
const normaliseRecovery = (code) => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Second step of sign-in for a platform account: the code from the authenticator, or a recovery code. */
async function verifyTwoFactor({ challenge, code, client }) {
  let payload;
  try {
    payload = jwt.verify(challenge, config.auth.jwtSecret);
  } catch {
    throw unauthorized('That sign-in expired. Start again.');
  }
  if (payload.type !== '2fa') throw unauthorized('That sign-in expired. Start again.');

  const row = await db()('employees').where({ id: payload.sub }).first();
  if (!row || row.status !== 'active' || !toBool(row.is_super_admin) || !toBool(row.totp_enabled)) {
    throw unauthorized('That sign-in expired. Start again.');
  }
  const company = await activeCompanyOf(row);

  const step = totp.verify(row.totp_secret, code, { lastStep: row.totp_last_step });
  if (step !== null) {
    await db()('employees').where({ id: row.id }).update({ totp_last_step: step });
  } else {
    // A recovery code works once, then is gone.
    const hashes = JSON.parse(row.totp_recovery || '[]');
    const hash = sha(normaliseRecovery(code));
    const at = hashes.indexOf(hash);
    if (at < 0) throw unauthorized('That code is not right.');
    hashes.splice(at, 1);
    await db()('employees').where({ id: row.id }).update({ totp_recovery: JSON.stringify(hashes) });
  }

  return {
    accessToken: signAccessToken(row),
    refreshToken: await issueRefreshToken(row.id, client),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(row, company),
  };
}

async function superRow(employeeId) {
  const row = await db()('employees').where({ id: employeeId }).first();
  if (!row || !toBool(row.is_super_admin)) throw forbidden('Platform accounts only');
  return row;
}

/** Starts two-factor setup: a fresh secret to put into an authenticator app. Not active until confirmed. */
async function setupTwoFactor(employeeId) {
  const row = await superRow(employeeId);
  if (toBool(row.totp_enabled)) throw conflict('Two-factor sign-in is already on.');
  const secret = totp.generateSecret();
  await db()('employees').where({ id: row.id }).update({ totp_secret: secret, updated_at: now() });
  return { secret, otpauthUrl: totp.otpauthUrl({ secret, account: row.email }) };
}

/** Confirms setup with a first code, turns it on and returns recovery codes (shown once). */
async function enableTwoFactor(employeeId, { code }) {
  const row = await superRow(employeeId);
  if (toBool(row.totp_enabled)) throw conflict('Two-factor sign-in is already on.');
  if (!row.totp_secret) throw badRequest('Start the setup first.');
  const step = totp.verify(row.totp_secret, code);
  if (step === null) throw badRequest('That code is not right. Check the time on your phone and try again.');

  const codes = Array.from({ length: 8 }, () => {
    const raw = require('crypto').randomBytes(5).toString('hex');
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  await db()('employees').where({ id: row.id }).update({
    totp_enabled: true,
    totp_last_step: step,
    totp_recovery: JSON.stringify(codes.map((c) => sha(normaliseRecovery(c)))),
    updated_at: now(),
  });
  return { enabled: true, recoveryCodes: codes };
}

/** Turning it off needs the password and a current code, so a borrowed session cannot do it. */
async function disableTwoFactor(employeeId, { password, code }) {
  const row = await superRow(employeeId);
  if (!toBool(row.totp_enabled)) return { enabled: false };
  if (!row.password_hash || !(await bcrypt.compare(password, row.password_hash))) {
    throw badRequest('The password is not correct.');
  }
  if (totp.verify(row.totp_secret, code, { lastStep: row.totp_last_step }) === null) {
    throw badRequest('That code is not right.');
  }
  await db()('employees').where({ id: row.id }).update({
    totp_enabled: false,
    totp_secret: null,
    totp_last_step: null,
    totp_recovery: null,
    updated_at: now(),
  });
  await logoutEverywhere(row.id);
  return { enabled: false };
}

/** The person's company, which must exist and not be suspended for them to sign in. */
async function activeCompanyOf(row) {
  const company = await companies.get(row.company_id);
  if (!company) throw unauthorized('Invalid email or password');
  const blocked = companies.blockReason(company);
  if (blocked) throw companySuspended(blocked);
  return company;
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
  const company = await activeCompanyOf(employee);

  const impersonatedBy = stored.impersonated_by || null;
  if (impersonatedBy) {
    const owner = await db()('employees').where({ id: impersonatedBy }).first();
    if (!owner || owner.status !== 'active' || !toBool(owner.is_super_admin)) {
      throw unauthorized('This view-as session has ended');
    }
  }

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
    accessToken: signAccessToken(employee, impersonatedBy),
    refreshToken: await issueRefreshToken(employee.id, stored.client, {
      impersonatedBy,
      expiresAt: impersonatedBy ? Number(stored.expires_at) : undefined,
    }),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(employee, company),
  };
}

async function logout({ refreshToken }) {
  if (!refreshToken) return { revoked: 0 };
  const stored = await db()('refresh_tokens').where({ token_hash: sha256(refreshToken) }).first();
  if (stored && stored.impersonated_by && !stored.revoked_at) await recordImpersonationEnd(stored);
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

/** The company sees when a view-as session ended, in its own audit trail. */
async function recordImpersonationEnd(stored) {
  const owner = await db()('employees').where({ id: stored.impersonated_by }).select('name').first();
  await db()('audit_logs').insert({
    id: uuid(),
    admin_id: stored.employee_id,
    action: 'impersonation_ended',
    target_employee_id: stored.employee_id,
    target_type: 'employee',
    details: JSON.stringify({ impersonatedBy: owner ? owner.name : 'platform owner' }),
    timestamp: now(),
  });
}

/**
 * The signed-in person. In a view-as session the person's own pending steps (temporary password,
 * consent) are not asked, since they are not the one signed in, and the response says who is.
 */
async function me(employeeId, impersonatedBy) {
  const row = await db()('employees').where({ id: employeeId }).first();
  if (!row) throw notFound('Employee not found');
  const shape = {
    ...publicEmployee(row, await companies.get(row.company_id)),
    announcements: await require('../../services/announcements').active(),
  };
  if (!impersonatedBy) return shape;
  return {
    ...shape,
    mustChangePassword: false,
    consent: { ...shape.consent, required: false },
    impersonation: { by: impersonatedBy },
  };
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
  return publicEmployee(updated, await companies.get(updated.company_id));
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

async function exchangeAgentCode({ code }) {
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
  const company = await activeCompanyOf(row);

  return {
    accessToken: signAccessToken(row),
    refreshToken: await issueRefreshToken(row.id, 'desktop'),
    expiresIn: config.auth.expiresIn,
    employee: publicEmployee(row, company),
  };
}

module.exports = {
  login,
  createAgentCode,
  exchangeAgentCode,
  refresh,
  verifyTwoFactor,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  logout,
  logoutEverywhere,
  changePassword,
  me,
  recordConsent,
  publicEmployee,
  signAccessToken,
  issueRefreshToken,
  parseDuration,
  CONSENT_DISCLOSURE,
  CONSENT_VERSION,
};
