'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { storage } = require('../src/storage');
const attendanceService = require('../src/modules/attendance/attendance.service');

/** The shape `req.user` has, for tests that drive the service directly. */
function toUser(row) {
  return {
    id: row.id,
    role: row.role,
    timezone: row.timezone,
    consentMonitoring: true,
    consentAudio: Boolean(row.consent_audio),
  };
}

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

// A 1x1 JPEG.
const IMAGE = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64'
).toString('base64');

const AUDIO = Buffer.from('fake audio bytes').toString('base64');

describe('screenshot upload', () => {
  it('stores the file and a row while a shift is open', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token).post('/api/screenshots/upload').send({ imageBase64: IMAGE });
    expect(res.status).toBe(201);

    const row = await db()('screenshots').where({ id: res.body.id }).first();
    expect(row.image_url).toBeTruthy();
    expect(row.file_deleted).toBeFalsy();
    expect(await storage().exists(row.image_url)).toBe(true);
  });

  it('is refused when the capture time falls outside every shift', async () => {
    const token = await login(await createEmployee());
    const res = await as(token).post('/api/screenshots/upload').send({ imageBase64: IMAGE });

    expect(res.status).toBe(409);
    expect(await db()('screenshots').count({ c: '*' })).toEqual([{ c: 0 }]);
  });

  // ADR-0004: an agent that was offline uploads after the shift has closed. Judging the
  // capture by upload time would leave it retrying something the server can never accept.
  it('accepts a capture taken during a shift that has since closed', async () => {
    const employee = await createEmployee();
    const token = await login(employee);
    const start = Date.now() - 4 * 3600_000;

    await attendanceService.punchIn({ employee: toUser(employee), at: start });
    await attendanceService.punchOut({ employee: toUser(employee), at: start + 3 * 3600_000 });

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, capturedAt: new Date(start + 3600_000).toISOString() });

    expect(res.status).toBe(201);
    const row = await db()('screenshots').first();
    // It is attached to the shift it actually belongs to, not to nothing.
    expect(row.attendance_id).toBeTruthy();
  });

  it('refuses a capture taken during a break, even when replayed later', async () => {
    const employee = await createEmployee();
    const token = await login(employee);
    const start = Date.now() - 5 * 3600_000;
    const user = toUser(employee);

    await attendanceService.punchIn({ employee: user, at: start });
    await attendanceService.startBreak({ employee: user, at: start + 3600_000 });
    await attendanceService.endBreak({ employee: user, at: start + 5400_000 });
    await attendanceService.punchOut({ employee: user, at: start + 4 * 3600_000 });

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, capturedAt: new Date(start + 4500_000).toISOString() });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/break/i);
  });

  it('is refused during a break', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');
    await as(token).post('/api/attendance/break-start');

    const res = await as(token).post('/api/screenshots/upload').send({ imageBase64: IMAGE });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/break/i);
  });

  it('rejects a payload over the size cap without storing anything', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const huge = Buffer.alloc(6 * 1024 * 1024, 1).toString('base64');
    const res = await as(token).post('/api/screenshots/upload').send({ imageBase64: huge });

    expect(res.status).toBe(413);
    expect(await db()('screenshots').count({ c: '*' })).toEqual([{ c: 0 }]);
  });
});

// Sprint 6.5 / ADR-0004. On an unreliable connection a lost response is indistinguishable
// from a failed request, so the agent retries and the server has to recognise the replay.
describe('replay protection (captureId)', () => {
  const { uuid } = require('../src/utils/ids');

  it('stores a screenshot once however many times it is sent', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');
    const captureId = uuid();

    const first = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId });
    const retry = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId });

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.duplicate).toBe(true);
    expect(await db()('screenshots').count({ c: '*' })).toEqual([{ c: 1 }]);
  });

  it('accepts a replay even after the shift it belonged to has closed', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');
    const captureId = uuid();
    const first = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId });

    await as(token).post('/api/attendance/punch-out');

    // Without the replay check this would be a 409 and the agent would retry forever.
    const retry = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId });

    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
  });

  it('stores an audio sample once however many times it is sent', async () => {
    const token = await login(await createEmployee({ consent_audio: true }));
    await as(token).post('/api/attendance/punch-in');
    const captureId = uuid();

    const first = await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 300, captureId });
    const retry = await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 300, captureId });

    expect(retry.body.id).toBe(first.body.id);
    expect(await db()('audio_recordings').count({ c: '*' })).toEqual([{ c: 1 }]);
  });

  it('still refuses an audio replay once consent has been withdrawn', async () => {
    const token = await login(await createEmployee({ consent_audio: true }));
    await as(token).post('/api/attendance/punch-in');
    const captureId = uuid();

    await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 60, captureId });
    await as(token).post('/api/auth/consent').send({ audioConsent: false });

    const retry = await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 60, captureId });

    expect(retry.status).toBe(403);
  });

  it('drops activity entries the agent has already delivered', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const entries = [1, 2, 3].map((n) => ({
      captureId: uuid(),
      keystrokeCount: n * 10,
      mouseCount: n,
    }));

    const first = await as(token).post('/api/activity/log').send({ entries });
    // The agent did not see the response and sends the batch again, plus one new entry.
    const retry = await as(token)
      .post('/api/activity/log')
      .send({ entries: [...entries, { captureId: uuid(), keystrokeCount: 5, mouseCount: 5 }] });

    expect(first.body.accepted).toBe(3);
    expect(retry.body.accepted).toBe(1);
    expect(retry.body.duplicates).toBe(3);
    expect(await db()('activity_logs').count({ c: '*' })).toEqual([{ c: 4 }]);
  });

  it('rejects a captureId that is not a UUID', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId: '../../etc/passwd' });

    expect(res.status).toBe(400);
  });
});

