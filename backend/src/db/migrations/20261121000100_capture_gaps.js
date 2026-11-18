'use strict';

// Stretches of a shift in which nothing was being captured because the agent was not talking to the
// server (closed, quit, no internet, never started). Recorded by the capture watch, shown on the
// Timesheet, and never used to change anyone's pay: it is a flag for HR and the leader to look at.

exports.up = async function up(knex) {
  await knex.schema.createTable('capture_gaps', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('attendance_id', 36).notNullable().references('id').inTable('attendance').onDelete('CASCADE');
    t.bigInteger('started_at').notNullable(); // when the agent was last heard from (or the shift began)
    t.bigInteger('ended_at').nullable(); // null while it is still going on
    t.string('reason', 20).notNullable().defaultTo('agent_offline');
    t.bigInteger('created_at').notNullable();
    t.index(['attendance_id'], 'idx_capture_gaps_attendance');
    t.index(['ended_at'], 'idx_capture_gaps_open');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('capture_gaps');
};
