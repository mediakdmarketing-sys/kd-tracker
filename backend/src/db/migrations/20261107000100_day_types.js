'use strict';

// How a day is paid: a FULL day (at least `full` seconds of work), a HALF day (at least `half`),
// and anything below that as plain hours.
//
// "Work" is the worked time of the day with breaks already taken out, so someone who takes a
// break and stays late to finish their hours reaches a full day exactly like someone who takes
// none and leaves on time.
//
// The limits live in settings (HR edits them). Each generated payroll row keeps the limits it was
// generated with, so changing them later never alters a payslip that was already produced.

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.integer('payroll_full_day_seconds').notNullable().defaultTo(32400); // 9 hours
    t.integer('payroll_half_day_seconds').notNullable().defaultTo(16200); // 4.5 hours
  });

  await knex.schema.table('payroll_summary', (t) => {
    t.integer('full_days').notNullable().defaultTo(0);
    t.integer('half_days').notNullable().defaultTo(0);
    t.integer('partial_days').notNullable().defaultTo(0); // days that were neither full nor half
    t.integer('partial_seconds').notNullable().defaultTo(0); // the hours worked on those days
    t.integer('full_day_seconds').notNullable().defaultTo(32400);
    t.integer('half_day_seconds').notNullable().defaultTo(16200);
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('payroll_summary', (t) => {
    ['full_days', 'half_days', 'partial_days', 'partial_seconds', 'full_day_seconds', 'half_day_seconds'].forEach((c) =>
      t.dropColumn(c)
    );
  });
  await knex.schema.table('settings', (t) => {
    t.dropColumn('payroll_full_day_seconds');
    t.dropColumn('payroll_half_day_seconds');
  });
};
