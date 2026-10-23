'use strict';

// Per-department app categories: "Spotify is distracting for Sales" without touching how
// Design sees it. A row here beats the company-wide row in app_categories (and the built-in
// default) for people in that department only.
//
// Replaces app_restrictions from the previous migration — a separate "restricted" category is
// not needed once any of the three categories can be set per department.

exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists('app_restrictions');
  await knex.schema.createTable('app_department_categories', (t) => {
    t.string('id', 36).primary();
    t.string('app_key', 120).notNullable();
    t.string('app_name', 120).notNullable();
    t.string('department', 120).notNullable();
    t.string('category', 20).notNullable().checkIn(['productive', 'neutral', 'distracting']);
    t.string('updated_by', 36).nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.unique(['app_key', 'department'], { indexName: 'uq_app_dept_categories' });
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('app_department_categories');
};
