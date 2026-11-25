'use strict';

// Who has installed the newest desktop agent and who has not: for HR (everyone) and for a team leader
// (their own people). The version is what each agent last said it was.

const { db } = require('../../db');
const sessions = require('../auth/sessions.service');
const agentRelease = require('../../services/agentRelease');

const ORDER = { outdated: 0, unknown: 1, not_installed: 2, other: 3, current: 4 };

/**
 * @param {{ memberIds?: string[]|null }} [opts]  null = everyone; a list = only those people
 */
async function agentUpdates({ memberIds = null } = {}) {
  const release = await agentRelease.latest();

  const query = db()('employees').where({ status: 'active' }).select('id', 'name', 'department', 'role');
  if (memberIds) query.whereIn('id', memberIds.length ? memberIds : ['-']);
  const people = await query.orderBy('name');

  const agents = await sessions.agentStatus(people.map((p) => p.id));
  const rows = people.map((p) => {
    const a = agents.get(p.id);
    let state;
    if (a.state === 'none') state = 'not_installed';
    else if (a.client !== 'desktop') state = 'other'; // the phone app: updated from its own installer
    else state = a.update || 'unknown';
    return {
      employeeId: p.id,
      name: p.name,
      department: p.department || null,
      version: a.version,
      update: state,
      agentState: a.state, // online | quiet | none
      lastSeenAt: a.lastSeenAt,
      device: a.device,
      client: a.client,
    };
  });
  rows.sort((x, y) => ORDER[x.update] - ORDER[y.update] || x.name.localeCompare(y.name));

  const count = (k) => rows.filter((r) => r.update === k).length;
  return {
    release,
    summary: {
      people: rows.length,
      current: count('current'),
      outdated: count('outdated'),
      unknown: count('unknown'),
      notInstalled: count('not_installed'),
    },
    rows,
  };
}

module.exports = { agentUpdates };
