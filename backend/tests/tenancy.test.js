'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const companies = require('../src/services/companies');
const settings = require('../src/services/settings');
const t = require('../src/utils/time');

const A = companies.DEFAULT_COMPANY_ID;
const B = '00000000-0000-4000-8000-0000000000b2';

beforeAll(migrate);
afterAll(destroy);

beforeEach(async () => {
  await truncate();
  await db()('departments').del();
  await db()('companies').where({ id: B }).del();
  await db()('companies').insert({ id: B, name: 'Second Co', slug: 'second', status: 'active', created_at: t.now(), updated_at: t.now() });
  await db()('companies').where({ id: A }).update({ status: 'active' });
  companies.invalidate();
});

/** Two companies, each with an HR admin and an employee in a department with the same name. */
async function world() {
  const hrA = await createEmployee({ name: 'HR A', role: 'admin', department: 'Sales', company_id: A });
  const empA = await createEmployee({ name: 'Emp A', role: 'user', department: 'Sales', company_id: A });
  const hrB = await createEmployee({ name: 'HR B', role: 'admin', department: 'Sales', company_id: B });
  const empB = await createEmployee({ name: 'Emp B', role: 'user', department: 'Sales', company_id: B });
  return { hrA, empA, hrB, empB };
}

describe('employees', () => {
  it('lists only the admin\'s own company', async () => {
    const { hrB } = await world();
    const res = await as(await login(hrB)).get('/api/admin/employees');
    expect(res.status).toBe(200);
    expect(res.body.data.map((r) => r.name).sort()).toEqual(['Emp B', 'HR B']);
  });

  it('answers 404 for another company\'s employee, on read and on update', async () => {
    const { hrB, empA } = await world();
    const api = as(await login(hrB));
    expect((await api.get(`/api/admin/employees/${empA.id}`)).status).toBe(404);
    const patch = await api.patch(`/api/admin/employees/${empA.id}`).send({ name: 'Hacked' });
    expect(patch.status).toBe(404);
    const row = await db()('employees').where({ id: empA.id }).first();
    expect(row.name).toBe('Emp A');
  });

  it('creates people inside the admin\'s own company', async () => {
    const { hrB } = await world();
    const res = await as(await login(hrB))
      .post('/api/admin/employees')
      .send({ name: 'New B', email: 'new-b@example.com', role: 'user', department: 'Sales' });
    expect(res.status).toBe(201);
    const row = await db()('employees').where({ id: res.body.id }).first();
    expect(row.company_id).toBe(B);
  });

  it('keeps work emails unique across companies', async () => {
    const { hrB, empA } = await world();
    const res = await as(await login(hrB))
      .post('/api/admin/employees')
      .send({ name: 'Dup', email: empA.email, role: 'user' });
    expect(res.status).toBe(409);
  });
});

describe('reading someone else\'s records', () => {
  it('refuses attendance and capture lists of another company', async () => {
    const { hrB, empA } = await world();
    const api = as(await login(hrB));
    expect((await api.get(`/api/attendance/${empA.id}`)).status).toBe(403);
    expect((await api.get(`/api/screenshots/${empA.id}`)).status).toBe(403);
    expect((await api.get(`/api/audio/${empA.id}`)).status).toBe(403);
    expect((await api.get(`/api/activity/${empA.id}`)).status).toBe(403);
  });

  it('hides another company\'s files by id', async () => {
    const { hrB, empA } = await world();
    const id = '11111111-1111-4111-8111-111111111111';
    await db()('screenshots').insert({
      id,
      employee_id: empA.id,
      image_url: 'screenshots/x.jpg',
      content_type: 'image/jpeg',
      captured_at: t.now(),
      date: '2026-10-01',
      size_bytes: 1,
      created_at: t.now(),
    });
    const res = await as(await login(hrB)).get(`/api/screenshots/file/${id}`);
    expect(res.status).toBe(404);
  });
});

