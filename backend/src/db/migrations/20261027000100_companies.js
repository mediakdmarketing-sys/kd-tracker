'use strict';

// Several companies on one deployment.
//
// A company owns its employees, departments and settings; everything else (attendance,
// captures, leave, notifications...) belongs to an employee and so to that employee's company.
// Each company also has switches for what the platform owner has allowed it to use, so one
// company can be "time tracking only" while another also gets screenshots and microphone
// samples.
//
// Everything that exists today becomes the first company. Its id is fixed and is also the
// column default, so a row inserted without a company (older code, tests, scripts) lands there
// rather than in nowhere, and the existing data needs no backfill statement at all.

const DEFAULT_COMPANY_ID = '00000000-0000-4000-8000-000000000001';

exports.up = async function up(knex) {
  const isPg = knex.client.config.client === 'pg';

  await knex.schema.createTable('companies', (t) => {
    t.string('id', 36).primary();
    t.string('name', 200).notNullable();
    t.string('slug', 60).notNullable().unique();
    t.string('status', 20).notNullable().defaultTo('active'); // 'active' | 'suspended'

    // What the platform owner has switched on. Basic time tracking (punch in/out, breaks,
    // attendance) is always available and has no switch.
    t.boolean('feature_screen_capture').notNullable().defaultTo(true);
    t.boolean('feature_audio_capture').notNullable().defaultTo(true);
    t.boolean('feature_idle_tracking').notNullable().defaultTo(true);
    t.boolean('feature_payroll').notNullable().defaultTo(true);
    t.boolean('feature_leave').notNullable().defaultTo(true);
    // The company's clock: its days, months and "today" are measured in this zone.
    // Plan limits set by the platform owner. Null means no limit.
    t.bigInteger('storage_limit_bytes').nullable();
    t.integer('max_employees').nullable();
    t.string('timezone', 64).notNullable().defaultTo(require('../../config').timezone);

    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
  });

  const now = Date.now();
  await knex('companies').insert({
    id: DEFAULT_COMPANY_ID,
    name: process.env.DEFAULT_COMPANY_NAME || 'KD Marketing',
    slug: 'default',
    status: 'active',
    created_at: now,
    updated_at: now,
  });

  await knex.schema.alterTable('employees', (t) => {
    t.string('company_id', 36).notNullable().defaultTo(DEFAULT_COMPANY_ID);
    // The platform owner. Belongs to a company like anyone else, but can also manage companies.
    t.boolean('is_super_admin').notNullable().defaultTo(false);
    t.index(['company_id'], 'idx_employees_company');
  });

  // Departments are named per company: two companies may both have a "Sales".
  await knex.schema.alterTable('departments', (t) => {
    t.string('company_id', 36).notNullable().defaultTo(DEFAULT_COMPANY_ID);
    t.dropUnique(['name']);
  });
  await knex.schema.alterTable('departments', (t) => {
    t.unique(['company_id', 'name'], { indexName: 'uq_departments_company_name' });
  });

  // One settings row per company (the existing row becomes the first company's).
  await knex.schema.alterTable('settings', (t) => {
    t.string('company_id', 36).notNullable().defaultTo(DEFAULT_COMPANY_ID);
  });
  await knex.schema.alterTable('settings', (t) => {
    t.unique(['company_id'], { indexName: 'uq_settings_company' });
  });

  // App productivity rules: the company-wide ones and the per-department ones. Department rules
  // are keyed by the department's name, so they need the company as well.
  await knex.schema.alterTable('app_categories', (t) => {
    t.string('company_id', 36).notNullable().defaultTo(DEFAULT_COMPANY_ID);
    t.dropUnique(['app_key']);
  });
  await knex.schema.alterTable('app_categories', (t) => {
    t.unique(['company_id', 'app_key'], { indexName: 'uq_app_categories_company' });
  });
  await knex.schema.alterTable('app_department_categories', (t) => {
    t.string('company_id', 36).notNullable().defaultTo(DEFAULT_COMPANY_ID);
    t.dropUnique(['app_key', 'department'], 'uq_app_dept_categories');
  });
  await knex.schema.alterTable('app_department_categories', (t) => {
    t.unique(['company_id', 'app_key', 'department'], { indexName: 'uq_app_dept_categories_company' });
  });

  if (isPg) {
    // SQLite cannot add a foreign key to an existing table; Postgres (production) can.
    for (const table of ['employees', 'departments', 'settings', 'app_categories', 'app_department_categories']) {
      await knex.raw(
        `ALTER TABLE ${table} ADD CONSTRAINT ${table}_company_fk FOREIGN KEY (company_id) REFERENCES companies(id)`
      );
    }
  }
};

exports.down = async function down(knex) {
  // Going back to one company cannot be done without choosing which company's rows survive,
  // so this only removes the structure that is safe to remove.
  await knex.schema.dropTableIfExists('companies');
};
