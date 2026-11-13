'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');
const settings = require('../src/services/settings');
const calendar = require('../src/services/holidayCalendar');

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  await settings.update({ leave: { allowances: { sick: null, bereavement: null, personal: null, emergency: null, vacation: null } } });
});
afterAll(destroy);

const YEAR = 2026;

/** Working days in [start, end]: the company's payroll work days (Monday to Friday by default), minus company holidays. */
async function workingDays(start, end) {
  const holidays = new Set((await calendar.holidaysBetween(start, end)).map((h) => h.date));
  const workDays = settings.get().payroll.workDays;
  let n = 0;
  for (let d = new Date(`${start}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (workDays.includes(d.getUTCDay()) && !holidays.has(d.toISOString().slice(0, 10))) n += 1;
  }
  return n;
}

async function leave(e, { type = 'vacation', start, end = start, dayPart = 'full', status = 'approved' }) {
  const row = {
    id: uuid(), employee_id: e.id, type, start_date: start, end_date: end, day_part: dayPart,
    status, created_at: t.now(), updated_at: t.now(),
  };
  await db()('leave_requests').insert(row);
  return row;
}

describe('GET /api/leave/balance', () => {
  it('shows allowance, days taken, days waiting and what is left, per type', async () => {
    const e = await createEmployee({ name: 'Eve Employee' });
    const api = as(await login(e));
    await settings.update({ leave: { allowances: { vacation: 10, sick: 5 } } });

    // Monday to the following Sunday: the weekend does not count.
    const week = await workingDays('2026-03-02', '2026-03-08');
    await leave(e, { start: '2026-03-02', end: '2026-03-08' });
    await leave(e, { type: 'vacation', start: '2026-04-15', dayPart: 'half_am', status: 'pending' });
    await leave(e, { type: 'sick', start: '2026-05-04', status: 'rejected' }); // never counts
    await leave(e, { type: 'personal', start: '2026-06-02' }); // no allowance set for personal

    const res = await api.get(`/api/leave/balance?year=${YEAR}`);
    expect(res.status).toBe(200);
    expect(res.body.year).toBe(YEAR);
    const by = Object.fromEntries(res.body.balances.map((b) => [b.type, b]));

    expect(by.vacation).toMatchObject({ allowance: 10, used: week, pending: 0.5, left: 10 - week - 0.5 });
    expect(by.sick).toMatchObject({ allowance: 5, used: 0, pending: 0, left: 5 });
    expect(by.personal).toMatchObject({ allowance: null, used: 1, left: null }); // counted, but no limit to compare with
    expect(by.vacation.label).toContain('Vacation');
  });

  it('counts only the days inside the year for leave that crosses New Year', async () => {
    const e = await createEmployee();
    const api = as(await login(e));
    await settings.update({ leave: { allowances: { vacation: 20 } } });
    await leave(e, { start: '2026-12-28', end: '2027-01-05' });
    const inside2026 = await workingDays('2026-12-28', '2026-12-31');
    const inside2027 = await workingDays('2027-01-01', '2027-01-05');

    const by = async (year) => Object.fromEntries((await api.get(`/api/leave/balance?year=${year}`)).body.balances.map((b) => [b.type, b]));
    expect((await by(2026)).vacation.used).toBe(inside2026);
    expect((await by(2027)).vacation.used).toBe(inside2027);
  });
});

describe('what a reviewer sees', () => {
  it('shows the days a waiting request asks for and what would be left, and nothing for other states or unlimited types', async () => {
    const hr = await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` });
    const e = await createEmployee({ name: 'Eve Employee' });
    await settings.update({ leave: { allowances: { vacation: 3 } } });
    await leave(e, { start: '2026-03-02', end: '2026-03-03' }); // 2 days taken
    await leave(e, { start: '2026-09-01', end: '2026-09-03', status: 'pending' }); // asks for 3 more: over
    await leave(e, { type: 'sick', start: '2026-09-08', status: 'pending' }); // no allowance for sick

    const list = (await as(await login(hr)).get('/api/admin/leave?status=pending')).body;
    const vacation = list.find((r) => r.type === 'vacation');
    const days = await workingDays('2026-09-01', '2026-09-03');
    expect(vacation.days).toBe(days);
    expect(vacation.balance).toEqual({ allowance: 3, used: 2, leftIfApproved: 3 - 2 - days });
    expect(list.find((r) => r.type === 'sick').balance).toBeNull();
  });
});

describe('the allowances setting', () => {
  it('lets HR set, change in half days, and clear them', async () => {
    const hr = as(await login(await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` })));
    expect((await hr.patch('/api/admin/settings').send({ leave: { allowances: { vacation: 14, sick: 7.5 } } })).status).toBe(200);
    expect((await hr.get('/api/admin/settings')).body.leave.allowances).toMatchObject({ vacation: 14, sick: 7.5, personal: null });

    expect((await hr.patch('/api/admin/settings').send({ leave: { allowances: { vacation: -1 } } })).status).toBe(400);
    expect((await hr.patch('/api/admin/settings').send({ leave: { allowances: { vacation: 2.3 } } })).status).toBe(400);
    expect((await hr.patch('/api/admin/settings').send({ leave: { allowances: { vacation: 500 } } })).status).toBe(400);

    await hr.patch('/api/admin/settings').send({ leave: { allowances: { vacation: null } } });
    expect(settings.get().leave.allowances).toMatchObject({ vacation: null, sick: 7.5 }); // only the one changed
  });
});
