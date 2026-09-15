'use strict';

// Adds a proof attachment to a leave request — the form now asks for it directly (a doctor's
// note, etc.) instead of the requester having to hand it over some other way. One file per
// request, stored through the same storage abstraction screenshots/audio already use
// (backend/src/storage), keyed as `leave-proof/<employeeId>/<date>/<id>.<ext>`.

exports.up = async function up(knex) {
  await knex.schema.alterTable('leave_requests', (t) => {
    t.string('proof_key', 255).nullable();
    t.string('proof_content_type', 60).nullable();
    t.integer('proof_size_bytes').nullable();
    t.string('proof_original_name', 200).nullable();
    t.boolean('proof_deleted').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('leave_requests', (t) => {
    t.dropColumn('proof_key');
    t.dropColumn('proof_content_type');
    t.dropColumn('proof_size_bytes');
    t.dropColumn('proof_original_name');
    t.dropColumn('proof_deleted');
  });
};
