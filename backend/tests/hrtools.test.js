'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  await db()('departments').del();
  // Settings outlive the truncate, so put the day lines back to their defaults.
  await require('../src/services/settings').update({ shift: { halfDaySeconds: 4 * 3600, fullDaySeconds: 7 * 3600 } });
});
afterAll(destroy);

const hours = (h) => Math.round(h * 3600);

async function shift(employee, date, workedHours, breakSeconds = 0) {
  await db()('attendance').insert({
    id: uuid(),
    employee_id: employee.id,
    date,
    punch_in: Date.parse(`${date}T09:00:00Z`),
    punch_out: Date.parse(`${date}T09:00:00Z`) + hours(workedHours) * 1000,
    status: 'closed',
    total_worked_seconds: hours(workedHours),
    total_break_seconds: breakSeconds,
    idle_seconds: 0,
    created_at: t.now(),
    updated_at: t.now(),
  });
}

describe('full and half days', () => {
  it('counts days by the hours HR sets, adding two shifts of one day together', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'HR' });
    const emp = await createEmployee({ name: 'Eve' });
    await shift(emp, '2026-10-01', 8); // full (7h default)
    await shift(emp, '2026-10-02', 4.5); // half (4h default)
    await shift(emp, '2026-10-05', 2); // less than half
    await shift(emp, '2026-10-06', 3); // two shifts that add up to a full day
    await shift(emp, '2026-10-06', 4.5);

    const api = as(await login(hr));
    const q = 'from=2026-10-01&to=2026-10-31';
    let row = (await api.get(`/api/admin/reports?${q}`)).body.rows.find((r) => r.name === 'Eve');
    expect(row).toMatchObject({ fullDays: 2, halfDays: 1, shortDays: 1 });

    // HR moves the line: 5 hours is now a half day, 8 a full day. The 7.5h day drops to half and
    // the 4.5h day falls below the half-day line.
    const set = await api.patch('/api/admin/settings').send({ shift: { halfDaySeconds: hours(5), fullDaySeconds: hours(8) } });
    expect(set.status).toBe(200);
    row = (await api.get(`/api/admin/reports?${q}`)).body.rows.find((r) => r.name === 'Eve');
    expect(row).toMatchObject({ fullDays: 1, halfDays: 1, shortDays: 2 });

    await api.patch('/api/admin/settings').send({ shift: { halfDaySeconds: hours(5), fullDaySeconds: hours(9) } });
    row = (await api.get(`/api/admin/reports?${q}`)).body.rows.find((r) => r.name === 'Eve');
    expect(row).toMatchObject({ fullDays: 0, halfDays: 2, shortDays: 2 });

    const bad = await api.patch('/api/admin/settings').send({ shift: { halfDaySeconds: hours(9), fullDaySeconds: hours(6) } });
    expect(bad.status).toBe(400);
  });

  it('exports a summary and a daily CSV that name the day type', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'HR' });
    const emp = await createEmployee({ name: 'Eve' });
    await shift(emp, '2026-10-01', 8);
    const api = as(await login(hr));

    const summary = await api.get('/api/admin/reports?from=2026-10-01&to=2026-10-31&format=csv&detail=summary');
    expect(summary.status).toBe(200);
    expect(summary.text).toContain('Full days,Half days,Less than half day');
    expect(summary.text).toContain('Eve');

    const daily = await api.get('/api/admin/reports?from=2026-10-01&to=2026-10-31&format=csv');
    expect(daily.text).toContain('Day type');
    expect(daily.text).toContain('Full day');
  });
});

describe('employee export and import', () => {
  it('exports everyone as a CSV', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'HR' });
    await createEmployee({ name: 'Eve', department: 'Sales' });
    const res = await as(await login(hr)).get('/api/admin/employees/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Name,Email,Employee code,Department,Role,Status,Time zone');
    expect(res.text).toContain('Eve');
  });

  it('imports a sheet: creates people and departments, skips duplicates and bad rows, returns passwords once', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'HR' });
    const existing = await createEmployee({ name: 'Already Here' });
    const api = as(await login(hr));
    const res = await api.post('/api/admin/employees/import').send({
      rows: [
        { name: 'Ann', email: 'ann@example.com', department: 'Support' },
        { name: 'Bob', email: 'bob@example.com', department: 'support' },
        { name: 'Dup', email: existing.email },
        { name: 'Ann Again', email: 'ANN@example.com' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.created.map((c) => c.email)).toEqual(['ann@example.com', 'bob@example.com']);
    expect(res.body.created.every((c) => c.temporaryPassword)).toBe(true);
    expect(res.body.skipped.map((s) => s.email)).toEqual([existing.email, 'ann@example.com']);

    const depts = await db()('departments').pluck('name');
    expect(depts).toEqual(['Support']); // 'support' reuses it, case-insensitively
    const ann = await db()('employees').where({ email: 'ann@example.com' }).first();
    expect(ann.role).toBe('user');
    expect(ann.must_change_password).toBeTruthy();
  });

  it('stops at the plan limit and says so per row', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'HR' });
    await db()('companies').update({ max_employees: 2 });
    require('../src/services/companies').invalidate();
    const res = await as(await login(hr)).post('/api/admin/employees/import').send({
      rows: [
        { name: 'One', email: 'one@example.com' },
        { name: 'Two', email: 'two@example.com' },
      ],
    });
    expect(res.body.created).toHaveLength(1);
    expect(res.body.skipped[0].reason).toMatch(/allows 2/);
    await db()('companies').update({ max_employees: null });
    require('../src/services/companies').invalidate();
  });
});
