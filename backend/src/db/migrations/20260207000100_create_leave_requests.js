'use strict';

// Leave requests (PTO) — v1 scope, deliberately: no balance/quota/accrual tracking (that's a
// whole separate accounting system) and no payroll integration yet. This just tracks requests
// through to a decision, and lets the Live Board and Reports show an approved day honestly as
// "On leave" instead of an unexplained absence.

exports.up = async function up(knex) {
  await knex.schema.createTable('leave_requests', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');

    t.string('type', 20).notNullable().checkIn(['sick', 'casual', 'unpaid']);
    // Whole-day granularity for v1 — inclusive range, "YYYY-MM-DD" like attendance.date so a
    // day's leave status is a plain BETWEEN, not a timestamp comparison.
    t.string('start_date', 10).notNullable();
    t.string('end_date', 10).notNullable();
    t.text('reason').nullable();

    t.string('status', 20).notNullable().defaultTo('pending').checkIn(['pending', 'approved', 'rejected', 'cancelled']);
    t.string('reviewed_by', 36).nullable().references('id').inTable('employees').onDelete('SET NULL');
    t.bigInteger('reviewed_at').nullable();
    t.text('review_note').nullable();

    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['employee_id'], 'idx_leave_employee');
    t.index(['status'], 'idx_leave_status');
    t.index(['start_date', 'end_date'], 'idx_leave_range');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('leave_requests');
};
