'use strict';

// The website host (e.g. "youtube.com") the employee had in the foreground while using a
// browser. Host only: the agent never sends a path, query string or page title.

exports.up = async function up(knex) {
  await knex.schema.alterTable('activity_logs', (t) => {
    t.string('domain', 120).nullable();
  });
  await knex.schema.alterTable('activity_logs', (t) => {
    t.index(['date', 'domain'], 'idx_activity_date_domain');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('activity_logs', (t) => {
    t.dropIndex(['date', 'domain'], 'idx_activity_date_domain');
    t.dropColumn('domain');
  });
};
