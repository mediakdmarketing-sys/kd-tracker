'use strict';

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const { now } = require('../utils/time');
const logger = require('../utils/logger');

/**
 * What the platform's own staff did, across companies: creating, suspending, changing plans,
 * stepping into a company, deleting. Separate from a company's audit trail, which belongs to the
 * company. Never throws: an audit write that fails must not undo or hide the action.
 */
async function record(req, { action, company, companyId, companyName, details }) {
  try {
    await db()('platform_audit_logs').insert({
      id: uuid(),
      actor_id: req.user?.id || null,
      actor_name: req.user?.name || null,
      action,
      company_id: companyId || company?.id || null,
      company_name: companyName || company?.name || null,
      details: details ? JSON.stringify(details) : null,
      ip_address: req.ip || null,
      timestamp: now(),
    });
  } catch (err) {
    logger.error('Failed to write platform audit log', { action, message: err.message });
  }
}

async function list({ companyId, action, limit = 50, offset = 0 } = {}) {
  const base = db()('platform_audit_logs');
  if (companyId) base.where({ company_id: companyId });
  if (action) base.where({ action });
  const [{ n }] = await base.clone().count({ n: '*' });
  const rows = await base.clone().orderBy('timestamp', 'desc').limit(limit).offset(offset);
  return {
    total: Number(n),
    rows: rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      companyId: r.company_id,
      companyName: r.company_name,
      details: r.details ? JSON.parse(r.details) : null,
      ipAddress: r.ip_address,
      timestamp: new Date(Number(r.timestamp)).toISOString(),
    })),
  };
}

module.exports = { record, list };
