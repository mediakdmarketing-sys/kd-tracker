'use strict';

const { migrate, truncate } = require('./helpers');
const { db, destroy } = require('../src/db');
const { runJob, lastRuns } = require('../src/jobs/jobRunner');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

describe('runJob', () => {
  it('records a successful run with its result', async () => {
    const result = await runJob('demo', async () => ({ affected: 3, note: 'ok' }));

    expect(result).toEqual({ affected: 3, note: 'ok' });
    const row = await db()('job_runs').where({ job_name: 'demo' }).first();
    expect(row.status).toBe('success');
    expect(row.affected_count).toBe(3);
    expect(JSON.parse(row.details)).toEqual({ affected: 3, note: 'ok' });
  });

  it('re-throws a failure and still records it', async () => {
    await expect(runJob('demo', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

    const row = await db()('job_runs').where({ job_name: 'demo' }).first();
    expect(row.status).toBe('failed');
    expect(JSON.parse(row.details).message).toBe('boom');
  });

  // Regression: a partial-failure error (retention.job.js's purge(), which attaches exactly
  // what succeeded and what didn't via err.details/err.partialResult) used to have that
  // information silently dropped — the stored row kept only the generic message and stack,
  // leaving an operator unable to tell which files failed without digging through logs.
  it('preserves details and partialResult from a partial-failure error', async () => {
    await expect(
      runJob('purge', async () => {
        const err = new Error('Retention purge could not delete 2 file(s).');
        err.details = [{ id: 'a', message: 'ENOENT' }, { id: 'b', message: 'EACCES' }];
        err.partialResult = { affected: 5, screenshots: { deleted: 5 } };
        throw err;
      })
    ).rejects.toThrow(/could not delete/);

    const row = await db()('job_runs').where({ job_name: 'purge' }).first();
    expect(row.status).toBe('failed');
    // The partial success count is surfaced on the row itself, not buried in the JSON blob.
    expect(row.affected_count).toBe(5);
    const details = JSON.parse(row.details);
    expect(details.details).toHaveLength(2);
    expect(details.partialResult.screenshots.deleted).toBe(5);
  });

  it('lastRuns reports only the most recent run per job', async () => {
    await runJob('purge', async () => ({ affected: 1 }));
    await runJob('purge', async () => ({ affected: 2 }));
    await runJob('payroll', async () => ({ affected: 10 }));

    const runs = await lastRuns();
    const purgeRun = runs.find((r) => r.job === 'purge');
    expect(purgeRun.affectedCount).toBe(2);
    expect(runs.filter((r) => r.job === 'purge')).toHaveLength(1);
  });
});
