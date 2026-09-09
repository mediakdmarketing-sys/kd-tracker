'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    // The agent is CommonJS, and `require('vitest')` is not allowed from CJS.
    globals: true,
    include: ['tests/**/*.test.js'],
    testTimeout: 20000,
  },
});
