'use strict';

// Admin overrides for how a desktop application counts towards a productivity score.
//
// Only overrides live here. A built-in default list (modules/productivity/categories.js)
// covers common tools, so a fresh install scores sensibly with zero configuration and this
// table stays small: one row per app an admin disagreed with the default about.
//
// app_key is the normalised name (lower-case, no ".exe") — the same app reports as "Code",
// "code.exe" or "Visual Studio Code" depending on platform, and one row should cover them all.

exports.up = async function up(knex) {
  await knex.schema.createTable('app_categories', (t) => {
    t.string('id', 36).primary();
    t.string('app_key', 120).notNullable().unique();
    t.string('app_name', 120).notNullable(); // display form, as first entered
    t.string('category', 20).notNullable().checkIn(['productive', 'neutral', 'distracting']);
    t.string('updated_by', 36).nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('app_categories');
};
