'use strict';

const settings = require('../services/settings');
const { db } = require('../db');
const { storage } = require('../storage');
const t = require('../utils/time');
const logger = require('../utils/logger');

/**
 * Spec 6.4 / story P-3 — the 31-day purge.
 *
 * Deletes the *file* and keeps the row. The order matters: file first, then null the URL.
 * A crash between the two leaves a row pointing at a missing file, which the next run
 * cleans up. The reverse order would leave a file on disk that no row references — a file
 * we promised to delete and can no longer find.
 */
async function purgeTable({ table, urlColumn, timeColumn, cutoff, companyId }) {
  // Optionally limited to one company's employees, each of which keeps its own retention days.
  const scope = (query) =>
    companyId
      ? query.whereIn('employee_id', db()('employees').where({ company_id: companyId }).select('id'))
      : query;
  const rows = await scope(db()(table))
    .where(timeColumn, '<', cutoff)
    .andWhere({ file_deleted: false })
    .whereNotNull(urlColumn)
    .select('id', urlColumn);

  let deleted = 0;
  const failures = [];

  for (const row of rows) {
    try {
      await storage().remove(row[urlColumn]);
      await db()(table).where({ id: row.id }).update({ [urlColumn]: null, file_deleted: true });
      deleted += 1;
    } catch (err) {
      // One unreadable object must not stop the rest of the purge.
      failures.push({ id: row.id, key: row[urlColumn], message: err.message });
      logger.error(`Purge failed for ${table} row`, { id: row.id, message: err.message });
    }
  }

  // Rows whose file was already gone (e.g. removed by an S3 lifecycle rule) still need their
  // metadata marked, or they are re-examined on every future run.
  const orphans = await scope(db()(table))
    .where(timeColumn, '<', cutoff)
    .andWhere({ file_deleted: false })
    .whereNull(urlColumn)
    .update({ file_deleted: true });

  return { table, candidates: rows.length, deleted, orphansMarked: orphans, failures };
}

const sum = (a, b) => ({
  table: a.table,
  candidates: a.candidates + b.candidates,
  deleted: a.deleted + b.deleted,
  orphansMarked: a.orphansMarked + b.orphansMarked,
  failures: [...a.failures, ...b.failures],
});

/**
 * Deletes expired files, company by company, each by its own retention days. An explicit `days`
 * overrides every company's setting.
 */
async function purge({ days, at = t.now() } = {}) {
  const companyIds = await db()('companies').pluck('id');
  let screenshots = { table: 'screenshots', candidates: 0, deleted: 0, orphansMarked: 0, failures: [] };
  let audio = { table: 'audio_recordings', candidates: 0, deleted: 0, orphansMarked: 0, failures: [] };
  let usedDays = days;
  let cutoff = t.daysAgo(days || settings.get().retention.days, at);

  for (const companyId of companyIds) {
    await settings.ensure(companyId);
    const companyDays = days || settings.get(companyId).retention.days;
    if (!usedDays) usedDays = companyDays;
    cutoff = t.daysAgo(companyDays, at);
    screenshots = sum(
      screenshots,
      await purgeTable({ table: 'screenshots', urlColumn: 'image_url', timeColumn: 'captured_at', cutoff, companyId })
    );
    audio = sum(
      audio,
      await purgeTable({ table: 'audio_recordings', urlColumn: 'file_url', timeColumn: 'recorded_at', cutoff, companyId })
    );
  }
  days = usedDays || settings.get().retention.days;

  const failures = [...screenshots.failures, ...audio.failures];
  const result = {
    retentionDays: days,
    cutoff: new Date(cutoff).toISOString(),
    screenshots: { ...screenshots, failures: screenshots.failures.length },
    audio: { ...audio, failures: audio.failures.length },
    affected: screenshots.deleted + audio.deleted,
  };

  // Loud failure (story P-5): a partial purge is a retention breach, not a warning.
  if (failures.length) {
    const err = new Error(
      `Retention purge could not delete ${failures.length} file(s). Retention is not satisfied until these succeed.`
    );
    err.details = failures.slice(0, 20);
    err.partialResult = result;
    throw err;
  }

  return result;
}

module.exports = { purge, purgeTable };
