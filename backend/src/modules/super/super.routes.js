'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./super.service');
const { authenticate } = require('../../middleware/auth');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const { forbidden } = require('../../utils/errors');
const logger = require('../../utils/logger');
const platformAudit = require('../../services/platformAudit');
const settingsService = require('../../services/settings');
const announcements = require('../../services/announcements');
const lifecycle = require('./super.lifecycle');
const { PLAN_NAMES } = require('../../services/plans');
const { settingsPatchSchema, assertValidSettings } = require('../admin/settingsSchema');

const router = express.Router();

// The platform owner only. A company's own HR admin is not enough, and neither is a role: it
// is a separate flag on the account, set from the server (db:create-admin with ADMIN_SUPER=1).
router.use(authenticate, (req, res, next) => {
  if (!req.user.isSuperAdmin) return next(forbidden('Super admin only'));
  return next();
});

// Support staff (platform_role 'support') can look, and step into a company to help; changing a
// company, or anything about money, plans, people or data, is the owner's.
const requireOwner = (req, res, next) =>
  req.user.platformRole === 'owner' ? next() : next(forbidden('Only the platform owner can do this'));

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
  plan: z.enum(PLAN_NAMES).optional(),
  trialDays: z.number().int().min(1).max(365).optional(),
  // Starting values for this company's Settings (shift, break, retention...).
  settings: settingsPatchSchema.optional(),
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
  plan: z.enum(PLAN_NAMES).optional(),
  // When the trial ends (a date), or null for none. After it, the company is blocked if auto-suspend is on.
  trialEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
  autoSuspend: z.boolean().optional(),
  billingNote: z.string().trim().max(1000).nullable().optional(),
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
  requireOwner,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const created = await service.create(req.body);
    await platformAudit.record(req, { action: 'company_created', company: created.company, details: { admin: created.admin.email } });
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
  requireOwner,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const updated = await service.update(req.params.id, req.body);
    await platformAudit.record(req, {
      action: req.body.status ? (req.body.status === 'suspended' ? 'company_suspended' : 'company_reactivated') : 'company_updated',
      company: updated,
      details: { changed: req.body },
    });
    logger.info('Company updated', { by: req.user.id, company: req.params.id, fields: Object.keys(req.body) });
    res.json(updated);
  })
);

const brandingSchema = z.object({
  slug: z.string().trim().toLowerCase().min(2).max(40).optional(),
  brandName: z.string().trim().min(1).max(120).nullable().optional(),
  brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1a73e8').nullable().optional(),
  logoBase64: z.string().max(900_000).optional(),
  logoContentType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  removeLogo: z.boolean().optional(),
});

router.patch(
  '/companies/:id/branding',
  requireOwner,
  validate(brandingSchema),
  asyncHandler(async (req, res) => {
    const updated = await service.updateBranding(req.params.id, req.body);
    const { logoBase64, ...shown } = req.body;
    await platformAudit.record(req, { action: 'branding_updated', company: updated, details: { changed: { ...shown, ...(logoBase64 && { logo: 'replaced' }) } } });
    logger.info('Company branding updated', { by: req.user.id, company: req.params.id, fields: Object.keys(req.body).filter((k) => k !== 'logoBase64') });
    res.json(updated);
  })
);

// The company's records as a download (what it is owed when a contract ends).
router.get(
  '/companies/:id/export',
  requireOwner,
  asyncHandler(async (req, res) => {
    const data = await lifecycle.exportCompany(req.params.id);
    await platformAudit.record(req, { action: 'company_exported', companyId: req.params.id, companyName: data.company.name, details: { employees: data.employees.length } });
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${data.company.slug}-export.json"`);
    res.send(JSON.stringify(data, null, 2));
  })
);

// Permanent. The company must be suspended and its exact name typed.
router.delete(
  '/companies/:id',
  requireOwner,
  validate(z.object({ confirmName: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const result = await lifecycle.deleteCompany(req.params.id, { confirmName: req.body.confirmName, actorCompanyId: req.user.companyId });
    await platformAudit.record(req, { action: 'company_deleted', companyId: req.params.id, companyName: result.name, details: { employees: result.employees, filesRemoved: result.filesRemoved, filesFailed: result.filesFailed } });
    res.json(result);
  })
);

router.patch(
  '/companies/:id/domain',
  requireOwner,
  validate(z.object({ customDomain: z.string().trim().min(4).max(253).nullable() })),
  asyncHandler(async (req, res) => {
    const updated = await service.setDomain(req.params.id, req.body.customDomain);
    await platformAudit.record(req, { action: 'domain_set', company: updated, details: { domain: req.body.customDomain } });
    res.json(updated);
  })
);

router.post(
  '/companies/:id/domain/verify',
  requireOwner,
  asyncHandler(async (req, res) => {
    const result = await service.verifyDomain(req.params.id);
    await platformAudit.record(req, { action: 'domain_checked', company: result.company, details: { verified: result.verified } });
    res.json(result);
  })
);

router.get(
  '/companies/:id/usage',
  validate(z.object({ days: z.coerce.number().int().min(7).max(90).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.usage(req.params.id, q(req).days || 30));
  })
);

// --- Announcements: a message shown to everyone signed in to any company -------------------

router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    res.json(await announcements.list());
  })
);

