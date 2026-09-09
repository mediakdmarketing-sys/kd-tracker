'use strict';

// Structured single-line logs, same shape as the backend's, so an agent log pasted into a
// support ticket reads the same way as a server log.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS[process.env.AGENT_LOG_LEVEL] || LEVELS.info;
let sink = (line) => {
  const out = line.level === 'error' || line.level === 'warn' ? console.error : console.log;
  out(JSON.stringify(line));
};

function emit(level, message, meta) {
  if (LEVELS[level] < threshold) return;
  sink({ ts: new Date().toISOString(), level, message, ...(meta || {}) });
}

module.exports = {
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
  /** Tests silence the logger; the Electron main process points it at a rotating file. */
  setSink: (fn) => {
    sink = fn;
  },
  setLevel: (level) => {
    threshold = LEVELS[level] || threshold;
  },
};
