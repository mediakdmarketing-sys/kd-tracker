'use strict';

// Where a person is signed in, and what has been tried on their account.
//
// A session is one sign-in. Its refresh tokens come and go as they rotate; the session stays, and
// ending it ends them all. The access token carries the session id (`sid`) and the server checks the
// session on every request, so ending a session takes effect at once, not when the 30-minute access
// token would have run out.

const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const config = require('../../config');
const logger = require('../../utils/logger');
const { toIso, toBool } = require('../../utils/http');
const { describe } = require('../../utils/device');
const notifications = require('../../services/notifications');
const mailer = require('../../services/mailer');

const IDLE_LIMIT_MS = 14 * t.DAY_MS; // a session untouched this long has lost its refresh tokens anyway

async function createSession({ employeeId, client, info, secondFactor = false }) {
  const device = describe(info?.userAgent, client);
  const id = uuid();
  const now = t.now();
  await db()('sessions').insert({
    id,
    employee_id: employeeId,
    client: client || null,
    ip: info?.ip || null,
    user_agent: info?.userAgent || null,
    device_label: device.label,
    device_hash: device.hash,
    second_factor: secondFactor,
    created_at: now,
    last_seen_at: now,
  });
  return id;
}

/** Called when the session's tokens are refreshed: it is still in use, and from where. */
async function touch(sessionId, info) {
  if (!sessionId) return;
  await db()('sessions')
    .where({ id: sessionId })
    .whereNull('revoked_at')
    .update({ last_seen_at: t.now(), ...(info?.ip ? { ip: info.ip } : {}) });
}

// A session in use is noted as active at most this often, so "last seen" is true to about a minute
// without a database write on every request.
const TOUCH_EVERY_MS = 60 * 1000;

/**
 * true = live, false = ended, null = no such session (a token from before sessions existed).
 * Also records that the session is in use: every authenticated request passes through here, so for
 * the desktop agent (which asks for its status every minute and uploads as it goes) "last seen" is
 * how HR can tell the agent is connected.
 */
async function isLive(sessionId) {
  const row = await db()('sessions').where({ id: sessionId }).first('revoked_at', 'last_seen_at');
  if (!row) return null;
  if (row.revoked_at) return false;
  const now = t.now();
  if (now - Number(row.last_seen_at) > TOUCH_EVERY_MS) {
    await db()('sessions').where({ id: sessionId }).whereNull('revoked_at').update({ last_seen_at: now });
  }
  return true;
}

const AGENT_CLIENTS = ['desktop', 'chromeos', 'android'];
// The agent asks for its status every minute; three minutes of silence means it is not running or
// has no connection.
const AGENT_ONLINE_MS = 3 * 60 * 1000;

/**
 * When each person's agent last talked to the server, from any agent session, ended ones included
 * (so an agent that was signed out mid-shift still tells when it went quiet). Missing = never.
 * @returns {Promise<Map<string, number>>} employee id -> epoch ms
 */
async function lastAgentContact(employeeIds) {
  const out = new Map();
  if (!employeeIds.length) return out;
  const rows = await db()('sessions')
    .whereIn('employee_id', employeeIds)
    .whereIn('client', AGENT_CLIENTS)
    .groupBy('employee_id')
    .select('employee_id')
    .max({ last: 'last_seen_at' });
  for (const r of rows) out.set(r.employee_id, Number(r.last));
  return out;
}

/**
 * Is each person's agent (desktop or phone app) connected? From the agent's own session:
 *   online  asked the server inside the last 3 minutes
 *   quiet   signed in but silent longer than that: closed, asleep or offline
 *   none    no agent signed in (never connected, signed out, or ended)
 * @param {string[]} employeeIds
 * @returns {Promise<Map<string, {state: 'online'|'quiet'|'none', lastSeenAt: string|null, device: string|null, client: string|null}>>}
 */
async function agentStatus(employeeIds) {
  const result = new Map(employeeIds.map((id) => [id, { state: 'none', lastSeenAt: null, device: null, client: null }]));
  if (!employeeIds.length) return result;
  const now = t.now();
  const rows = await db()('sessions')
    .whereIn('employee_id', employeeIds)
    .whereIn('client', AGENT_CLIENTS)
    .whereNull('revoked_at')
    .andWhere('last_seen_at', '>', now - IDLE_LIMIT_MS)
    .orderBy('last_seen_at', 'desc')
    .select('employee_id', 'client', 'device_label', 'last_seen_at');
  for (const r of rows) {
    if (result.get(r.employee_id).state !== 'none') continue; // the newest session wins
    result.set(r.employee_id, {
      state: now - Number(r.last_seen_at) <= AGENT_ONLINE_MS ? 'online' : 'quiet',
      lastSeenAt: toIso(r.last_seen_at),
      device: r.device_label || null,
      client: r.client,
    });
  }
  return result;
}

async function revoke(employeeId, sessionId, reason = 'signed_out_other') {
  const now = t.now();
  const ended = await db()('sessions')
    .where({ id: sessionId, employee_id: employeeId })
    .whereNull('revoked_at')
    .update({ revoked_at: now, revoked_reason: reason });
  if (ended) {
    await db()('refresh_tokens')
      .where({ session_id: sessionId })
      .whereNull('revoked_at')
      .update({ revoked_at: now, revoked_reason: 'logout' });
  }
  return ended;
}

