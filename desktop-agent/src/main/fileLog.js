'use strict';

// Writes the agent's log lines to a file as well as the console, so a problem on someone
// else's computer can be diagnosed from one file instead of asking them to run the app from a
// terminal. Packaged apps have no console, which is why "nothing happens" used to leave no trace.
//
// File: <userData>/agent.log (Windows: %APPDATA%\kd-tracker-agent, macOS:
// ~/Library/Application Support/kd-tracker-agent, Linux: ~/.config/kd-tracker-agent).
// It holds metadata only (timestamps, messages, counts), never screenshots or typed content.
// One previous file is kept (agent.log.1), so the log never grows past about 2 MB.

const fs = require('fs');
const path = require('path');
const logger = require('../core/logger');

const MAX_BYTES = 1024 * 1024;

function startFileLog(dir) {
  const file = path.join(dir, 'agent.log');

  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file) && fs.statSync(file).size > MAX_BYTES) {
      fs.renameSync(file, `${file}.1`);
    }
  } catch {
    // Not being able to rotate must never stop the agent from starting.
  }

  logger.setSink((line) => {
    const text = JSON.stringify(line);
    (line.level === 'error' || line.level === 'warn' ? console.error : console.log)(text);
    try {
      fs.appendFileSync(file, `${text}\n`);
    } catch {
      // Disk full or the folder went away: the console copy above is still there.
    }
  });

  return file;
}

module.exports = { startFileLog };
