'use strict';

// Where to pay an employee: bank, branch, account number and account name.
//
// All four are kept together as ONE encrypted blob (AES-256-GCM, see services/bankDetails.js), so
// a copy of the database on its own does not reveal anyone's account. Only the bank's name and the
// last four characters of the account number are stored in the clear, so lists can say which bank
// and the portal can show "****1234" without decrypting anything.

exports.up = async function up(knex) {
  await knex.schema.createTable('employee_bank_details', (t) => {
    t.string('employee_id', 36).primary().references('id').inTable('employees').onDelete('CASCADE');
    t.text('details_enc').notNullable();
    t.string('bank_name', 100).notNullable();
    t.string('account_last4', 4).notNullable();
    t.string('updated_by', 36).nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('employee_bank_details');
};
