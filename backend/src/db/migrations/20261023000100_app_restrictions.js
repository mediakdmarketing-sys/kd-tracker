'use strict';

// Apps an admin has marked "restricted", scoped to one department.
//
// department = '' means every department (set while the Productivity page's department filter
// is on "All departments"). A sentinel string rather than NULL so the (app_key, department)
// unique index actually de-duplicates on both SQLite and Postgres.

exports.up = async function up(knex) {
  await knex.schema.createTable('app_restrictions', (t) => {
    t.string('id', 36).primary();
    t.string('app_key', 120).notNullable();
    t.string('app_name', 120).notNullable();
    t.string('department', 120).notNullable().defaultTo('');
    t.string('updated_by', 36).nullable();
    t.bigInteger('created_at').notNullable();

    t.unique(['app_key', 'department'], { indexName: 'uq_app_restrictions_app_dept' });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('app_restrictions');
};
