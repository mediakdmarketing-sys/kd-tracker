'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./auth.service');
const attendance = require('../attendance/attendance.service');
const { authenticate } = require('../../middleware/auth');
const { validate } = require('../../middleware/validate');
const { loginLimiter, agentTokenLimiter } = require('../../middleware/rateLimit');
const { asyncHandler } = require('../../utils/http');
const { notImplemented, badRequest, notFound } = require('../../utils/errors');
const { clientInfo } = require('../../utils/device');
const sessions = require('./sessions.service');
const twoFactor = require('./twoFactor.service');

const router = express.Router();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('A valid work email is required'),
  password: z.string().min(1, 'Password is required'),
  client: z.enum(['web', 'desktop', 'chromeos', 'android']).optional(),
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
    res.json(await service.login({ ...req.body, info: clientInfo(req) }));
  })
);

// The code step of a two-step sign-in. Limited like sign-in, and the account itself is held after a
// few wrong codes (see twoFactor.service).
router.post(
  '/2fa/verify',
  loginLimiter,
  validate(
    z
      .object({
        challengeToken: z.string().min(20).max(2000),
        code: z.string().trim().max(20).optional(),
        recoveryCode: z.string().trim().max(40).optional(),
      })
      .refine((v) => v.code || v.recoveryCode, { message: 'Enter the 6-digit code from your app' })
  ),
  asyncHandler(async (req, res) => {
    res.json(await service.verifyTwoFactor({ ...req.body, info: clientInfo(req) }));
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
    res.json(await service.exchangeAgentCode({ ...req.body, info: clientInfo(req) }));
  })
);

router.post(
  '/refresh',
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    res.json(await service.refresh({ ...req.body, info: clientInfo(req) }));
  })
);

router.post(
  '/logout',
  validate(refreshSchema.partial()),
  asyncHandler(async (req, res) => {
    const { revoked, employeeId } = await service.logout(req.body);
    // Signing out while punched in means stepping away: the shift goes on a break.
    if (employeeId) await attendance.breakOnSignOut(employeeId);
    res.json({ revoked });
  })
);

router.post(
  '/logout-all',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await service.logoutEverywhere(req.user.id);
    await attendance.breakOnSignOut(req.user.id);
    res.json(result);
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
    res.json(await service.me(req.user.id));
  })
);

// --- Security: two-step sign-in, where you are signed in, and what has been tried --------------

router.get(
  '/security',
  authenticate,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ twoFactor: await twoFactor.status(req.user.id), currentSessionId: req.user.sessionId });
  })
);

router.post(
  '/2fa/setup',
  authenticate,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await twoFactor.beginSetup(req.user.id));
  })
);

router.post(
  '/2fa/enable',
  authenticate,
  loginLimiter,
  validate(z.object({ code: z.string().trim().min(6).max(10) })),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await twoFactor.confirmSetup(req.user.id, req.body.code));
  })
);

const confirmSchema = z.object({
  password: z.string().min(1, 'Enter your password'),
  code: z.string().trim().max(20).optional(),
  recoveryCode: z.string().trim().max(40).optional(),
});

router.post(
  '/2fa/disable',
  authenticate,
  loginLimiter,
  validate(confirmSchema.refine((v) => v.code || v.recoveryCode, { message: 'Enter a code from your app, or a recovery code' })),
  asyncHandler(async (req, res) => {
    res.json(await twoFactor.disable(req.user.id, req.body, { info: clientInfo(req), client: 'web' }));
  })
);

router.post(
  '/2fa/recovery-codes',
  authenticate,
  loginLimiter,
  validate(confirmSchema.pick({ password: true, code: true }).refine((v) => v.code, { message: 'Enter the 6-digit code from your app' })),
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await twoFactor.regenerateRecoveryCodes(req.user.id, req.body, { info: clientInfo(req), client: 'web' }));
  })
);

router.get(
  '/sessions',
  authenticate,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await sessions.listSessions(req.user.id, req.user.sessionId));
  })
);

// End every other session, keeping this one. (Registered before the :id route so it is not read as an id.)
router.post(
  '/sessions/revoke-others',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ ended: await sessions.revokeAll(req.user.id, { exceptId: req.user.sessionId }) });
  })
);

router.delete(
  '/sessions/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.sessionId) throw badRequest('That is the session you are using. Use Sign out for it.');
    const ended = await sessions.revoke(req.user.id, req.params.id);
    if (!ended) throw notFound('That session is not signed in any more.');
    res.json({ ended });
  })
);

router.get(
  '/login-history',
  authenticate,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await sessions.loginHistory(req.user.id, 50));
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
