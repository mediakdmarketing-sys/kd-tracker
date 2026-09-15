'use strict';

// Per-employee screenshot blur preference (Hubstaff calls this "blurred screenshots") — a
// softer default view for anyone who finds full-detail screenshots too invasive day-to-day.
// It is a display preference only, admin-controlled in both directions (unlike audio consent,
// which is the employee's to give and only theirs to revoke) — the underlying image is never
// altered or re-encoded; the blur is a CSS filter applied client-side, so an admin who needs
// to actually check something can still reveal full detail on demand without re-uploading or
// storing a second copy of the file.

exports.up = async function up(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.boolean('blur_screenshots').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('employees', (t) => {
    t.dropColumn('blur_screenshots');
  });
};
