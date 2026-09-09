# ADR-0001 — SQLite first, PostgreSQL later, without a rewrite

**Status:** Accepted (Sprint 0)

## Context

The dev documentation specifies PostgreSQL. For the build phase we want zero infrastructure:
no container, no server, no credentials — clone, `npm install`, run. SQLite 3 gives us that.
But the production target is still Postgres, and "we'll port it later" usually means "we'll
rewrite the data layer later".

## Decision

Use **Knex** as the only path to the database, and keep the schema in the intersection of what
SQLite and Postgres both support.

Concretely:

1. **One config switch.** `DB_CLIENT` selects `better-sqlite3` or `pg`. No other file knows
   which database is in use.
2. **No dialect-specific SQL.** No `INTERVAL`, no `NOW()`, no `ON CONFLICT ... RETURNING`, no
   `uuid_generate_v4()`. Date arithmetic happens in JavaScript, not in SQL.
3. **UUIDs generated in the application** (`crypto.randomUUID()`), stored as `CHAR(36)`. Works
   identically on both; a later migration to Postgres `uuid` is a type change, not a data change.
4. **Timestamps as epoch-milliseconds integers**, dates as `YYYY-MM-DD` text. This is the one
   deliberate deviation from the spec's `TIMESTAMP`/`DATE` column types.
5. **Enums as `VARCHAR` + a CHECK constraint.** SQLite has no `ENUM`; Postgres enums are
   painful to alter. A check constraint behaves the same on both.
6. **Booleans via Knex's `boolean()`**, always read back through `toBool()` — SQLite returns
   `0`/`1`, Postgres returns `true`/`false`, and the API must not expose that difference.
7. **No cross-database transactions or long-held write transactions**, because SQLite
   serialises writers. WAL mode is on; write transactions stay short.

## Why epoch-milliseconds rather than TIMESTAMP

Knex's SQLite dialect returns timestamp columns as strings under `sqlite3` and as numbers under
`better-sqlite3`; Postgres returns `Date` objects, in the server's timezone unless told
otherwise. Chasing that difference through every query is a steady source of off-by-one-day
reporting bugs. An integer is an integer everywhere, needs no timezone, and sorts and ranges
correctly. `attendance.date` stays a separate `YYYY-MM-DD` text column so daily grouping is a
plain `GROUP BY` on both engines.

The cost is that ad-hoc SQL against the DB shows numbers rather than readable dates. Accepted:
reporting goes through the API, and the migration to Postgres can add a generated
`timestamptz` column if DBAs want one.

## Migration path to PostgreSQL

1. Point `DATABASE_URL` at Postgres and set `DB_CLIENT=pg`.
2. `npm run db:migrate` — the same migration files run; Knex emits Postgres DDL.
3. `npm run db:export` / `db:import` moves rows across (row shapes are identical).
4. Optional hardening once on Postgres: convert `CHAR(36)` → `uuid`, add partial indexes on
   `attendance(employee_id) WHERE punch_out IS NULL`, move the purge job to a Postgres cron.

None of these steps touch application code.

## Consequences

- We give up Postgres-only features during the build: JSONB operators, materialised views,
  `INTERVAL` arithmetic, full-text search. None are needed for the current backlog.
- Concurrency ceiling: SQLite handles one writer at a time. At 60 employees uploading every
  5–10 minutes that is roughly one write every few seconds — comfortably inside SQLite's range,
  but it is the reason to move to Postgres before scaling headcount, not a reason to stay.
- Every developer gets an identical database in one command, which is worth more during the
  build than the features we deferred.
