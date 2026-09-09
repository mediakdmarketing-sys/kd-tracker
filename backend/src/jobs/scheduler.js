'use strict';

const cron = require('node-cron');
const config = require('../config');
const logger = require('../utils/logger');
const { runJob } = require('./jobRunner');
const { purge } = require('./retention.job');
const { closeStaleShifts } = require('./closeShifts.job');
const payrollService = require('../modules/payroll/payroll.service');
const t = require('../utils/time');

const tasks = [];

/**
 * In-process scheduler. Fine for a single API instance, which is what SQLite implies anyway
 * (ADR-0001). With more than one instance, set ENABLE_SCHEDULER=false and drive the jobs
 * from system cron via `npm run job:*`, or every instance will run the same purge.
 */
function start() {
  if (!config.jobs.enabled) {
    logger.info('Scheduler disabled (ENABLE_SCHEDULER=false)');
    return [];
  }

  const register = (name, expression, fn) => {
    if (!cron.validate(expression)) {
      logger.error(`Invalid cron expression for ${name}; job not scheduled`, { expression });
      return;
    }
    // A throwing job must not take the API process down with it.
    tasks.push(
      cron.schedule(expression, () => {
        runJob(name, fn).catch((err) => logger.error(`Scheduled job ${name} failed`, { message: err.message }));
      })
    );
    logger.info(`Scheduled job: ${name}`, { expression });
  };

  register('purge', config.jobs.purgeCron, () => purge());
  register('close-shifts', config.jobs.closeShiftsCron, () => closeStaleShifts());
  register('payroll', config.jobs.payrollCron, async () => {
    // Runs on the 1st, so the month to close is the previous one.
    const month = t.previousMonth();
    const result = await payrollService.generate({ month });
    return { ...result, affected: result.employeesProcessed };
  });

  return tasks;
}

function stop() {
  tasks.forEach((task) => task.stop());
  tasks.length = 0;
}

module.exports = { start, stop };
