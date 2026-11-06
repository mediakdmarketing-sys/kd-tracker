'use strict';

// Emailing payslips, one person or everyone.
//
// Sending goes through a queue (the payslip_emails table) worked by a background loop, not inside
// the request: the email service allows only a couple of messages a second, so sixty payslips
// take about half a minute, longer than a web request may last. Each person's row shows queued,
// sent or failed, and a restart in the middle just leaves the unsent rows queued for the next run.
// A person is only ever emailed at the address on their own employee record.

const config = require('../../config');
const settings = require('../../services/settings');
const { FONTS } = require('../../services/payslipTemplate');
const mailer = require('../../services/mailer');
const pay = require('./pay.service');
const { db } = require('../../db');
const { uuid } = require('../../utils/ids');
const t = require('../../utils/time');
const { toIso } = require('../../utils/http');
const { badRequest } = require('../../utils/errors');
const logger = require('../../utils/logger');

const DEFAULT_COMPANY = 'KD Marketing';
const MAX_ATTEMPTS = 3;
const STALE_SENDING_MS = 5 * 60 * 1000;
// The email service's default limit is 2 requests a second; stay under it.
let paceMs = 600;

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MONTH_NAME = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** For tests: no waiting between messages. */
function setPace(ms) {
  paceMs = ms;
}

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function monthTitle(month) {
  return MONTH_NAME.format(new Date(`${month}-01T00:00:00Z`));
}

function companyName() {
  return settings.get().company.name || DEFAULT_COMPANY;
}

