'use strict';

// Adds idle_deducted to payroll_summary so the portal and CSV export can show whether idle
// seconds were subtracted from paid hours at generation time (controlled by
// PAYROLL_DEDUCT_IDLE in .env). Defaults to false (current behaviour unchanged).

exports.up = async function up(knex) {
  await knex.schema.table('payroll_summary', (t) => {
    t.boolean('idle_deducted').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('payroll_summary', (t) => {
    t.dropColumn('idle_deducted');
  });
};
