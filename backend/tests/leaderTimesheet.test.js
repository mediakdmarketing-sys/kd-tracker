'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const H = 3600 * 1000;
const shift = (e, over = {}) =>
  db()('attendance').insert({
    id: uuid(), employee_id: e.id, punch_in: t.now() - 3 * H, punch_out: null, date: t.localDate(), status: 'open',
    total_break_seconds: 0, total_worked_seconds: null, idle_seconds: 0, over_break: false, auto_closed: false,
    needs_review: false, created_at: t.now(), updated_at: t.now(), ...over,
  });

async function setup() {
  const leader = await createEmployee({ name: 'Lena Leader', role: 'leader', department: 'Sales' });
  await db()('department_leaders').insert({ department: 'Sales', employee_id: leader.id, assigned_at: t.now() });
  const mine = await createEmployee({ name: 'Mia Member', department: 'Sales' });
  const mine2 = await createEmployee({ name: 'Max Member', department: 'Sales' });
  const other = await createEmployee({ name: 'Olly Other', department: 'Support' });
  const admin = await createEmployee({ name: 'Hana HR', role: 'admin', department: 'HR', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` });
  for (const e of [mine, other, leader, admin]) await shift(e);
  return { leader, mine, mine2, other, admin, api: as(await login(leader)) };
}

describe('GET /api/leader/timesheet', () => {
  it('shows a leader only the people of their departments, never themselves or other teams', async () => {
    const { api, mine, mine2 } = await setup();
    const res = await api.get('/api/leader/timesheet');
    expect(res.status).toBe(200);
    // Mia worked; Max has not started (a single-day view lists who is missing); nobody else appears.
    expect(res.body.rows.map((r) => r.name).sort()).toEqual(['Max Member', 'Mia Member']);
    expect(res.body.rows.find((r) => r.employeeId === mine.id)).toMatchObject({ state: 'working' });
    expect(res.body.rows.find((r) => r.employeeId === mine2.id)).toMatchObject({ state: 'not_started' });
    expect(res.body.summary).toMatchObject({ people: 2, working: 1, notStarted: 1 });
  });

  it('leaves out what is HR’s alone: the agent state and the screenshot counts', async () => {
    const { api } = await setup();
    const res = await api.get('/api/leader/timesheet');
    for (const row of res.body.rows) {
      expect(row).not.toHaveProperty('agent');
      expect(row).not.toHaveProperty('screenshots');
    }
    expect(res.body.summary).not.toHaveProperty('agentOffline');
    expect(res.body.rows[0]).toHaveProperty('workedSeconds'); // the hours are there
  });

  it('cannot be widened to another team by a department or an employee filter', async () => {
    const { api, other, mine } = await setup();
    expect((await api.get('/api/leader/timesheet?department=Support')).body.rows).toEqual([]);
    expect((await api.get(`/api/leader/timesheet?employeeId=${other.id}`)).body.rows).toEqual([]);
    expect((await api.get(`/api/leader/timesheet?employeeId=${mine.id}`)).body.rows.map((r) => r.name)).toEqual(['Mia Member']);
    expect((await api.get('/api/leader/timesheet?employee=olly')).body.rows).toEqual([]);
  });

  it('shows a leader with no department nobody, an admin everyone, and refuses a plain employee', async () => {
    const { admin, other } = await setup();
    const lone = await createEmployee({ name: 'Lone Leader', role: 'leader', department: 'Ops' });
    expect((await as(await login(lone)).get('/api/leader/timesheet')).body.rows).toEqual([]);

    const all = (await as(await login(admin)).get('/api/leader/timesheet')).body.rows;
    expect(all.some((r) => r.employeeId === other.id)).toBe(true);

    expect((await as(await login(other)).get('/api/leader/timesheet')).status).toBe(403);
  });

  it('keeps HR’s own timesheet as it was, with the agent state', async () => {
    const { admin } = await setup();
    const res = await as(await login(admin)).get('/api/admin/timesheet');
    expect(res.body.rows[0]).toHaveProperty('agent');
    expect(res.body.summary).toHaveProperty('agentOffline');
  });
});
