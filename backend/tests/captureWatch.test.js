'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');
const watch = require('../src/services/captureWatch');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const MIN = 60 * 1000;

async function setup() {
  const leader = await createEmployee({ name: 'Lena Leader', role: 'leader', department: 'Sales' });
  await db()('department_leaders').insert({ department: 'Sales', employee_id: leader.id, assigned_at: t.now() });
  const hr = await createEmployee({ name: 'Hana HR', role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` });
  const eve = await createEmployee({ name: 'Eve Employee', department: 'Sales' });
  return { leader, hr, eve };
}

const shift = (e, minutesAgo, over = {}) => {
  const id = uuid();
  return db()('attendance')
    .insert({
      id, employee_id: e.id, punch_in: t.now() - minutesAgo * MIN, date: t.localDate(), status: 'open',
      total_break_seconds: 0, total_worked_seconds: null, idle_seconds: 0, over_break: false, auto_closed: false,
      needs_review: false, created_at: t.now(), updated_at: t.now(), ...over,
    })
    .then(() => id);
};
const agentSeen = async (e, minutesAgo) => {
  await request(app).post('/api/auth/login').send({ email: e.email, password: 'Password123!', client: 'desktop' });
  await db()('sessions').where({ employee_id: e.id, client: 'desktop' }).update({ last_seen_at: t.now() - minutesAgo * MIN });
};
const inbox = async (person, type) => (await as(await login(person)).get('/api/notifications')).body.items.filter((i) => i.type === type);
const activity = (e, minutesAgo) =>
  db()('activity_logs').insert({
    id: uuid(), employee_id: e.id, date: t.localDate(), timestamp: t.now() - minutesAgo * MIN, keystroke_count: 5, mouse_count: 5,
    window_title: 'Chrome', created_at: t.now(),
  });

describe('the agent goes quiet during a shift', () => {
  it('records a gap, tells HR and the leader once, and closes it when the agent is back', async () => {
    const { hr, leader, eve } = await setup();
    const shiftId = await shift(eve, 60);
    await agentSeen(eve, 12); // last heard from twelve minutes ago

    expect(await watch.run()).toMatchObject({ opened: 1, closed: 0 });
    const gap = await db()('capture_gaps').first();
    expect(gap).toMatchObject({ employee_id: eve.id, attendance_id: shiftId, ended_at: null, reason: 'agent_offline' });
    expect(Math.abs(Number(gap.started_at) - (t.now() - 12 * MIN))).toBeLessThan(5000); // from when it went quiet

    for (const person of [hr, leader]) {
      const [alert] = await inbox(person, 'agent_offline');
      expect(alert.title).toBe('Agent offline: Eve Employee');
      expect(alert.body).toContain('Nothing is being captured');
    }
    expect((await inbox(hr, 'agent_offline'))[0].link).toBe(`/admin/employees/${eve.id}`);
    expect((await inbox(leader, 'agent_offline'))[0].link).toBe(`/leader/members/${eve.id}`);

    // The same gap is not announced again, and not counted twice.
    expect(await watch.run()).toMatchObject({ opened: 0 });
    expect(await inbox(hr, 'agent_offline')).toHaveLength(1);
    expect(await db()('capture_gaps').count({ n: '*' }).first().then((r) => Number(r.n))).toBe(1);

    // The agent talks to the server again: the gap ends.
    await db()('sessions').where({ employee_id: eve.id }).update({ last_seen_at: t.now() });
    await activity(eve, 0); // connected again and sending samples
    expect(await watch.run()).toMatchObject({ closed: 1 });
    expect((await db()('capture_gaps').first()).ended_at).not.toBeNull();
  });

  it('gives a short silence time, and someone who has not started the agent a little longer', async () => {
    const { eve } = await setup();
    await shift(eve, 60);
    await agentSeen(eve, 3); // quiet for 3 minutes: not yet
    expect(await watch.run()).toMatchObject({ opened: 0 });

    const bob = await createEmployee({ name: 'Bob', department: 'Sales' });
    await shift(bob, 6); // punched in 6 minutes ago, no agent at all: still inside the grace
    expect(await watch.run()).toMatchObject({ opened: 0 });

    const cy = await createEmployee({ name: 'Cy', department: 'Sales' });
    const cyShift = await shift(cy, 15); // 15 minutes, no agent: counts, from the punch-in
    expect(await watch.run()).toMatchObject({ opened: 1 });
    const gap = await db()('capture_gaps').where({ attendance_id: cyShift }).first();
    expect(Math.abs(Number(gap.started_at) - (t.now() - 15 * MIN))).toBeLessThan(5000);
  });

  it('expects nothing from someone on a break, and ends the gap when the shift ends', async () => {
    const { eve } = await setup();
    await shift(eve, 60, { status: 'on_break' });
    await agentSeen(eve, 30);
    expect(await watch.run()).toMatchObject({ opened: 0 }); // on a break: not expected to be captured

    await db()('attendance').where({ employee_id: eve.id }).update({ status: 'open' });
    expect(await watch.run()).toMatchObject({ opened: 1 });
    await db()('attendance').where({ employee_id: eve.id }).update({ status: 'closed', punch_out: t.now() - 5 * MIN, total_worked_seconds: 3000 });
    expect(await watch.run()).toMatchObject({ closed: 1 });
    // It ends when the shift ended (five minutes ago), not when the watch noticed.
    expect(Math.abs(Number((await db()('capture_gaps').first()).ended_at) - (t.now() - 5 * MIN))).toBeLessThan(5000);
  });
});

describe('long idle', () => {
  it('tells HR and the leader when a running agent sees no activity for 30 minutes, then waits before telling again', async () => {
    const { hr, leader, eve } = await setup();
    await shift(eve, 50);
    await agentSeen(eve, 0); // the agent is fine
    await activity(eve, 40); // the last activity was 40 minutes ago

    expect(await watch.run()).toMatchObject({ idleAlerts: 1, opened: 0 });
    for (const person of [hr, leader]) {
      const [alert] = await inbox(person, 'long_idle');
      expect(alert.title).toBe('No activity: Eve Employee');
      expect(alert.body).toContain('meeting');
    }
    expect(await watch.run()).toMatchObject({ idleAlerts: 0 }); // not again so soon
    expect(await inbox(hr, 'long_idle')).toHaveLength(1);
  });

  it('says nothing when there was recent activity, a short shift, or no agent (that is the other alert)', async () => {
    const { eve } = await setup();
    const active = await createEmployee({ name: 'Active', department: 'Sales' });
    const fresh = await createEmployee({ name: 'Fresh', department: 'Sales' });
    await shift(active, 90); await agentSeen(active, 0); await activity(active, 5); // working
    await shift(fresh, 20); await agentSeen(fresh, 0); await activity(fresh, 0); // only 20 minutes into the shift
    await shift(eve, 90); await agentSeen(eve, 20); // agent quiet, so a gap and not an idle alert

    const result = await watch.run();
    expect(result.idleAlerts).toBe(0);
    expect(result.opened).toBe(1);
  });
});

describe('a connection kept alive without the agent', () => {
  it('flags an agent that is connected but delivers no activity, and closes it when data arrives', async () => {
    const { hr, eve } = await setup();
    await shift(eve, 60);
    await agentSeen(eve, 0); // a session that keeps asking the server...
    // ...but not one activity sample has arrived in the hour.
    expect(await watch.run()).toMatchObject({ opened: 1 });
    const gap = await db()('capture_gaps').first();
    expect(gap.reason).toBe('agent_no_data');
    const [alert] = await inbox(hr, 'agent_offline');
    expect(alert.title).toBe('Agent not sending data: Eve Employee');

    expect(await watch.run()).toMatchObject({ opened: 0 }); // not announced twice
    await activity(eve, 0);
    expect(await watch.run()).toMatchObject({ closed: 1 });
  });

  it('gives a person coming back from a break time before expecting samples again', async () => {
    const { eve } = await setup();
    const id = await shift(eve, 90);
    await agentSeen(eve, 0);
    await activity(eve, 0);
    await db()('activity_logs').update({ created_at: t.now() - 40 * MIN }); // last sample before a 30 min break
    await db()('breaks').insert({ id: uuid(), attendance_id: id, employee_id: eve.id, break_start: t.now() - 35 * MIN, break_end: t.now() - 2 * MIN, duration_seconds: 1980, created_at: t.now() });
    expect(await watch.run()).toMatchObject({ opened: 0 });
  });
});

describe('scripted activity', () => {
  const sample = (e, minutesAgo, keys, mouse) =>
    db()('activity_logs').insert({ id: uuid(), employee_id: e.id, date: t.localDate(), timestamp: t.now() - minutesAgo * MIN, keystroke_count: keys, mouse_count: mouse, window_title: 'Chrome', created_at: t.now() });

  it('tells HR and the leader about identical busy readings every minute, once', async () => {
    const { hr, leader, eve } = await setup();
    await shift(eve, 60);
    await agentSeen(eve, 0);
    for (let i = 0; i < 25; i += 1) await sample(eve, i, 0, 120); // a jiggler: same mouse count, no keys
    expect(await watch.run()).toMatchObject({ patternAlerts: 1 });
    for (const person of [hr, leader]) expect(await inbox(person, 'scripted_activity')).toHaveLength(1);
    expect(await watch.run()).toMatchObject({ patternAlerts: 0 });
  });

  it('leaves real, varied work alone, and quiet stretches', async () => {
    const { eve } = await setup();
    const bob = await createEmployee({ name: 'Bob', department: 'Sales' });
    await shift(eve, 60); await agentSeen(eve, 0);
    await shift(bob, 60); await agentSeen(bob, 0);
    for (let i = 0; i < 25; i += 1) {
      await sample(eve, i, (i * 7) % 40, 30 + ((i * 13) % 90)); // varied
      await sample(bob, i, 0, i % 2 ? 0 : 50); // half the minutes quiet
    }
    expect(await watch.run()).toMatchObject({ patternAlerts: 0 });
  });
});

describe('what HR and leaders see, and what it does not do', () => {
  it('shows the no-capture time on the timesheet and counts the day as flagged', async () => {
    const { hr, leader, eve } = await setup();
    await shift(eve, 60);
    await agentSeen(eve, 20);
    await watch.run();

    const row = (res) => res.body.rows.find((r) => r.employeeId === eve.id);
    const sheet = await as(await login(hr)).get('/api/admin/timesheet');
    expect(row(sheet).noCaptureSeconds).toBeGreaterThan(19 * 60);
    expect(sheet.body.summary).toMatchObject({ flagged: 1, noCapturePeople: 1 });

    const mine = await as(await login(leader)).get('/api/leader/timesheet'); // leaders see it for their people
    expect(row(mine).noCaptureSeconds).toBeGreaterThan(19 * 60);

    // It is a flag only: the worked time of the shift is whatever the shift says, nothing is taken off.
    expect(row(sheet).workedSeconds).toBeGreaterThan(55 * 60);
  });

  it('is exported with the timesheet CSV', async () => {
    const { hr, eve } = await setup();
    await shift(eve, 60);
    await agentSeen(eve, 20);
    await watch.run();
    const csv = (await as(await login(hr)).get('/api/admin/timesheet/export')).text;
    expect(csv).toContain('No capture (HH:MM:SS)');
  });
});
