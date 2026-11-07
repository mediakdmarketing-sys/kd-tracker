'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const holidays = require('../src/modules/payroll/holidays.service');
const { uuid } = require('../src/utils/ids');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const mail = (p) => `${p}-${uuid().slice(0, 6)}@kdmarketing.in`;

async function leave(e, { from, to, status = 'approved', type = 'vacation', dayPart = 'full' }) {
  const now = Date.now();
  await db()('leave_requests').insert({
    id: uuid(), employee_id: e.id, type, day_part: dayPart, start_date: from, end_date: to,
    reason: 'test', status, created_at: now, updated_at: now,
  });
}

async function setup() {
  const hr = await createEmployee({ role: 'admin', email: mail('hr') });
  const lead = await createEmployee({ role: 'leader', name: 'Lead', department: 'Management', email: mail('lead') });
  await db()('department_leaders').insert({ department: 'Sales', employee_id: lead.id, assigned_at: Date.now() });
  const mine = await createEmployee({ name: 'Mine', department: 'Sales', birth_date: '1995-03-12', email: mail('mine') });
  const other = await createEmployee({ name: 'Other', department: 'Support', birth_date: '1994-03-20', email: mail('other') });

  await holidays.add({ date: '2026-03-03', name: 'Founders Day' });
  await leave(mine, { from: '2026-03-09', to: '2026-03-11' });
  await leave(mine, { from: '2026-03-16', to: '2026-03-16', status: 'pending' });
  await leave(mine, { from: '2026-03-18', to: '2026-03-18', status: 'rejected' });
  await leave(other, { from: '2026-03-24', to: '2026-03-25', type: 'sick' });
  await leave(other, { from: '2026-02-27', to: '2026-03-02' }); // starts the month before
  await leave(other, { from: '2026-04-01', to: '2026-04-02' }); // next month

  const get = async (who) => (await as(await login(who)).get('/api/calendar/month?month=2026-03'));
  return { hr, lead, mine, other, get };
}

describe('GET /api/calendar/month', () => {
  it('needs a sign-in and a real month', async () => {
    expect((await request(app).get('/api/calendar/month?month=2026-03')).status).toBe(401);
    const { hr } = await setup();
    expect((await as(await login(hr)).get('/api/calendar/month?month=2026-13')).status).toBe(400);
  });

  it('gives HR everything: holidays with edit details, all leave, all birthdays', async () => {
    const { hr, get } = await setup();
    const res = await get(hr);
    expect(res.status).toBe(200);
    expect(res.body.holidays).toEqual([expect.objectContaining({ date: '2026-03-03', name: 'Founders Day', id: expect.any(String), repeats: true })]);
    expect(res.body.leave.map((l) => [l.name, l.start, l.status])).toEqual([
      ['Other', '2026-02-27', 'approved'], // overlaps into March
      ['Mine', '2026-03-09', 'approved'],
      ['Mine', '2026-03-16', 'pending'],
      ['Other', '2026-03-24', 'approved'],
    ]); // rejected and next month's are left out
    expect(res.body.birthdays.map((b) => [b.name, b.date])).toEqual([['Mine', '2026-03-12'], ['Other', '2026-03-20']]);
  });

  it('gives a leader their own team only, and never their own birthday', async () => {
    const { lead, get } = await setup();
    await db()('employees').where({ id: lead.id }).update({ birth_date: '1980-03-05' });
    const res = await get(lead);
    expect(res.body.leave.map((l) => l.name)).toEqual(['Mine', 'Mine']);
    expect(res.body.birthdays.map((b) => b.name)).toEqual(['Mine']);
    expect(res.body.holidays[0]).not.toHaveProperty('id'); // viewing, not managing
  });

  it('gives an employee only their own leave, and no birthdays', async () => {
    const { mine, other, get } = await setup();
    const own = await get(mine);
    expect(own.body.leave.map((l) => l.name)).toEqual(['Mine', 'Mine']);
    expect(own.body.birthdays).toEqual([]);
    expect(own.body.holidays).toEqual([{ date: '2026-03-03', name: 'Founders Day' }]);

    const theirs = await get(other);
    expect(theirs.body.leave.map((l) => l.name)).toEqual(['Other', 'Other']);
  });

  it('drops a deactivated person’s birthday from the calendar', async () => {
    const { hr, other, get } = await setup();
    await db()('employees').where({ id: other.id }).update({ status: 'inactive' });
    const res = await get(hr);
    expect(res.body.birthdays.map((b) => b.name)).toEqual(['Mine']);
  });
});
