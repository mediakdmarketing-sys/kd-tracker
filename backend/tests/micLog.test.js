'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { periodsFromSamples, MAX_GAP_MS } = require('../src/modules/capture/micLog');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const MIN = 60 * 1000;
const SAMPLE_SECONDS = 300;

/** A sample starting `atMin` minutes after t0. */
const sample = (atMin, micMuted) => ({
  recordedAt: 1_000_000_000_000 + atMin * MIN,
  durationSeconds: SAMPLE_SECONDS,
  micMuted,
});

describe('periodsFromSamples', () => {
  it('has nothing to report when the mic was always live', () => {
    expect(periodsFromSamples([sample(0, false), sample(13, false), sample(26, false)])).toEqual([]);
  });

  it('runs from the first silent sample to the end of the last, and says when sound came back', () => {
    const periods = periodsFromSamples([
      sample(0, false),
      sample(13, true),
      sample(26, true),
      sample(39, false),
    ]);
    expect(periods).toHaveLength(1);
    expect(periods[0].start).toBe(sample(13, true).recordedAt);
    expect(periods[0].end).toBe(sample(26, true).recordedAt + SAMPLE_SECONDS * 1000);
    expect(periods[0].samples).toBe(2);
    expect(periods[0].endedBy).toBe('live');
    expect(periods[0].confirmedLiveAt).toBe(sample(39, false).recordedAt);
  });

  it('keeps separate stretches separate', () => {
    const periods = periodsFromSamples([
      sample(0, true),
      sample(13, false),
      sample(26, true),
      sample(39, false),
    ]);
    expect(periods).toHaveLength(2);
  });

  it('closes a stretch when samples stop, rather than assuming the mic stayed muted', () => {
    const periods = periodsFromSamples([sample(0, true), sample(13, true), sample(13 + MAX_GAP_MS / MIN + 30, false)]);
    expect(periods).toHaveLength(1);
    expect(periods[0].endedBy).toBe('gap');
    expect(periods[0].confirmedLiveAt).toBeNull();
  });

  it('reports a stretch that is still silent at the last sample as ongoing', () => {
    const periods = periodsFromSamples([sample(0, false), sample(13, true)]);
    expect(periods[0].endedBy).toBe('ongoing');
  });

  it('runs a period to the exact moment the agent saw the mic come back', () => {
    const muted = { recordedAt: 1_000_000_000_000, durationSeconds: 0, micMuted: true, event: true };
    const back = { recordedAt: 1_000_000_000_000 + 9 * MIN, durationSeconds: 0, micMuted: false, event: true };
    const periods = periodsFromSamples([muted, back]);
    expect(periods).toHaveLength(1);
    expect(periods[0].start).toBe(muted.recordedAt);
    expect(periods[0].end).toBe(back.recordedAt);
    expect(periods[0].endedBy).toBe('live');
  });

  it('ignores samples whose state is unknown', () => {
    const periods = periodsFromSamples([sample(0, true), sample(13, null), sample(26, false)]);
    expect(periods).toHaveLength(1);
    expect(periods[0].endedBy).toBe('live');
  });
});

describe('a microphone that could not be started', () => {
  async function ready() {
    const employee = await createEmployee({ name: 'Eve Employee', department: 'Sales', consent_audio: true });
    const leader = await createEmployee({ name: 'Lena Leader', department: 'Sales', role: 'leader' });
    const hr = await createEmployee({ name: 'Hana HR', department: 'HR', role: 'admin' });
    await db()('department_leaders').insert({ department: 'Sales', employee_id: leader.id, assigned_at: t.now() });
    const token = await login(employee);
    expect((await as(token).post('/api/attendance/punch-in')).status).toBe(201);
    return { employee, leader, hr, token };
  }

  const report = (token) =>
    as(token).post('/api/audio/mic-status').send({ state: 'unavailable', reason: 'Could not start audio source' });

  it('alerts HR and the leader, and shows up in the mic log', async () => {
    const { token, hr, leader, employee } = await ready();
    expect((await report(token)).status).toBe(201);

    for (const person of [hr, leader]) {
      const inbox = await as(await login(person)).get('/api/notifications');
      const alert = inbox.body.items.find((i) => i.type === 'mic_inactive');
      expect(alert.title).toBe('Mic not active: Eve Employee');
      expect(alert.body).toContain('could not be started');
    }

    const log = await as(await login(hr)).get(`/api/audio/${employee.id}/mic-log`);
    expect(log.body.periods).toHaveLength(1);
    expect(log.body.periods[0].unavailable).toBe(true);
  });

  it('treats "muted" like a silent sample, and "live" closes it in the mic log', async () => {
    const { token, hr, leader, employee } = await ready();
    const send = (state) => as(token).post('/api/audio/mic-status').send({ state });

    expect((await send('muted')).status).toBe(201);
    const alert = (await as(await login(leader)).get('/api/notifications')).body.items.find(
      (i) => i.type === 'mic_inactive'
    );
    expect(alert.body).toContain('muted');

    expect((await send('live')).status).toBe(201);
    const log = await as(await login(hr)).get(`/api/audio/${employee.id}/mic-log`);
    expect(log.body.periods).toHaveLength(1);
    expect(log.body.periods[0].endedBy).toBe('live');
    expect(log.body.periods[0].unavailable).toBe(false);
    // Coming back raises no second alert.
    const inbox = await as(await login(hr)).get('/api/notifications');
    expect(inbox.body.items.filter((i) => i.type === 'mic_inactive')).toHaveLength(1);
  });

  it('is refused without audio consent', async () => {
    const employee = await createEmployee({ consent_audio: false });
    const token = await login(employee);
    await as(token).post('/api/attendance/punch-in');
    expect((await report(token)).status).toBe(403);
  });

  it('is refused while not punched in', async () => {
    const employee = await createEmployee({ consent_audio: true });
    expect((await report(await login(employee))).status).toBe(409);
  });
});