describe('reports and boards', () => {
  it('shows only the company\'s people on the live board and in reports', async () => {
    const { hrB, empA, empB } = await world();
    const day = '2026-10-05';
    for (const e of [empA, empB]) {
      await db()('attendance').insert({
        id: require('../src/utils/ids').uuid(),
        employee_id: e.id,
        date: day,
        punch_in: t.now() - 3600_000,
        punch_out: t.now(),
        status: 'closed',
        total_worked_seconds: 3600,
        total_break_seconds: 0,
        idle_seconds: 0,
        created_at: t.now(),
        updated_at: t.now(),
      });
    }
    const api = as(await login(hrB));
    const board = await api.get('/api/admin/dashboard');
    expect(board.body.employees.map((e) => e.name).sort()).toEqual(['Emp B', 'HR B']);

    const report = await api.get(`/api/admin/reports?from=${day}&to=${day}`);
    expect(report.body.rows.map((r) => r.name)).toEqual(['Emp B']);
  });

  it('shows only the company\'s admin actions in the audit trail', async () => {
    const { hrA, hrB } = await world();
    await as(await login(hrA)).post('/api/admin/departments').send({ name: 'Ops' });
    await as(await login(hrA)).post('/api/admin/employees').send({ name: 'X', email: 'x@example.com' });
    const res = await as(await login(hrB)).get('/api/admin/audit-logs');
    expect(res.status).toBe(200);
    expect(res.body.data.every((r) => r.adminId === hrB.id)).toBe(true);
  });
});

describe('departments', () => {
  it('lets two companies use the same department name, and lists only their own', async () => {
    const { hrA, hrB } = await world();
    expect((await as(await login(hrA)).post('/api/admin/departments').send({ name: 'Support' })).status).toBe(201);
    expect((await as(await login(hrB)).post('/api/admin/departments').send({ name: 'Support' })).status).toBe(201);
    expect((await as(await login(hrB)).post('/api/admin/departments').send({ name: 'Support' })).status).toBe(409);
    const list = await as(await login(hrB)).get('/api/admin/departments');
    expect(list.body).toEqual(['Support']);
  });

  it('refuses to make someone from another company a leader', async () => {
    const { hrB, empA } = await world();
    const res = await as(await login(hrB))
      .post('/api/admin/department-leaders')
      .send({ department: 'Sales', employeeId: empA.id });
    expect(res.status).toBe(404);
  });
});

describe('leave', () => {
  const LEAVE = { type: 'personal', startDate: '2026-12-01', endDate: '2026-12-02', dayPart: 'full' };

  it('notifies and lists only the company\'s own HR, and blocks cross-company decisions', async () => {
    const { hrA, hrB, empA } = await world();
    const made = await as(await login(empA)).post('/api/leave').send(LEAVE);
    expect(made.status).toBe(201);

    const inboxA = await as(await login(hrA)).get('/api/notifications');
    const inboxB = await as(await login(hrB)).get('/api/notifications');
    expect(inboxA.body.unreadCount).toBe(1);
    expect(inboxB.body.unreadCount).toBe(0);

    const listB = await as(await login(hrB)).get('/api/admin/leave');
    expect(listB.body).toHaveLength(0);
    const decide = await as(await login(hrB)).patch(`/api/admin/leave/${made.body.id}`).send({ status: 'approved' });
    expect(decide.status).toBe(403);
    const listA = await as(await login(hrA)).get('/api/admin/leave');
    expect(listA.body).toHaveLength(1);
  });
});

describe('settings', () => {
  it('keeps each company\'s settings separate', async () => {
    const { hrA, hrB } = await world();
    const patch = await as(await login(hrB)).patch('/api/admin/settings').send({ shift: { targetSeconds: 18000 } });
    expect(patch.status).toBe(200);
    const mine = await as(await login(hrB)).get('/api/admin/settings');
    const theirs = await as(await login(hrA)).get('/api/admin/settings');
    expect(mine.body.shift.targetSeconds).toBe(18000);
    expect(theirs.body.shift.targetSeconds).not.toBe(18000);
    expect(settings.get(B).shift.targetSeconds).toBe(18000);
  });
});

describe('a suspended company', () => {
  it('cannot sign in, and a signed-in session stops working', async () => {
    const { hrB, empB } = await world();
    const token = await login(empB);
    await db()('companies').where({ id: B }).update({ status: 'suspended' });
    companies.invalidate();

    const res = await as(token).get('/api/attendance/status');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');

    await expect(login(hrB)).rejects.toThrow(/COMPANY_SUSPENDED/);
  });
});


