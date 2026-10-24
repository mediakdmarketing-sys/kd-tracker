'use strict';

// Moments when the agent could not use the microphone at all (switched off by a hardware key or
// a privacy switch, blocked in the system settings, unplugged). An audio sample can only report
// "silent" if it recorded something; when the device itself refuses to start there is no sample,
// so without this the server would never learn the mic was off. Each row feeds the mic log and
// the "mic not active" alert.

exports.up = async function up(knex) {
  await knex.schema.createTable('mic_events', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.bigInteger('at').notNullable();
    t.string('date', 10).notNullable();
    t.string('state', 20).notNullable(); // 'unavailable'
    t.string('reason', 200).nullable();
    t.bigInteger('created_at').notNullable();

    t.index(['employee_id', 'date'], 'idx_mic_events_employee_date');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mic_events');
};
