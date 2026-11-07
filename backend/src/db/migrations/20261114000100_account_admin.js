'use strict';

// "Account admin": the admins who may see and run payroll and payments (pay rates, bonuses, payslips,
// finalizing a month, the payment list, bank details, payroll settings and the payslip template).
// Other admins (HR) keep everything else.
//
// It is a flag on an admin account rather than a fourth role, so every existing "is an admin" check
// keeps working and only the payroll and payment doors look at this.
//
// Everyone who is an admin today starts as an account admin, so nobody loses access when this
// ships. The owner then switches it off for the HR admins who should not see payroll.

exports.up = async function up(knex) {
  await knex.schema.table('employees', (t) => {
    t.boolean('is_account_admin').notNullable().defaultTo(false);
  });
  await knex('employees').where({ role: 'admin' }).update({ is_account_admin: true });
};

exports.down = async function down(knex) {
  await knex.schema.table('employees', (t) => {
    t.dropColumn('is_account_admin');
  });
};
