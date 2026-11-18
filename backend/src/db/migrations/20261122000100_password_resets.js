'use strict';

// "Forgot password": a one-time link sent to the person's work email. Only a hash of the link's token
// is stored, so a database dump cannot be used to take over an account. A link works once and for a
// short time.

exports.up = async function up(knex) {
  await knex.schema.createTable('password_resets', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.bigInteger('expires_at').notNullable();
    t.bigInteger('used_at').nullable();
    t.string('requested_ip', 64).nullable();
    t.bigInteger('created_at').notNullable();
    t.index(['employee_id', 'created_at'], 'idx_password_resets_employee');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('password_resets');
};
