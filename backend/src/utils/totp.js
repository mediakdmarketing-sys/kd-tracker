'use strict';

// Time-based one-time passwords (RFC 6238, the kind an authenticator app shows): HMAC-SHA1 over the
// 30-second step count, 6 digits. Written out here rather than pulled in as a package because it is
// small, and because it should be obvious what is being checked.

const crypto = require('crypto');

const STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=-]/g, '');
  let bits = '';
  for (const ch of clean) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error('Not a valid base32 secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** A new random secret, as the base32 text an authenticator app takes (160 bits). */
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

/** The code for a given 30-second step number. */
function codeAtStep(secretBase32, step, digits = DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secretBase32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const stepAt = (ms) => Math.floor(ms / 1000 / STEP_SECONDS);

/**
 * Checks a code, allowing one step either side for clock drift. Returns the step that matched, or
 * null. Pass the last step already accepted: a step at or before it is refused, so a code that was
 * just used (or shoulder-surfed) cannot be used again.
 */
function verify(secretBase32, code, { now = Date.now(), lastStep = null, window = 1 } = {}) {
  const text = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(text)) return null;
  const current = stepAt(now);
  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(codeAtStep(secretBase32, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(text))) return step;
  }
  return null;
}

/** The otpauth:// address an authenticator app's QR scanner reads. */
function otpauthUrl({ secret, account, issuer }) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

module.exports = { generateSecret, codeAtStep, verify, otpauthUrl, stepAt, base32Encode, base32Decode, STEP_SECONDS };
