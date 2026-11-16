'use strict';

const { migrate, truncate, createEmployee, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const MIN = 60 * 1000;
const signIn = async (employee, client) => {
  const res = await request(app).post('/api/auth/login').send({ email: employee.email, password: 'Password123!', client });
  expect(res.status).toBe(200);
  return as(res.body.accessToken);
};
const hr = async () => signIn(await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` }), 'web');
const startShift = (e) =>
  db()('attendance').insert({
    id: uuid(), employee_id: e.id, punch_in: t.now() - 2 * 3600 * 1000, date: t.localDate(), status: 'open',
    total_break_seconds: 0, total_worked_seconds: null, idle_seconds: 0, over_break: false, auto_closed: false,
    needs_review: false, created_at: t.now(), updated_at: t.now(),
  });
const age = (e, minutes) => db()('sessions').where({ employee_id: e.id, client: 'desktop' }).update({ last_seen_at: t.now() - minutes * MIN });
const boardRow = async (admin, e) => (await admin.get('/api/admin/dashboard')).body.employees.find((r) => r.employeeId === e.id);

describe('is the agent connected?', () => {
  it('says online, quiet or none from the agent’s own session', async () => {
    const admin = await hr();
    const e = await createEmployee({ name: 'Eve' });
    expect((await boardRow(admin, e)).agent).toMatchObject({ state: 'none', lastSeenAt: null });

    await signIn(e, 'web'); // the browser does not count as the agent
    expect((await boardRow(admin, e)).agent.state).toBe('none');

    const agent = await signIn(e, 'desktop');
    expect((await boardRow(admin, e)).agent).toMatchObject({ state: 'online', client: 'desktop' });

    await age(e, 10); // silent for ten minutes: closed, asleep or offline
    expect((await boardRow(admin, e)).agent.state).toBe('quiet');

    // Any request the agent makes shows it is there again, so no extra "heartbeat" is needed.
    expect((await agent.get('/api/attendance/status')).status).toBe(200);
    expect((await boardRow(admin, e)).agent.state).toBe('online');

    // Signed out or ended: none.
    await db()('sessions').where({ employee_id: e.id, client: 'desktop' }).update({ revoked_at: t.now(), revoked_reason: 'logout' });
    expect((await boardRow(admin, e)).agent.state).toBe('none');
  });

  it('counts people on a shift whose agent is not connected', async () => {
    const admin = await hr();
    const connected = await createEmployee({ name: 'Connected' });
    const missing = await createEmployee({ name: 'Missing' });
    const notWorking = await createEmployee({ name: 'Idle Ida' });
    await signIn(connected, 'desktop');
    await startShift(connected);
    await startShift(missing);

    const { summary } = (await admin.get('/api/admin/dashboard')).body;
    expect(summary).toMatchObject({ working: 2, agentOffline: 1, agentsOnline: 1 }); // the person not on a shift is not counted
    expect((await boardRow(admin, notWorking)).agent.state).toBe('none');
  });

  it('shows on the timesheet for today, the employees list and one employee', async () => {
    const admin = await hr();
    const e = await createEmployee({ name: 'Eve' });
    await signIn(e, 'desktop');
    await startShift(e);

    const sheet = (await admin.get('/api/admin/timesheet')).body;
    expect(sheet.rows.find((r) => r.employeeId === e.id).agent).toBe('online');
    expect(sheet.summary.agentOffline).toBe(0);

    await age(e, 10);
    const later = (await admin.get('/api/admin/timesheet')).body;
    expect(later.rows.find((r) => r.employeeId === e.id).agent).toBe('quiet');
    expect(later.summary.agentOffline).toBe(1);

    // A past day says nothing about the agent.
    const yesterday = t.localDate(t.now() - t.DAY_MS);
    const past = (await admin.get(`/api/admin/timesheet?from=${yesterday}&to=${yesterday}`)).body;
    expect(past.rows.every((r) => r.agent === null)).toBe(true);

    const list = (await admin.get('/api/admin/employees')).body.data.find((r) => r.id === e.id);
    expect(list.agent.state).toBe('quiet');
    expect((await admin.get(`/api/admin/employees/${e.id}`)).body.agent).toMatchObject({ state: 'quiet', client: 'desktop' });
  });
});