// ADR-0005. Capturing only the primary display leaves a second monitor invisible, so the
// agent uploads every display and the server ties them together.
describe('multi-display capture', () => {
  const { uuid } = require('../src/utils/ids');

  async function captureBothScreens(token, capturedAt) {
    const captureGroupId = uuid();
    const labels = ['Built-in Display', 'DELL U2720Q'];
    const results = [];
    for (let displayIndex = 0; displayIndex < 2; displayIndex += 1) {
      results.push(
        await as(token).post('/api/screenshots/upload').send({
          imageBase64: IMAGE,
          captureId: uuid(),
          captureGroupId,
          displayIndex,
          displayCount: 2,
          displayLabel: labels[displayIndex],
          capturedAt,
        })
      );
    }
    return { captureGroupId, results };
  }

  it('keeps both displays as separate rows in one group', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const { captureGroupId, results } = await captureBothScreens(token);

    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(results.map((r) => r.body.captureGroupId)).toEqual([captureGroupId, captureGroupId]);

    const rows = await db()('screenshots').where({ capture_group_id: captureGroupId });
    expect(rows).toHaveLength(2);
    // Two files, not one overwritten by the other.
    expect(new Set(rows.map((r) => r.image_url)).size).toBe(2);
  });

  it('lists a group newest first, primary display first', async () => {
    const employee = await createEmployee();
    const token = await login(employee);
    // The shift has to cover the capture times below — captures are judged by when they were
    // taken, not when they were uploaded.
    await attendanceService.punchIn({ employee: toUser(employee), at: Date.now() - 3600_000 });

    await captureBothScreens(token, new Date(Date.now() - 10 * 60000).toISOString());
    await captureBothScreens(token, new Date(Date.now() - 5 * 60000).toISOString());

    const res = await as(token).get(`/api/screenshots/${employee.id}`);
    const order = res.body.data.map((s) => s.displayIndex);

    expect(res.body.data).toHaveLength(4);
    expect(order).toEqual([0, 1, 0, 1]);
    expect(res.body.data[0].displayCount).toBe(2);
    expect(res.body.data[0].displayLabel).toBe('Built-in Display');
  });

  it('treats a single-display capture as a group of one', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId: uuid() });

    expect(res.body.captureGroupId).toBeTruthy();
    expect(res.body.displayIndex).toBe(0);
  });

  it('purges every display of a group independently', async () => {
    const { purge } = require('../src/jobs/retention.job');
    const employee = await createEmployee();
    const token = await login(employee);
    await as(token).post('/api/attendance/punch-in');

    const { captureGroupId } = await captureBothScreens(token);
    // Age both rows past the retention window.
    await db()('screenshots')
      .where({ capture_group_id: captureGroupId })
      .update({ captured_at: Date.now() - 40 * 86400000 });

    const result = await purge();

    expect(result.screenshots.deleted).toBe(2);
    const rows = await db()('screenshots').where({ capture_group_id: captureGroupId });
    // Rows survive, files do not — the retention rule is per file, so N displays is N deletions.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.image_url === null && r.file_deleted)).toBe(true);
  });

  it('rejects a displayIndex outside the display count', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, captureId: uuid(), displayIndex: 3, displayCount: 2 });

    expect(res.status).toBe(400);
  });
});

