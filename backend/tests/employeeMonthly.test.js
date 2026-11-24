'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const H = 3600;
const closed = (e, date, workedSeconds) => {
  const punchIn = new Date(`${date}T14:00:00Z`).getTime();
  return db()('attendance').insert({
    id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: punchIn + workedSeconds * 1000, date,
    total_break_seconds: 0, total_worked_seconds: workedSeconds, idle_seconds: 0, status: 'closed',
    over_break: false, auto_closed: false, needs_review: false, created_at: punchIn, updated_at: punchIn,
  });
};

describe('GET /api/admin/employees/:id/monthly', () => {
  it('counts days present, full, half and short days for the month, and gives it as CSV too', async () => {
    const hr = as(await login(await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` })));
    const eve = await createEmployee({ name: 'Eve Employee', department: 'Sales' });
    await closed(eve, '2026-03-02', 9.5 * H); // full
    await closed(eve, '2026-03-03', 9 * H); // full
    await closed(eve, '2026-03-04', 5 * H); // half
    await closed(eve, '2026-03-05', 2 * H); // short
    await closed(eve, '2026-04-01', 9 * H); // another month: not counted

    const res = await hr.get(`/api/admin/employees/${eve.id}/monthly?month=2026-03`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Eve Employee', department: 'Sales', month: '2026-03', daysPresent: 4, fullDays: 2, halfDays: 1, otherDays: 1, otherHours: 2 });
    expect(res.body.totalHours).toBe(25.5);

    const csv = await hr.get(`/api/admin/employees/${eve.id}/monthly?month=2026-03&format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const [head, line] = csv.text.trim().split(/\r?\n/);
    expect(head.replace(/^﻿/, '')).toBe('Employee,Email,Department,Month,Days Present,Total Hours,Full Days,Half Days,Other Hours');
    expect(line).toContain('Eve Employee');
    expect(line).toContain('25.5');
    expect(await db()('audit_logs').where({ action: 'exported_report' }).count({ n: '*' }).first().then((r) => Number(r.n))).toBeGreaterThan(0);
  });

  it('gives zeros for a month with no work, refuses a bad month, an unknown person, and non-admins', async () => {
    const hr = as(await login(await createEmployee({ role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` })));
    const eve = await createEmployee();
    expect((await hr.get(`/api/admin/employees/${eve.id}/monthly?month=2026-03`)).body).toMatchObject({ daysPresent: 0, totalHours: 0, fullDays: 0 });
    expect((await hr.get(`/api/admin/employees/${eve.id}/monthly?month=2026-13`)).status).toBe(400);
    expect((await hr.get(`/api/admin/employees/${uuid()}/monthly?month=2026-03`)).status).toBe(404);
    expect((await as(await login(eve)).get(`/api/admin/employees/${eve.id}/monthly`)).status).toBe(403);
  });
});
