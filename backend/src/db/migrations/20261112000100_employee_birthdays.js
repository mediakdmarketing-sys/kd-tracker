'use strict';

// A birthday on each employee, "YYYY-MM-DD". HR sets it; it shows on the admin calendar for active
// people, and HR and the person's leaders are told the day before and on the day.

exports.up = async function up(knex) {
  await knex.schema.table('employees', (t) => {
    t.string('birth_date', 10).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('employees', (t) => {
    t.dropColumn('birth_date');
  });
};
