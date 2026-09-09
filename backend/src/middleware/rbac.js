'use strict';

const { db } = require('../db');
const { forbidden, unauthorized } = require('../utils/errors');

/**
 * Role checks live on the server. The portal hides routes cosmetically; this is the real gate.
 */
function requireRole(...roles) {
  return function guard(req, res, next) {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden(`Requires role: ${roles.join(' or ')}`));
    }
    return next();
  };
}

const requireAdmin = requireRole('admin');
const requireAdminOrLeader = requireRole('admin', 'leader');

/**
 * Allows access when the caller is the subject of the request, or an admin.
 */
function requireSelfOrAdmin(paramName = 'employeeId') {
  return function guard(req, res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'admin' || req.user.id === req.params[paramName]) return next();
    return next(forbidden('You can only access your own records'));
  };
}

/**
 * Allows access when the caller is:
 *   - admin                  → full access
 *   - the subject themselves → only their own records (leaders cannot view own captures)
 *   - a leader of the subject's department → can view member data
 *
 * Leaders cannot view their own captures (requirement: leader paakka mudiiyaathu own data).
 * That restriction is enforced by the absence of a self-access path for leaders here.
 */
function requireSelfOrAdminOrLeader(paramName = 'employeeId') {
  return async function guard(req, res, next) {
    if (!req.user) return next(unauthorized());

    const targetId = req.params[paramName];

    // Admin: full access always.
    if (req.user.role === 'admin') return next();

    // Employee viewing their own data — allowed unless they are a leader
    // (leaders cannot view their own captures, only their members').
    if (req.user.role !== 'leader' && req.user.id === targetId) return next();

    // Leader: allowed only if the target employee is in one of their departments.
    if (req.user.role === 'leader') {
      const isLeaderOf = await leaderManagesEmployee(req.user.id, targetId);
      if (isLeaderOf) {
        // Attach the department context so route handlers can audit correctly.
        req.leaderAccess = true;
        return next();
      }
      return next(forbidden('You can only view members of your department'));
    }

    return next(forbidden('You can only access your own records'));
  };
}

/**
 * Returns true if `leaderId` may view `memberId`'s data.
 *
 * Rules:
 *  1. Target must not be admin.
 *  2. If target is a regular employee (role='user') — allowed if target's department
 *     is in the leader's managed departments.
 *  3. If target is a sub-leader (role='leader') — allowed only if the caller manages
 *     ALL departments that the target leads. This models seniority: Vithurshan leads
 *     GHL CC + GHL CRM, so he can see Kumar (GHL CC only) and Priya (GHL CRM only),
 *     but Kumar cannot see Vithurshan because Kumar does not manage GHL CRM.
 */
async function leaderManagesEmployee(leaderId, memberId) {
  const target = await db()('employees').where({ id: memberId }).first();
  if (!target) return false;

  // Admins are never visible to leaders.
  if (target.role === 'admin') return false;

  // Departments the caller (senior leader) manages.
  const callerDepts = await db()('department_leaders')
    .where({ employee_id: leaderId })
    .pluck('department');
  if (!callerDepts.length) return false;

  if (target.role === 'user') {
    // Regular employee — visible if their department is in caller's managed list.
    return Boolean(target.department && callerDepts.includes(target.department));
  }

  if (target.role === 'leader') {
    // Sub-leader — visible only if caller manages ALL departments the target leads.
    // This ensures seniority: a more senior leader who covers a superset of departments
    // can see the sub-leaders below them, but not vice-versa.
    const targetDepts = await db()('department_leaders')
      .where({ employee_id: memberId })
      .pluck('department');
    if (!targetDepts.length) return false;

    // Every department the target leads must be covered by the caller.
    return targetDepts.every((d) => callerDepts.includes(d));
  }

  return false;
}

/**
 * Loads the list of departments a leader manages and attaches it to req.leaderDepts.
 * Used on leader-specific list routes so the service can scope queries to those departments.
 * No-op for admins (they have no dept restriction).
 */
function loadLeaderDepts() {
  return async function loader(req, res, next) {
    if (!req.user) return next(unauthorized());
    if (req.user.role === 'admin') {
      req.leaderDepts = null; // null = no restriction
      return next();
    }
    if (req.user.role === 'leader') {
      req.leaderDepts = await db()('department_leaders')
        .where({ employee_id: req.user.id })
        .pluck('department');
      return next();
    }
    return next(forbidden('Requires role: admin or leader'));
  };
}

module.exports = {
  requireRole,
  requireAdmin,
  requireAdminOrLeader,
  requireSelfOrAdmin,
  requireSelfOrAdminOrLeader,
  loadLeaderDepts,
  leaderManagesEmployee,
};
