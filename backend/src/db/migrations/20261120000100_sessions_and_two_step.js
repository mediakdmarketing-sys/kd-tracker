'use strict';

// Account security:
//   sessions      one row per sign-in, so a person can see where they are signed in and end any of
//                 them. A refresh token belongs to a session; the session survives token rotation.
//   login_events  every sign-in attempt on a real account (the good ones and the bad), with the
//                 device, so "new device" can be spotted and the history shown.
//   employees     two-step sign-in (an authenticator app): the encrypted secret, when it was
//                 switched on, the last code step used (a code works once), and the hashed
//                 recovery codes.
//   settings      whether admins must use two-step sign-in.

exports.up = async function up(knex) {
  await knex.schema.createTable('sessions', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('client', 40).nullable(); // web | desktop | chromeos | android
    t.string('ip', 64).nullable();
    t.string('user_agent', 255).nullable();
    t.string('device_label', 120).nullable(); // "Chrome on Windows"
    t.string('device_hash', 64).nullable();
    t.boolean('second_factor').notNullable().defaultTo(false);
    t.bigInteger('created_at').notNullable();
    t.bigInteger('last_seen_at').notNullable();
    t.bigInteger('revoked_at').nullable();
    t.string('revoked_reason', 30).nullable(); // logout | signed_out_other | admin | security | password
    t.index(['employee_id', 'revoked_at'], 'idx_sessions_employee');
  });

  await knex.schema.createTable('login_events', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.bigInteger('at').notNullable();
    t.string('result', 20).notNullable(); // success | bad_password | bad_code | locked | deactivated
    t.string('client', 40).nullable();
    t.string('ip', 64).nullable();
    t.string('user_agent', 255).nullable();
    t.string('device_label', 120).nullable();
    t.string('device_hash', 64).nullable();
    t.boolean('new_device').notNullable().defaultTo(false);
    t.boolean('second_factor').notNullable().defaultTo(false);
    t.string('session_id', 36).nullable();
    t.index(['employee_id', 'at'], 'idx_login_events_employee');
  });

  await knex.schema.table('refresh_tokens', (t) => {
    t.string('session_id', 36).nullable();
    t.index(['session_id'], 'idx_refresh_session');
  });

  await knex.schema.table('employees', (t) => {
    t.text('totp_secret').nullable(); // encrypted; present while setting up and once enabled
    t.bigInteger('totp_enabled_at').nullable(); // null until the first code has been confirmed
    t.bigInteger('totp_last_step').nullable(); // the newest 30-second step already used
    t.text('recovery_codes').nullable(); // JSON [{ hash, usedAt }]
  });

  await knex.schema.table('settings', (t) => {
    t.boolean('require_admin_2fa').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('settings', (t) => t.dropColumn('require_admin_2fa'));
  await knex.schema.table('employees', (t) => {
    t.dropColumn('totp_secret');
    t.dropColumn('totp_enabled_at');
    t.dropColumn('totp_last_step');
    t.dropColumn('recovery_codes');
  });
  await knex.schema.table('refresh_tokens', (t) => {
    t.dropIndex(['session_id'], 'idx_refresh_session');
    t.dropColumn('session_id');
  });
  await knex.schema.dropTableIfExists('login_events');
  await knex.schema.dropTableIfExists('sessions');
};
