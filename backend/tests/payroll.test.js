'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const payroll = require('../src/modules/payroll/payroll.service');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const MONTH = '2026-07';

async function addShift(employee, day, workedSeconds, extra = {}) {
  const date = `${MONTH}-${String(day).padStart(2, '0')}`;
  const punchIn = new Date(`${date}T09:00:00Z`).getTime();
  await db()('attendance').insert({
    id: uuid(),
    employee_id: employee.id,
    punch_in: punchIn,
    punch_out: punchIn + (workedSeconds + 3600) * 1000,
    date,
    total_break_seconds: 3600,
    total_worked_seconds: workedSeconds,
    idle_seconds: 0,
    status: 'closed',
    over_break: false,
    auto_closed: false,
    needs_review: false,
    review_reason: null,
    created_at: punchIn,
    updated_at: punchIn,
    ...extra,
  });
}

describe('payroll generation', () => {
  it('aggregates a month into hours', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);
    await addShift(employee, 2, 8 * 3600);
    await addShift(employee, 3, 4 * 3600);

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });

    expect(row.daysPresent).toBe(3);
    expect(row.totalHours).toBe(20);
  });

  it('is idempotent -- a second run overwrites rather than doubling', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);

    await payroll.generate({ month: MONTH });
    await payroll.generate({ month: MONTH });

    const rows = await db()('payroll_summary').where({ employee_id: employee.id, month: MONTH });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total_hours)).toBe(8);
  });

  it('ignores shifts that are still open', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);
    await db()('attendance').insert({
      id: uuid(),
      employee_id: employee.id,
      punch_in: new Date(`${MONTH}-02T09:00:00Z`).getTime(),
      punch_out: null,
      date: `${MONTH}-02`,
      total_break_seconds: 0,
      total_worked_seconds: null,
      idle_seconds: 0,
      status: 'open',
      over_break: false,
      auto_closed: false,
      needs_review: false,
      review_reason: null,
      created_at: t.now(),
      updated_at: t.now(),
    });

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });

    expect(row.daysPresent).toBe(1);
    expect(row.totalHours).toBe(8);
  });

  it('counts flagged days separately', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);
    await addShift(employee, 2, 8 * 3600, { over_break: true, needs_review: true });

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });

    expect(row.daysPresent).toBe(2);
    expect(row.daysFlagged).toBe(1);
  });

  it('clears the synced flag when a month is regenerated', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);

    await payroll.generate({ month: MONTH });
    await payroll.markSynced({ month: MONTH });
    expect((await payroll.list({ month: MONTH }))[0].syncedToPayroll).toBe(true);

    await addShift(employee, 2, 8 * 3600);
    await payroll.generate({ month: MONTH });

    // The numbers changed, so what was sent to payroll is no longer what we hold.
    expect((await payroll.list({ month: MONTH }))[0].syncedToPayroll).toBe(false);
  });

  it('rejects a malformed month', async () => {
    await expect(payroll.generate({ month: '2026-7' })).rejects.toThrow(/YYYY-MM/);
  });

  // Regression: the check-then-insert per employee is not atomic (SQLite's deferred
  // transaction takes no write lock until the write), so two concurrent generate() calls for
  // the same month used to both pass the "no existing row" check and race on the
  // uq_payroll_employee_month unique constraint, surfacing as a raw 500 on the loser.
  it('does not fail when two generate() calls race for the same month', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);

    const attempts = await Promise.allSettled([
      payroll.generate({ month: MONTH }),
      payroll.generate({ month: MONTH }),
    ]);

    expect(attempts.every((a) => a.status === 'fulfilled')).toBe(true);
    const rows = await db()('payroll_summary').where({ employee_id: employee.id, month: MONTH });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].total_hours)).toBe(8);
  });
});

describe('markSynced', () => {
  it('marks the whole month when employeeIds is omitted', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);
    await payroll.generate({ month: MONTH });

    const result = await payroll.markSynced({ month: MONTH });

    expect(result.updated).toBe(1);
    expect((await payroll.list({ month: MONTH }))[0].syncedToPayroll).toBe(true);
  });

  // Regression: `employeeIds?.length` is falsy for both `undefined` and `[]`, so an explicit
  // empty array — "these zero employees" — used to be silently treated as "everyone".
  it('marks nobody when employeeIds is explicitly empty, rather than everyone', async () => {
    const employee = await createEmployee();
    await addShift(employee, 1, 8 * 3600);
    await payroll.generate({ month: MONTH });

    const result = await payroll.markSynced({ month: MONTH, employeeIds: [] });

    expect(result.updated).toBe(0);
    expect((await payroll.list({ month: MONTH }))[0].syncedToPayroll).toBe(false);
  });
});

describe('payroll export', () => {
  it('exports CSV and audits the export', async () => {
    const employee = await createEmployee({ name: 'Divya Nair' });
    await addShift(employee, 1, 8 * 3600);
    await payroll.generate({ month: MONTH });

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    const res = await as(adminToken).get(`/api/payroll/export?month=${MONTH}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('Divya Nair');
    expect(res.text).toContain('Total Hours');

    const logs = await db()('audit_logs').where({ action: 'exported_payroll' });
    expect(logs).toHaveLength(1);
  });

  it('is closed to non-admins', async () => {
    const token = await login(await createEmployee({ role: 'user' }));
    expect((await as(token).get(`/api/payroll/export?month=${MONTH}`)).status).toBe(403);
  });
});
