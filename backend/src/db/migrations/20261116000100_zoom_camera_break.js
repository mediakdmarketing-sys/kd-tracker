'use strict';

// Windows agents can tell that the camera is off during a Zoom meeting. This setting is how many
// minutes of that it takes before the agent starts a break by itself. 0 means switched off, which
// is the default: an automatic break takes time out of pay, so HR turns it on knowingly.

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.integer('zoom_camera_break_minutes').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('settings', (t) => {
    t.dropColumn('zoom_camera_break_minutes');
  });
};
