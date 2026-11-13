'use strict';

// When the working day starts and ends (company time), as minutes after midnight. Used to judge
// punch-in lateness and early punch-out for the dashboard's performance view. Null = not set:
// that view then leaves those two measures out rather than guessing a start time.

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.integer('workday_start_minutes').nullable();
    t.integer('workday_end_minutes').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('settings', (t) => {
    t.dropColumn('workday_start_minutes');
    t.dropColumn('workday_end_minutes');
  });
};
