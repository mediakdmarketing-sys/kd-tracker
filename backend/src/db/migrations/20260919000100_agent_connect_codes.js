'use strict';

// One-time codes that let the desktop agent sign in as whoever just signed in on the web portal,
// without the employee typing their password a second time.
//
// The portal asks for a code while the employee is authenticated, hands it to the agent through
// a `workbuddy://connect?code=...` link, and the agent exchanges it for its own tokens. A code
// is short-lived and single-use, and only its hash is stored — same treatment as refresh tokens
// (see 20260101000150_create_refresh_tokens.js) — so a copy of the table is not a set of
// working sign-ins.

exports.up = async function up(knex) {
  await knex.schema.createTable('agent_connect_codes', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('code_hash', 64).notNullable().unique();
    t.bigInteger('expires_at').notNullable();
    t.bigInteger('used_at').nullable();
    t.bigInteger('created_at').notNullable();

    t.index(['expires_at'], 'idx_agent_codes_expiry');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('agent_connect_codes');
};
