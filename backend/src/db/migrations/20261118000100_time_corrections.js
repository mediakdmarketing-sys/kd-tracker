'use strict';

// Time correction requests: an employee asks for a finished shift's punch-in / punch-out to be
// changed (or for a whole forgotten shift to be added), with a reason. HR approves or rejects;
// only an approval touches attendance. The request keeps the original times so the change can be
// audited later. `attendance.corrected` marks a shift whose times HR changed.

exports.up = async function up(knex) {
  await knex.schema.createTable('time_corrections', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees');
    // The shift being corrected; null when a whole shift was forgotten and is being added.
    t.string('attendance_id', 36).nullable().references('id').inTable('attendance');
    t.string('date', 10).notNullable();
    t.bigInteger('original_punch_in').nullable();
    t.bigInteger('original_punch_out').nullable();
    t.bigInteger('requested_punch_in').notNullable();
    t.bigInteger('requested_punch_out').notNullable();
    t.string('reason', 500).notNullable();
    t.string('status', 12).notNullable().defaultTo('pending'); // pending | approved | rejected | cancelled
    t.string('reviewed_by', 36).nullable();
    t.string('review_note', 500).nullable();
    t.bigInteger('reviewed_at').nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
    t.index(['employee_id', 'status']);
    t.index(['status', 'created_at']);
  });

  await knex.schema.table('attendance', (t) => {
    t.boolean('corrected').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('attendance', (t) => {
    t.dropColumn('corrected');
  });
  await knex.schema.dropTableIfExists('time_corrections');
};