describe('the microphone log API', () => {
  async function addSample(employee, startedAgoMin, micMuted) {
    const at = t.now() - startedAgoMin * MIN;
    await db()('audio_recordings').insert({
      id: uuid(),
      employee_id: employee.id,
      file_url: `audio/${uuid()}.webm`,
      recorded_at: at,
      date: t.localDate(at),
      duration_seconds: SAMPLE_SECONDS,
      size_bytes: 10,
      content_type: 'audio/webm',
      consent_verified: true,
      mic_muted: micMuted,
      file_deleted: false,
      created_at: at,
    });
  }

  async function setup() {
    const employee = await createEmployee({ name: 'Eve Employee', department: 'Sales', consent_audio: true });
    const leader = await createEmployee({ name: 'Lena Leader', department: 'Sales', role: 'leader' });
    const hr = await createEmployee({ name: 'Hana HR', department: 'HR', role: 'admin' });
    await db()('department_leaders').insert({ department: 'Sales', employee_id: leader.id, assigned_at: t.now() });
    // Live, then silent twice, then live again.
    await addSample(employee, 80, false);
    await addSample(employee, 60, true);
    await addSample(employee, 40, true);
    await addSample(employee, 20, false);
    return { employee, leader, hr };
  }

  it('gives HR the periods for one employee, and records that HR looked', async () => {
    const { employee, hr } = await setup();
    const res = await as(await login(hr)).get(`/api/audio/${employee.id}/mic-log`);
    expect(res.status).toBe(200);
    expect(res.body.periods).toHaveLength(1);
    expect(res.body.periods[0].samples).toBe(2);
    expect(res.body.periods[0].endedBy).toBe('live');
    expect(res.body.periods[0].durationSeconds).toBeGreaterThan(0);

    const logged = await db()('audit_logs').where({ target_employee_id: employee.id });
    expect(logged.some((r) => String(r.details).includes('mic-log'))).toBe(true);
  });

  it('gives a team leader the log for their own member', async () => {
    const { employee, leader } = await setup();
    const res = await as(await login(leader)).get(`/api/leader/members/${employee.id}/mic-log`);
    expect(res.status).toBe(200);
    expect(res.body.periods).toHaveLength(1);
  });

  it('refuses a leader for someone outside their department', async () => {
    const { leader } = await setup();
    const stranger = await createEmployee({ name: 'Sam Stranger', department: 'Support', consent_audio: true });
    const res = await as(await login(leader)).get(`/api/leader/members/${stranger.id}/mic-log`);
    expect(res.status).toBe(403);
  });

  it('lets an employee read their own log, but not a colleague\'s', async () => {
    const { employee } = await setup();
    const colleague = await createEmployee({ name: 'Cy Colleague', department: 'Sales' });
    const mine = await as(await login(employee)).get(`/api/audio/${employee.id}/mic-log`);
    expect(mine.status).toBe(200);
    const theirs = await as(await login(employee)).get(`/api/audio/${colleague.id}/mic-log`);
    expect(theirs.status).toBe(403);
  });

  it('gives HR the company-wide log with names, and keeps it admin only', async () => {
    const { employee, hr, leader } = await setup();
    const res = await as(await login(hr)).get('/api/admin/mic-log');
    expect(res.status).toBe(200);
    expect(res.body.periods[0].employeeName).toBe('Eve Employee');
    expect(res.body.periods[0].department).toBe('Sales');
    expect(res.body.periods[0].employeeId).toBe(employee.id);

    const filtered = await as(await login(hr)).get('/api/admin/mic-log?department=Support');
    expect(filtered.body.periods).toHaveLength(0);

    const denied = await as(await login(leader)).get('/api/admin/mic-log');
    expect(denied.status).toBe(403);
  });
});
