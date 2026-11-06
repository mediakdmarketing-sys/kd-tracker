'use strict';

// Holidays that come back every year.
//
// A holiday HR marks repeats by default: the first time a later year is looked at (its calendar,
// payroll for it, a punch-in in it) the repeating holidays of the year before are copied into it as
// real rows, flagged `auto_copied` so HR can see which ones to check (a festival that moves, say).
// holiday_years remembers which years have been filled in, so a holiday HR removes or moves in the
// new year stays that way and is not copied back.

exports.up = async function up(knex) {
  await knex.schema.table('company_holidays', (t) => {
    t.boolean('repeats').notNullable().defaultTo(true);
    t.boolean('auto_copied').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('holiday_years', (t) => {
    t.integer('year').primary();
    t.bigInteger('generated_at').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('holiday_years');
  await knex.schema.table('company_holidays', (t) => {
    t.dropColumn('repeats');
    t.dropColumn('auto_copied');
  });
};
