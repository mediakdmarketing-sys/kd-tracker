'use strict';

const crypto = require('crypto');

/** UUID v4, generated in the application so the id is known before the INSERT (ADR-0001). */
function uuid() {
  return crypto.randomUUID();
}

/** Opaque high-entropy token, used for refresh tokens. */
function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** Refresh tokens are stored hashed — a database dump must not hand out live sessions. */
function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

module.exports = { uuid, randomToken, sha256 };
