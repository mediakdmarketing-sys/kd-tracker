'use strict';

// Platform-owner tooling: who did what on the platform, two-factor sign-in for the owner,
// support staff, plans and trials, announcements and custom domains.

exports.up = async (knex) => {
  await knex.schema.alterTable('employees', (t) => {
    // 'support' = limited platform staff; null with is_super_admin = a full owner.
    t.string('platform_role', 20).nullable();
    t.string('totp_secret', 64).nullable();
    t.boolean('totp_enabled').notNullable().defaultTo(false);
    t.bigInteger('totp_last_step').nullable();
    t.text('totp_recovery').nullable();
  });

  await knex.schema.alterTable('companies', (t) => {
    t.boolean('is_internal').notNullable().defaultTo(false);
    t.string('plan', 20).notNullable().defaultTo('pro');
    t.bigInteger('trial_ends_at').nullable();
    t.boolean('auto_suspend').notNullable().defaultTo(true);
    t.text('billing_note').nullable();
    t.string('custom_domain', 255).nullable();
    t.boolean('custom_domain_verified').notNullable().defaultTo(false);
  });
  await knex.schema.alterTable('companies', (t) => {
    t.unique(['custom_domain'], { indexName: 'uq_companies_custom_domain' });
  });

  await knex.schema.createTable('platform_audit_logs', (t) => {
    t.string('id', 36).primary();
    t.string('actor_id', 36).nullable();
    t.string('actor_name', 200).nullable();
    t.string('action', 80).notNullable();
    // Kept as plain text: the company may be deleted later, the record must survive it.
    t.string('company_id', 36).nullable();
    t.string('company_name', 200).nullable();
    t.text('details').nullable();
    t.string('ip_address', 64).nullable();
    t.bigInteger('timestamp').notNullable();
    t.index(['timestamp'], 'idx_platform_audit_time');
    t.index(['company_id'], 'idx_platform_audit_company');
  });

  await knex.schema.createTable('announcements', (t) => {
    t.string('id', 36).primary();
    t.text('message').notNullable();
    t.string('level', 10).notNullable().defaultTo('info');
    t.bigInteger('starts_at').notNullable();
    t.bigInteger('ends_at').nullable();
    t.string('created_by', 36).nullable();
    t.bigInteger('created_at').notNullable();
    t.index(['starts_at'], 'idx_announcements_start');
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('announcements');
  await knex.schema.dropTableIfExists('platform_audit_logs');
};
