'use strict';

// Single source of Knex configuration, shared by the runtime and the migration CLI.
// Swapping SQLite -> Postgres happens here and nowhere else (see docs/adr/0001).

const path = require('path');
const config = require('./src/config');

const migrations = {
  directory: path.join(__dirname, 'src', 'db', 'migrations'),
  tableName: 'knex_migrations',
};

const seeds = {
  directory: path.join(__dirname, 'src', 'db', 'seeds'),
};

const sqlite = {
  client: 'better-sqlite3',
  connection: {
    filename: config.isTest ? ':memory:' : config.db.sqliteFile,
  },
  // SQLite has no DEFAULT for missing insert values; Knex requires this acknowledgement.
  useNullAsDefault: true,
  // SQLite serialises writers: a single connection avoids SQLITE_BUSY entirely.
  pool: {
    min: 1,
    max: 1,
    afterCreate(conn, done) {
      try {
        conn.pragma('journal_mode = WAL');
        conn.pragma('foreign_keys = ON');
        conn.pragma('busy_timeout = 5000');
        done(null, conn);
      } catch (err) {
        done(err, conn);
      }
    },
  },
  migrations,
  seeds,
};

// On Vercel (or any serverless runtime) each function instance handles one request at a
// time and may be frozen between invocations, so a large pool just exhausts the Supabase
// pooler's client slots. One connection per warm instance, released quickly when idle.
const serverless = !!process.env.VERCEL || process.env.SERVERLESS === '1';

const postgres = {
  client: 'pg',
  connection: {
    connectionString: config.db.url,
    ssl: { rejectUnauthorized: false },
    family: 4,
  },
  pool: serverless
    ? { min: 0, max: 1, idleTimeoutMillis: 10000, acquireTimeoutMillis: 15000 }
    : { min: 2, max: 10 },
  migrations,
  seeds,
};

const active = config.db.client === 'pg' ? postgres : sqlite;

module.exports = {
  development: active,
  test: active,
  production: active,
  // Named exports so tooling can reach either explicitly.
  sqlite,
  postgres,
};
