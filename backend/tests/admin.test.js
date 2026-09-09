'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const attendanceService = require('../src/modules/attendance/attendance.service');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const HOUR = 3600 * 1000;

function toUser(row) {
  return {
    id: row.id,
    role: row.role,
    timezone: row.timezone,
    consentMonitoring: true,
    consentAudio: !!row.consent_audio,
  };
}

describe('live dashboard', () => {
  it('reports who is working, on break and not started', async () => {
    const working = await createEmployee({ name: 'Working Person' });
    const onBreak = await createEmployee({ name: 'Break Person' });
    await createEmployee({ name: 'Not Started Person' });

    await attendanceService.punchIn({ employee: toUser(working), at: t.now() - 2 * HOUR });
    await attendanceService.punchIn({ employee: toUser(onBreak), at: t.now() - 3 * HOUR });
    await attendanceService.startBreak({ employee: toUser(onBreak), at: t.now() - 20 * 60000 });

    const adminToken = await login(await createEmployee({ role: 'admin', name: 'Admin' }));
    const res = await as(adminToken).get('/api/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.body.summary.working).toBe(1);
    expect(res.body.summary.onBreak).toBe(1);
    // The admin has not punched in either.
    expect(res.body.summary.notStarted).toBe(2);

    const row = res.body.employees.find((e) => e.employeeId === working.id);
    expect(row.state).toBe('working');
    expect(row.workedSeconds).toBeGreaterThan(0);
  });

  it('counts a running break in the live break total', async () => {
    const employee = await createEmployee();
    await attendanceService.punchIn({ employee: toUser(employee), at: t.now() - 4 * HOUR });
    await attendanceService.startBreak({ employee: toUser(employee), at: t.now() - 30 * 60000 });

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get('/api/admin/dashboard');

    const row = res.body.employees.find((e) => e.employeeId === employee.id);
    expect(row.breakSeconds).toBeGreaterThan(29 * 60);
  });

  // Regression: filtering the board by calendar date alone dropped anyone whose shift began
  // before midnight in their own timezone, even though they were still working.
  it('keeps a shift that began yesterday on the board while it is open', async () => {
    const employee = await createEmployee();
    const yesterday = t.now() - 20 * HOUR;
    await attendanceService.punchIn({ employee: toUser(employee), at: yesterday });

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get('/api/admin/dashboard');

    const row = res.body.employees.find((e) => e.employeeId === employee.id);
    expect(row.state).toBe('working');
    expect(row.overnight).toBe(true);
    expect(row.shiftDate).toBe(t.localDate(yesterday, employee.timezone));
  });

  it('flags a working employee with no recent activity as idle', async () => {
    const employee = await createEmployee();
    await attendanceService.punchIn({ employee: toUser(employee), at: t.now() - 3 * HOUR });

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get('/api/admin/dashboard');

    const row = res.body.employees.find((e) => e.employeeId === employee.id);
    expect(row.appearsIdle).toBe(true);
  });
});

describe('reports', () => {
  it('summarises worked time over a range', async () => {
    const employee = await createEmployee({ name: 'Karthik', department: 'Engineering' });
    const user = toUser(employee);
    const start = t.now() - 30 * HOUR;

    await attendanceService.punchIn({ employee: user, at: start });
    await attendanceService.punchOut({ employee: user, at: start + 8 * HOUR });

    const date = t.localDate(start, employee.timezone);
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get(`/api/admin/reports?from=${date}&to=${date}`);

    expect(res.status).toBe(200);
    const row = res.body.rows.find((r) => r.employeeId === employee.id);
    expect(row.daysPresent).toBe(1);
    expect(row.workedHours).toBe(8);
  });

  it('filters by department', async () => {
    const eng = await createEmployee({ department: 'Engineering' });
    const design = await createEmployee({ department: 'Design' });
    const start = t.now() - 30 * HOUR;

    for (const emp of [eng, design]) {
      await attendanceService.punchIn({ employee: toUser(emp), at: start });
      await attendanceService.punchOut({ employee: toUser(emp), at: start + 8 * HOUR });
    }

    const date = t.localDate(start, eng.timezone);
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get(
      `/api/admin/reports?from=${date}&to=${date}&department=Design`
    );

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].employeeId).toBe(design.id);
  });

  it('exports CSV and neutralises formula-injection in employee names', async () => {
    const employee = await createEmployee({ name: '=cmd|calc', department: 'Sales' });
    const start = t.now() - 30 * HOUR;
    await attendanceService.punchIn({ employee: toUser(employee), at: start });
    await attendanceService.punchOut({ employee: toUser(employee), at: start + 8 * HOUR });

    const date = t.localDate(start, employee.timezone);
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get(
      `/api/admin/reports?from=${date}&to=${date}&format=csv`
    );

    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain("'=cmd|calc");
    expect(res.text).not.toMatch(/^=cmd/m);
  });

  it('rejects a range with from after to', async () => {
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get('/api/admin/reports?from=2026-08-10&to=2026-08-01');
    expect(res.status).toBe(400);
  });
});

