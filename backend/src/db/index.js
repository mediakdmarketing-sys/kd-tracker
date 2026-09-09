'use strict';

const knexFactory = require('knex');
const config = require('../config');
const knexConfig = require('../../knexfile');

let instance = null;

/** The one database handle for the process. Everything else imports this. */
function db() {
  if (!instance) {
    instance = knexFactory(knexConfig[config.env] || knexConfig.development);
  }
  return instance;
}

async function destroy() {
  if (instance) {
    await instance.destroy();
    instance = null;
  }
}

/**
 * Run a function inside a transaction.
 *
 * Kept deliberately thin and short-lived: SQLite allows a single writer, so a transaction
 * that awaits network I/O blocks every other write in the process (ADR-0001).
 */
async function transaction(fn) {
  return db().transaction(fn);
}

/**
 * Unique-constraint violations carry different shapes per driver: SQLite raises
 * `SQLITE_CONSTRAINT_UNIQUE`, Postgres uses SQLSTATE 23505. Idempotent inserts need to
 * recognise both without knowing which engine is in use (ADR-0001).
 */
function isUniqueViolation(err) {
  if (!err) return false;
  return (
    err.code === '23505' ||
    String(err.code || '').startsWith('SQLITE_CONSTRAINT') ||
    /unique constraint|duplicate key/i.test(err.message || '')
  );
}

module.exports = { db, destroy, transaction, isUniqueViolation };
