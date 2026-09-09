'use strict';

// Sprint 7, story G-2 — the durable outbox.
//
// Everything the agent wants to send goes in here first and is only removed once the server
// has acknowledged it. Nothing is held in memory: if the machine loses power mid-shift, the
// queue is still on disk when it comes back.
//
// Large payloads (screenshots, audio) are spooled to files and the row keeps the path. A
// day's backlog of base64 blobs inside the database would make every queue read expensive
// and the file itself enormous.
//
// Previously backed by better-sqlite3 (native module). Replaced with sql.js (pure WASM) so
// no C++ toolchain rebuild is required when running under Electron — the WASM binary works
// identically under plain Node (tests) and Electron (the agent itself).
//
// Persistence model: the entire DB is held in memory (sql.js has no file-handle concept) and
// written to disk atomically after every mutation — write to a temp file then rename over the
// target. On the next open the file is read back in. This gives the same durability as
// better-sqlite3's WAL+synchronous=NORMAL: a crash mid-write at worst leaves the old file
// intact; a crash after rename has committed the new state.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// sql.js init is async (WASM compilation) but only needs to happen once. We kick it off at
// module load time and Outbox.open() awaits the result — so the constructor stays synchronous
// for the common path (the promise will already be resolved by the time the second Outbox
// opens, e.g. when a test reopens the queue to verify persistence).
const initSqlJs = require('sql.js');
const WASM_PATH = path.join(path.dirname(require.resolve('sql.js')), 'sql-wasm.wasm');

