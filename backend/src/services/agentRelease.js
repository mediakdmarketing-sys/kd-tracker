'use strict';

// Agent releases: what the newest desktop agent is, and who is on it.

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const t = require('../utils/time');
const { toIso, toBool } = require('../utils/http');
const { isVersion, compare } = require('../utils/version');
const { badRequest, conflict } = require('../utils/errors');

const shape = (row) =>
  row && {
    id: row.id,
    version: row.version,
    notes: String(row.notes || '').split('\n').map((s) => s.trim()).filter(Boolean),
    mandatory: toBool(row.mandatory),
    publishedAt: toIso(row.created_at),
  };

/** The newest release by version number, or null before the first one. */
async function latest() {
  const rows = await db()('agent_releases').select();
  if (!rows.length) return null;
  rows.sort((a, b) => compare(b.version, a.version));
  return shape(rows[0]);
}

async function history(limit = 10) {
  const rows = await db()('agent_releases').select();
  rows.sort((a, b) => compare(b.version, a.version));
  return rows.slice(0, limit).map(shape);
}

async function publish({ version, notes, mandatory, publishedBy }) {
  if (!isVersion(version)) throw badRequest('The version must be numbers separated by dots, like 0.8.0.');
  const lines = (Array.isArray(notes) ? notes : String(notes || '').split('\n')).map((s) => String(s).trim()).filter(Boolean);
  if (!lines.length) throw badRequest('Say what is new in this version (one line per change).');
  if (await db()('agent_releases').where({ version }).first()) throw conflict(`Version ${version} is already published.`);

  const newest = await latest();
  if (newest && compare(version, newest.version) < 0) {
    throw badRequest(`A newer version (${newest.version}) is already published. Publish a version higher than that.`);
  }
  const row = {
    id: uuid(),
    version,
    notes: lines.join('\n'),
    mandatory: Boolean(mandatory),
    published_by: publishedBy || null,
    created_at: t.now(),
  };
  await db()('agent_releases').insert(row);
  return shape(row);
}

/**
 * Where a person's agent stands against the newest release:
 *   current   on the newest version (or newer)
 *   outdated  on an older one: the update has not been installed
 *   unknown   no version reported yet (an older agent that does not say, or never connected)
 * null when no release has been published, or the agent is not the desktop one.
 */
function updateState(version, release) {
  if (!release) return null;
  if (!version) return 'unknown';
  return compare(version, release.version) >= 0 ? 'current' : 'outdated';
}

module.exports = { latest, history, publish, updateState, shape };
