'use strict';

// The signed-in person's own notifications. There is no way to read or change anyone else's:
// every query is scoped to the caller's id.

const express = require('express');
const { z } = require('zod');
const notifications = require('../../services/notifications');
const { authenticate } = require('../../middleware/auth');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();
router.use(authenticate);

const listQuery = z.object({
  unread: z.enum(['1', 'true']).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const readBody = z
  .object({
    ids: z.array(z.string().uuid()).max(200).optional(),
    all: z.boolean().optional(),
  })
  .refine((v) => v.all === true || (v.ids && v.ids.length > 0), {
    message: 'Provide ids, or all: true',
  });

router.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const query = q(req);
    res.json(
      await notifications.listFor(req.user.id, {
        unreadOnly: Boolean(query.unread),
        limit: query.limit,
      })
    );
  })
);

router.post(
  '/read',
  validate(readBody),
  asyncHandler(async (req, res) => {
    const updated = await notifications.markRead(req.user.id, req.body);
    res.json({ updated });
  })
);

module.exports = router;
