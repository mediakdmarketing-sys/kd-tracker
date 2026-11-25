'use strict';

// Agent updates. HR publishes a release (a version and what is new in it); the desktop agent finds it
// in its config, shows an "Update" window, and installs the new build over the old one. The agent also
// says which version it is on (a header on every request), kept on its session, so HR and team leaders
// can see who has updated and who has not.

exports.up = async function up(knex) {
  await knex.schema.createTable('agent_releases', (t) => {
    t.string('id', 36).primary();
    t.string('version', 20).notNullable().unique();
    t.text('notes').nullable(); // one line per change, newline separated
    t.boolean('mandatory').notNullable().defaultTo(false); // true: no "Later" button
    t.string('published_by', 36).nullable().references('id').inTable('employees').onDelete('SET NULL');
    t.bigInteger('created_at').notNullable();
  });

  await knex.schema.alterTable('sessions', (t) => {
    t.string('agent_version', 20).nullable(); // the version the agent last said it is
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('sessions', (t) => t.dropColumn('agent_version'));
  await knex.schema.dropTableIfExists('agent_releases');
};