describe('employee administration', () => {
  it('creates an employee with consent not yet given', async () => {
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).post('/api/admin/employees').send({
      name: 'New Joiner',
      email: 'new.joiner@kdmarketing.in',
      password: 'Password123!',
      department: 'Support',
    });

    expect(res.status).toBe(201);
    // Consent is the employee's to give, at first login. Never pre-set by HR.
    expect(res.body.consent.monitoring).toBe(false);
    expect(res.body.consent.audio).toBe(false);
    expect(res.body.consent.required).toBe(true);
  });

  it('refuses a duplicate work email', async () => {
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    await createEmployee({ email: 'taken@kdmarketing.in' });

    const res = await as(adminToken)
      .post('/api/admin/employees')
      .send({ name: 'Dup', email: 'taken@kdmarketing.in', password: 'Password123!' });

    expect(res.status).toBe(409);
  });

  it('will not let HR grant audio consent on behalf of an employee', async () => {
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const employee = await createEmployee({ consent_audio: false });

    const res = await as(adminToken)
      .patch(`/api/admin/employees/${employee.id}`)
      .send({ consentAudio: true });

    expect(res.status).toBe(400);
    const row = await db()('employees').where({ id: employee.id }).first();
    expect(row.consent_audio).toBeFalsy();
  });

  it('revokes sessions when an employee is deactivated', async () => {
    const employee = await createEmployee();
    const employeeToken = await login(employee);
    const adminToken = await login(await createEmployee({ role: 'admin' }));

    await as(adminToken).patch(`/api/admin/employees/${employee.id}`).send({ status: 'inactive' });

    expect((await as(employeeToken).get('/api/auth/me')).status).toBe(403);
    const tokens = await db()('refresh_tokens').where({ employee_id: employee.id });
    expect(tokens.every((tk) => tk.revoked_at)).toBe(true);
  });
});

describe('audit log', () => {
  it('is readable by admins and closed to everyone else', async () => {
    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const userToken = await login(await createEmployee({ role: 'user' }));

    expect((await as(adminToken).get('/api/admin/audit-logs')).status).toBe(200);
    expect((await as(userToken).get('/api/admin/audit-logs')).status).toBe(403);
  });

  it('names the admin who looked and who they looked at', async () => {
    const admin = await createEmployee({ role: 'admin', name: 'Priya Raman' });
    const employee = await createEmployee({ name: 'Karthik' });
    const adminToken = await login(admin);

    await as(adminToken).get(`/api/screenshots/${employee.id}`);

    const res = await as(adminToken).get('/api/admin/audit-logs');
    const entry = res.body.data.find((l) => l.action === 'listed_screenshots');
    expect(entry.adminName).toBe('Priya Raman');
    expect(entry.targetEmployeeId).toBe(employee.id);
  });
});
