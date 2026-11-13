'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');
const settings = require('../src/services/settings');
const { minutesOfDay } = require('../src/modules/admin/performance.service');

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  await settings.update({ shift: { workdayStartMinutes: null, workdayEndMinutes: null } });
});
afterAll(destroy);

const H = 3600 * 1000;
const MIN = 60 * 1000;

async function hr() {
  return as(await login(await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` })));
}

/**
 * One closed shift on each of the last `n` days. `inShift` and `outShift` move the punch times
 * from the base day (9 hours long), so lateness and early finish are easy to set up.
 */
async function worked(e, n, { inShift = 0, outShift = 0, overBreak = false } = {}) {
  for (let k = 0; k < n; k += 1) {
    // Whole minutes, and only a few days back, so a clock change cannot move the minute of day.
    const base = Math.floor((t.now() - k * 24 * H) / MIN) * MIN - 10 * H;
    const punchIn = base + inShift * MIN;
    const punchOut = base + 9 * H + outShift * MIN;
    await db()('attendance').insert({
      id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: punchOut, date: t.localDate(punchIn),
      total_break_seconds: 0, total_worked_seconds: 8 * 3600, idle_seconds: 0, status: 'closed',
      over_break: overBreak, auto_closed: false, needs_review: false, review_reason: null, created_at: punchIn, updated_at: punchOut,
    });
  }
}

async function mutedSample(e, minutesAgo, micMuted) {
  const at = t.now() - minutesAgo * MIN;
  await db()('audio_recordings').insert({
    id: uuid(), employee_id: e.id, file_url: `audio/${uuid()}.webm`, recorded_at: at, date: t.localDate(at),
    duration_seconds: 300, size_bytes: 10, content_type: 'audio/webm', consent_verified: true, mic_muted: micMuted,
    file_deleted: false, created_at: at,
  });
}

/** Sets the workday to match the base shift: starts when it starts, ends nine hours later. */
async function setWorkday() {
  const base = Math.floor(t.now() / MIN) * MIN - 10 * H;
  const start = minutesOfDay(base);
  await settings.update({ shift: { workdayStartMinutes: start, workdayEndMinutes: minutesOfDay(base + 9 * H) } });
}

describe('GET /api/admin/performance', () => {
  it('puts the weakest person in each department first, with the five parts shown', async () => {
    const api = await hr();
    await setWorkday();
    const good = await createEmployee({ name: 'Asha Good', department: 'Sales', consent_audio: true });
    const poor = await createEmployee({ name: 'Ravi Poor', department: 'Sales', consent_audio: true });
    const other = await createEmployee({ name: 'Mani Steady', department: 'Support', consent_audio: false });
    await worked(good, 3);
    await worked(poor, 3, { inShift: 45, outShift: -60, overBreak: true });
    await worked(other, 3);
    await mutedSample(poor, 120, true);
    await mutedSample(poor, 100, true);
    await mutedSample(poor, 80, true);
    await mutedSample(good, 100, false);

    const res = await api.get('/api/admin/performance?days=7');
    expect(res.status).toBe(200);

    const sales = res.body.departments.find((d) => d.department === 'Sales');
    expect(sales.employees.map((e) => e.name)).toEqual(['Ravi Poor', 'Asha Good']); // lowest first
    const [ravi, asha] = sales.employees;
    expect(asha.score).toBeGreaterThan(ravi.score + 30);
    expect(ravi.band).toBe('attention');

    // The parts say why.
    expect(ravi.parts.punctuality).toMatchObject({ score: 0, detail: 'Late on 3 of 3 days' });
    expect(ravi.parts.finishing).toMatchObject({ score: 0, detail: 'Left early on 3 of 3 days' });
    expect(ravi.parts.breaks).toMatchObject({ score: 0 });
    expect(ravi.parts.mic.score).toBeLessThan(100);
    expect(asha.parts.punctuality.score).toBe(100);
    expect(asha.parts.mic.score).toBe(100);
    expect(['punctuality', 'finishing', 'breaks']).toContain(ravi.weakest);

    // The whole-company shortlist leads with the same person; the lowest department is first.
    expect(res.body.worst[0].name).toBe('Ravi Poor');
    expect(res.body.departments[0].score).toBeLessThanOrEqual(res.body.departments[1].score);
  });

  it('leaves a measure out, instead of marking people down, when it cannot be worked out', async () => {
    const api = await hr();
    // No workday start or end set, and no audio consent: only breaks (and productivity, if any) count.
    const e = await createEmployee({ name: 'Nia Neutral', department: 'Sales', consent_audio: false });
    await worked(e, 2, { inShift: 120, outShift: -120 });

    const res = await api.get('/api/admin/performance');
    const nia = res.body.departments[0].employees[0];
    expect(nia.parts.punctuality).toMatchObject({ score: null, detail: 'Workday start not set' });
    expect(nia.parts.finishing).toMatchObject({ score: null, detail: 'Workday end not set' });
    expect(nia.parts.mic).toMatchObject({ score: null, detail: 'No audio consent' });
    expect(nia.score).toBe(100); // lateness is not counted when no start time is set
    expect(res.body.workday).toEqual({ start: null, end: null });
  });

  it('ignores people who did not work in the range, filters by department, and is for HR only', async () => {
    const api = await hr();
    await createEmployee({ name: 'Idle Ida', department: 'Sales' });
    const e = await createEmployee({ name: 'Wes Worker', department: 'Support' });
    await worked(e, 1);

    const all = await api.get('/api/admin/performance');
    expect(all.body.departments.map((d) => d.department)).toEqual(['Support']);
    expect((await api.get('/api/admin/performance?department=Sales')).body.departments).toEqual([]);
    expect((await api.get('/api/admin/performance?days=10')).status).toBe(400);
    expect((await as(await login(await createEmployee())).get('/api/admin/performance')).status).toBe(403);
  });

  it('lets HR set and clear the workday', async () => {
    const api = await hr();
    const set = await api.patch('/api/admin/settings').send({ shift: { workdayStartMinutes: 540, workdayEndMinutes: 1080 } });
    expect(set.status).toBe(200);
    expect(settings.get().shift).toMatchObject({ workdayStartMinutes: 540, workdayEndMinutes: 1080 });
    expect((await api.patch('/api/admin/settings').send({ shift: { workdayStartMinutes: 2000 } })).status).toBe(400);
    await api.patch('/api/admin/settings').send({ shift: { workdayStartMinutes: null } });
    expect(settings.get().shift.workdayStartMinutes).toBeNull();
  });
});