describe('the platform owner', () => {
  async function owner() {
    return createEmployee({ name: 'Owner', role: 'admin', is_super_admin: true, company_id: A });
  }

  it('is the only one who can reach /api/super', async () => {
    const { hrA } = await world();
    const res = await as(await login(hrA)).get('/api/super/companies');
    expect(res.status).toBe(403);
    const ok = await as(await login(await owner())).get('/api/super/companies');
    expect(ok.status).toBe(200);
    expect(ok.body.length).toBeGreaterThanOrEqual(2);
  });

  it('creates a company with its first admin and the features it chose', async () => {
    const api = as(await login(await owner()));
    const res = await api.post('/api/super/companies').send({
      name: 'Acme Corp',
      features: { screenCapture: false, payroll: false },
      admin: { name: 'Acme HR', email: 'hr@acme.test' },
    });
    expect(res.status).toBe(201);
    expect(res.body.company.features).toMatchObject({ screenCapture: false, payroll: false, audioCapture: true, leave: true });
    expect(res.body.admin.temporaryPassword).toBeTruthy();

    const row = await db()('employees').where({ email: 'hr@acme.test' }).first();
    expect(row.company_id).toBe(res.body.company.id);
    expect(row.role).toBe('admin');
    await db()('employees').where({ id: row.id }).update({ must_change_password: false });
    const hr = { email: 'hr@acme.test' };
    const token = await login(hr, res.body.admin.temporaryPassword);

    const config = await as(token).get('/api/config');
    expect(config.body.features.screenCapture).toBe(false);
    expect(config.body.screenshot.enabled).toBe(false);
    expect((await as(token).get('/api/payroll?month=2026-10')).body.error.code).toBe('FEATURE_DISABLED');
    expect((await as(token).get('/api/admin/leave')).status).toBe(200);
  });

  it('turns a feature on and off for a company, and suspends it', async () => {
    const { hrB, empB } = await world();
    const api = as(await login(await owner()));
    const tokenB = await login(hrB);
    expect((await as(tokenB).get('/api/payroll?month=2026-10')).status).toBe(200);

    await api.patch(`/api/super/companies/${B}`).send({ features: { payroll: false, leave: false } });
    expect((await as(tokenB).get('/api/payroll?month=2026-10')).body.error.code).toBe('FEATURE_DISABLED');
    const status = await as(await login(empB)).get('/api/attendance/status');
    expect(status.body.features.leave).toBe(false);

    await api.patch(`/api/super/companies/${B}`).send({ features: { payroll: true } });
    expect((await as(tokenB).get('/api/payroll?month=2026-10')).status).toBe(200);

    await api.patch(`/api/super/companies/${B}`).send({ status: 'suspended' });
    const res = await as(tokenB).get('/api/attendance/status');
    expect(res.body.error.code).toBe('COMPANY_SUSPENDED');
  });

  it('drops uploads of a switched-off feature instead of storing them', async () => {
    const { empB } = await world();
    await db()('companies').where({ id: B }).update({ feature_screen_capture: false });
    companies.invalidate();
    const res = await as(await login(empB)).post('/api/screenshots/upload').send({ imageBase64: 'AAAA' });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);
    expect(await db()('screenshots').where({ employee_id: empB.id })).toHaveLength(0);
  });
});

describe('company numbers for the platform owner', () => {
  it('shows active people, storage in use, hours and breaks per company, and takes a time zone', async () => {
    const { empB } = await world();
    const owner = await createEmployee({ name: 'Owner', role: 'admin', is_super_admin: true, company_id: A });
    const { uuid } = require('../src/utils/ids');
    const today = t.localDate(t.now());
    await db()('attendance').insert({
      id: uuid(), employee_id: empB.id, date: today, punch_in: t.now() - 7200_000, punch_out: t.now(),
      status: 'closed', total_worked_seconds: 3600, total_break_seconds: 600, idle_seconds: 0,
      created_at: t.now(), updated_at: t.now(),
    });
    await db()('screenshots').insert({
      id: uuid(), employee_id: empB.id, image_url: 'screenshots/a.jpg', content_type: 'image/jpeg',
      captured_at: t.now(), date: today, size_bytes: 1500, created_at: t.now(),
    });
    await db()('screenshots').insert({
      id: uuid(), employee_id: empB.id, image_url: null, content_type: 'image/jpeg', file_deleted: true,
      captured_at: t.now(), date: today, size_bytes: 9999, created_at: t.now(),
    });

    const api = as(await login(owner));
    const list = await api.get('/api/super/companies');
    const b = list.body.find((c) => c.id === B);
    expect(b.employees).toBe(2);
    expect(b.admins).toBe(1);
    expect(b.storage.bytes).toBe(1500);
    expect(b.storage.files).toBe(1);
    expect(b.hours.allTime).toEqual({ workedSeconds: 3600, breakSeconds: 600 });
    expect(b.hours.thisMonth.workedSeconds).toBe(3600);

    expect((await api.patch(`/api/super/companies/${B}`).send({ timezone: 'Not/AZone' })).status).toBe(400);
    const ok = await api.patch(`/api/super/companies/${B}`).send({ timezone: 'Asia/Kolkata' });
    expect(ok.status).toBe(200);
    expect(ok.body.timezone).toBe('Asia/Kolkata');
  });
});

