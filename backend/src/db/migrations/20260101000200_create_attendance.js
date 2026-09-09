'use strict';

// Sprint 2 — attendance.
//
// The spec's `attendance` table carries a single break_start/break_end pair. Real shifts have
// several breaks, so breaks live in their own table and `attendance.total_break_seconds` is
// their rolled-up sum — the column the spec asked for, kept accurate.

exports.up = async function up(knex) {
  await knex.schema.createTable('attendance', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');

    t.bigInteger('punch_in').notNullable();
    t.bigInteger('punch_out').nullable(); // null while the shift is active

    // The employee's local calendar date for this shift, "YYYY-MM-DD". Stored rather than
    // derived so daily grouping is a plain GROUP BY on both SQLite and Postgres.
    t.string('date', 10).notNullable();

    t.integer('total_break_seconds').notNullable().defaultTo(0);
    t.integer('total_worked_seconds').nullable(); // (punch_out - punch_in) - breaks
    t.integer('idle_seconds').notNullable().defaultTo(0);

    t.string('status', 20).notNullable().defaultTo('open').checkIn(['open', 'on_break', 'closed']);

    t.boolean('over_break').notNullable().defaultTo(false); // breaks exceeded the allowance
    t.boolean('auto_closed').notNullable().defaultTo(false); // closed by the sweeper, not the employee
    t.boolean('needs_review').notNullable().defaultTo(false);
    t.string('review_reason', 255).nullable();

    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['employee_id', 'date'], 'idx_attendance_employee_date');
    t.index(['date'], 'idx_attendance_date');
    t.index(['status'], 'idx_attendance_status');
  });

  await knex.schema.createTable('breaks', (t) => {
    t.string('id', 36).primary();
    t.string('attendance_id', 36).notNullable().references('id').inTable('attendance').onDelete('CASCADE');
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');

    t.bigInteger('break_start').notNullable();
    t.bigInteger('break_end').nullable(); // null while the break is running
    t.integer('duration_seconds').nullable();

    t.bigInteger('created_at').notNullable();

    t.index(['attendance_id'], 'idx_breaks_attendance');
    t.index(['employee_id'], 'idx_breaks_employee');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('breaks');
  await knex.schema.dropTableIfExists('attendance');
};
