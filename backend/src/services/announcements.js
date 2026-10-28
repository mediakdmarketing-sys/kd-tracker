'use strict';

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const { now } = require('../utils/time');

// A message from the platform to everyone signed in to any company ("maintenance at 10 PM").
// It shows from `starts_at` until `ends_at` (or until it is ended).

function shape(r) {
  return {
    id: r.id,
    message: r.message,
    level: r.level,
    startsAt: new Date(Number(r.starts_at)).toISOString(),
    endsAt: r.ends_at == null ? null : new Date(Number(r.ends_at)).toISOString(),
    active: Number(r.starts_at) <= now() && (r.ends_at == null || Number(r.ends_at) > now()),
  };
}

/** What a signed-in person should see right now. */
async function active() {
  const t = now();
  const rows = await db()('announcements')
    .where('starts_at', '<=', t)
    .andWhere((b) => b.whereNull('ends_at').orWhere('ends_at', '>', t))
    .orderBy('starts_at', 'desc')
    .limit(5);
  return rows.map((r) => ({ id: r.id, message: r.message, level: r.level }));
}

async function list() {
  const rows = await db()('announcements').orderBy('starts_at', 'desc').limit(100);
  return rows.map(shape);
}

async function create({ message, level = 'info', startsAt, endsAt, createdBy }) {
  const row = {
    id: uuid(),
    message,
    level,
    starts_at: startsAt ? new Date(startsAt).getTime() : now(),
    ends_at: endsAt ? new Date(endsAt).getTime() : null,
    created_by: createdBy || null,
    created_at: now(),
  };
  await db()('announcements').insert(row);
  return shape(row);
}

/** Stops showing it now (the record stays). */
async function end(id) {
  const row = await db()('announcements').where({ id }).first();
  if (!row) return null;
  await db()('announcements').where({ id }).update({ ends_at: now() });
  return shape({ ...row, ends_at: now() });
}

module.exports = { active, list, create, end };
