'use strict';

// "Forgot password". The person gives their work email; if it is a live account, a one-time link goes
// to that address. The reply is the same whether or not the account exists, so this cannot be used to
// find out who works here. The link carries a random token (only its hash is stored), works once, and
// expires in 30 minutes. Using it ends every session of the person, like any password change.
//
// Two-step sign-in is NOT skipped: a reset gives a new password, and the code is still asked at sign-in.

const bcrypt = require('bcryptjs');
const config = require('../../config');
const { db } = require('../../db');
const { uuid, randomToken, sha256 } = require('../../utils/ids');
const t = require('../../utils/time');
const logger = require('../../utils/logger');
const passwordPolicy = require('../../utils/passwordPolicy');
const { badRequest } = require('../../utils/errors');
const mailer = require('../../services/mailer');
const notifications = require('../../services/notifications');

const MIN = 60 * 1000;
const MAX_REQUESTS_PER_HOUR = 3;

const esc = (s) => String(s).replace(/[<>&"]/g, '');

/** Always the same words, for a real account or not. */
const SENT = { sent: true, message: 'If that email belongs to an active account, a reset link has been sent. It works for 30 minutes.' };

async function request({ email, info }) {
  const row = await db()('employees').whereRaw('lower(email) = ?', [String(email).trim().toLowerCase()]).first();
  if (!row || row.status !== 'active') return SENT;

  const now = t.now();
  const recent = await db()('password_resets').where({ employee_id: row.id }).andWhere('created_at', '>', now - 60 * MIN).count({ n: '*' }).first();
  if (Number(recent.n) >= MAX_REQUESTS_PER_HOUR) return SENT; // quietly: no email flood, no hint

  if (!mailer.isConfigured()) {
    logger.warn('Password reset asked for, but email is not set up on this server', { employeeId: row.id });
    return SENT;
  }

  const token = randomToken(32);
  // Older unused links stop working: only the newest one counts.
  await db()('password_resets').where({ employee_id: row.id }).whereNull('used_at').update({ used_at: now });
  await db()('password_resets').insert({
    id: uuid(),
    employee_id: row.id,
    token_hash: sha256(token),
    expires_at: now + config.auth.resetMinutes * MIN,
    requested_ip: info?.ip || null,
    created_at: now,
  });

  const link = `${config.auth.portalUrl.replace(/\/$/, '')}/reset-password?token=${token}`;
  try {
    await mailer.send({
      to: row.email,
      subject: 'Reset your WorkInvigilator password',
      text:
        `Hi ${row.name},\n\nSomeone asked to reset the password for this account. To choose a new one, open this link within ${config.auth.resetMinutes} minutes:\n\n${link}\n\n` +
        'If you did not ask for this, ignore this email: your password stays as it is.',
      html:
        `<p>Hi ${esc(row.name)},</p><p>Someone asked to reset the password for this account. To choose a new one, use the button within ${config.auth.resetMinutes} minutes.</p>` +
        `<p><a href="${link}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">Choose a new password</a></p>` +
        `<p style="font-size:12px;color:#666">Or paste this address into your browser:<br>${link}</p>` +
        '<p>If you did not ask for this, ignore this email: your password stays as it is.</p>',
    });
  } catch (err) {
    logger.warn('Password reset email failed', { employeeId: row.id, message: err.message });
  }
  return SENT;
}

/** The link is for a real, unused, unexpired reset. Returns the row, or throws one message for all failures. */
async function findUsable(token) {
  const bad = badRequest('This reset link is not valid any more. Ask for a new one.');
  if (!token || typeof token !== 'string') throw bad;
  const reset = await db()('password_resets').where({ token_hash: sha256(token) }).first();
  if (!reset || reset.used_at || Number(reset.expires_at) < t.now()) throw bad;
  return reset;
}

/** Lets the page say "this link is no good" before asking for a password. */
async function check(token) {
  await findUsable(token);
  return { valid: true };
}

async function reset({ token, newPassword }) {
  const link = await findUsable(token);
  const row = await db()('employees').where({ id: link.employee_id }).first();
  if (!row || row.status !== 'active') throw badRequest('This reset link is not valid any more. Ask for a new one.');

  const weakness = passwordPolicy.check(newPassword, { role: row.role, email: row.email, name: row.name });
  if (weakness) throw badRequest(weakness);

  // Claimed first, so two clicks at once cannot both succeed.
  const claimed = await db()('password_resets').where({ id: link.id }).whereNull('used_at').update({ used_at: t.now() });
  if (!claimed) throw badRequest('This reset link is not valid any more. Ask for a new one.');

  await db()('employees').where({ id: row.id }).update({
    password_hash: await bcrypt.hash(newPassword, config.auth.bcryptRounds),
    must_change_password: false,
    updated_at: t.now(),
  });
  // Lazy: auth.service requires this file's neighbours, so it is loaded here, not at the top.
  await require('./auth.service').logoutEverywhere(row.id);
  await db()('password_resets').where({ employee_id: row.id }).whereNull('used_at').update({ used_at: t.now() });

  try {
    await notifications.notify([row.id], {
      type: 'password_changed',
      title: 'Your password was changed',
      body: 'Your password was reset using an emailed link. If that was not you, tell HR now.',
      link: '/security',
    });
  } catch (err) {
    logger.warn('Password reset notice failed', { message: err.message });
  }
  return { changed: true };
}

module.exports = { request, check, reset, SENT };
