'use strict';

// Pay for payroll. Money is stored as whole cents (integers), never as floats, so a month of sums
// cannot drift by a cent between SQLite and Postgres.
//
// pay_rates is a history, not a single value: an increment is a new row with a later
// `effective_from`, and every worked day is paid at the rate that was in force on that day. So a
// raise in the middle of a month, or one entered afterwards with a back-dated start, prices each
// day correctly and old months can still be regenerated.

exports.up = async function up(knex) {
  await knex.schema.createTable('pay_rates', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.integer('daily_rate_cents').notNullable();
    t.string('effective_from', 10).notNullable(); // "YYYY-MM-DD", the first day this rate applies
    t.string('note', 255).nullable();
    t.string('created_by', 36).nullable(); // the admin who entered it
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.unique(['employee_id', 'effective_from'], { indexName: 'uq_pay_rates_employee_from' });
    t.index(['employee_id'], 'idx_pay_rates_employee');
  });

  await knex.schema.createTable('payroll_bonuses', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('month', 7).notNullable(); // the payroll month it is paid with, "2026-11"
    t.integer('amount_cents').notNullable();
    t.string('reason', 255).notNullable();
    t.string('created_by', 36).nullable();
    t.bigInteger('created_at').notNullable();

    t.index(['month'], 'idx_payroll_bonuses_month');
    t.index(['employee_id', 'month'], 'idx_payroll_bonuses_employee_month');
  });

  // The day-based part of the pay is fixed when payroll is generated; bonuses are added on top
  // when read, so adding one later never needs a regenerate.
  await knex.schema.table('payroll_summary', (t) => {
    t.integer('base_pay_cents').notNullable().defaultTo(0);
    t.integer('priced_days').notNullable().defaultTo(0);
    t.integer('rate_missing_days').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('payroll_summary', (t) => {
    t.dropColumn('base_pay_cents');
    t.dropColumn('priced_days');
    t.dropColumn('rate_missing_days');
  });
  await knex.schema.dropTableIfExists('payroll_bonuses');
  await knex.schema.dropTableIfExists('pay_rates');
};
