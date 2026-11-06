'use strict';

// How a payslip looks (colours, font, title, closing note, which details to show), editable by HR.
// Kept as one JSON document in the settings row: it is read whole, shown in a live preview and
// replaced whole, and the shape can grow without a migration each time.

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.text('payslip_template').nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('settings', (t) => {
    t.dropColumn('payslip_template');
  });
};
