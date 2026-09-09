'use strict';

// Closes a real race in attendance.service.js's punchIn(): the check-then-insert
// ("does an open shift exist? no -> insert one") happens inside a transaction, but SQLite's
// default transaction is DEFERRED — it does not take a write lock until the first write
// statement runs. Two punch-in requests landing close together (a double-click before the UI
// disables the button, a client retry, an agent and the web portal racing) can both execute
// their SELECT before either INSERTs, and both would then succeed: two 'open' shift rows for
// the same employee.
//
// A partial unique index is the same syntax on SQLite and Postgres (ADR-0001) and makes the
// invariant "at most one open/on_break shift per employee" a database guarantee rather than
// an application-level hope. The service catches the resulting unique-violation and turns it
// into the same 409 the non-concurrent path already returns.

exports.up = async function up(knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX idx_one_open_shift_per_employee
    ON attendance (employee_id)
    WHERE status IN ('open', 'on_break')
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX idx_one_open_shift_per_employee');
};