router.post(
  '/announcements',
  requireOwner,
  validate(
    z.object({
      message: z.string().trim().min(3).max(400),
      level: z.enum(['info', 'warn']).optional(),
      startsAt: z.string().datetime({ offset: true }).optional(),
      endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const made = await announcements.create({ ...req.body, createdBy: req.user.id });
    await platformAudit.record(req, { action: 'announcement_created', details: { message: made.message, level: made.level } });
    res.status(201).json(made);
  })
);

router.delete(
  '/announcements/:id',
  requireOwner,
  asyncHandler(async (req, res) => {
    const ended = await announcements.end(req.params.id);
    if (!ended) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Announcement not found' } });
    await platformAudit.record(req, { action: 'announcement_ended', details: { message: ended.message } });
    return res.json(ended);
  })
);

// A company's Settings as the platform owner sees and sets them (the same values its HR edits).
router.get(
  '/companies/:id/settings',
  asyncHandler(async (req, res) => {
    await service.get(req.params.id);
    await settingsService.ensure(req.params.id);
    res.json(settingsService.get(req.params.id));
  })
);

router.patch(
  '/companies/:id/settings',
  requireOwner,
  validate(settingsPatchSchema),
  asyncHandler(async (req, res) => {
    const company = await service.get(req.params.id);
    await settingsService.ensure(req.params.id);
    assertValidSettings(settingsService.get(req.params.id), req.body);
    const updated = await settingsService.update(req.body, { updatedBy: req.user.id, companyId: req.params.id });
    await platformAudit.record(req, { action: 'settings_updated', company, details: { changed: req.body } });
    res.json(updated);
  })
);

router.get(
  '/companies/:id/people',
  validate(z.object({ search: z.string().trim().max(120).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.people(req.params.id, q(req)));
  })
);

// Step into a company as one of its people (see service.impersonate).
router.post(
  '/impersonate',
  validate(z.object({ employeeId: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    const session = await service.impersonate({ id: req.user.id, name: req.user.name }, req.body.employeeId);
    await platformAudit.record(req, {
      action: 'view_as_started',
      companyId: session.employee.companyId,
      companyName: session.employee.company?.name,
      details: { as: session.employee.email, role: session.employee.role },
    });
    logger.info('View-as started', { by: req.user.id, as: req.body.employeeId });
    res.status(201).json(session);
  })
);

router.get(
  '/companies/:id/admins',
  asyncHandler(async (req, res) => {
    res.json(await service.admins(req.params.id));
  })
);

// --- Platform staff (owner only) ---------------------------------------------------------

router.get(
  '/staff',
  requireOwner,
  asyncHandler(async (req, res) => {
    res.json(await service.listStaff());
  })
);

router.post(
  '/staff',
  requireOwner,
  validate(z.object({ name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().email() })),
  asyncHandler(async (req, res) => {
    const created = await service.createStaff(req.body);
    await platformAudit.record(req, { action: 'staff_created', details: { email: created.email, platformRole: 'support' } });
    res.status(201).json(created);
  })
);

router.post(
  '/staff/:id/reset-password',
  requireOwner,
  asyncHandler(async (req, res) => {
    const result = await service.resetStaffPassword(req.params.id);
    await platformAudit.record(req, { action: 'staff_password_reset', details: { email: result.email } });
    res.json(result);
  })
);

router.delete(
  '/staff/:id',
  requireOwner,
  asyncHandler(async (req, res) => {
    const result = await service.removeStaff(req.user.id, req.params.id);
    await platformAudit.record(req, { action: 'staff_removed', details: { email: result.email } });
    res.json(result);
  })
);

router.get(
  '/audit',
  validate(z.object({ companyId: z.string().uuid().optional(), action: z.string().max(80).optional(), page: z.coerce.number().int().min(1).optional() }), 'query'),
  asyncHandler(async (req, res) => {
    const { page = 1, ...filters } = q(req);
    const limit = 50;
    res.json({ ...(await platformAudit.list({ ...filters, limit, offset: (page - 1) * limit })), page, limit });
  })
);

router.post(
  '/companies/:id/admins/:employeeId/reset-password',
  requireOwner,
  asyncHandler(async (req, res) => {
    const result = await service.resetAdminPassword(req.params.id, req.params.employeeId);
    await platformAudit.record(req, { companyId: req.params.id, action: 'admin_password_reset', details: { admin: result.email } });
    res.json(result);
  })
);

module.exports = router;
