'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

// 'personal' is one of the newer types, so this also covers the SQLite CHECK repair migration.
const LEAVE = { type: 'personal', startDate: '2026-12-01', endDate: '2026-12-02', dayPart: 'full' };

/** One department with an employee, its team leader, a second leader, and an HR admin. */
async function team(employeeOverrides = {}) {
  const employee = await createEmployee({
    name: 'Eve Employee',
    department: 'Sales',
    role: 'user',
    ...employeeOverrides,
  });
  const leader = await createEmployee({ name: 'Lena Leader', department: 'Sales', role: 'leader' });
  const otherLeader = await createEmployee({ name: 'Omar Other', department: 'Sales', role: 'leader' });
  const hr = await createEmployee({ name: 'Hana HR', department: 'HR', role: 'admin' });
  const outsider = await createEmployee({ name: 'Ola Outsider', department: 'Support', role: 'user' });
  for (const l of [leader, otherLeader]) {
    await db()('department_leaders').insert({ department: 'Sales', employee_id: l.id, assigned_at: t.now() });
  }
  return { employee, leader, otherLeader, hr, outsider };
}

async function inbox(person) {
  const token = await login(person);
  const res = await as(token).get('/api/notifications');
  expect(res.status).toBe(200);
  return res.body;
}

async function request(employee) {
  const token = await login(employee);
  const res = await as(token).post('/api/leave').send(LEAVE);
  expect(res.status).toBe(201);
  return res.body;
}

describe('a new leave request', () => {
  it('tells the team leaders and HR, but not the requester or other departments', async () => {
    const { employee, leader, otherLeader, hr, outsider } = await team();
    await request(employee);

    for (const person of [leader, otherLeader, hr]) {
      const { items, unreadCount } = await inbox(person);
      expect(unreadCount).toBe(1);
      expect(items[0].type).toBe('leave_requested');
      expect(items[0].body).toContain('Eve Employee');
    }
    expect((await inbox(employee)).items).toHaveLength(0);
    expect((await inbox(outsider)).items).toHaveLength(0);
  });

  it('links leaders to their queue and HR to theirs', async () => {
    const { employee, leader, hr } = await team();
    await request(employee);
    expect((await inbox(leader)).items[0].link).toBe('/leader/leave');
    expect((await inbox(hr)).items[0].link).toBe('/admin/leave');
  });

  it('goes to HR only when a leader asks for leave', async () => {
    const { leader, otherLeader, hr } = await team();
    await request(leader);
    expect((await inbox(hr)).items).toHaveLength(1);
    expect((await inbox(otherLeader)).items).toHaveLength(0);
  });
});

describe('a decision', () => {
  it('when HR decides: tells the employee and the leaders', async () => {
    const { employee, leader, otherLeader, hr } = await team();
    const created = await request(employee);
    await (async () => {
      const token = await login(hr);
      const res = await as(token).patch(`/api/admin/leave/${created.id}`).send({ status: 'approved' });
      expect(res.status).toBe(200);
      expect(res.body.reviewedByName).toBe('Hana HR');
      expect(res.body.reviewedByRole).toBe('HR / Admin');
    })();

    const mine = await inbox(employee);
    expect(mine.items[0].type).toBe('leave_approved');
    expect(mine.items[0].body).toContain('Hana HR');

    for (const person of [leader, otherLeader]) {
      const { items } = await inbox(person);
      const decision = items.find((i) => i.type === 'leave_approved_by_reviewer');
      expect(decision).toBeTruthy();
      expect(decision.title).toContain('HR');
    }
  });

  it('when a leader decides: tells the employee, HR and the other leader', async () => {
    const { employee, leader, otherLeader, hr } = await team();
    const created = await request(employee);
    const token = await login(leader);
    const res = await as(token).patch(`/api/leader/leave/${created.id}`).send({ status: 'rejected', reviewNote: 'Busy week' });
    expect(res.status).toBe(200);
    expect(res.body.reviewedByRole).toBe('Team leader');

    const mine = await inbox(employee);
    expect(mine.items[0].type).toBe('leave_rejected');
    expect(mine.items[0].body).toContain('Busy week');

    const forHr = (await inbox(hr)).items.find((i) => i.type === 'leave_rejected_by_reviewer');
    expect(forHr).toBeTruthy();
    expect(forHr.body).toContain('Lena Leader');
    expect((await inbox(otherLeader)).items.some((i) => i.type === 'leave_rejected_by_reviewer')).toBe(true);
    // The leader who decided is not told about their own decision.
    expect((await inbox(leader)).items.some((i) => i.type === 'leave_rejected_by_reviewer')).toBe(false);
  });

  it('shows who decided in the list the other reviewer reads', async () => {
    const { employee, leader, hr } = await team();
    const created = await request(employee);
    await as(await login(hr)).patch(`/api/admin/leave/${created.id}`).send({ status: 'approved' });

    const res = await as(await login(leader)).get('/api/leader/leave');
    expect(res.status).toBe(200);
    expect(res.body[0].status).toBe('approved');
    expect(res.body[0].reviewedByName).toBe('Hana HR');
    expect(res.body[0].reviewedByRole).toBe('HR / Admin');
  });
});

