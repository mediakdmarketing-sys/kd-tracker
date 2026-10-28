'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./auth.service');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { loginLimiter, agentTokenLimiter } = require('../../middleware/rateLimit');
const { asyncHandler } = require('../../utils/http');
const { notImplemented } = require('../../utils/errors');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid work email is required'),
  password: z.string().min(1, 'Password is required'),
  client: z.enum(['web', 'desktop', 'chromeos', 'android']).optional(),
  // Set by the web portal when the person is signing in on a company's own address.
  companySlug: z.string().trim().toLowerCase().max(60).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken is required'),
});

const consentSchema = z
  .object({
    // Named to match the spec's `audioConsent`, with the newer field accepted too.
    monitoringConsent: z.boolean().optional(),
    audioConsent: z.boolean().optional(),
  })
  .refine((v) => v.monitoringConsent !== undefined || v.audioConsent !== undefined, {
    message: 'Provide monitoringConsent and/or audioConsent',
  });

router.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.login(req.body));
  })
);

// Signed in on the web portal => the desktop agent signs in too. The portal calls agent-code
// (authenticated) and passes the result to the agent, which calls agent-token (no session yet).
router.post(
  '/agent-code',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await service.createAgentCode(req.user.id));
  })
);

router.post(
  '/agent-token',
  agentTokenLimiter,
  validate(z.object({ code: z.string().min(20).max(200) })),
  asyncHandler(async (req, res) => {
    res.json(await service.exchangeAgentCode(req.body));
  })
);

// Second step of sign-in for platform accounts that have two-factor on.
router.post(
  '/2fa/verify',
  loginLimiter,
  validate(z.object({ challenge: z.string().min(10), code: z.string().min(6).max(20), client: z.enum(['web', 'desktop', 'chromeos', 'android']).optional() })),
  asyncHandler(async (req, res) => {
    res.json(await service.verifyTwoFactor(req.body));
  })
);

router.post(
  '/2fa/setup',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await service.setupTwoFactor(req.user.id));
  })
);

router.post(
  '/2fa/enable',
  loginLimiter,
  authenticate,
  validate(z.object({ code: z.string().min(6).max(10) })),
  asyncHandler(async (req, res) => {
    res.json(await service.enableTwoFactor(req.user.id, req.body));
  })
);

router.post(
  '/2fa/disable',
  loginLimiter,
  authenticate,
  validate(z.object({ password: z.string().min(1), code: z.string().min(6).max(20) })),
  asyncHandler(async (req, res) => {
    res.json(await service.disableTwoFactor(req.user.id, req.body));
  })
);

router.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.refresh(req.body));
  })
);

router.post(
  '/logout',
  validate(refreshSchema.partial()),
  asyncHandler(async (req, res) => {
    res.json(await service.logout(req.body));
  })
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await service.logoutEverywhere(req.user.id));
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter the current password'),
  newPassword: z
    .string()
    .min(8, 'The new password must be at least 8 characters')
    .max(200),
});

// Rate limited like sign-in: this checks a password too, so it must not be a way around that.
router.post(
  '/change-password',
  loginLimiter,
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.changePassword(req.user.id, req.body));
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await service.me(req.user.id, req.user.impersonatedBy));
  })
);

/** The text the consent screen must show. Kept server-side so it cannot drift per client. */
router.get('/consent', authenticate, (req, res) => {
  res.json(service.CONSENT_DISCLOSURE);
});

router.post(
  '/consent',
  authenticate,
  validate(consentSchema),
  asyncHandler(async (req, res) => {
    const updated = await service.recordConsent(req.user.id, {
      monitoring: req.body.monitoringConsent,
      audio: req.body.audioConsent,
    });
    res.json(updated);
  })
);

// Story A-8, deferred to the icebox: wiring this needs the customer's IdP tenant. The route
// exists so clients can feature-detect rather than guess.
router.post('/sso/callback', (req, res, next) => {
  next(
    notImplemented(
      'SSO is not enabled yet (backlog I-1). Use POST /api/auth/login with a work email and password.'
    )
  );
});

module.exports = router;
