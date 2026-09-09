'use strict';

// Department leader hierarchy.
//
// Design decisions:
//  - employees.department (string) is kept as-is for backward compat. A "department" is
//    identified by its name string, not a FK to a departments table, so existing data and
//    reports are unaffected.
//  - department_leaders is a join table: one row = one employee is a leader of one dept.
//    An employee can lead multiple departments; a department can have multiple leaders.
//  - employees.role gains a 'leader' value. The CHECK constraint is updated.
//    SQLite cannot ALTER a CHECK on an existing column, so the constraint is enforced in
//    the application (auth middleware + zod schema); Postgres gets the real CHECK.

exports.up = async function up(knex) {
  // 1. Add 'leader' to the role check on Postgres (SQLite ignores ALTER TABLE … CHECK).
  //    We drop and re-add the constraint rather than trying to patch it in place.
  const isPg = knex.client.config.client === 'pg';
  if (isPg) {
    await knex.raw(`
      ALTER TABLE employees
        DROP CONSTRAINT IF EXISTS employees_role_check
    `);
    await knex.raw(`
      ALTER TABLE employees
        ADD CONSTRAINT employees_role_check
        CHECK (role IN ('admin', 'leader', 'user'))
    `);
  }

  // 2. department_leaders join table.
  await knex.schema.createTable('department_leaders', (t) => {
    // The department is identified by the same string stored in employees.department.
    t.string('department', 120).notNullable();
    t.string('employee_id', 36)
      .notNullable()
      .references('id')
      .inTable('employees')
      .onDelete('CASCADE');

    t.bigInteger('assigned_at').notNullable();
    t.string('assigned_by', 36).nullable(); // admin employee_id who made the assignment

    // One row per (department, employee) pair — no duplicate assignments.
    t.primary(['department', 'employee_id']);

    t.index(['employee_id'], 'idx_dept_leaders_employee');
    t.index(['department'], 'idx_dept_leaders_dept');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('department_leaders');

  const isPg = knex.client.config.client === 'pg';
  if (isPg) {
    await knex.raw(`
      ALTER TABLE employees
        DROP CONSTRAINT IF EXISTS employees_role_check
    `);
    await knex.raw(`
      ALTER TABLE employees
        ADD CONSTRAINT employees_role_check
        CHECK (role IN ('admin', 'user'))
    `);
  }
};
