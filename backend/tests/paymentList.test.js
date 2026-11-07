'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const payroll = require('../src/modules/payroll/payroll.service');
const pay = require('../src/modules/payroll/pay.service');
const finalizeService = require('../src/modules/payroll/finalize.service');
const settings = require('../src/services/settings');
const { uuid } = require('../src/utils/ids');

const MONTH = '2026-07';
const H = 3600;

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  await settings.update({ payroll: { paidLeaveTypes: ['vacation'], workDays: [1, 2, 3, 4, 5] } });
});
afterAll(destroy);

async function employee(overrides = {}, rate = 50) {
  const e = await createEmployee({ created_at: new Date('2026-01-01T00:00:00Z').getTime(), ...overrides });
  if (rate) await pay.setRate({ employeeId: e.id, dailyRate: rate, effectiveFrom: '2026-01-01' });
  return e;
}

async function fullDay(e, date) {
  const punchIn = new Date(`${date}T09:00:00Z`).getTime();
  await db()('attendance').insert({
    id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: punchIn + 10 * H * 1000, date,
    total_break_seconds: H, total_worked_seconds: 9 * H, idle_seconds: 0, status: 'closed',
    over_break: false, auto_closed: false, needs_review: false, review_reason: null,
    created_at: punchIn, updated_at: punchIn,
  });
}

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return as(await login(a));
}

describe('month-end payment list', () => {
  it('is refused until the month is finalized', async () => {
    const e = await employee();
    await fullDay(e, '2026-07-01');
    await payroll.generate({ month: MONTH });
    const hr = await admin();
    const res = await hr.get(`/api/payroll/payment-list?month=${MONTH}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Finalize the month first/);
  });

  it('lists who is paid how much, from the frozen payslips, with a total', async () => {
    const ann = await employee({ name: 'Ann' }, 50);
    const bob = await employee({ name: 'Bob' }, 80);
    await employee({ name: 'NoShifts' }, 60); // paid nothing: left off
    await fullDay(ann, '2026-07-01');
    await fullDay(ann, '2026-07-02');
    await fullDay(bob, '2026-07-01');
    await pay.addBonus({ employeeId: bob.id, month: MONTH, amount: 25, reason: 'Great month' });
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });

    const hr = await admin();
    const json = (await hr.get(`/api/payroll/payment-list?month=${MONTH}&format=json`)).body;
    expect(json.rows.map((r) => [r.name, r.netPay])).toEqual([['Ann', 100], ['Bob', 105]]);
    expect(json.total).toBe(205);
    expect(json.skipped).toBe(0); // NoShifts never had a payroll row at all
    expect(json.rows[1]).toMatchObject({ basePay: 80, bonusTotal: 25, fullDays: 1, number: 2 });

    const csv = await hr.get(`/api/payroll/payment-list?month=${MONTH}`);
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toContain('payment-list_2026-07.csv');
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toContain('Amount To Pay (USD)');
    expect(lines[0]).toContain('Paid On,Payment Method,Reference');
    expect(lines[1]).toContain('Ann');
    expect(lines[2]).toContain('Bob');
    expect(lines[3]).toMatch(/^,,TOTAL \(2 people\)/);
    expect(lines[3]).toContain('205');
  });

  it('does not move when rates change after the month is finalized', async () => {
    const e = await employee({ name: 'Ann' }, 50);
    await fullDay(e, '2026-07-01');
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });
    await pay.setRate({ employeeId: e.id, dailyRate: 500, effectiveFrom: '2026-02-01' });

    const hr = await admin();
    const json = (await hr.get(`/api/payroll/payment-list?month=${MONTH}&format=json`)).body;
    expect(json.rows[0].netPay).toBe(50);
  });

  it('can be narrowed to one department', async () => {
    const a = await employee({ name: 'Ann', department: 'Sales' });
    const b = await employee({ name: 'Bob', department: 'Support' });
    await fullDay(a, '2026-07-01');
    await fullDay(b, '2026-07-01');
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });

    const hr = await admin();
    const json = (await hr.get(`/api/payroll/payment-list?month=${MONTH}&department=Sales&format=json`)).body;
    expect(json.rows.map((r) => r.name)).toEqual(['Ann']);
  });

  it('is for HR only and is written to the audit log', async () => {
    const e = await employee();
    await fullDay(e, '2026-07-01');
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });

    const user = as(await login(await createEmployee()));
    expect((await user.get(`/api/payroll/payment-list?month=${MONTH}`)).status).toBe(403);
    expect((await request(app).get(`/api/payroll/payment-list?month=${MONTH}`)).status).toBe(401);

    const hr = await admin();
    await hr.get(`/api/payroll/payment-list?month=${MONTH}`);
    const entry = await db()('audit_logs').orderBy('timestamp', 'desc').first();
    expect(entry.details).toContain('payment-list');
  });
});
