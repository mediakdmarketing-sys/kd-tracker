'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { db } = require('../db');
const {
  unauthorized,
  accountDeactivated,
  passwordChangeRequired,
  companySuspended,
  impersonationReadOnly,
  twoFactorSetupRequired,
} = require('../utils/errors');
const companies = require('../services/companies');
const settings = require('../services/settings');

// The only calls a person with a temporary password may make: see who they are, set a new
// password, and sign out. Everything else waits until the password has been changed.
const ALLOWED_WHILE_PASSWORD_PENDING = new Set([
  '/api/auth/me',
  '/api/auth/change-password',
  '/api/auth/logout',
  '/api/auth/logout-all',
]);
const { toBool } = require('../utils/http');

// While someone is viewing as another person, writes are limited to the admin and leader tools
// (which is what they are there to use) and signing out. Everything that is the person's own
// doing (punching in, capture, consent, password, their own leave) is refused.
const IMPERSONATION_WRITE_PREFIXES = ['/api/admin/', '/api/leader/', '/api/payroll/'];
const IMPERSONATION_WRITE_EXACT = new Set(['/api/auth/logout', '/api/auth/refresh']);

function impersonationMayWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const path = req.originalUrl.split('?')[0];
  return (
    IMPERSONATION_WRITE_EXACT.has(path) ||
    IMPERSONATION_WRITE_PREFIXES.some((p) => path.startsWith(p))
  );
}

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

      // A "view as" token is only good while the person who started it is still a super admin.
      let impersonatedBy = null;
      if (payload.imp) {
        const owner = await db()('employees').where({ id: payload.imp }).first();
        if (!owner || owner.status !== 'active' || !toBool(owner.is_super_admin)) {
          throw unauthorized('This view-as session has ended');
        }
        impersonatedBy = { id: owner.id, name: owner.name };
      }

      // The person's company decides whether they may use the service at all, and which
      // features it has. Its settings are loaded here so handlers can read them synchronously.
      const company = await companies.get(row.company_id);
      if (!company) throw unauthorized('Account no longer exists');
      const blocked = companies.blockReason(company);
      if (blocked) throw companySuspended(blocked);
      await settings.ensure(company.id);

      req[cacheKey] = {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        department: row.department,
        companyId: company.id,
        companyName: company.name,
        features: company.features,
        isSuperAdmin: toBool(row.is_super_admin),
        impersonatedBy,
        platformRole: toBool(row.is_super_admin) ? row.platform_role || 'owner' : null,
        twoFactorEnabled: toBool(row.totp_enabled),
        timezone: company.timezone || config.timezone,
        status: row.status,
        mustChangePassword: toBool(row.must_change_password),
        consentMonitoring: toBool(row.consent_monitoring),
        consentAudio: toBool(row.consent_audio),
      };
    }

    req.user = req[cacheKey];

    if (req.user.impersonatedBy && !impersonationMayWrite(req)) throw impersonationReadOnly();

    // With SUPER_2FA_REQUIRED, a platform account without two-factor can only set it up.
    if (
      config.auth.superTwoFactorRequired &&
      req.user.isSuperAdmin &&
      !req.user.twoFactorEnabled &&
      !req.user.impersonatedBy &&
      !req.originalUrl.startsWith('/api/auth/') &&
      !req.originalUrl.startsWith('/api/config')
    ) {
      throw twoFactorSetupRequired();
    }

    if (!req.user.impersonatedBy && req.user.mustChangePassword && !ALLOWED_WHILE_PASSWORD_PENDING.has(req.originalUrl.split('?')[0])) {
      throw passwordChangeRequired();
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { authenticate, extractToken };
