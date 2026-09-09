'use strict';

// Sprint 6.5 — the offline contract (ADR-0004).
//
// An agent on a flaky home connection queues work locally and drains it on reconnect. That
// makes retries routine rather than exceptional, so the API needs to be able to recognise a
// replay, and attendance needs to record that an event arrived late.
//
// Note on `source`: ADR-0001 says enums are VARCHAR + CHECK, but SQLite cannot add a CHECK
// constraint to an existing table without rebuilding it. The value is validated in the
// application (attendance.service) and the CHECK is added when the schema is next created
// from scratch on PostgreSQL.

const CAPTURE_TABLES = [
  ['screenshots', 'uq_screenshots_capture_id'],
  ['audio_recordings', 'uq_audio_capture_id'],
  ['activity_logs', 'uq_activity_capture_id'],
];

exports.up = async function up(knex) {
  for (const [table, indexName] of CAPTURE_TABLES) {
    // Client-generated id for one captured artefact. A retry after a lost response carries
    // the same value, so the second attempt is recognised instead of duplicated.
    // Nullable: rows created before this migration have none, and NULLs do not collide in a
    // unique index on either engine.
    await knex.schema.alterTable(table, (t) => {
      t.string('capture_id', 36).nullable();
      t.unique(['capture_id'], { indexName });
    });
  }

  await knex.schema.alterTable('attendance', (t) => {
    // 'live'  — the employee pressed the button and we heard it immediately
    // 'queued'— the agent held it offline and replayed it with its original time
    // 'admin' — created or corrected by HR
    t.string('source', 20).notNullable().defaultTo('live');
    // When the server actually received the punch-in, as opposed to when it claims to have
    // happened. The gap between the two is what HR needs to see.
    t.bigInteger('punch_in_received_at').nullable();
  });

  await knex.schema.alterTable('refresh_tokens', (t) => {
    // Supports the rotation grace window: a token presented again shortly after it was
    // rotated is a lost response, not an attack.
    t.bigInteger('last_used_at').nullable();
    t.integer('reuse_count').notNullable().defaultTo(0);
    // Why the token was revoked: 'rotated' | 'logout' | 'security' | 'admin'.
    // Only 'rotated' is eligible for the grace window — a token killed by a sign-out, an HR
    // action or a suspected theft must be dead immediately, with no window at all.
    t.string('revoked_reason', 20).nullable();
  });
};

exports.down = async function down(knex) {
  for (const [table, indexName] of CAPTURE_TABLES) {
    await knex.schema.alterTable(table, (t) => {
      t.dropUnique(['capture_id'], indexName);
      t.dropColumn('capture_id');
    });
  }

  await knex.schema.alterTable('attendance', (t) => {
    t.dropColumn('source');
    t.dropColumn('punch_in_received_at');
  });

  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.dropColumn('last_used_at');
    t.dropColumn('reuse_count');
    t.dropColumn('revoked_reason');
  });
};
