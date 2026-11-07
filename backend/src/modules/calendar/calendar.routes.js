'use strict';

// The company calendar, readable by everyone who is signed in: the holidays HR has marked.
// (Sundays are always a day off and are not listed: the apps know them.)

const express = require('express');
const { z } = require('zod');
const { authenticate } = require('../../middleware/auth');
const { validate, q } = require('../../middleware/validate');
const { asyncHandler } = require('../../utils/http');
const calendar = require('../../services/holidayCalendar');
const feed = require('../../services/calendarFeed');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  validate(z.object({ year: z.string().regex(/^\d{4}$/) }), 'query'),
  asyncHandler(async (req, res) => {
    const year = q(req).year;
    const rows = await calendar.listYear(Number(year));
    // Only what people need to see: no flags about how HR manages them.
    res.json({ year, holidays: rows.map((h) => ({ date: h.date, name: h.name })) });
  })
);

// One month of everything this person may see: holidays, leave and birthdays (see services/calendarFeed).
router.get(
  '/month',
  validate(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must be YYYY-MM') }), 'query'),
  asyncHandler(async (req, res) => {
    res.json(await feed.forMonth(req.user, q(req).month));
  })
);

module.exports = router;
