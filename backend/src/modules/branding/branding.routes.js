'use strict';

const express = require('express');
const { z } = require('zod');
const branding = require('../../services/branding');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin } = require('../../middleware/rbac');
const { validate } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const audit = require('../../services/audit');

const router = express.Router();

// The logo is public on purpose: it appears on emails and pages that are opened without signing in.
// It is only the company's logo, never anything about a person.
router.get(
  '/logo',
  asyncHandler(async (req, res) => {
    const logo = await branding.readLogo();
    if (!logo) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No logo has been set' } });

    // helmet's default blocks other sites from embedding images served by this one, which is
    // exactly what an email client and the portal do.
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.set('Cache-Control', 'public, max-age=300');
    res.set('ETag', `"${logo.updatedAt}"`);
    if (req.headers['if-none-match'] === `"${logo.updatedAt}"`) return res.status(304).end();
    res.type(logo.contentType);
    return res.send(logo.buffer);
  })
);

router.post(
  '/logo',
  authenticate,
  requireAdmin,
  validate(z.object({ contentType: z.string().max(40), data: z.string().min(1).max(2_000_000) })),
  asyncHandler(async (req, res) => {
    const result = await branding.setLogo({
      contentType: req.body.contentType,
      dataBase64: req.body.data,
      updatedBy: req.user.id,
    });
    await audit.record(req, { action: audit.ACTIONS.UPDATED_SETTINGS, targetType: 'logo', details: { logo: 'set' } });
    res.status(201).json(result);
  })
);

router.delete(
  '/logo',
  authenticate,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await branding.removeLogo({ updatedBy: req.user.id });
    await audit.record(req, { action: audit.ACTIONS.UPDATED_SETTINGS, targetType: 'logo', details: { logo: 'removed' } });
    res.json({ removed: true });
  })
);

module.exports = router;
