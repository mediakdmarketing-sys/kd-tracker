'use strict';

const config = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[process.env.LOG_LEVEL] || (config.isTest ? LEVELS.error : LEVELS.info);

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  const line = { ts: new Date().toISOString(), level, message, ...(meta || {}) };
  // Structured single-line JSON: greppable locally, ingestible by a log shipper in production.
  const out = level === 'error' || level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
}

module.exports = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
