'use strict';

// Multi-monitor capture (ADR-0005).
//
// `desktopCapturer` returns one source per display. Capturing only the first one leaves an
// employee's second monitor invisible — a blind spot that defeats the point of the system.
// So a capture at a moment in time becomes N rows, one per display, tied together by
// `capture_group_id`.
//
// `capture_id` stays unique per row (it is the replay key for one image, ADR-0004);
// `capture_group_id` is shared by every image taken at the same moment.

exports.up = async function up(knex) {
  await knex.schema.alterTable('screenshots', (t) => {
    // Shared by every display captured at the same instant. Defaults to the row's own
    // capture_id for single-display captures, so a group of one is still a group.
    t.string('capture_group_id', 36).nullable();
    t.integer('display_index').nullable(); // 0-based; 0 is the primary display
    t.integer('display_count').nullable(); // how many displays existed at capture time
    t.string('display_label', 120).nullable(); // e.g. "Built-in Retina Display", "DELL U2720Q"

    t.index(['employee_id', 'capture_group_id'], 'idx_screenshots_capture_group');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('screenshots', (t) => {
    t.dropIndex(['employee_id', 'capture_group_id'], 'idx_screenshots_capture_group');
    t.dropColumn('capture_group_id');
    t.dropColumn('display_index');
    t.dropColumn('display_count');
    t.dropColumn('display_label');
  });
};