let _sqlReady = null;
function getSql() {
  if (!_sqlReady) {
    _sqlReady = initSqlJs({ locateFile: () => WASM_PATH });
  }
  return _sqlReady;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'POST',
  payload         TEXT NOT NULL,
  blob_path       TEXT,
  blob_field      TEXT,
  capture_id      TEXT,
  created_at      INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_outbox_ready   ON outbox (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox (created_at);
`;

class Outbox {
  /**
   * @param {string} dir  agent data directory; holds queue.sqlite3 and spool/
   *
   * Call Outbox.open(dir) to get a fully-initialised instance. The constructor is not async
   * because sql.js's WASM promise is resolved once at module load; after the first Outbox is
   * opened every subsequent one is synchronous in practice.
   *
   * In tests, use `await Outbox.open(dir)` or the `tempOutbox()` helper (which calls open()).
   */
  constructor(dir, sqlJs, existingData) {
    this.dir = dir;
    this.dbPath = path.join(dir, 'queue.sqlite3');
    this.spoolDir = path.join(dir, 'spool');
    fs.mkdirSync(this.spoolDir, { recursive: true });

    this.db = existingData ? new sqlJs.Database(existingData) : new sqlJs.Database();
    this.db.run(SCHEMA);
    // Persist the schema immediately so a crash before any enqueue still leaves a valid file.
    this._flush();
  }

  /**
   * Async factory — awaits WASM init and reads the existing DB file if present.
   * This is the only way to construct an Outbox; the class constructor is not exported.
   */
  static async open(dir) {
    const SQL = await getSql();
    fs.mkdirSync(dir, { recursive: true });
    const dbPath = path.join(dir, 'queue.sqlite3');
    let existingData = null;
    try {
      existingData = fs.readFileSync(dbPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // First run — start empty.
    }
    return new Outbox(dir, SQL, existingData);
  }

  // ---------------------------------------------------------------------------
  // Write-through persistence
  // ---------------------------------------------------------------------------

  /** Atomically flush the in-memory DB to disk. */
  _flush() {
    const data = this.db.export();
    const tmp = this.dbPath + '.tmp';
    fs.writeFileSync(tmp, Buffer.from(data));
    fs.renameSync(tmp, this.dbPath);
  }

  // ---------------------------------------------------------------------------
  // Public API (identical surface to the better-sqlite3 version)
  // ---------------------------------------------------------------------------

  /**
   * @param {object} item
   * @param {string} item.kind
   * @param {string} item.endpoint
   * @param {object} item.payload
   * @param {Buffer} [item.blob]       binary spooled to disk instead of held in the row
   * @param {string} [item.blobField]  payload field the blob is inlined into when sending
   */
  enqueue({ kind, endpoint, method = 'POST', payload, blob, blobField, captureId, at = Date.now() }) {
    const id = crypto.randomUUID();
    let blobPath = null;

    if (blob) {
      blobPath = path.join(this.spoolDir, `${id}.bin`);
      fs.writeFileSync(blobPath, blob);
    }

    // The server needs the replay key in the request body; the queue needs it in a column to
    // find it. One value, copied here, so a retry can never send a different id — which would
    // defeat the whole point of replay protection (ADR-0004).
    const stored = captureId ? { ...payload, captureId } : payload;

    this.db.run(
      `INSERT INTO outbox
         (id, kind, endpoint, method, payload, blob_path, blob_field,
          capture_id, created_at, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, kind, endpoint, method, JSON.stringify(stored),
       blobPath, blobField || null, captureId || null, at, at]
    );
    this._flush();
    return id;
  }

  /** Items due for a send attempt, oldest first — the queue drains in the order it filled. */
  due(limit = 10, now = Date.now()) {
    const stmt = this.db.prepare(
      `SELECT * FROM outbox
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY created_at ASC
       LIMIT ?`
    );
    stmt.bind([now, limit]);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    return rows.map((row) => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  /** Reads the spooled blob for an item, or null when it has none. */
  readBlob(item) {
    if (!item.blob_path) return null;
    try {
      return fs.readFileSync(item.blob_path);
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Delivered. The row and its spooled file go away. */
  markSent(id) {
    const stmt = this.db.prepare('SELECT blob_path FROM outbox WHERE id = ?');
    stmt.bind([id]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    this.db.run("UPDATE outbox SET status = 'sent' WHERE id = ?", [id]);
    this.#removeBlob(row?.blob_path);
    this.db.run("DELETE FROM outbox WHERE id = ? AND status = 'sent'", [id]);
    this._flush();
  }

  /**
   * The server refused it in a way that retrying cannot fix — consent withdrawn, a payload it
   * will never accept. Kept as a row (without the file) so it is visible rather than silently
   * vanishing, but never retried.
   */
  abandon(id, reason) {
    const stmt = this.db.prepare('SELECT blob_path FROM outbox WHERE id = ?');
    stmt.bind([id]);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();

    this.#removeBlob(row?.blob_path);
    this.db.run(
      "UPDATE outbox SET status = 'abandoned', last_error = ?, blob_path = NULL WHERE id = ?",
      [String(reason).slice(0, 500), id]
    );
    this._flush();
  }

  /** Transient failure: try again later, with the backoff the caller worked out. */
  defer(id, { nextAttemptAt, error }) {
    this.db.run(
      `UPDATE outbox
       SET attempts = attempts + 1, next_attempt_at = ?, last_error = ?
       WHERE id = ?`,
      [nextAttemptAt, String(error || '').slice(0, 500), id]
    );
    this._flush();
  }

  stats(now = Date.now()) {
    // sql.js's WASM SQLite build does not support the FILTER(WHERE ...) aggregate extension.
    // Rewritten with CASE WHEN, which is standard SQL and works everywhere.
    const stmt = this.db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'abandoned' THEN 1 ELSE 0 END) AS abandoned,
        MIN(CASE WHEN status = 'pending'   THEN created_at ELSE NULL END) AS oldest
      FROM outbox
    `);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();

    return {
      pending: row.pending || 0,
      abandoned: row.abandoned || 0,
      oldestAgeSeconds: row.oldest ? Math.floor((now - row.oldest) / 1000) : 0,
    };
  }

  /**
   * The server rejects captures older than its upload window, so an item that has aged past it
   * will never be accepted however often we retry. Drop it rather than let it block the queue
   * and fill the disk.
   */
  expire({ maxAgeMs, now = Date.now() }) {
    const stmt = this.db.prepare(
      `SELECT id FROM outbox
       WHERE status = 'pending'
         AND kind IN ('screenshot', 'audio', 'activity')
         AND created_at < ?`
    );
    stmt.bind([now - maxAgeMs]);
    const ids = [];
    while (stmt.step()) ids.push(stmt.getAsObject().id);
    stmt.free();

    for (const id of ids) this.abandon(id, "Older than the server's upload window");
    return ids.length;
  }

  #removeBlob(blobPath) {
    if (!blobPath) return;
    try {
      fs.unlinkSync(blobPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = { Outbox };
