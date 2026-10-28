'use strict';

// "View as": the platform owner can step into a company as one of its people to see what they
// see. The session is a normal refresh token marked with who started it, capped in length.

exports.up = async (knex) => {
  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.string('impersonated_by', 36).nullable();
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable('refresh_tokens', (t) => {
    t.dropColumn('impersonated_by');
  });
};
