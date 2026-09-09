'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    // The backend is CommonJS, and `require('vitest')` is not allowed from CJS. Exposing the
    // test API as globals keeps the test files in the same module system as the code they test.
    globals: true,
    // Each test file gets its own worker, and therefore its own in-memory SQLite database.
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    // Generous, because a timeout here is worse than a slow test: vitest does not cancel the
    // request that overran, so it goes on to truncate tables underneath the *next* test and
    // the failure cascades into unrelated foreign-key errors. Seen once on a loaded machine.
    testTimeout: 30000,
    hookTimeout: 30000,
    // Every file runs its own migrations and bcrypt hashing; unbounded parallelism just makes
    // the files fight each other for CPU.
    poolOptions: { threads: { maxThreads: 4 } },
  },
});
