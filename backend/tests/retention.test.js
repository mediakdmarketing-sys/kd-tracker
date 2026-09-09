'use strict';

const { migrate, truncate, createEmployee } = require('./helpers');
const { db, destroy } = require('../src/db');
const { storage, buildKey } = require('../src/storage');
const { purge } = require('../src/jobs/retention.job');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');
const config = require('../src/config');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

async function makeScreenshot(employee, ageDays) {
  const id = uuid();
  const capturedAt = t.daysAgo(ageDays);
  const date = t.localDate(capturedAt, employee.timezone);
  const key = buildKey({
    type: 'screenshots',
    employeeId: employee.id,
    date,
    id,
    extension: 'jpg',
  });

  await storage().put(key, Buffer.from('screenshot bytes'), 'image/jpeg');
  await db()('screenshots').insert({
    id,
    employee_id: employee.id,
    attendance_id: null,
    image_url: key,
    captured_at: capturedAt,
    date,
    size_bytes: 16,
    content_type: 'image/jpeg',
    file_deleted: false,
    created_at: capturedAt,
  });

  return { id, key };
}

describe('31-day retention purge', () => {
  it('deletes the file but keeps the row', async () => {
    const employee = await createEmployee();
    const old = await makeScreenshot(employee, config.retention.days + 3);

    const result = await purge();

    expect(result.screenshots.deleted).toBe(1);
    expect(await storage().exists(old.key)).toBe(false);

    // The row is the audit history and must survive (spec 6.4).
    const row = await db()('screenshots').where({ id: old.id }).first();
    expect(row).toBeTruthy();
    expect(row.image_url).toBeNull();
    expect(row.file_deleted).toBeTruthy();
    expect(row.captured_at).toBeTruthy();
    expect(row.employee_id).toBe(employee.id);
  });

  it('leaves files inside the retention window alone', async () => {
    const employee = await createEmployee();
    const recent = await makeScreenshot(employee, 5);

    await purge();

    expect(await storage().exists(recent.key)).toBe(true);
    const row = await db()('screenshots').where({ id: recent.id }).first();
    expect(row.image_url).toBe(recent.key);
    expect(row.file_deleted).toBeFalsy();
  });

  it('purges audio on the same rule', async () => {
    const employee = await createEmployee();
    const id = uuid();
    const recordedAt = t.daysAgo(config.retention.days + 1);
    const date = t.localDate(recordedAt, employee.timezone);
    const key = buildKey({ type: 'audio', employeeId: employee.id, date, id, extension: 'webm' });

    await storage().put(key, Buffer.from('audio bytes'), 'audio/webm');
    await db()('audio_recordings').insert({
      id,
      employee_id: employee.id,
      attendance_id: null,
      file_url: key,
      recorded_at: recordedAt,
      date,
      duration_seconds: 300,
      size_bytes: 11,
      content_type: 'audio/webm',
      consent_verified: true,
      file_deleted: false,
      created_at: recordedAt,
    });

    const result = await purge();

    expect(result.audio.deleted).toBe(1);
    expect(await storage().exists(key)).toBe(false);
    const row = await db()('audio_recordings').where({ id }).first();
    expect(row.file_url).toBeNull();
    expect(row.consent_verified).toBeTruthy();
  });

  it('is safe to run twice', async () => {
    const employee = await createEmployee();
    await makeScreenshot(employee, 40);

    const first = await purge();
    const second = await purge();

    expect(first.screenshots.deleted).toBe(1);
    expect(second.screenshots.deleted).toBe(0);
    expect(second.affected).toBe(0);
  });

  it('marks rows whose file was already removed elsewhere', async () => {
    const employee = await createEmployee();
    const old = await makeScreenshot(employee, 40);

    // Simulate an S3 lifecycle rule having already expired the object.
    await storage().remove(old.key);

    const result = await purge();
    expect(result.screenshots.deleted).toBe(1);
    const row = await db()('screenshots').where({ id: old.id }).first();
    expect(row.file_deleted).toBeTruthy();
  });

  it('serves a clear 404 for a purged file rather than a broken image', async () => {
    const { login, as } = require('./helpers');
    const employee = await createEmployee();
    const old = await makeScreenshot(employee, 40);
    await purge();

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get(`/api/screenshots/file/${old.id}`);

    expect(res.status).toBe(404);
    expect(res.body.error.message).toMatch(/retention/i);
  });
});
