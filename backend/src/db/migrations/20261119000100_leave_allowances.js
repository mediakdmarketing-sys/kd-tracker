'use strict';

// Yearly leave allowance per leave type, in days: a JSON object like {"sick":10,"vacation":14}.
// A type that is missing or null has no limit set, so no balance is shown for it.

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.text('leave_allowances').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('settings', (t) => {
    t.dropColumn('leave_allowances');
  });
};
