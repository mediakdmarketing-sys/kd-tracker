'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');

function make(options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    // Tests would otherwise trip limits and fail for the wrong reason.
    skip: () => config.isTest,
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down' },
      });
    },
    ...options,
  });
}

/** Login is the credential-stuffing surface. Keyed by IP + email, not IP alone. */
const loginLimiter = make({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});

/**
 * Uploads (story C-6). Steady state is ~12 screenshots/hour per employee.
 *
 * Raised from 120 to 240 in Sprint 6.5: an agent coming back from a full-day outage has to
 * drain roughly 8 hours of captures — around 96 screenshots, plus retries — and hitting the
 * limit mid-drain would leave the backlog stuck rather than merely slowed. 240/hour is still
 * an order of magnitude above normal use, so a runaway client is caught.
 */
const uploadLimiter = make({
  windowMs: 60 * 60 * 1000,
  max: 240,
  keyGenerator: (req) => req.user?.id || req.ip,
});

/** Broad backstop for everything else. */
const apiLimiter = make({ windowMs: 60 * 1000, max: 300 });

module.exports = { loginLimiter, uploadLimiter, apiLimiter };
