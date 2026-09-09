'use strict';

// Runs before any test file is imported, so src/config sees these values.
// dotenv does not override variables that are already set, so a developer's .env cannot
// point the test suite at a real database or a real bucket.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite';
process.env.JWT_SECRET = 'test-secret-value-for-the-suite-only-000000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-value-for-the-suite-only';
process.env.ENABLE_SCHEDULER = 'false';
process.env.STORAGE_DRIVER = 'local';

const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kd-tracker-test-'));
process.env.STORAGE_LOCAL_DIR = storageDir;
