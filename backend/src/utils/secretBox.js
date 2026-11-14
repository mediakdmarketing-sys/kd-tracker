'use strict';

// Encrypts small secrets stored in the database (an authenticator secret): AES-256-GCM, a fresh
// nonce each time, and the owner's id bound in as additional data so a ciphertext copied to another
// person's row does not decrypt. The key is TOTP_ENCRYPTION_KEY when set (64 hex characters), and
// otherwise derived from the JWT secret, so the feature works with no extra set-up. Setting its own
// key is better: then rotating the JWT secret does not lock everybody out of two-step sign-in.

const crypto = require('crypto');
const config = require('../config');

function key() {
  const configured = process.env.TOTP_ENCRYPTION_KEY;
  if (configured && /^[0-9a-fA-F]{64}$/.test(configured)) return Buffer.from(configured, 'hex');
  return crypto.createHash('sha256').update(`totp-secret:${config.auth.jwtSecret}`).digest();
}

/** @returns {string} base64 of nonce | tag | ciphertext */
function seal(plain, ownerId) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), nonce);
  cipher.setAAD(Buffer.from(String(ownerId)));
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString('base64');
}

function open(sealed, ownerId) {
  const raw = Buffer.from(String(sealed), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(String(ownerId)));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

module.exports = { seal, open };
