'use strict';

// A temporary password that HR hands out (an invitation, a reset) must not stay the person's
// password: the first time they sign in they have to choose their own. Existing accounts keep
// working exactly as before, so the flag starts false for everyone.

exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.boolean('must_change_password').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('must_change_password');
  });
};
