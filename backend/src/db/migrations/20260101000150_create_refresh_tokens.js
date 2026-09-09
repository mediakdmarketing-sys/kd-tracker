'use strict';

// Sprint 1 — story A-2. A 30-minute access token would log an agent out mid-shift, so the
// agent holds a long-lived refresh token. Only its SHA-256 hash is stored: a database dump
// must not hand out sessions.

exports.up = async function up(knex) {
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.string('client', 40).nullable(); // 'web' | 'desktop' | 'chromeos'
    t.bigInteger('expires_at').notNullable();
    t.bigInteger('revoked_at').nullable();
    t.bigInteger('created_at').notNullable();

    t.index(['employee_id'], 'idx_refresh_employee');
    t.index(['expires_at'], 'idx_refresh_expires');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('refresh_tokens');
};