/** Ends every live session of a person, optionally keeping one (the one they are using now). */
async function revokeAll(employeeId, { exceptId = null, reason = 'signed_out_other' } = {}) {
  const live = await db()('sessions').where({ employee_id: employeeId }).whereNull('revoked_at').select('id');
  let count = 0;
  for (const { id } of live) {
    if (id === exceptId) continue;
    count += await revoke(employeeId, id, reason);
  }
  return count;
}

function shapeSession(row, currentId) {
  return {
    id: row.id,
    device: row.device_label || 'Unknown device',
    client: row.client,
    ip: row.ip,
    signedInAt: toIso(row.created_at),
    lastSeenAt: toIso(row.last_seen_at),
    twoStep: toBool(row.second_factor),
    current: row.id === currentId,
  };
}

async function listSessions(employeeId, currentId = null) {
  const rows = await db()('sessions')
    .where({ employee_id: employeeId })
    .whereNull('revoked_at')
    .andWhere('last_seen_at', '>', t.now() - IDLE_LIMIT_MS)
    .orderBy('last_seen_at', 'desc')
    .limit(50);
  return rows.map((r) => shapeSession(r, currentId));
}

/**
 * Records a sign-in attempt on a real account. For a success, also says whether the device is new:
 * the person has signed in before, but never from this browser and system.
 */
async function recordLogin({ employee, result, client, info, secondFactor = false, sessionId = null }) {
  const device = describe(info?.userAgent, client);
  let newDevice = false;
  if (result === 'success') {
    const earlier = await db()('login_events').where({ employee_id: employee.id, result: 'success' }).count({ n: '*' }).first();
    if (Number(earlier.n) > 0) {
      const same = await db()('login_events')
        .where({ employee_id: employee.id, result: 'success', device_hash: device.hash })
        .count({ n: '*' })
        .first();
      newDevice = Number(same.n) === 0;
    }
  }
  await db()('login_events').insert({
    id: uuid(),
    employee_id: employee.id,
    at: t.now(),
    result,
    client: client || null,
    ip: info?.ip || null,
    user_agent: info?.userAgent || null,
    device_label: device.label,
    device_hash: device.hash,
    new_device: newDevice,
    second_factor: secondFactor,
    session_id: sessionId,
  });
  return { newDevice, device };
}

async function loginHistory(employeeId, limit = 50) {
  const rows = await db()('login_events').where({ employee_id: employeeId }).orderBy('at', 'desc').limit(limit);
  return rows.map((r) => ({
    id: r.id,
    at: toIso(r.at),
    result: r.result,
    device: r.device_label || 'Unknown device',
    client: r.client,
    ip: r.ip,
    newDevice: toBool(r.new_device),
    twoStep: toBool(r.second_factor),
  }));
}

/** How many wrong codes this person has entered lately: past the limit, no more tries for a while. */
async function recentBadCodes(employeeId) {
  const since = t.now() - config.auth.badCodeWindowMinutes * 60 * 1000;
  const row = await db()('login_events')
    .where({ employee_id: employeeId, result: 'bad_code' })
    .andWhere('at', '>', since)
    .count({ n: '*' })
    .first();
  return Number(row.n);
}

/**
 * Tells the person about a sign-in from a device they have not used before: a notification in the
 * portal, and an email when email is set up. Best effort, never blocks the sign-in.
 */
async function announceNewDevice(employee, { device, info, client }) {
  try {
    const where = info?.ip ? ` from ${info.ip}` : '';
    await notifications.notify([employee.id], {
      type: 'new_device_login',
      title: 'New sign-in on your account',
      body: `Someone signed in${where} using ${device.label}${client ? ` (${client})` : ''}. If that was not you, change your password and end the session in Security.`,
      link: '/security',
    });
    if (mailer.isConfigured() && employee.email) {
      const when = new Date().toUTCString();
      await mailer.send({
        to: employee.email,
        subject: 'New sign-in on your WorkInvigilator account',
        text:
          `Hi ${employee.name},\n\nYour account was just signed in to from a device we have not seen before.\n\n` +
          `Device: ${device.label}\nAddress: ${info?.ip || 'unknown'}\nTime: ${when}\n\n` +
          'If this was you, nothing to do. If not, sign in, change your password and end the session under Security.',
        html:
          `<p>Hi ${String(employee.name).replace(/[<>&]/g, '')},</p><p>Your account was just signed in to from a device we have not seen before.</p>` +
          `<p>Device: <b>${device.label}</b><br>Address: ${info?.ip || 'unknown'}<br>Time: ${when}</p>` +
          '<p>If this was you, nothing to do. If not, sign in, change your password and end the session under Security.</p>',
      });
    }
  } catch (err) {
    logger.warn('New-device alert failed', { message: err.message });
  }
}

module.exports = {
  createSession,
  touch,
  isLive,
  agentStatus,
  lastAgentContact,
  revoke,
  revokeAll,
  listSessions,
  recordLogin,
  loginHistory,
  recentBadCodes,
  announceNewDevice,
};