describe('timestamp sanity', () => {
  it('rejects a capture dated in the future', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, capturedAt: new Date(Date.now() + 3600_000).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/future|clock/i);
    expect(await db()('screenshots').count({ c: '*' })).toEqual([{ c: 0 }]);
  });

  it('rejects a capture older than the upload window', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/screenshots/upload')
      .send({ imageBase64: IMAGE, capturedAt: new Date(Date.now() - 30 * 86400000).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/upload window/i);
  });

  it('accepts a capture from a few hours ago, which is the whole point', async () => {
    const employee = await createEmployee();
    const token = await login(employee);
    await attendanceService.punchIn({ employee: toUser(employee), at: Date.now() - 6 * 3600_000 });
    const capturedAt = new Date(Date.now() - 3 * 3600_000).toISOString();

    const res = await as(token).post('/api/screenshots/upload').send({ imageBase64: IMAGE, capturedAt });

    expect(res.status).toBe(201);
    expect(res.body.capturedAt).toBe(capturedAt);
  });
});

describe('audio upload -- consent gate', () => {
  it('rejects the upload with 403 when audio consent is absent', async () => {
    const token = await login(await createEmployee({ consent_audio: false }));
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 300 });

    expect(res.status).toBe(403);
    // Nothing may be written on the rejected path -- not the row, not the file.
    expect(await db()('audio_recordings').count({ c: '*' })).toEqual([{ c: 0 }]);
  });

  it('accepts it once the employee has consented, and records that consent on the row', async () => {
    const token = await login(await createEmployee({ consent_audio: true }));
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 300 });

    expect(res.status).toBe(201);
    const row = await db()('audio_recordings').where({ id: res.body.id }).first();
    expect(row.consent_verified).toBeTruthy();
  });

  it('stops accepting uploads the moment consent is revoked', async () => {
    const token = await login(await createEmployee({ consent_audio: true }));
    await as(token).post('/api/attendance/punch-in');

    expect(
      (await as(token).post('/api/audio/upload').send({ audioBase64: AUDIO, durationSeconds: 60 }))
        .status
    ).toBe(201);

    await as(token).post('/api/auth/consent').send({ audioConsent: false });

    // Same token, no re-login: revocation must not wait for the access token to expire.
    expect(
      (await as(token).post('/api/audio/upload').send({ audioBase64: AUDIO, durationSeconds: 60 }))
        .status
    ).toBe(403);
  });

  it('refuses a sample long enough to be continuous recording', async () => {
    const token = await login(await createEmployee({ consent_audio: true }));
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: AUDIO, durationSeconds: 3600 });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/continuous|sample length/i);
  });
});

describe('activity logging', () => {
  it('accepts a single entry', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token)
      .post('/api/activity/log')
      .send({ keystrokeCount: 120, mouseCount: 40, windowTitle: 'VS Code' });

    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(1);
  });

  it('accepts a batch, so an offline agent can drain its queue', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const entries = Array.from({ length: 25 }, (_, i) => ({
      keystrokeCount: i,
      mouseCount: i * 2,
      timestamp: new Date(Date.now() - i * 60000).toISOString(),
    }));

    const res = await as(token).post('/api/activity/log').send({ entries });
    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(25);
  });

  it('has no way to submit keystroke content', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    await as(token)
      .post('/api/activity/log')
      .send({ keystrokeCount: 5, mouseCount: 5, keystrokes: 'my-banking-password' });

    const row = await db()('activity_logs').first();
    // The schema strips unknown fields; there is no column that could hold them.
    expect(Object.keys(row)).not.toContain('keystrokes');
    expect(JSON.stringify(row)).not.toContain('banking');
  });
});

describe('admin media access', () => {
  it('writes an audit row for every screenshot view', async () => {
    const employee = await createEmployee();
    const userToken = await login(employee);
    await as(userToken).post('/api/attendance/punch-in');
    const upload = await as(userToken).post('/api/screenshots/upload').send({ imageBase64: IMAGE });

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const view = await as(adminToken).get(`/api/screenshots/file/${upload.body.id}`);

    expect(view.status).toBe(200);
    const logs = await db()('audit_logs').where({ action: 'viewed_screenshot' });
    expect(logs).toHaveLength(1);
    expect(logs[0].target_id).toBe(upload.body.id);
  });

  it('does not let a normal user open the screenshot of another employee', async () => {
    const owner = await createEmployee();
    const ownerToken = await login(owner);
    await as(ownerToken).post('/api/attendance/punch-in');
    const upload = await as(ownerToken).post('/api/screenshots/upload').send({ imageBase64: IMAGE });

    const otherToken = await login(await createEmployee());
    const res = await as(otherToken).get(`/api/screenshots/file/${upload.body.id}`);
    expect(res.status).toBe(403);
  });
});
