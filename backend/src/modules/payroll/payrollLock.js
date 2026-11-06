'use strict';

// A finalized payroll month is frozen: it cannot be regenerated, and anything that feeds its pay
// (bonuses, company holidays) cannot change, until HR reopens it. These are the checks the other
// services call before they write.

const { db } = require('../../db');
const { conflict } = require('../../utils/errors');

async function isFinal(month) {
  return Boolean(await db()('payroll_months').where({ month }).first('month'));
}

/** Throws if the month is finalized. `what` finishes the sentence "…before you ___". */
async function assertOpen(month, what = 'change it') {
  if (await isFinal(month)) {
    throw conflict(`Payroll for ${month} is finalized. Reopen the month before you ${what}.`);
  }
}

module.exports = { isFinal, assertOpen };
