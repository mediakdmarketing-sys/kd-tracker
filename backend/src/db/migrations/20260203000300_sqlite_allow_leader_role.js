'use strict';

// SQLite does enforce the CHECK from 20260101000100_create_employees.js
// (role IN ('admin','user')), so assigning a department leader failed with
// "CHECK constraint failed: role". 20260203000100 only patched Postgres.
//
// SQLite cannot ALTER a CHECK, so we rebuild the table using the procedure from
// https://sqlite.org/lang_altertable.html#otheralter : create the new table, copy rows, drop
// the old one, rename, recreate indexes. Foreign keys must be OFF while doing this (the PRAGMA
// is a no-op inside a transaction, hence `transaction: false` and the manual transaction).
// Other tables reference employees by name, so they pick up the rebuilt table unchanged.
// Postgres is already handled by 20260203000100.

exports.config = { transaction: false };

const OLD = "check (`role` in ('admin','user'))";
const NEW = "check (`role` in ('admin','leader','user'))";

async function rebuild(knex, from, to) {
  const table = await knex('sqlite_master').where({ type: 'table', name: 'employees' }).first('sql');
  if (!table || !table.sql.includes(from)) return; // already migrated

  const indexes = await knex('sqlite_master')
    .where({ type: 'index', tbl_name: 'employees' })
    .whereNotNull('sql')
    .select('sql');

  await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.transaction(async (trx) => {
      await trx.raw(table.sql.replace('CREATE TABLE `employees`', 'CREATE TABLE `employees__new`').replace(from, to));
      await trx.raw('INSERT INTO `employees__new` SELECT * FROM `employees`');
      await trx.raw('DROP TABLE `employees`');
      await trx.raw('ALTER TABLE `employees__new` RENAME TO `employees`');
      for (const { sql } of indexes) await trx.raw(sql);

      const violations = await trx.raw('PRAGMA foreign_key_check');
      if (violations.length) throw new Error('foreign_key_check failed after rebuilding employees');
    });
  } finally {
    await knex.raw('PRAGMA foreign_keys = ON');
  }
}

exports.up = async function up(knex) {
  if (knex.client.config.client !== 'better-sqlite3') return;
  await rebuild(knex, OLD, NEW);
};

exports.down = async function down(knex) {
  if (knex.client.config.client !== 'better-sqlite3') return;
  await rebuild(knex, NEW, OLD);
};
