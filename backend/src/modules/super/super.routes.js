'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./super.service');
const { authenticate } = require('../../middleware/auth');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const { forbidden } = require('../../utils/errors');
const logger = require('../../utils/logger');

const router = express.Router();

// The platform owner only. A company's own HR admin is not enough, and neither is a role: it
// is a separate flag on the account, set from the server (db:create-admin with ADMIN_SUPER=1).
router.use(authenticate, (req, res, next) => {
  if (!req.user.isSuperAdmin) return next(forbidden('Super admin only'));
  return next();
});

const featuresSchema = z
  .object({
    screenCapture: z.boolean().optional(),
    audioCapture: z.boolean().optional(),
    idleTracking: z.boolean().optional(),
    payroll: z.boolean().optional(),
    leave: z.boolean().optional(),
  })
  .strict();

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  features: featuresSchema.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  storageLimitBytes: z.number().int().min(0).nullable().optional(),
  maxEmployees: z.number().int().min(1).nullable().optional(),
  admin: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email(),
  }),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  features: featuresSchema.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  storageLimitBytes: z.number().int().min(0).nullable().optional(),
  maxEmployees: z.number().int().min(1).nullable().optional(),
});

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const rangeQuery = z.object({ from: DATE.optional(), to: DATE.optional() });

router.get(
  '/companies',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.list(q(req)));
  })
);

router.post(
  '/companies',
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const created = await service.create(req.body);
    logger.info('Company created', { by: req.user.id, company: created.company.id });
    res.status(201).json(created);
  })
);

router.get(
  '/companies/:id',
  validate(rangeQuery, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.get(req.params.id, q(req)));
  })
);

router.patch(
  '/companies/:id',
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const updated = await service.update(req.params.id, req.body);
    logger.info('Company updated', { by: req.user.id, company: req.params.id, fields: Object.keys(req.body) });
    res.json(updated);
  })
);

router.get(
  '/companies/:id/admins',
  asyncHandler(async (req, res) => {
    res.json(await service.admins(req.params.id));
  })
);

router.post(
  '/companies/:id/admins/:employeeId/reset-password',
  asyncHandler(async (req, res) => {
    res.json(await service.resetAdminPassword(req.params.id, req.params.employeeId));
  })
);

module.exports = router;
