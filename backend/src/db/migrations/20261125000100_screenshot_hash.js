'use strict';

/** Adds image_hash to screenshots so repeated identical images can be detected. */
exports.up = (knex) =>
  knex.schema.table('screenshots', (t) => {
    t.string('image_hash', 64).nullable(); // SHA-256 hex
  });

exports.down = (knex) =>
  knex.schema.table('screenshots', (t) => {
    t.dropColumn('image_hash');
  });
