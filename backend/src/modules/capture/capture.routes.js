'use strict';

const express = require('express');
const { z } = require('zod');
const service = require('./capture.service');
const { authenticate } = require('../../middleware/auth');
const { requireAdmin, requireSelfOrAdmin } = require('../../middleware/rbac');
const { validate, q } = require('../../middleware/validate');
const { uploadLimiter } = require('../../middleware/rateLimit');
const { asyncHandler, pagination, paged } = require('../../utils/http');
const audit = require('../../services/audit');

const listQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// --- Screenshots -----------------------------------------------------------------------

const screenshots = express.Router();
screenshots.use(authenticate);

// `captureId` is the agent's replay key: the same value on every retry of the same capture.
// A UUID is required rather than any string, so it cannot be used to smuggle a path fragment
// or to probe another employee's rows by guessing ids.
const CAPTURE_ID = z.string().uuid('captureId must be a UUID');

const screenshotUploadSchema = z
  .object({
    imageBase64: z.string().min(1, 'imageBase64 is required'),
    capturedAt: z.string().datetime({ offset: true }).optional(),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
    captureId: CAPTURE_ID.optional(),

    // Multi-display (ADR-0005): one upload per display, tied together by captureGroupId.
    captureGroupId: CAPTURE_ID.optional(),
    displayIndex: z.coerce.number().int().min(0).max(7).optional(),
    // Capped at 8: more displays than that on a work-from-home desk is a misconfigured agent.
    displayCount: z.coerce.number().int().min(1).max(8).optional(),
    displayLabel: z.string().max(120).optional(),
  })
  .refine((v) => v.displayIndex === undefined || v.displayCount === undefined || v.displayIndex < v.displayCount, {
    message: 'displayIndex must be less than displayCount',
    path: ['displayIndex'],
  });

screenshots.post(
  '/upload',
  uploadLimiter,
  validate(screenshotUploadSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.uploadScreenshot({ employee: req.user, ...req.body }));
  })
);

/** Streams the image. Every single view is audited (story D-4). */
screenshots.get(
  '/file/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await service.readFile('screenshots', req.params.id);
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_SCREENSHOT,
      targetEmployeeId: row.employee_id,
      targetType: 'screenshot',
      targetId: row.id,
      details: { capturedAt: new Date(Number(row.captured_at)).toISOString() },
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  })
);

screenshots.get(
  '/:employeeId',
  requireSelfOrAdmin('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.listScreenshots({
      employeeId: req.params.employeeId,
      ...query,
      limit: page.limit,
      offset: page.offset,
    });

    if (req.user.role === 'admin' && req.user.id !== req.params.employeeId) {
      await audit.record(req, {
        action: audit.ACTIONS.LISTED_SCREENSHOTS,
        targetEmployeeId: req.params.employeeId,
        targetType: 'screenshot',
        details: { date: query.date, from: query.from, to: query.to, count: rows.length },
      });
    }

    res.json(paged(rows, total, page));
  })
);

// --- Audio -----------------------------------------------------------------------------

const audio = express.Router();
audio.use(authenticate);

const audioUploadSchema = z.object({
  audioBase64: z.string().min(1, 'audioBase64 is required'),
  recordedAt: z.string().datetime({ offset: true }).optional(),
  durationSeconds: z.coerce.number().int().min(1, 'durationSeconds is required'),
  contentType: z.enum(['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav']).optional(),
  captureId: CAPTURE_ID.optional(),
  // Silence detection result from the desktop agent.
  // true  = entire sample was silence (mic muted or disconnected)
  // false = audio signal detected
  // omitted/null = agent could not determine (old build or permission error)
  micMuted: z.boolean().nullable().optional(),
});

audio.post(
  '/upload',
  uploadLimiter,
  validate(audioUploadSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await service.uploadAudio({ employee: req.user, ...req.body }));
  })
);

audio.get(
  '/file/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await service.readFile('audio_recordings', req.params.id);
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_AUDIO,
      targetEmployeeId: row.employee_id,
      targetType: 'audio',
      targetId: row.id,
      details: { recordedAt: new Date(Number(row.recorded_at)).toISOString() },
    });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  })
);

audio.get(
  '/:employeeId',
  requireSelfOrAdmin('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.listAudio({
      employeeId: req.params.employeeId,
      ...query,
      limit: page.limit,
      offset: page.offset,
    });

    if (req.user.role === 'admin' && req.user.id !== req.params.employeeId) {
      await audit.record(req, {
        action: audit.ACTIONS.LISTED_AUDIO,
        targetEmployeeId: req.params.employeeId,
        targetType: 'audio',
        details: { date: query.date, count: rows.length },
      });
    }

    res.json(paged(rows, total, page));
  })
);

// --- Activity --------------------------------------------------------------------------

const activity = express.Router();
activity.use(authenticate);

// Counts only. There is deliberately no field for keystroke *content* — the schema is the
// guarantee that this system cannot become a keylogger by accident.
const activityEntrySchema = z.object({
  keystrokeCount: z.coerce.number().int().min(0).max(100000),
  mouseCount: z.coerce.number().int().min(0).max(100000),
  // null is valid: the agent sends null when it cannot determine the window title
  // (e.g. uiohook-napi not installed). undefined and string are also accepted.
  windowTitle: z.string().max(255).nullable().optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  captureId: CAPTURE_ID.optional(),
});

const activityLogSchema = z.union([
  activityEntrySchema,
  z.object({ entries: z.array(activityEntrySchema).min(1).max(500) }),
]);

activity.post(
  '/log',
  uploadLimiter,
  validate(activityLogSchema),
  asyncHandler(async (req, res) => {
    const entries = req.body.entries || [req.body];
    res.status(201).json(await service.logActivity({ employee: req.user, entries }));
  })
);

activity.get(
  '/:employeeId',
  requireSelfOrAdmin('employeeId'),
  validate(listQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    const page = pagination(query);
    const { rows, total } = await service.listActivity({
      employeeId: req.params.employeeId,
      date: query.date,
      from: query.from,
      to: query.to,
      limit: page.limit,
      offset: page.offset,
    });
    res.json(paged(rows, total, page));
  })
);

module.exports = { screenshots, audio, activity };
