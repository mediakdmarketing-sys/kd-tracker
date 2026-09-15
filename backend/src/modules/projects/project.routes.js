'use strict';

// Employee-facing project list — any signed-in employee, active projects only, for the
// punch-flow picker. Admin CRUD (including archived projects) lives in admin.routes.js
// instead, gated behind requireAdmin like every other admin mutation.

const express = require('express');
const service = require('./project.service');
const { authenticate } = require('../../middleware/auth');
const { asyncHandler } = require('../../utils/http');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Scoped to the employee's own department plus any unscoped (department-less) project —
    // an employee should not have to hunt through every other team's projects to find theirs.
    const all = await service.listProjects({ status: 'active' });
    const rows = req.user.department
      ? all.filter((p) => !p.department || p.department === req.user.department)
      : all;
    res.json(rows);
  })
);

module.exports = router;