describe('a muted microphone', () => {
  // A few bytes are enough: the server stores whatever audio it is given.
  const SAMPLE = Buffer.from('not really audio').toString('base64');

  async function punchedIn() {
    const people = await team({ consent_audio: true });
    const token = await login(people.employee);
    const res = await as(token).post('/api/attendance/punch-in');
    expect(res.status).toBe(201);
    return { ...people, token };
  }

  function upload(token, micMuted) {
    return as(token)
      .post('/api/audio/upload')
      .send({ audioBase64: SAMPLE, durationSeconds: 5, contentType: 'audio/webm', micMuted });
  }

  it('tells HR and the team leaders, naming the employee', async () => {
    const { token, leader, otherLeader, hr, employee, outsider } = await punchedIn();
    const res = await upload(token, true);
    expect(res.status).toBe(201);

    for (const person of [hr, leader, otherLeader]) {
      const alert = (await inbox(person)).items.find((i) => i.type === 'mic_inactive');
      expect(alert).toBeTruthy();
      expect(alert.title).toBe('Mic not active: Eve Employee');
    }
    expect((await inbox(hr)).items.find((i) => i.type === 'mic_inactive').link)
      .toBe(`/admin/employees/${employee.id}`);
    expect((await inbox(leader)).items.find((i) => i.type === 'mic_inactive').link)
      .toBe(`/leader/members/${employee.id}`);
    // Not the employee themselves, and not another department's people.
    expect((await inbox(employee)).items).toHaveLength(0);
    expect((await inbox(outsider)).items).toHaveLength(0);
  });

  it('says nothing while the microphone is picking up sound', async () => {
    const { token, hr } = await punchedIn();
    expect((await upload(token, false)).status).toBe(201);
    expect((await inbox(hr)).items).toHaveLength(0);
  });

  it('does not repeat the alert for every sample, only once an hour', async () => {
    const { token, hr } = await punchedIn();
    expect((await upload(token, true)).status).toBe(201);
    expect((await upload(token, true)).status).toBe(201);
    const alerts = (await inbox(hr)).items.filter((i) => i.type === 'mic_inactive');
    expect(alerts).toHaveLength(1);
  });
});

describe('the inbox', () => {
  it('marks notifications read, only for the caller', async () => {
    const { employee, leader, hr } = await team();
    await request(employee);

    const token = await login(leader);
    const before = await as(token).get('/api/notifications');
    expect(before.body.unreadCount).toBe(1);

    const marked = await as(token).post('/api/notifications/read').send({ all: true });
    expect(marked.status).toBe(200);
    expect(marked.body.updated).toBe(1);

    const after = await as(token).get('/api/notifications');
    expect(after.body.unreadCount).toBe(0);
    expect(after.body.items[0].read).toBe(true);
    // HR's copy is untouched.
    expect((await inbox(hr)).unreadCount).toBe(1);
  });

  it('refuses a request that names nothing to mark', async () => {
    const { employee } = await team();
    const res = await as(await login(employee)).post('/api/notifications/read').send({});
    expect(res.status).toBe(400);
  });

  it('needs a sign-in', async () => {
    const res = await as('not-a-token').get('/api/notifications');
    expect(res.status).toBe(401);
  });
});
