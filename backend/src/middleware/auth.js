'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const { unauthorized, accountDeactivated } = require('../utils/errors');
const { toBool } = require('../utils/http');

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Verifies the access token and loads the *current* employee row.
 *
 * The row is re-read on every request rather than trusted from the token claims: a
 * deactivated employee or a revoked audio consent must take effect immediately, not when
 * their 30-minute token happens to expire.
 *
 * Request-level cache: a single HTTP request may call authenticate() more than once (e.g.
 * two route middlewares stacked, or a future sub-request). The cache is keyed on (req, sub)
 * so each request pays at most one DB round-trip regardless of how many middleware layers
 * call authenticate(). The cache is never shared across requests — it lives on req itself
 * and is garbage-collected with the request object.
 */
async function authenticate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) throw unauthorized('Missing bearer token');

    let payload;
    try {
      payload = jwt.verify(token, config.auth.jwtSecret);
    } catch (err) {
      throw unauthorized(err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    }

    if (payload.type !== 'access') throw unauthorized('Wrong token type');

    // Request-level cache: same sub on the same request → single DB read.
    // The cache key includes the employee id so a crafted request that somehow changes
    // sub mid-request (not currently possible, but defensive) cannot serve stale data.
    const cacheKey = `__authUser_${payload.sub}`;
    if (!req[cacheKey]) {
      const row = await db()('employees').where({ id: payload.sub }).first();
      if (!row) throw unauthorized('Account no longer exists');
      if (row.status !== 'active') throw accountDeactivated();

      req[cacheKey] = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        department: row.department,
        timezone: row.timezone,
        status: row.status,
        consentMonitoring: toBool(row.consent_monitoring),
        consentAudio: toBool(row.consent_audio),
      };
    }

    req.user = req[cacheKey];
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, extractToken };
