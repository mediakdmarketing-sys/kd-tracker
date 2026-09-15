'use strict';

// Replaces the v1 placeholder leave types (sick/casual/unpaid) with the real categories from
// the company's leave request form, and adds a day-part field (full day vs. half day AM/PM) —
// both were missing fields the form has that the app didn't yet capture. "Unpaid" is no longer
// a type someone picks: per policy, sick/bereavement/emergency leave taken without proof is
// just treated as no-pay after the fact, so it's a review-time note (review_note), not a type.

exports.up = async function up(knex) {
  const isPg = knex.client.config.client === 'pg';

  // 1. Widen `type` (old values were <= 6 chars; keep some headroom) and swap the CHECK.
  //    SQLite can't ALTER a CHECK on an existing column — same limitation noted in
  //    20260203000100_department_leaders.js — so it's app-enforced there via zod.
  await knex.schema.alterTable('leave_requests', (t) => {
    t.string('type', 20).notNullable().alter();
  });

  if (isPg) {
    await knex.raw(`
      ALTER TABLE leave_requests
        DROP CONSTRAINT IF EXISTS leave_requests_type_check
    `);
    await knex.raw(`
      ALTER TABLE leave_requests
        ADD CONSTRAINT leave_requests_type_check
        CHECK (type IN ('sick', 'bereavement', 'personal', 'emergency', 'vacation'))
    `);
  }

  // 2. day_part — whole-day leave still dominates, so it defaults there rather than forcing
  //    a backfill decision for existing rows.
  await knex.schema.alterTable('leave_requests', (t) => {
    t.string('day_part', 10).notNullable().defaultTo('full');
  });

  if (isPg) {
    await knex.raw(`
      ALTER TABLE leave_requests
        ADD CONSTRAINT leave_requests_day_part_check
        CHECK (day_part IN ('full', 'half_am', 'half_pm'))
    `);
  }
};

exports.down = async function down(knex) {
  const isPg = knex.client.config.client === 'pg';

  if (isPg) {
    await knex.raw(`
      ALTER TABLE leave_requests
        DROP CONSTRAINT IF EXISTS leave_requests_day_part_check
    `);
  }
  await knex.schema.alterTable('leave_requests', (t) => {
    t.dropColumn('day_part');
  });

  if (isPg) {
    await knex.raw(`
      ALTER TABLE leave_requests
        DROP CONSTRAINT IF EXISTS leave_requests_type_check
    `);
    await knex.raw(`
      ALTER TABLE leave_requests
        ADD CONSTRAINT leave_requests_type_check
        CHECK (type IN ('sick', 'casual', 'unpaid'))
    `);
  }
};
