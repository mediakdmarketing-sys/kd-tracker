'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const H = 3600 * 1000;
const today = () => t.localDate();

async function admin() {
  return as(await login(await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` })));
}

async function shift(e, over = {}) {
  const punchIn = over.punch_in ?? t.now() - 3 * H;
  const row = {
    id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: null, date: today(),
    total_break_seconds: 0, total_worked_seconds: null, idle_seconds: 0, status: 'open',
    over_break: false, auto_closed: false, needs_review: false, review_reason: null,
    created_at: punchIn, updated_at: punchIn, ...over,
  };
  await db()('attendance').insert(row);
  return row;
}

async function shot(e, atMs, over = {}) {
  const id = uuid();
  await db()('screenshots').insert({
    id, employee_id: e.id, attendance_id: null, image_url: `screenshots/${id}.jpg`, captured_at: atMs,
    date: t.localDate(atMs), size_bytes: 10, content_type: 'image/jpeg', file_deleted: false, created_at: atMs, ...over,
  });
  return id;
}

describe('GET /api/admin/timesheet', () => {
  it('counts a running shift up to now, net of its break, and marks who is on a break', async () => {
    const hr = await admin();
    const working = await createEmployee({ name: 'Wendy Working' });
    const resting = await createEmployee({ name: 'Rita Resting' });
    await shift(working, { punch_in: t.now() - 3 * H, total_break_seconds: 1800 });
    const s = await shift(resting, { punch_in: t.now() - 4 * H, status: 'on_break', total_break_seconds: 600 });
    await db()('breaks').insert({ id: uuid(), attendance_id: s.id, employee_id: resting.id, break_start: t.now() - 20 * 60 * 1000, break_end: null, duration_seconds: null, created_at: t.now() });

    const res = await hr.get('/api/admin/timesheet');
    expect(res.status).toBe(200);
    const w = res.body.rows.find((r) => r.name === 'Wendy Working');
    expect(w).toMatchObject({ state: 'working', punchOut: null });
    expect(w.workedSeconds).toBeGreaterThan(2.45 * 3600); // 3h minus a 30 minute break
    expect(w.workedSeconds).toBeLessThan(2.55 * 3600);

    const r = res.body.rows.find((x) => x.name === 'Rita Resting');
    expect(r.state).toBe('on_break');
    expect(r.breakSeconds).toBeGreaterThan(29 * 60); // 10 minutes banked plus about 20 running
    // The signed-in HR admin is an employee too, and has not punched in.
    expect(res.body.summary).toMatchObject({ working: 1, onBreak: 1, notStarted: 1, people: 3 });
  });

  it('shows a closed day with its times, and merges two shifts on one day', async () => {
    const hr = await admin();
    const e = await createEmployee({ name: 'Sam Splitshift' });
    const a = t.now() - 9 * H;
    await shift(e, { punch_in: a, punch_out: a + 3 * H, status: 'closed', total_worked_seconds: 3 * 3600 });
    await shift(e, { punch_in: a + 4 * H, punch_out: a + 8 * H, status: 'closed', total_worked_seconds: 3.5 * 3600, total_break_seconds: 1800 });

    const row = (await hr.get('/api/admin/timesheet')).body.rows.find((r) => r.name === 'Sam Splitshift');
    expect(row).toMatchObject({ state: 'finished', shifts: 2, workedSeconds: 6.5 * 3600, breakSeconds: 1800 });
    expect(new Date(row.punchIn).getTime()).toBe(a);
    expect(new Date(row.punchOut).getTime()).toBe(a + 8 * H);
  });

  it('lists the people who have not started, and who is on leave, for a single day', async () => {
    const hr = await admin();
    await createEmployee({ name: 'Nora NotStarted' });
    const away = await createEmployee({ name: 'Lee OnLeave' });
    await db()('leave_requests').insert({
      id: uuid(), employee_id: away.id, type: 'vacation', day_part: 'full', start_date: today(), end_date: today(),
      reason: 'x', status: 'approved', created_at: t.now(), updated_at: t.now(),
    });

    const rows = (await hr.get('/api/admin/timesheet')).body.rows;
    expect(rows.find((r) => r.name === 'Nora NotStarted').state).toBe('not_started');
    expect(rows.find((r) => r.name === 'Lee OnLeave').state).toBe('on_leave');

    // Over several days only days with shifts are listed: absence is not a row.
    const range = (await hr.get(`/api/admin/timesheet?from=${t.localDate(t.now() - 2 * 86400000)}&to=${today()}`)).body.rows;
    expect(range).toHaveLength(0);
  });

  it('filters by department and by part of a name', async () => {
    const hr = await admin();
    const a = await createEmployee({ name: 'Ravi Kumar', department: 'Sales' });
    const b = await createEmployee({ name: 'Kaaviya Ravi', department: 'Support' });
    const c = await createEmployee({ name: 'Mohan Das', department: 'Sales' });
    for (const e of [a, b, c]) await shift(e);

    const names = async (qs) => (await hr.get(`/api/admin/timesheet?${qs}`)).body.rows.map((r) => r.name).sort();
    expect(await names('employee=ravi')).toEqual(['Kaaviya Ravi', 'Ravi Kumar']);
    expect(await names('department=Sales')).toEqual(['Mohan Das', 'Ravi Kumar']);
    expect(await names('employee=RAVI&department=Sales')).toEqual(['Ravi Kumar']);
  });

  it('counts how many times each person’s microphone was muted, how long in all, and who is muted now', async () => {
    // A fixed midday, so "a few minutes ago" can never fall on yesterday's date near midnight.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-10T17:00:00Z'));
    try {
      const hr = await admin();
      const muter = await createEmployee({ name: 'Mia Muter' });
      const quiet = await createEmployee({ name: 'Liv Loud' });
      await shift(muter);
      await shift(quiet);
      const MIN = 60 * 1000;
      const ev = (e, minAgo, state) =>
        db()('mic_events').insert({ id: uuid(), employee_id: e.id, at: t.now() - minAgo * MIN, date: t.localDate(t.now() - minAgo * MIN), state, reason: null, created_at: t.now() });
      // Two stretches that ended (5 minutes each) and one that is still going.
      await ev(muter, 40, 'unavailable'); await ev(muter, 35, 'live');
      await ev(muter, 20, 'unavailable'); await ev(muter, 15, 'live');
      await ev(muter, 2, 'unavailable');

      const res = (await hr.get('/api/admin/timesheet?from=2026-11-10&to=2026-11-10')).body;
      const mia = res.rows.find((r) => r.name === 'Mia Muter');
      expect(mia).toMatchObject({ micMutedTimes: 3, micMutedNow: true });
      expect(mia.micMutedSeconds).toBe(600); // 5 + 5 minutes, and the running one has no end yet
      const liv = res.rows.find((r) => r.name === 'Liv Loud');
      expect(liv).toMatchObject({ micMutedTimes: 0, micMutedSeconds: 0, micMutedNow: false });
      expect(res.summary).toMatchObject({ micMutedTimes: 3, micMutedPeople: 1, micMutedNow: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('picks one person exactly by id, even when two people share a name part, and lists people for the picker', async () => {
    const hr = await admin();
    const a = await createEmployee({ name: 'Ravi Kumar', department: 'Sales' });
    const b = await createEmployee({ name: 'Ravi Shankar', department: 'Support' });
    const gone = await createEmployee({ name: 'Zed Former', department: 'Sales', status: 'inactive' });
    for (const e of [a, b]) {
      await shift(e);
      await shot(e, t.now() - H);
    }

    const rows = async (qs) => (await hr.get(`/api/admin/timesheet?${qs}`)).body.rows.map((r) => r.name);
    expect(await rows('employee=ravi')).toEqual(['Ravi Kumar', 'Ravi Shankar']);
    expect(await rows(`employeeId=${b.id}`)).toEqual(['Ravi Shankar']);
    // The pick wins over typed text.
    expect(await rows(`employeeId=${b.id}&employee=kumar`)).toEqual(['Ravi Shankar']);

    const shots = async (qs) => (await hr.get(`/api/admin/screenshots?${qs}`)).body.people.map((p) => p.name);
    expect(await shots(`employeeId=${a.id}`)).toEqual(['Ravi Kumar']);
    expect((await hr.get('/api/admin/screenshots?employeeId=not-an-id')).status).toBe(400);

    const options = (await hr.get('/api/admin/employee-options')).body;
    expect(options.find((o) => o.id === a.id)).toEqual({ id: a.id, name: 'Ravi Kumar', department: 'Sales', active: true });
    expect(options.find((o) => o.id === gone.id).active).toBe(false);
    expect(options.map((o) => o.name)).toEqual([...options.map((o) => o.name)].sort((x, y) => x.localeCompare(y)));
    expect((await as(await login(await createEmployee())).get('/api/admin/employee-options')).status).toBe(403);
  });

  it('offers every department people actually have for the filter, created or not', async () => {
    const hr = await admin();
    const name = `Sales-${uuid().slice(0, 5)}`; // departments are not wiped between tests
    expect((await hr.post('/api/admin/departments').send({ name })).status).toBe(201);
    await createEmployee({ department: 'Operations-X' }); // carried by a person, never created
    const created = (await hr.get('/api/admin/departments')).body;
    const filterList = (await hr.get('/api/admin/departments?inUse=1')).body;
    expect(created).toContain(name);
    expect(created).not.toContain('Operations-X');
    expect(filterList).toEqual(expect.arrayContaining(['Operations-X', name]));
    expect(filterList).toEqual([...filterList].sort((a, b) => a.localeCompare(b)));
  });

  it('counts each person’s captures per day', async () => {
    const hr = await admin();
    const e = await createEmployee({ name: 'Pic Person' });
    await shift(e);
    const g = uuid();
    await shot(e, t.now() - 2 * H);
    await shot(e, t.now() - H, { capture_group_id: g, display_index: 0, display_count: 2 });
    await shot(e, t.now() - H, { capture_group_id: g, display_index: 1, display_count: 2 }); // second screen, same moment

    expect((await hr.get('/api/admin/timesheet')).body.rows.find((r) => r.name === 'Pic Person').screenshots).toBe(2);
  });

  it('refuses a backwards or over-long range, and everyone but HR', async () => {
    const hr = await admin();
    expect((await hr.get('/api/admin/timesheet?from=2026-11-26&to=2026-11-09')).status).toBe(400);
    expect((await hr.get('/api/admin/timesheet?from=2026-01-01&to=2026-11-09')).status).toBe(400);
    const user = as(await login(await createEmployee()));
    expect((await user.get('/api/admin/timesheet')).status).toBe(403);
    expect((await request(app).get('/api/admin/timesheet')).status).toBe(401);
  });
});

describe('GET /api/admin/daily-trend', () => {
  const dayOf = (offset) => t.localDate(t.now() - offset * 24 * H);
  const closed = (e, daysAgo, workedHours, extra = {}) =>
    shift(e, {
      date: dayOf(daysAgo), punch_in: t.now() - daysAgo * 24 * H - 9 * H, punch_out: t.now() - daysAgo * 24 * H,
      status: 'closed', total_worked_seconds: workedHours * 3600, ...extra,
    });

  it('gives one point per day, with zeros for days nobody worked, and totals per day', async () => {
    const hr = await admin();
    const a = await createEmployee({ name: 'Asha' });
    const b = await createEmployee({ name: 'Bala' });
    await closed(a, 2, 8, { total_break_seconds: 1800 });
    await closed(b, 2, 6, { total_break_seconds: 600, needs_review: true });
    await closed(a, 5, 7);

    const res = await hr.get('/api/admin/daily-trend?days=7');
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.days[6].date).toBe(today()); // ends today
    expect(res.body.days[0].date).toBe(dayOf(6));

    const two = res.body.days.find((d) => d.date === dayOf(2));
    expect(two).toMatchObject({ people: 2, workedSeconds: 14 * 3600, breakSeconds: 2400, flagged: 1 });
    expect(res.body.days.find((d) => d.date === dayOf(5))).toMatchObject({ people: 1, workedSeconds: 7 * 3600 });
    expect(res.body.days.find((d) => d.date === dayOf(3))).toEqual({ date: dayOf(3), people: 0, workedSeconds: 0, breakSeconds: 0, flagged: 0 });
  });

  it('counts a shift that is still running today', async () => {
    const hr = await admin();
    await shift(await createEmployee(), { punch_in: t.now() - 2 * H });
    const res = await hr.get('/api/admin/daily-trend');
    expect(res.body.days).toHaveLength(14); // 14 days unless asked otherwise
    const last = res.body.days[13];
    expect(last.people).toBe(1);
    expect(last.workedSeconds).toBeGreaterThan(1.9 * 3600);
  });

  it('accepts only 7, 14 or 30 days, and is for HR only', async () => {
    const hr = await admin();
    expect((await hr.get('/api/admin/daily-trend?days=10')).status).toBe(400);
    expect((await hr.get('/api/admin/daily-trend?days=30')).status).toBe(200);
    const emp = as(await login(await createEmployee()));
    expect((await emp.get('/api/admin/daily-trend')).status).toBe(403);
  });
});

describe('GET /api/admin/screenshots', () => {
  it('groups everyone’s screenshots by person, with the true count, and audits the listing', async () => {
    const hr = await admin();
    const a = await createEmployee({ name: 'Anil A', department: 'Sales', blur_screenshots: true });
    const b = await createEmployee({ name: 'Bina B', department: 'Support' });
    await createEmployee({ name: 'Quiet Q' }); // no screenshots: not listed
    for (let i = 0; i < 5; i += 1) await shot(a, t.now() - (i + 1) * 10 * 60 * 1000);
    await shot(b, t.now() - 60 * 1000);

    const res = await hr.get('/api/admin/screenshots?perPerson=3');
    expect(res.status).toBe(200);
    expect(res.body.people.map((p) => p.name)).toEqual(['Anil A', 'Bina B']);
    const anil = res.body.people[0];
    expect(anil).toMatchObject({ images: 5, shown: 3, blurScreenshots: true, department: 'Sales' });
    expect(anil.items[0].fileUrl).toMatch(/^\/api\/screenshots\/file\//);
    expect(new Date(anil.items[0].capturedAt) > new Date(anil.items[1].capturedAt)).toBe(true); // newest first
    expect(res.body.pagination).toMatchObject({ total: 2, pages: 1 });
    expect(res.body.images).toBe(6); // every match, not just the 3 + 1 shown

    const entry = (await db()('audit_logs').where({ action: 'listed_screenshots' }).orderBy('timestamp', 'desc').first());
    expect(JSON.parse(entry.details)).toMatchObject({ scope: 'everyone', people: 2, images: 4 });
  });

  it('filters by department, name and date, and pages by person', async () => {
    const hr = await admin();
    const people = [];
    for (const [name, dept] of [['Ann A', 'Sales'], ['Bob B', 'Sales'], ['Cy C', 'Support']]) {
      const e = await createEmployee({ name, department: dept });
      await shot(e, t.now() - H);
      people.push(e);
    }
    const old = await createEmployee({ name: 'Old O', department: 'Sales' });
    await shot(old, t.now() - 5 * 86400000);

    const names = async (qs) => (await hr.get(`/api/admin/screenshots?${qs}`)).body.people.map((p) => p.name);
    expect(await names('department=Sales')).toEqual(['Ann A', 'Bob B']); // Old O is outside today's date
    expect(await names('employee=cy')).toEqual(['Cy C']);
    expect(await names(`from=${t.localDate(t.now() - 6 * 86400000)}&to=${today()}&department=Sales`)).toEqual(['Ann A', 'Bob B', 'Old O']);

    const page1 = (await hr.get('/api/admin/screenshots?limit=2&page=1')).body;
    const page2 = (await hr.get('/api/admin/screenshots?limit=2&page=2')).body;
    expect(page1.people.map((p) => p.name)).toEqual(['Ann A', 'Bob B']);
    expect(page2.people.map((p) => p.name)).toEqual(['Cy C']);
    expect(page1.pagination).toMatchObject({ total: 3, pages: 2 });
  });

  it('limits the range to 7 days, and is for HR only', async () => {
    const hr = await admin();
    expect((await hr.get('/api/admin/screenshots?from=2026-11-01&to=2026-11-09')).status).toBe(400);
    expect((await hr.get('/api/admin/screenshots?from=2026-11-09&to=2026-11-01')).status).toBe(400);
    const leader = as(await login(await createEmployee({ role: 'leader' })));
    expect((await leader.get('/api/admin/screenshots')).status).toBe(403);
  });
});
