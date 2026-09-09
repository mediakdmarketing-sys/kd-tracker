'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Outbox } = require('../src/core/outbox');
const logger = require('../src/core/logger');

logger.setLevel('error');

const dirs = [];

/**
 * Creates a temporary directory and returns a Promise<Outbox>.
 * Tests should use `outbox = await tempOutbox()` inside an async beforeEach.
 */
async function tempOutbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-agent-test-'));
  dirs.push(dir);
  return Outbox.open(dir);
}

function cleanup() {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Scripted API double. Each entry is either a response object or a function of the request,
 * so a test can say "fail twice, then succeed" without any network.
 */
function fakeApi(script) {
  const calls = [];
  let index = 0;

  return {
    calls,
    isSignedIn: () => true,
    async request(path_, options) {
      calls.push({ path: path_, ...options });
      const step = Array.isArray(script) ? script[Math.min(index, script.length - 1)] : script;
      index += 1;
      return typeof step === 'function' ? step({ path: path_, ...options }) : step;
    },
  };
}

const OK = { status: 201, body: { id: 'server-id' } };
const OFFLINE = { status: 0, body: null, networkError: 'ECONNREFUSED' };

module.exports = { tempOutbox, cleanup, fakeApi, OK, OFFLINE };
