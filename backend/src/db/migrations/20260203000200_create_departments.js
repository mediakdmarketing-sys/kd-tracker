'use strict';

// Departments are now first-class entities created by admins.
// employees.department (string) still stores the name for backward compat —
// it stays in sync when an employee is assigned to a department.

exports.up = async function up(knex) {
  await knex.schema.createTable('departments', (t) => {
    t.string('id', 36).primary();
    t.string('name', 120).notNullable().unique();
    t.text('description').nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('departments');
};
