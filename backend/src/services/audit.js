'use strict';

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const { now } = require('../utils/time');
const logger = require('../utils/logger');

/**
 * Spec 7.4 / story D-4: every admin view of screenshots or audio is recorded.
 *
 * Failures are logged but never thrown: an audit write that fails must not hand the admin a
 * 500 and hide the fact that they *did* see the data. A missing row is a monitoring problem;
 * a swallowed read is a compliance problem.
 */
async function record(req, { action, targetEmployeeId, targetType, targetId, details }) {
  try {
    await db()('audit_logs').insert({
      id: uuid(),
      admin_id: req.user.id,
      action,
      target_employee_id: targetEmployeeId || null,
      target_type: targetType || null,
      target_id: targetId || null,
      ip_address: req.ip || null,
      details: details ? JSON.stringify(details) : null,
      timestamp: now(),
    });
  } catch (err) {
    logger.error('Failed to write audit log', { action, adminId: req.user?.id, message: err.message });
  }
}

const ACTIONS = {
  VIEWED_SCREENSHOT: 'viewed_screenshot',
  LISTED_SCREENSHOTS: 'listed_screenshots',
  VIEWED_AUDIO: 'viewed_audio',
  LISTED_AUDIO: 'listed_audio',
  VIEWED_ACTIVITY: 'viewed_activity',
  VIEWED_ATTENDANCE: 'viewed_attendance',
  EXPORTED_REPORT: 'exported_report',
  EXPORTED_PAYROLL: 'exported_payroll',
  GENERATED_PAYROLL: 'generated_payroll',
  CREATED_EMPLOYEE: 'created_employee',
  UPDATED_EMPLOYEE: 'updated_employee',
  DEACTIVATED_EMPLOYEE: 'deactivated_employee',
  ASSIGNED_LEADER: 'assigned_leader',
  REMOVED_LEADER: 'removed_leader',
};

module.exports = { record, ACTIONS };
