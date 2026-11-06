'use strict';

// Sends email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
//
// Nothing else in the codebase talks to the email service, so it can be swapped by changing this
// file. Tests replace the transport with setTransport() and never touch the network.

const config = require('../config');
const logger = require('../utils/logger');

const ENDPOINT = 'https://api.resend.com/emails';
const TIMEOUT_MS = 20_000;

/**
 * @typedef {{ to: string, subject: string, html: string, text?: string,
 *            attachments?: Array<{ filename: string, content: Buffer }> }} Message
 * @typedef {(message: Message) => Promise<{ id: string|null }>} Transport
 */

/** @type {Transport|null} */
let override = null;

function isConfigured() {
  return Boolean(override) || Boolean(config.mail.resendApiKey && config.mail.from);
}

/** For tests: send through `fn` instead of the network. Pass null to restore. */
function setTransport(fn) {
  override = fn;
}

/**
 * Thrown for a failure worth retrying later (the service is busy or unreachable). Anything else,
 * such as a rejected address, is permanent for that message.
 */
class TemporaryMailError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'TemporaryMailError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** @param {Message} message @returns {Promise<{ id: string|null }>} */
async function send(message) {
  if (override) return override(message);
  if (!isConfigured()) throw new Error('Email is not set up on this server');

  let res;
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.mail.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.mail.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        // Files travel as base64 text in the request.
        ...(message.attachments?.length
          ? {
              attachments: message.attachments.map((a) => ({
                filename: a.filename,
                content: Buffer.from(a.content).toString('base64'),
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new TemporaryMailError(`Could not reach the email service: ${err.message}`);
  }

  const body = await res.json().catch(() => ({}));
  if (res.ok) return { id: body.id || null };

  const detail = body.message || body.error?.message || `status ${res.status}`;
  // 429 (too many requests) and 5xx are the service's trouble, not the message's.
  if (res.status === 429 || res.status >= 500) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new TemporaryMailError(`The email service is busy: ${detail}`, retryAfter > 0 ? retryAfter * 1000 : undefined);
  }
  logger.warn('Email rejected by the service', { status: res.status, detail });
  throw new Error(detail);
}

module.exports = { send, isConfigured, setTransport, TemporaryMailError };
