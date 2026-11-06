'use strict';

// Remembers what was sent, so a payslip sent again can say DUPLICATE.
//
// payslip_emails keeps one row per employee and month and a new send overwrites its status, so the
// history that must survive a re-send lives in two extra columns: how many times it was delivered,
// and a fingerprint of the payslip's figures at the last delivery. A repeat of the SAME figures is
// a duplicate; a payslip whose figures changed since (a correction) is a different payslip.

exports.up = async function up(knex) {
  await knex.schema.table('payslip_emails', (t) => {
    t.integer('times_sent').notNullable().defaultTo(0);
    t.string('last_sent_digest', 64).nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.table('payslip_emails', (t) => {
    t.dropColumn('times_sent');
    t.dropColumn('last_sent_digest');
  });
};
