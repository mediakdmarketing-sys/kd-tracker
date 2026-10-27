'use strict';

// HR decides what counts as a half day and a full day: the hours a person must have worked in
// one calendar day. Stored with the rest of the company's settings.

exports.up = async (knex) => {
  await knex.schema.alterTable('settings', (t) => {
    t.integer('half_day_seconds').notNullable().defaultTo(4 * 3600);
    t.integer('full_day_seconds').notNullable().defaultTo(7 * 3600);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('settings', (t) => {
    t.dropColumn('half_day_seconds');
    t.dropColumn('full_day_seconds');
  });
};