/** The logo's public address, for mail clients to fetch. Null when there is no logo or no public URL. */
function logoUrl() {
  const { logoKey, logoUpdatedAt } = settings.get().company;
  if (!logoKey || !config.mail.publicApiUrl) return null;
  return `${config.mail.publicApiUrl}/api/branding/logo?v=${logoUpdatedAt}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One earnings line: "Full days: 18 × $50.00", "Half days: 2 × $25.00", "Other hours: 5.5 h at $5.56/h". */
function lineLabel(l) {
  if (l.kind === 'full') return `Full ${l.days === 1 ? 'day' : 'days'}: ${l.days} × ${MONEY.format(l.dailyRate)}`;
  if (l.kind === 'half') return `Half ${l.days === 1 ? 'day' : 'days'}: ${l.days} × ${MONEY.format(l.dailyRate / 2)}`;
  return `Other hours: ${l.hours} h at ${MONEY.format(l.hourlyRate)}/h`;
}

/** "You worked 21 days: 18 full, 2 half, and 5.5 hours on 1 other day (total 170.5 hours)." */
function summaryLine(slip, show = { dayBreakdown: true, totalHours: true }) {
  const parts = [`${slip.fullDays} full`, `${slip.halfDays} half`];
  if (slip.otherDays) parts.push(`${slip.otherHours} hours on ${plural(slip.otherDays, 'other day')}`);
  let line = `You worked ${plural(slip.daysWorked, 'day')}`;
  if (show.dayBreakdown) line += `: ${parts.join(', ')}`;
  if (show.totalHours) line += ` (total ${slip.totalHours} hours)`;
  return `${line}.`;
}

const DEFAULT_NOTE =
  'All amounts are in US dollars. A full day pays the daily rate, a half day pays half of it, and other work is paid by the hour; breaks are not counted. Bonuses are added on top. If something looks wrong, please reply to HR.';

/** The message for one payslip (see pay.service.payslip for its shape). */
function buildEmail(slip, { company = companyName(), logo = logoUrl(), template = settings.get().payslip } = {}) {
  const title = monthTitle(slip.month);
  const { colors, show, font } = template;
  // A plain grey rule: 8-digit hex colours are not understood by every email program.
  const cell = 'padding:8px 10px;border-bottom:1px solid #d9d7e6;';
  const note = template.footerNote || DEFAULT_NOTE;

  // Employee details the template allows, as one line each under the heading.
  const details = [
    show.employeeId && slip.employee.employeeCode ? `ID ${slip.employee.employeeCode}` : null,
    show.department && slip.employee.department ? slip.employee.department : null,
    show.email ? slip.employee.email : null,
  ].filter(Boolean);

  const rows = [
    ...slip.lines.map(
      (l) => `<tr><td style="${cell}">${esc(lineLabel(l))}</td><td style="${cell}text-align:right;">${MONEY.format(l.amount)}</td></tr>`
    ),
    `<tr><td style="${cell}"><strong>Base pay</strong></td><td style="${cell}text-align:right;"><strong>${MONEY.format(slip.basePay)}</strong></td></tr>`,
    ...slip.bonuses.map(
      (b) => `<tr><td style="${cell}">Bonus: ${esc(b.reason)}</td><td style="${cell}text-align:right;">${MONEY.format(b.amount)}</td></tr>`
    ),
    `<tr><td style="padding:12px 10px;font-size:16px;color:${colors.accent};"><strong>Net pay</strong></td><td style="padding:12px 10px;font-size:16px;text-align:right;color:${colors.accent};"><strong>${MONEY.format(slip.netPay)}</strong></td></tr>`,
  ].join('');

  const html = `<!doctype html><html><body style="margin:0;background:#f5f4fc;font-family:${FONTS[font]};color:${colors.text};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:${colors.background};border-radius:12px;">
<tr><td style="background:${colors.headerBackground};border-radius:12px 12px 0 0;padding:20px 24px;border-bottom:2px solid ${colors.accent};">
${show.logo && logo ? `<img src="${esc(logo)}" alt="" width="52" height="52" style="display:inline-block;vertical-align:middle;margin-right:12px;border-radius:8px;object-fit:contain;">` : ''}
<span style="font-size:20px;font-weight:700;vertical-align:middle;color:${colors.accent};">${esc(company)}</span>
<div style="margin:6px 0 0;opacity:.8;">${esc(template.title)} for ${esc(title)}</div>
${details.length ? `<div style="margin:4px 0 0;font-size:12px;opacity:.7;">${details.map(esc).join(' · ')}</div>` : ''}
</td></tr>
<tr><td style="padding:20px 24px 24px;">
<p style="margin:0 0 14px;">Hello ${esc(slip.employee.name)},</p>
<p style="margin:0 0 14px;">Here is your ${esc(template.title.toLowerCase())} for ${esc(title)}. ${esc(summaryLine(slip, show))}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows}</table>
${show.rulesNote ? `<p style="font-size:12px;margin:18px 0 0;opacity:.75;">${esc(note)}</p>` : ''}
</td></tr></table></td></tr></table></body></html>`;

  const text = [
    `${company}: ${template.title.toLowerCase()} for ${title}`,
    ...(details.length ? [details.join(' · ')] : []),
    '',
    `Hello ${slip.employee.name},`,
    summaryLine(slip, show),
    ...slip.lines.map((l) => `  ${lineLabel(l)} = ${MONEY.format(l.amount)}`),
    `Base pay: ${MONEY.format(slip.basePay)}`,
    ...slip.bonuses.map((b) => `Bonus (${b.reason}): ${MONEY.format(b.amount)}`),
    `Net pay: ${MONEY.format(slip.netPay)}`,
    ...(show.rulesNote ? ['', note] : []),
  ].join('\n');

  return { subject: `Your ${template.title.toLowerCase()} for ${title}`, html, text };
}

// --- Queueing -----------------------------------------------------------------------------

/**
 * Puts payslips on the queue. With no `employeeIds` that is everyone active who has a payroll row
 * for the month. People already queued or sending are left alone.
 *
 * @returns {Promise<{ queued: number, skipped: Array<{ employeeId: string, reason: string }> }>}
 */
async function queue({ month, employeeIds, requestedBy }) {
  if (!pay.isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  if (!mailer.isConfigured()) {
    throw badRequest('Email is not set up on this server. Add RESEND_API_KEY and MAIL_FROM to the server settings first.');
  }

  const query = db()('payroll_summary as p')
    .join('employees as e', 'e.id', 'p.employee_id')
    .where('p.month', month);
  if (employeeIds) query.whereIn('p.employee_id', employeeIds);
  else query.andWhere('e.status', 'active');
  const eligible = await query.select('e.id', 'e.email');

  const skipped = [];
  if (employeeIds) {
    const found = new Set(eligible.map((e) => e.id));
    for (const id of employeeIds) {
      if (!found.has(id)) skipped.push({ employeeId: id, reason: `No payroll for ${month} yet. Generate the month first.` });
    }
  }
  if (!eligible.length) return { queued: 0, skipped };

  const existing = await db()('payslip_emails')
    .where({ month })
    .whereIn('employee_id', eligible.map((e) => e.id))
    .select('employee_id', 'status');
  const busy = new Set(existing.filter((r) => r.status === 'queued' || r.status === 'sending').map((r) => r.employee_id));

  const nowMs = t.now();
  const rows = eligible
    .filter((e) => !busy.has(e.id))
    .map((e) => ({
      id: uuid(),
      employee_id: e.id,
      month,
      to_email: e.email,
      status: 'queued',
      error: null,
      provider_id: null,
      attempts: 0,
      requested_by: requestedBy || null,
      created_at: nowMs,
      updated_at: nowMs,
      sent_at: null,
    }));

  if (rows.length) {
    await db()('payslip_emails')
      .insert(rows)
      .onConflict(['employee_id', 'month'])
      .merge({
        to_email: db().raw('excluded.to_email'),
        status: 'queued',
        error: null,
        provider_id: null,
        attempts: 0,
        requested_by: requestedBy || null,
        updated_at: nowMs,
        sent_at: null,
      });
  }
  return { queued: rows.length, skipped };
}

// --- The worker ---------------------------------------------------------------------------

let running = false;

/** Sends everything queued, one message at a time. Safe to call at any moment, from anywhere. */
async function processQueue() {
  if (running) return { sent: 0, failed: 0 };
  running = true;
  const result = { sent: 0, failed: 0 };
  try {
    // A worker that died mid-send leaves its row "sending": put those back.
    await db()('payslip_emails')
      .where({ status: 'sending' })
      .andWhere('updated_at', '<', t.now() - STALE_SENDING_MS)
      .update({ status: 'queued', updated_at: t.now() });

    for (;;) {
      const next = await db()('payslip_emails').where({ status: 'queued' }).orderBy('created_at').first();
      if (!next) break;

      // Claim it; if another process got there first, move on.
      const claimed = await db()('payslip_emails')
        .where({ id: next.id, status: 'queued' })
        .update({ status: 'sending', attempts: next.attempts + 1, updated_at: t.now() });
      if (!claimed) continue;

      const outcome = await sendOne(next, next.attempts + 1);
      if (outcome === 'sent') result.sent += 1;
      else if (outcome === 'failed') result.failed += 1;
      if (paceMs) await sleep(paceMs);
    }
  } finally {
    running = false;
  }
  return result;
}

async function sendOne(row, attempt) {
  const finish = (patch) => db()('payslip_emails').where({ id: row.id }).update({ ...patch, updated_at: t.now() });

  try {
    const slip = await pay.payslip({ employeeId: row.employee_id, month: row.month });
    const info = await mailer.send({ to: row.to_email, ...buildEmail(slip) });
    await finish({ status: 'sent', error: null, provider_id: info?.id || null, sent_at: t.now() });
    return 'sent';
  } catch (err) {
    const message = String(err.message || err).slice(0, 500);
    if (err instanceof mailer.TemporaryMailError && attempt < MAX_ATTEMPTS) {
      // Busy or unreachable: wait and let the loop pick it up again.
      await finish({ status: 'queued', error: message });
      if (paceMs) await sleep(Math.min(err.retryAfterMs || 2000, 30_000));
      return 'retry';
    }
    logger.warn('Payslip email failed', { employeeId: row.employee_id, month: row.month, message });
    await finish({ status: 'failed', error: message });
    return 'failed';
  }
}

/** Start the worker without waiting for it. */
function kick() {
  setImmediate(() => processQueue().catch((err) => logger.error('Payslip email worker crashed', { message: err.message })));
}

// --- Status -------------------------------------------------------------------------------

async function status(month) {
  if (!pay.isRealMonth(month)) throw badRequest('month must be YYYY-MM');
  const rows = await db()('payslip_emails as m')
    .join('employees as e', 'e.id', 'm.employee_id')
    .where('m.month', month)
    .orderBy('e.name')
    .select('m.*', 'e.name');
  return {
    emailConfigured: mailer.isConfigured(),
    rows: rows.map((r) => ({
      employeeId: r.employee_id,
      name: r.name,
      email: r.to_email,
      status: r.status,
      error: r.error,
      sentAt: toIso(r.sent_at),
    })),
  };
}

module.exports = { queue, processQueue, kick, status, buildEmail, setPace };
