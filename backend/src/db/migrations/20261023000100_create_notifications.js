'use strict';

// In-app notifications: one row per person per event, so each person has their own read state.
// Leave requests are the first user (a new request tells the team leader and HR; a decision
// tells the employee and the other reviewer), but nothing here is leave-specific.

exports.up = async function up(knex) {
  await knex.schema.createTable('notifications', (t) => {
    t.string('id', 36).primary();
    // Who it is for.
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('type', 40).notNullable();
    t.string('title', 200).notNullable();
    t.string('body', 500).nullable();
    // Where the portal should take the person when they open it, e.g. /leader/leave.
    t.string('link', 200).nullable();
    // The record it is about (a leave request id), so repeats can be recognised.
    t.string('ref_id', 36).nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('read_at').nullable();

    t.index(['employee_id', 'read_at', 'created_at'], 'idx_notifications_inbox');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notifications');
};
