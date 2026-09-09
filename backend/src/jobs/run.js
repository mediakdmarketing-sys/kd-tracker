'use strict';

// Manual/cron entry point:  npm run job:purge | job:payroll | job:close-shifts
// Exits non-zero on failure so a cron wrapper or CI can alert on it (story P-5).

const { destroy } = require('../db');
const { runJob } = require('./jobRunner');
const { purge } = require('./retention.job');
const { closeStaleShifts } = require('./closeShifts.job');
const payrollService = require('../modules/payroll/payroll.service');
const t = require('../utils/time');

const JOBS = {
  purge: () => purge(),
  'close-shifts': () => closeStaleShifts(),
  payroll: async () => {
    // `npm run job:payroll -- 2026-08` overrides the default of "last month".
    const month = process.argv[3] || t.previousMonth();
    const result = await payrollService.generate({ month });
    return { ...result, affected: result.employeesProcessed };
  },
};

async function main() {
  const name = process.argv[2];
  if (!JOBS[name]) {
    console.error(`Unknown job "${name}". Available: ${Object.keys(JOBS).join(', ')}`);
    process.exit(2);
  }

  try {
    const result = await runJob(name, JOBS[name]);
    console.log(JSON.stringify(result, null, 2));
    await destroy();
    process.exit(0);
  } catch (err) {
    console.error(`Job ${name} failed: ${err.message}`);
    if (err.details) console.error(JSON.stringify(err.details, null, 2));
    await destroy();
    process.exit(1);
  }
}

main();
