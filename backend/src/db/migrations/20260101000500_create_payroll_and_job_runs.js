'use strict';

// Sprint 5 — payroll & retention.
//
// `month` is CHAR(7) "YYYY-MM" rather than the spec's DATE-first-of-month: it is the natural
// key, sorts correctly as text, and behaves identically on SQLite and Postgres (ADR-0001).

exports.up = async function up(knex) {
  await knex.schema.createTable('payroll_summary', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('month', 7).notNullable(); // "2026-08"

    t.decimal('total_hours', 10, 2).notNullable().defaultTo(0);
    t.integer('total_worked_seconds').notNullable().defaultTo(0);
    t.integer('total_break_seconds').notNullable().defaultTo(0);
    t.integer('total_idle_seconds').notNullable().defaultTo(0);
    t.integer('days_present').notNullable().defaultTo(0);
    t.integer('days_flagged').notNullable().defaultTo(0); // over-break or auto-closed

    t.bigInteger('generated_on').notNullable();
    t.boolean('synced_to_payroll').notNullable().defaultTo(false);
    t.bigInteger('synced_at').nullable();

    // Regenerating a month must overwrite, never duplicate (story P-1: idempotent).
    t.unique(['employee_id', 'month'], { indexName: 'uq_payroll_employee_month' });
    t.index(['month'], 'idx_payroll_month');
  });

  await knex.schema.createTable('job_runs', (t) => {
    t.string('id', 36).primary();
    t.string('job_name', 60).notNullable(); // 'purge' | 'payroll' | 'close-shifts'
    t.bigInteger('started_at').notNullable();
    t.bigInteger('finished_at').nullable();
    t.string('status', 20).notNullable().defaultTo('running').checkIn(['running', 'success', 'failed']);
    t.integer('affected_count').nullable();
    t.text('details').nullable();

    t.index(['job_name', 'started_at'], 'idx_job_runs_name_started');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('job_runs');
  await knex.schema.dropTableIfExists('payroll_summary');
};
