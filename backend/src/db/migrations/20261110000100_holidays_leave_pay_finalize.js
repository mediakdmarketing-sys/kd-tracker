'use strict';

// Paid leave, company holidays, and closing a payroll month.
//
// - settings: which leave types are paid, and which weekdays are working days (leave and holidays
//   are only paid on working days, so a Friday-to-Tuesday vacation does not pay the weekend).
// - company_holidays: dates the whole company is off, paid at the daily rate.
// - payroll_summary: how many days of paid leave / holiday pay a month holds, and, once the month
//   is finalized, a frozen copy ("snapshot") of each person's payslip.
// - payroll_months: one row per finalized month. A finalized month cannot be regenerated or have
//   its bonuses changed until it is reopened (reopening is audited and deletes the row).

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.text('payroll_paid_leave_types').nullable(); // JSON array, e.g. ["vacation"]
    t.text('payroll_work_days').nullable(); // JSON array of weekdays, 0 = Sunday ... 6 = Saturday
  });

  await knex.schema.createTable('company_holidays', (t) => {
    t.string('id', 36).primary();
    t.string('date', 10).notNullable().unique(); // "YYYY-MM-DD"
    t.string('name', 120).notNullable();
    t.string('created_by', 36).nullable();
    t.bigInteger('created_at').notNullable();
  });

  await knex.schema.table('payroll_summary', (t) => {
    t.decimal('leave_days', 6, 2).notNullable().defaultTo(0);
    t.decimal('holiday_days', 6, 2).notNullable().defaultTo(0);
    t.bigInteger('finalized_at').nullable();
    t.text('snapshot').nullable(); // the payslip exactly as it was when the month was finalized
  });

  await knex.schema.createTable('payroll_months', (t) => {
    t.string('month', 7).primary();
    t.bigInteger('finalized_at').notNullable();
    t.string('finalized_by', 36).nullable();
    t.integer('employees').notNullable().defaultTo(0);
    t.integer('net_total_cents').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payroll_months');
  await knex.schema.table('payroll_summary', (t) => {
    ['leave_days', 'holiday_days', 'finalized_at', 'snapshot'].forEach((c) => t.dropColumn(c));
  });
  await knex.schema.dropTableIfExists('company_holidays');
  await knex.schema.table('settings', (t) => {
    t.dropColumn('payroll_paid_leave_types');
    t.dropColumn('payroll_work_days');
  });
};
