'use strict';

// Company branding (name, logo) and the queue of payslip emails.
//
// The logo file itself lives in file storage (local disk or S3/R2), never in the database; the
// settings row only remembers its key, type and when it changed.
//
// payslip_emails keeps one row per employee and month holding the latest send: sending again
// overwrites it, so the screen always shows what happened last. Sending is done by a background
// worker reading this table, which is why a restart in the middle of a bulk send loses nothing.

exports.up = async function up(knex) {
  await knex.schema.table('settings', (t) => {
    t.string('company_name', 120).nullable();
    t.string('logo_key', 255).nullable();
    t.string('logo_content_type', 40).nullable();
    t.bigInteger('logo_updated_at').nullable();
  });

  await knex.schema.createTable('payslip_emails', (t) => {
    t.string('id', 36).primary();
    t.string('employee_id', 36).notNullable().references('id').inTable('employees').onDelete('CASCADE');
    t.string('month', 7).notNullable();
    t.string('to_email', 255).notNullable(); // the address on file when it was queued
    t.string('status', 12).notNullable().defaultTo('queued').checkIn(['queued', 'sending', 'sent', 'failed']);
    t.string('error', 500).nullable();
    t.string('provider_id', 100).nullable(); // the email service's id for the message
    t.integer('attempts').notNullable().defaultTo(0);
    t.string('requested_by', 36).nullable();
    t.bigInteger('created_at').notNullable();
    t.bigInteger('updated_at').notNullable();
    t.bigInteger('sent_at').nullable();

    t.unique(['employee_id', 'month'], { indexName: 'uq_payslip_emails_employee_month' });
    t.index(['status'], 'idx_payslip_emails_status');
    t.index(['month'], 'idx_payslip_emails_month');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('payslip_emails');
  await knex.schema.table('settings', (t) => {
    t.dropColumn('company_name');
    t.dropColumn('logo_key');
    t.dropColumn('logo_content_type');
    t.dropColumn('logo_updated_at');
  });
};
