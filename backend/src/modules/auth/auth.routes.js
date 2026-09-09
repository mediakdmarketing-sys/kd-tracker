'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./auth.service');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { loginLimiter } = require('../../middleware/rateLimit');
const { asyncHandler } = require('../../utils/http');
const { notImplemented } = require('../../utils/errors');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid work email is required'),
  password: z.string().min(1, 'Password is required'),
  client: z.enum(['web', 'desktop', 'chromeos']).optional(),
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

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json(await service.me(req.user.id));
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
