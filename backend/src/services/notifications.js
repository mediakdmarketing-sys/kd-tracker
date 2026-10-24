'use strict';

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const t = require('../utils/time');
const { toIso } = require('../utils/http');
const logger = require('../utils/logger');

/**
 * Writes one notification per recipient. Never throws: a notification that could not be saved
 * must not undo the thing it was announcing (a leave request, a decision).
 */
async function notify(recipientIds, { type, title, body, link, refId }) {
  try {
    const ids = [...new Set((recipientIds || []).filter(Boolean))];
    if (!ids.length) return 0;
    const now = t.now();
    await db()('notifications').insert(
      ids.map((employeeId) => ({
        id: uuid(),
        employee_id: employeeId,
        type,
        title: String(title).slice(0, 200),
        body: body ? String(body).slice(0, 500) : null,
        link: link || null,
        ref_id: refId || null,
        created_at: now,
        read_at: null,
      }))
    );
    return ids.length;
  } catch (err) {
    logger.error('Could not save notifications', { type, message: err.message });
    return 0;
  }
}

/** Every active administrator (HR). */
async function adminIds() {
  const rows = await db()('employees').where({ role: 'admin', status: 'active' }).select('id');
  return rows.map((r) => r.id);
}

/** Active leaders of one department. */
async function leaderIdsOf(department) {
  if (!department) return [];
  const rows = await db()('department_leaders as dl')
    .join('employees as e', 'e.id', 'dl.employee_id')
    .where('dl.department', department)
    .andWhere('e.status', 'active')
    .select('e.id');
  return rows.map((r) => r.id);
}

/**
 * The people who look after an employee, minus `exclude`: every admin (HR), and for a regular
 * employee the leaders of their department. A leader's or admin's own events go to HR only.
 * Anyone who is both (an admin also assigned as a leader) appears once, as an admin.
 */
async function reviewerAudience(employee, exclude = []) {
  const skip = new Set(exclude.filter(Boolean));
  const admins = (await adminIds()).filter((id) => !skip.has(id));
  const taken = new Set([...skip, ...admins]);
  const leaders = employee.role === 'user'
    ? (await leaderIdsOf(employee.department)).filter((id) => !taken.has(id))
    : [];
  return { admins, leaders };
}

/** True if a notification of this type about this record was already sent recently. */
async function recentlyNotified(type, refId, withinMs) {
  const [{ count }] = await db()('notifications')
    .where({ type, ref_id: refId })
    .andWhere('created_at', '>', t.now() - withinMs)
    .count({ count: '*' });
  return Number(count) > 0;
}

function shape(row) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    refId: row.ref_id,
    createdAt: toIso(row.created_at),
    read: row.read_at != null,
  };
}

async function listFor(employeeId, { unreadOnly = false, limit = 30 } = {}) {
  const base = db()('notifications').where({ employee_id: employeeId });
  if (unreadOnly) base.whereNull('read_at');
  const rows = await base.orderBy('created_at', 'desc').limit(limit);
  const [{ count }] = await db()('notifications')
    .where({ employee_id: employeeId })
    .whereNull('read_at')
    .count({ count: '*' });
  return { unreadCount: Number(count) || 0, items: rows.map(shape) };
}

/** Marks some (ids) or all of a person's notifications as read. Only ever their own. */
async function markRead(employeeId, { ids, all }) {
  const base = db()('notifications').where({ employee_id: employeeId }).whereNull('read_at');
  if (!all) {
    if (!ids || !ids.length) return 0;
    base.whereIn('id', ids);
  }
  return base.update({ read_at: t.now() });
}

module.exports = {
  notify,
  adminIds,
  leaderIdsOf,
  reviewerAudience,
  recentlyNotified,
  listFor,
  markRead,
};