describe('plan limits and live numbers', () => {
  const { uuid } = require('../src/utils/ids');
  async function owner() {
    return createEmployee({ name: 'Owner', role: 'admin', is_super_admin: true, company_id: A });
  }

  it('stops adding people past the employee limit, and counts bringing someone back', async () => {
    const { hrB, empB } = await world();
    const api = as(await login(await owner()));
    expect((await api.patch(`/api/super/companies/${B}`).send({ maxEmployees: 2 })).status).toBe(200);

    const hr = as(await login(hrB));
    const full = await hr.post('/api/admin/employees').send({ name: 'Third', email: 'third@example.com' });
    expect(full.status).toBe(409);
    expect(full.body.error.message).toMatch(/allows 2/);

    await hr.patch(`/api/admin/employees/${empB.id}`).send({ status: 'inactive' });
    const ok = await hr.post('/api/admin/employees').send({ name: 'Third', email: 'third@example.com' });
    expect(ok.status).toBe(201);
    const back = await hr.patch(`/api/admin/employees/${empB.id}`).send({ status: 'active' });
    expect(back.status).toBe(409);

    await api.patch(`/api/super/companies/${B}`).send({ maxEmployees: null });
    expect((await hr.patch(`/api/admin/employees/${empB.id}`).send({ status: 'active' })).status).toBe(200);
  });

  it('drops uploads past the storage limit instead of storing them', async () => {
    const { empB } = await world();
    await db()('companies').where({ id: B }).update({ storage_limit_bytes: 10 });
    companies.invalidate();
    const shift = await as(await login(empB)).post('/api/attendance/punch-in').send({});
    expect(shift.status).toBe(201);
    const png = Buffer.alloc(200, 1).toString('base64');
    const res = await as(await login(empB)).post('/api/screenshots/upload').send({ imageBase64: png, contentType: 'image/png' });
    expect(res.body.ignored).toBe(true);
    expect(res.body.reason).toBe('STORAGE_FULL');
    expect(await db()('screenshots').where({ employee_id: empB.id })).toHaveLength(0);

    await db()('companies').where({ id: B }).update({ storage_limit_bytes: null });
    companies.invalidate();
    const ok = await as(await login(empB)).post('/api/screenshots/upload').send({ imageBase64: png, contentType: 'image/png' });
    expect(ok.status).toBe(201);
  });

  it('adds a running shift to the hours, and sums a chosen date range', async () => {
    const { empB } = await world();
    const api = as(await login(await owner()));
    await db()('attendance').insert({
      id: uuid(), employee_id: empB.id, date: '2026-01-10', punch_in: 1, punch_out: 2, status: 'closed',
      total_worked_seconds: 3600, total_break_seconds: 300, idle_seconds: 0, created_at: 1, updated_at: 1,
    });
    await db()('attendance').insert({
      id: uuid(), employee_id: empB.id, date: t.localDate(t.now()), punch_in: t.now() - 1800_000, status: 'open',
      total_break_seconds: 0, created_at: 1, updated_at: 1,
    });
    const all = (await api.get('/api/super/companies')).body.find((c) => c.id === B);
    expect(all.hours.allTime.workedSeconds).toBeGreaterThanOrEqual(3600 + 1790);
    expect(all.hours.range).toBeNull();

    const ranged = (await api.get('/api/super/companies?from=2026-01-01&to=2026-01-31')).body.find((c) => c.id === B);
    expect(ranged.hours.range).toMatchObject({ from: '2026-01-01', to: '2026-01-31', workedSeconds: 3600, breakSeconds: 300 });
  });
});
