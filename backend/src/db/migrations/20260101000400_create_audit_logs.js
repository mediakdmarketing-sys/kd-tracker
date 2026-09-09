'use strict';

// Sprint 4 — oversight. Every admin read of captured media lands here (spec 7.4).
// The table is append-only by convention: no service writes an UPDATE or DELETE against it.

exports.up = async function up(knex) {
  await knex.schema.createTable('audit_logs', (t) => {
    t.string('id', 36).primary();
    t.string('admin_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('action', 80).notNullable(); // e.g. "viewed_screenshot", "exported_report"
    t.string('target_employee_id', 36).nullable();
    t.string('target_type', 40).nullable(); // 'screenshot' | 'audio' | 'report' | 'employee'
    t.string('target_id', 36).nullable();
    t.string('ip_address', 64).nullable();
    t.text('details').nullable(); // JSON string: query filters, date ranges, row counts
    t.bigInteger('timestamp').notNullable();

    t.index(['admin_id'], 'idx_audit_admin');
    t.index(['target_employee_id'], 'idx_audit_target_employee');
    t.index(['timestamp'], 'idx_audit_timestamp');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('audit_logs');
};
