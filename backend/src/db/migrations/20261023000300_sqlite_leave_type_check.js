'use strict';

// SQLite only. 20260916000100_leave_types_and_day_part.js could not swap the CHECK on
// leave_requests.type here (SQLite cannot ALTER a CHECK), so a local or test database kept the
// original sick/casual/unpaid list and rejected 'personal', 'bereavement' and the rest with a
// 500. Postgres, which production runs, was migrated properly and is left alone.
//
// SQLite's own answer is to build the table again with the corrected definition, copy the rows
// across and swap the names, which is what this does.

const TYPES = ['sick', 'bereavement', 'personal', 'emergency', 'vacation'];

exports.up = async function up(knex) {
  if (knex.client.config.client === 'pg') return;

  const table = await knex('sqlite_master').where({ type: 'table', name: 'leave_requests' }).first();
  if (!table || !table.sql) return;

  // The type column's check, however the quoting happened to be written.
  const typeCheck = /check\s*\(\s*[`"[]?type[`"\]]?\s+in\s*\([^)]*\)\s*\)/i;
  if (!typeCheck.test(table.sql)) return;

  const fixed = table.sql
    .replace(typeCheck, `check (\`type\` in (${TYPES.map((t) => `'${t}'`).join(', ')}))`)
    .replace(/create\s+table\s+[`"]?leave_requests[`"]?/i, 'create table `leave_requests_rebuilt`');

  const indexes = await knex('sqlite_master')
    .where({ type: 'index', tbl_name: 'leave_requests' })
    .whereNotNull('sql')
    .select('sql');

  await knex.raw(fixed);
  await knex.raw('insert into `leave_requests_rebuilt` select * from `leave_requests`');
  await knex.raw('drop table `leave_requests`');
  await knex.raw('alter table `leave_requests_rebuilt` rename to `leave_requests`');
  for (const index of indexes) await knex.raw(index.sql);
};

exports.down = async function down() {
  // Nothing to undo: the corrected list is a superset of what the table accepted before.
};
