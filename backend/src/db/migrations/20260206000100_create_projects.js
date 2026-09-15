'use strict';

// Project/task time tracking — the biggest real gap versus Hubstaff: until now there was no
// way to see what work drove the hours, only flat department + raw punches.
//
// Mirrors the breaks table's own pattern (see 20260101000200_create_attendance.js): a project
// switch is a time-segment row with a start and a nullable end, not a field on `attendance`
// itself — a shift can move through several projects, same as it can take several breaks.
// project_id is nullable on purpose: no row is created for unassigned time, so "no row covers
// this moment" *is* "unassigned", the same way an absent breaks row means "not on break".

exports.up = async function up(knex) {
  await knex.schema.createTable('projects', (t) => {
    t.string('id', 36).primary();
    t.string('name', 200).notNullable().unique();
    t.string('client', 200).nullable();
    // Optional scoping. Null = available to every department, matching how a shared internal
    // project (e.g. "Admin / overhead") isn't owned by any one team.
    t.string('department', 120).nullable();
    t.string('status', 20).notNullable().defaultTo('active').checkIn(['active', 'archived']);
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();

    t.index(['status'], 'idx_projects_status');
  });

  await knex.schema.createTable('project_time_entries', (t) => {
    t.string('id', 36).primary();
    t.string('attendance_id', 36).notNullable().references('id').inTable('attendance').onDelete('CASCADE');
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    // No FK/onDelete('SET NULL') here on purpose — a project being archived must not sever or
    // rewrite historical time entries; archiving only hides it from the picker (see
    // project.service.js). Validity is enforced at write time in the service layer instead.
    t.string('project_id', 36).nullable();

    t.bigInteger('started_at').notNullable();
    t.bigInteger('ended_at').nullable(); // null while this segment is the active one
    t.integer('duration_seconds').nullable();

    t.bigInteger('created_at').notNullable();

    t.index(['attendance_id'], 'idx_pte_attendance');
    t.index(['employee_id'], 'idx_pte_employee');
    t.index(['project_id'], 'idx_pte_project');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('project_time_entries');
  await knex.schema.dropTableIfExists('projects');
};
