'use strict';

// Operational settings editable from the admin panel (Settings module), separate from
// deploy-time config (DB connection, storage credentials, JWT secrets, CORS, port — those
// stay in .env; changing them safely needs a restart/redeploy regardless of any UI).
//
// A single row rather than a generic key-value table: every column is typed and validated,
// matching how the rest of this schema works (see departments, employees). Global-only for
// now — see docs/adr if per-department overrides are ever needed; this table is where that
// would grow from, not something to redesign.

exports.up = async function up(knex) {
  await knex.schema.createTable('settings', (t) => {
    t.string('id', 20).primary(); // always 'default' — enforced in code, not a real key space

    t.integer('screenshot_min_interval_sec').notNullable();
    t.integer('screenshot_max_interval_sec').notNullable();
    t.integer('audio_sample_duration_sec').notNullable();
    t.integer('audio_sample_gap_sec').notNullable();

    t.integer('shift_target_seconds').notNullable();
    t.integer('break_allowance_seconds').notNullable();
    t.integer('idle_threshold_seconds').notNullable();
    t.integer('shift_auto_close_hours').notNullable();

    t.integer('retention_days').notNullable();
    t.boolean('payroll_deduct_idle').notNullable().defaultTo(false);

    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
    t.string('updated_by', 36).nullable(); // employees.id of the admin who last saved this
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('settings');
};
