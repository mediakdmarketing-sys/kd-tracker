'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const birthdays = require('../src/services/birthdays');
const notifications = require('../src/services/notifications');
const { uuid } = require('../src/utils/ids');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return { row: a, api: as(await login(a)) };
}

async function leaderOf(department) {
  const l = await createEmployee({ role: 'leader', department: 'Management', email: `lead-${uuid().slice(0, 6)}@kdmarketing.in` });
  await db()('department_leaders').insert({ department, employee_id: l.id, assigned_at: Date.now() });
  return l;
}

const inbox = (id) => db()('notifications').where({ employee_id: id, type: 'birthday' });

describe('setting a birthday', () => {
  it('HR sets and clears it, and refuses a future or impossible date', async () => {
    const { api } = await admin();
    const e = await createEmployee();

    const set = await api.patch(`/api/admin/employees/${e.id}`).send({ birthday: '1995-08-14' });
    expect(set.status).toBe(200);
    expect(set.body.birthday).toBe('1995-08-14');

    expect((await api.patch(`/api/admin/employees/${e.id}`).send({ birthday: '2999-01-01' })).status).toBe(400);
    expect((await api.patch(`/api/admin/employees/${e.id}`).send({ birthday: '1995-02-30' })).status).toBe(400);

    const cleared = await api.patch(`/api/admin/employees/${e.id}`).send({ birthday: null });
    expect(cleared.body.birthday).toBeNull();
  });

  it('can be given when the employee is created', async () => {
    const { api } = await admin();
    const res = await api.post('/api/admin/employees').send({
      name: 'Asha', email: `asha-${uuid().slice(0, 5)}@kdmarketing.in`, birthday: '1999-03-02',
    });
    expect(res.status).toBe(201);
    expect(res.body.birthday).toBe('1999-03-02');
  });
});

describe('the HR calendar feed', () => {
  it('lists active people only, on their date in the year asked, with 29 Feb moved to 28 Feb', async () => {
    const { api } = await admin();
    await createEmployee({ name: 'Ann', birth_date: '1990-06-10' });
    await createEmployee({ name: 'Leap', birth_date: '1996-02-29' });
    await createEmployee({ name: 'Gone', birth_date: '1991-06-11', status: 'inactive' });
    await createEmployee({ name: 'NoDate' });

    const res = await api.get('/api/admin/birthdays?year=2027');
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => [r.name, r.date])).toEqual([
      ['Leap', '2027-02-28'],
      ['Ann', '2027-06-10'],
    ]);
    expect((await api.get('/api/admin/birthdays?year=2028')).body.rows[0].date).toBe('2028-02-29');
  });

  it('is for HR only', async () => {
    const u = await createEmployee();
    const res = await as(await login(u)).get('/api/admin/birthdays?year=2027');
    expect(res.status).toBe(403);
    expect((await request(app).get('/api/admin/birthdays?year=2027')).status).toBe(401);
  });
});

describe('birthday reminders', () => {
  it('tells HR and the leader the day before and on the day, once each, not the person', async () => {
    const hr = await createEmployee({ role: 'admin' });
    const lead = await leaderOf('Sales');
    const other = await leaderOf('Support');
    const bday = await createEmployee({ name: 'Ravi', department: 'Sales', birth_date: '1992-09-20' });

    expect((await birthdays.sendReminders({ today: '2026-09-18' })).affected).toBe(0); // two days ahead

    await birthdays.sendReminders({ today: '2026-09-19' });
    await birthdays.sendReminders({ today: '2026-09-19' }); // a repeat run adds nothing
    expect(await inbox(hr.id)).toHaveLength(1);
    expect(await inbox(lead.id)).toHaveLength(1);
    expect((await inbox(hr.id))[0].title).toBe("Ravi's birthday is tomorrow");
    expect(await inbox(other.id)).toHaveLength(0); // leads another department
    expect(await inbox(bday.id)).toHaveLength(0); // it is a surprise

    await birthdays.sendReminders({ today: '2026-09-20' });
    expect(await inbox(hr.id)).toHaveLength(2);
    expect((await inbox(lead.id)).map((n) => n.title)).toContain("Today is Ravi's birthday");
    const { items } = await notifications.listFor(lead.id);
    expect(items.find((n) => n.type === 'birthday').link).toBe(`/leader/members/${bday.id}`);
  });

  it('sees a 1 January birthday from 31 December, and skips inactive people', async () => {
    const hr = await createEmployee({ role: 'admin' });
    await createEmployee({ name: 'NewYear', birth_date: '1990-01-01' });
    await createEmployee({ name: 'Left', birth_date: '1990-12-31', status: 'inactive' });

    await birthdays.sendReminders({ today: '2026-12-31' });
    const titles = (await inbox(hr.id)).map((n) => n.title);
    expect(titles).toEqual(["NewYear's birthday is tomorrow"]);
  });

  it('sends a leader’s own birthday to HR only', async () => {
    const hr = await createEmployee({ role: 'admin' });
    const lead = await leaderOf('Sales');
    await db()('employees').where({ id: lead.id }).update({ birth_date: '1985-05-05' });

    await birthdays.sendReminders({ today: '2026-05-05' });
    expect(await inbox(hr.id)).toHaveLength(1);
    expect(await inbox(lead.id)).toHaveLength(0);
  });
});
