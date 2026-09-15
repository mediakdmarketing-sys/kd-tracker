'use strict';

// Employee-facing leave requests — submit and view your own. Approval lives in
// admin.routes.js and leader.routes.js instead, gated the same way every other
// admin/leader mutation in this codebase already is.

const express = require('express');
const { z } = require('zod');
const service = require('./leave.service');
const { authenticate } = require('../../middleware/auth');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler, sendWithRange } = require('../../utils/http');
const { uploadLimiter } = require('../../middleware/rateLimit');
const audit = require('../../services/audit');

const router = express.Router();
router.use(authenticate);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const createSchema = z.object({
  type: z.enum(['sick', 'bereavement', 'personal', 'emergency', 'vacation']),
  startDate: DATE,
  endDate: DATE,
  dayPart: z.enum(['full', 'half_am', 'half_pm']).optional(),
  reason: z.string().trim().max(500).optional(),
  // The proof file, base64-encoded in the JSON body — same pattern capture.routes.js uses for
  // screenshots/audio, rather than a separate multipart upload path.
  proofBase64: z.string().min(1).optional(),
  proofContentType: z.enum(service.ALLOWED_PROOF_TYPES).optional(),
  proofFileName: z.string().trim().max(200).optional(),
}).refine((v) => !v.proofBase64 || !!v.proofContentType, {
  message: 'proofContentType is required when proofBase64 is set',
  path: ['proofContentType'],
});

const statusQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

router.post(
  '/',
  uploadLimiter,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const created = await service.createRequest({ employeeId: req.user.id, ...req.body });
    res.status(201).json(created);
  })
);

router.get(
  '/me',
  validate(statusQuerySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json(await service.listForEmployee(req.user.id, { status: q(req).status }));
  })
);

router.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await service.cancelRequest(req.params.id, req.user.id));
  })
);

/** Self-serve: an employee can always re-download the proof they attached to their own
 * request. Admin/leader access to someone else's proof lives in admin.routes.js /
 * leader.routes.js instead, gated the same way the rest of those reviewers' access is. */
router.get(
  '/:id/proof',
  asyncHandler(async (req, res) => {
    const { buffer, contentType, row } = await service.getProof(req.params.id, {
      requesterId: req.user.id,
    });
    await audit.record(req, {
      action: audit.ACTIONS.VIEWED_LEAVE_PROOF,
      targetEmployeeId: row.employee_id,
      targetType: 'leave_request',
      targetId: row.id,
    });
    sendWithRange(req, res, buffer, contentType);
  })
);

module.exports = router;
