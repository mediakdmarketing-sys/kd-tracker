'use strict';

// Why a break started, when it was not the person pressing Start break: 'signed_out' is a break
// the system started because they signed out while punched in. Null for an ordinary break, so the
// portal can say "your break started when you signed out" without guessing.

exports.up = async function up(knex) {
  await knex.schema.table('breaks', (t) => {
    t.string('reason', 30).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('breaks', (t) => {
    t.dropColumn('reason');
  });
};
