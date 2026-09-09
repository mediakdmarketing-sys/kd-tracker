'use strict';

const { db } = require('../db');
const { uuid } = require('../utils/ids');
const { now } = require('../utils/time');
const logger = require('../utils/logger');

/**
 * Wraps a job so every run leaves a row in `job_runs`.
 *
 * Story P-5: a purge that silently stops running is a broken retention promise that nobody
 * notices for a month. The row is what an alert can be built on ("no successful purge in the
 * last 48 hours"), and failures are re-thrown so a cron wrapper sees a non-zero exit.
 */
async function runJob(name, fn) {
  const id = uuid();
  const startedAt = now();

  await db()('job_runs').insert({ id, job_name: name, started_at: startedAt, status: 'running' });
  logger.info(`Job started: ${name}`, { jobRunId: id });

  try {
    const result = (await fn()) || {};
    await db()('job_runs').where({ id }).update({
      finished_at: now(),
      status: 'success',
      affected_count: result.affected ?? null,
      details: JSON.stringify(result),
    });
    logger.info(`Job finished: ${name}`, { jobRunId: id, durationMs: now() - startedAt, ...result });
    return result;
  } catch (err) {
    // retention.job.js's purge() (and anything else that fails partway through a batch)
    // attaches exactly what succeeded and what didn't via `err.details`/`err.partialResult` —
    // the whole point of a *loud, informative* failure (story P-5). Dropping those here and
    // keeping only the message would leave an operator staring at "could not delete 3 files"
    // with no way to tell which three without reading server logs from the moment it ran.
    await db()('job_runs').where({ id }).update({
      finished_at: now(),
      status: 'failed',
      affected_count: err.partialResult?.affected ?? null,
      details: JSON.stringify({
        message: err.message,
        stack: err.stack,
        details: err.details,
        partialResult: err.partialResult,
      }),
    });
    logger.error(`Job failed: ${name}`, { jobRunId: id, message: err.message });
    throw err;
  }
}

/** Last run of each job — for a health endpoint or an external monitor. */
async function lastRuns() {
  const rows = await db()('job_runs').orderBy('started_at', 'desc').limit(50);
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.job_name)) {
      seen.set(r.job_name, {
        job: r.job_name,
        status: r.status,
        startedAt: new Date(Number(r.started_at)).toISOString(),
        finishedAt: r.finished_at ? new Date(Number(r.finished_at)).toISOString() : null,
        affectedCount: r.affected_count,
      });
    }
  }
  return [...seen.values()];
}

module.exports = { runJob, lastRuns };
