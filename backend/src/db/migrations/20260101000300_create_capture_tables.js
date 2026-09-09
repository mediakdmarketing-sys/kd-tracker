'use strict';

// Sprint 3 — capture ingest.
//
// Retention rule (spec 6.4): after 31 days the *file* is deleted and the URL nulled, but the
// row survives permanently for audit and reporting. Hence `file_deleted` rather than a DELETE.

exports.up = async function up(knex) {
  await knex.schema.createTable('screenshots', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('attendance_id', 36).nullable().references('id').inTable('attendance').onDelete('SET NULL');

    t.string('image_url', 500).nullable(); // storage key; NULL once purged
    t.bigInteger('captured_at').notNullable();
    t.string('date', 10).notNullable();
    t.integer('size_bytes').nullable();
    t.string('content_type', 80).nullable();
    t.boolean('file_deleted').notNullable().defaultTo(false);

    t.bigInteger('created_at').notNullable();

    t.index(['employee_id', 'date'], 'idx_screenshots_employee_date');
    t.index(['captured_at', 'file_deleted'], 'idx_screenshots_purge');
  });

  await knex.schema.createTable('audio_recordings', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('attendance_id', 36).nullable().references('id').inTable('attendance').onDelete('SET NULL');

    t.string('file_url', 500).nullable(); // storage key; NULL once purged
    t.bigInteger('recorded_at').notNullable();
    t.string('date', 10).notNullable();
    t.integer('duration_seconds').notNullable();
    t.integer('size_bytes').nullable();
    t.string('content_type', 80).nullable();

    // Written from the employee record at ingest time, so the row carries proof that consent
    // was in force when the sample was taken — not merely that it is in force today.
    t.boolean('consent_verified').notNullable().defaultTo(false);
    t.boolean('file_deleted').notNullable().defaultTo(false);

    t.bigInteger('created_at').notNullable();

    t.index(['employee_id', 'date'], 'idx_audio_employee_date');
    t.index(['recorded_at', 'file_deleted'], 'idx_audio_purge');
  });

  await knex.schema.createTable('activity_logs', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('attendance_id', 36).nullable().references('id').inTable('attendance').onDelete('SET NULL');

    // Counts only. Keystroke *content* is never captured, transmitted or stored — the API has
    // no field to put it in, which is the point.
    t.integer('keystroke_count').notNullable().defaultTo(0);
    t.integer('mouse_count').notNullable().defaultTo(0);
    t.string('window_title', 255).nullable(); // active application name only, optional

    t.bigInteger('timestamp').notNullable();
    t.string('date', 10).notNullable();
    t.bigInteger('created_at').notNullable();

    t.index(['employee_id', 'timestamp'], 'idx_activity_employee_ts');
    t.index(['attendance_id'], 'idx_activity_attendance');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('activity_logs');
  await knex.schema.dropTableIfExists('audio_recordings');
  await knex.schema.dropTableIfExists('screenshots');
};
