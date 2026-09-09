'use strict';

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { createApp } = require('../src/app');
const { db } = require('../src/db');
const config = require('../src/config');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

const app = createApp();

/** Fresh schema for every test file. In-memory, so this is fast. */
async function migrate() {
  await db().migrate.latest();
}

/** Wipes rows between tests without paying for a full migrate cycle. */
async function truncate() {
  for (const table of [
    'job_runs',
    'payroll_summary',
    'audit_logs',
    'activity_logs',
    'audio_recordings',
    'screenshots',
    'breaks',
    'attendance',
    'refresh_tokens',
    'employees',
  ]) {
    await db()(table).del();
  }
}

async function createEmployee(overrides = {}) {
  const nowMs = t.now();
  const row = {
    id: uuid(),
    name: 'Test Employee',
    email: `user-${uuid().slice(0, 8)}@kdmarketing.in`,
    password_hash: await bcrypt.hash('Password123!', config.auth.bcryptRounds),
    role: 'user',
    department: 'Engineering',
    employee_code: null,
    status: 'active',
    timezone: 'Asia/Kolkata',
    consent_monitoring: true,
    consent_audio: false,
    consent_given_at: nowMs,
    consent_version: '1.0',
    created_at: nowMs,
    updated_at: nowMs,
    ...overrides,
  };
  await db()('employees').insert(row);
  return row;
}

async function login(employee, password = 'Password123!') {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: employee.email, password });
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken;
}

/** Convenience: an authenticated supertest agent. */
function as(token) {
  return {
    get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
    patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  };
}

module.exports = { app, request, migrate, truncate, createEmployee, login, as };
