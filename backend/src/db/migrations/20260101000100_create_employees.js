'use strict';

// Sprint 1 — identity & consent.
// Portability notes (ADR-0001): ids are CHAR(36) generated in the app, timestamps are epoch
// milliseconds, enums are VARCHAR + CHECK. Nothing here is SQLite- or Postgres-specific.

exports.up = async function up(knex) {
  await knex.schema.createTable('employees', (t) => {
    t.string('id', 36).primary();
    t.string('name', 200).notNullable();
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).nullable(); // null when the account is SSO-only
    t.string('role', 20).notNullable().defaultTo('user').checkIn(['admin', 'user']);
    t.string('department', 120).nullable();
    t.string('employee_code', 50).nullable();
    t.string('status', 20).notNullable().defaultTo('active').checkIn(['active', 'inactive']);

    // IANA zone, e.g. "Asia/Kolkata". Attendance dates are computed in the employee's own
    // zone — a WFH team can span zones and "which day was that shift" must not depend on
    // where the server happens to run.
    t.string('timezone', 64).notNullable().defaultTo('Asia/Kolkata');

    // Consent. `consent_monitoring` covers screenshots/activity; `consent_audio` is separate
    // and is the hard gate enforced server-side on every audio upload.
    t.boolean('consent_monitoring').notNullable().defaultTo(false);
    t.boolean('consent_audio').notNullable().defaultTo(false);
    t.bigInteger('consent_given_at').nullable();
    t.string('consent_version', 20).nullable();

    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['role'], 'idx_employees_role');
    t.index(['department'], 'idx_employees_department');
    t.index(['status'], 'idx_employees_status');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('employees');
};
