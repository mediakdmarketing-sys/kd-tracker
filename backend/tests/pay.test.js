'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const payroll = require('../src/modules/payroll/payroll.service');
const pay = require('../src/modules/payroll/pay.service');
const { uuid } = require('../src/utils/ids');

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
    // A long break must change nothing about the pay.
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

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return { employee: a, api: as(await login(a)) };
}

describe('pay by the day', () => {
  it('pays days worked x the daily rate, whatever the break was', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 50, effectiveFrom: '2026-01-01' });
    await addShift(e, 1, 9 * 3600);
    await addShift(e, 2, 9 * 3600, { total_break_seconds: 5 * 3600 });
    await addShift(e, 3, 9 * 3600, { total_break_seconds: 0 });

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });

    expect(row.pricedDays).toBe(3);
    expect(row.basePay).toBe(150);
    expect(row.netPay).toBe(150);
  });

  it('prices each day at the rate in force that day, so a mid-month raise splits the month', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 40, effectiveFrom: '2026-01-01' });
    await pay.setRate({ employeeId: e.id, dailyRate: 55.5, effectiveFrom: '2026-07-10' });
    await addShift(e, 8, 9 * 3600); // 40
    await addShift(e, 9, 9 * 3600); // 40
    await addShift(e, 10, 9 * 3600); // 55.50, the raise starts on this day
    await addShift(e, 20, 9 * 3600); // 55.50

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });
    expect(row.basePay).toBe(191);

    const slip = await pay.payslip({ employeeId: e.id, month: MONTH });
    expect(slip.lines).toEqual([
      { kind: 'full', dailyRate: 40, days: 2, hours: 18, hourlyRate: null, amount: 80 },
      { kind: 'full', dailyRate: 55.5, days: 2, hours: 18, hourlyRate: null, amount: 111 },
    ]);
  });

  it('a back-dated raise applies when the month is regenerated', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 40, effectiveFrom: '2026-01-01' });
    await addShift(e, 5, 9 * 3600);
    await payroll.generate({ month: MONTH });
    expect((await payroll.list({ month: MONTH }))[0].basePay).toBe(40);

    await pay.setRate({ employeeId: e.id, dailyRate: 60, effectiveFrom: '2026-07-01' });
    await payroll.generate({ month: MONTH });
    expect((await payroll.list({ month: MONTH }))[0].basePay).toBe(60);
  });

  it('pays nothing for days before any rate and reports them', async () => {
    const e = await createEmployee();
    await addShift(e, 1, 9 * 3600);
    await addShift(e, 2, 9 * 3600);

    const result = await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });

    expect(row.basePay).toBe(0);
    expect(row.rateMissingDays).toBe(2);
    expect(result.missingRates).toEqual([{ employeeId: e.id, days: 2 }]);
  });

  it('does not pay a day for a shift with no worked time', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 50, effectiveFrom: '2026-01-01' });
    await addShift(e, 1, 9 * 3600);
    await addShift(e, 2, 0); // punched in by mistake and out again

    await payroll.generate({ month: MONTH });
    expect((await payroll.list({ month: MONTH }))[0].basePay).toBe(50);
  });
});

describe('full days, half days and other hours', () => {
  // The default limits: full day = 9 h of work, half day = 4.5 h, break not counted.
  const H = 3600;

  it('treats someone who takes a break and stays late exactly like someone who takes none', async () => {
    const withBreak = await createEmployee();
    const noBreak = await createEmployee();
    for (const e of [withBreak, noBreak]) await pay.setRate({ employeeId: e.id, dailyRate: 90, effectiveFrom: '2026-01-01' });

    // 10 hours at the desk with a 1 hour break = 9 hours of work.
    await addShift(withBreak, 1, 9 * H, { total_break_seconds: H, punch_out: new Date(`${MONTH}-01T19:00:00Z`).getTime() });
    // 9 hours at the desk, no break = 9 hours of work.
    await addShift(noBreak, 1, 9 * H, { total_break_seconds: 0 });

    await payroll.generate({ month: MONTH });
    const rows = await payroll.list({ month: MONTH });
    for (const row of rows) {
      expect(row.fullDays).toBe(1);
      expect(row.halfDays).toBe(0);
      expect(row.basePay).toBe(90);
    }
  });

  it('does not make a full day of a short one just because they sat there: the break is not work', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 90, effectiveFrom: '2026-01-01' });
    // 9 hours at the desk but 1.5 hours of it on break = 7.5 hours of work: a half day, not a full one.
    await addShift(e, 1, 7.5 * H, { total_break_seconds: 1.5 * H });

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });
    expect([row.fullDays, row.halfDays]).toEqual([0, 1]);
    expect(row.basePay).toBe(45);
  });

  it('counts full, half and other days separately and pays the leftover hours by the hour', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 90, effectiveFrom: '2026-01-01' }); // $10 an hour over 9 h
    await addShift(e, 1, 9 * H); // full: 90
    await addShift(e, 2, 10 * H); // still just a full day: 90
    await addShift(e, 3, 6 * H); // half: 45
    await addShift(e, 4, 4.5 * H); // exactly the half-day limit: half, 45
    await addShift(e, 5, 3 * H); // other: 3 h x $10 = 30
    await addShift(e, 6, 1.5 * H); // other: 1.5 h x $10 = 15

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });
    expect(row).toMatchObject({ fullDays: 2, halfDays: 2, otherDays: 2, otherHours: 4.5 });
    expect(row.basePay).toBe(90 + 90 + 45 + 45 + 30 + 15);

    const slip = await pay.payslip({ employeeId: e.id, month: MONTH });
    expect(slip).toMatchObject({ daysWorked: 6, fullDays: 2, halfDays: 2, otherDays: 2, otherHours: 4.5, totalHours: 34 });
    expect(slip.lines.map((l) => [l.kind, l.days, l.amount])).toEqual([
      ['full', 2, 180],
      ['half', 2, 90],
      ['partial', 2, 45],
    ]);
    expect(slip.lines[2]).toMatchObject({ hours: 4.5, hourlyRate: 10 });
    expect(slip.stale).toBe(false);
  });

  it('adds up the work of several shifts on one date before deciding what kind of day it was', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 90, effectiveFrom: '2026-01-01' });
    await addShift(e, 1, 5 * H); // each alone would be a half day...
    await addShift(e, 1, 4 * H); // ...together 9 hours: one full day

    await payroll.generate({ month: MONTH });
    const [row] = await payroll.list({ month: MONTH });
    expect([row.fullDays, row.halfDays, row.otherDays]).toEqual([1, 0, 0]);
    expect(row.basePay).toBe(90);
  });

  it('uses the limits HR set, and keeps the ones a month was generated with', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 80, effectiveFrom: '2026-01-01' });
    await addShift(e, 1, 8 * H);

    const settings = require('../src/services/settings');
    await settings.update({ payroll: { fullDaySeconds: 8 * H, halfDaySeconds: 4 * H } });
    try {
      await payroll.generate({ month: MONTH });
      expect((await payroll.list({ month: MONTH }))[0].fullDays).toBe(1); // 8 h is a full day now

      // HR changes the limits afterwards: the slip of the month already generated does not change.
      await settings.update({ payroll: { fullDaySeconds: 9 * H, halfDaySeconds: 4.5 * H } });
      const slip = await pay.payslip({ employeeId: e.id, month: MONTH });
      expect(slip.fullDays).toBe(1);
      expect(slip.basePay).toBe(80);
      expect(slip.stale).toBe(false);
    } finally {
      await settings.update({ payroll: { fullDaySeconds: 9 * H, halfDaySeconds: 4.5 * H } });
    }
  });

  it('flags a payslip as out of date when a rate changed after the month was generated', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 40, effectiveFrom: '2026-01-01' });
    await addShift(e, 1, 9 * H);
    await payroll.generate({ month: MONTH });

    await pay.setRate({ employeeId: e.id, dailyRate: 60, effectiveFrom: '2026-07-01' });
    expect((await pay.payslip({ employeeId: e.id, month: MONTH })).stale).toBe(true);

    await payroll.generate({ month: MONTH });
    expect((await pay.payslip({ employeeId: e.id, month: MONTH })).stale).toBe(false);
  });

  it('the settings refuse a half-day limit that is not shorter than the full-day limit', async () => {
    const { api } = await admin();
    const res = await api.patch('/api/admin/settings').send({ payroll: { fullDaySeconds: 4 * H, halfDaySeconds: 5 * H } });
    expect(res.status).toBe(400);
    const ok = await api.patch('/api/admin/settings').send({ payroll: { fullDaySeconds: 9 * H, halfDaySeconds: 4.5 * H } });
    expect(ok.status).toBe(200);
  });
});

describe('rates', () => {
  it('refuses a second rate on the same start date, and updating moves it', async () => {
    const e = await createEmployee();
    const rate = await pay.setRate({ employeeId: e.id, dailyRate: 40, effectiveFrom: '2026-03-01' });

    await expect(pay.setRate({ employeeId: e.id, dailyRate: 45, effectiveFrom: '2026-03-01' })).rejects.toMatchObject({
      status: 409,
    });

    const updated = await pay.updateRate(rate.id, { dailyRate: 42.25, effectiveFrom: '2026-04-01' });
    expect(updated.dailyRate).toBe(42.25);
    expect(updated.effectiveFrom).toBe('2026-04-01');
  });

  it('rejects impossible dates and amounts', async () => {
    const e = await createEmployee();
    await expect(pay.setRate({ employeeId: e.id, dailyRate: 40, effectiveFrom: '2026-02-31' })).rejects.toMatchObject({ status: 400 });
    await expect(pay.setRate({ employeeId: e.id, dailyRate: 0, effectiveFrom: '2026-02-01' })).rejects.toMatchObject({ status: 400 });
    await expect(pay.setRate({ employeeId: e.id, dailyRate: -5, effectiveFrom: '2026-02-01' })).rejects.toMatchObject({ status: 400 });
  });

  it('lists the rate in force today and the next one scheduled', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 40, effectiveFrom: '2020-01-01' });
    await pay.setRate({ employeeId: e.id, dailyRate: 70, effectiveFrom: '2099-01-01' });

    const rows = await pay.listCurrentRates();
    const row = rows.find((r) => r.employeeId === e.id);
    expect(row.currentRate).toBe(40);
    expect(row.upcomingRate).toBe(70);
    expect(row.upcomingFrom).toBe('2099-01-01');
  });
});

describe('bulk rate upload', () => {
  it('saves every row, matching emails without regard to case, and replaces a same-date rate', async () => {
    const a = await createEmployee({ email: 'Ann@kdmarketing.in' });
    const b = await createEmployee({ email: 'bob@kdmarketing.in' });
    await pay.setRate({ employeeId: b.id, dailyRate: 30, effectiveFrom: '2026-05-01' });

    const result = await pay.bulkSetRates([
      { email: 'ann@KDMARKETING.in', dailyRate: 45, effectiveFrom: '2026-05-01' },
      { email: 'bob@kdmarketing.in', dailyRate: 35, effectiveFrom: '2026-05-01', note: 'corrected' },
    ]);

    expect(result).toEqual({ created: 1, updated: 1 });
    const history = await pay.rateHistory(b.id);
    expect(history.rates).toHaveLength(1);
    expect(history.rates[0].dailyRate).toBe(35);
    expect((await pay.rateHistory(a.id)).rates[0].dailyRate).toBe(45);
  });

  it('saves nothing when any row is wrong, and says which rows', async () => {
    const a = await createEmployee({ email: 'ann@kdmarketing.in' });

    await expect(
      pay.bulkSetRates([
        { email: 'ann@kdmarketing.in', dailyRate: 45, effectiveFrom: '2026-05-01' },
        { email: 'nobody@kdmarketing.in', dailyRate: 45, effectiveFrom: '2026-05-01' },
        { email: 'ann@kdmarketing.in', dailyRate: 45, effectiveFrom: '2026-13-01' },
      ])
    ).rejects.toMatchObject({
      status: 400,
      details: [
        expect.objectContaining({ row: 2 }),
        expect.objectContaining({ row: 3 }),
      ],
    });

    expect((await pay.rateHistory(a.id)).rates).toHaveLength(0);
  });

  it('flags the same person and date appearing twice', async () => {
    await createEmployee({ email: 'ann@kdmarketing.in' });
    await expect(
      pay.bulkSetRates([
        { email: 'ann@kdmarketing.in', dailyRate: 45, effectiveFrom: '2026-05-01' },
        { email: 'ann@kdmarketing.in', dailyRate: 46, effectiveFrom: '2026-05-01' },
      ])
    ).rejects.toMatchObject({ status: 400, details: [expect.objectContaining({ row: 2 })] });
  });
});

describe('bonuses and the payslip', () => {
  it('adds bonuses on top, even when entered after the month was generated', async () => {
    const e = await createEmployee();
    await pay.setRate({ employeeId: e.id, dailyRate: 50, effectiveFrom: '2026-01-01' });
    await addShift(e, 1, 9 * 3600);
    await addShift(e, 2, 9 * 3600);
    await payroll.generate({ month: MONTH });

    await pay.addBonus({ employeeId: e.id, month: MONTH, amount: 25.5, reason: 'Festival' });
    await pay.addBonus({ employeeId: e.id, month: MONTH, amount: 10, reason: 'Target met' });

    const [row] = await payroll.list({ month: MONTH });
    expect(row.basePay).toBe(100);
    expect(row.bonusTotal).toBe(35.5);
    expect(row.netPay).toBe(135.5);

    const slip = await pay.payslip({ employeeId: e.id, month: MONTH });
    expect(slip.daysWorked).toBe(2);
    expect(slip.bonuses.map((b) => b.reason)).toEqual(['Festival', 'Target met']);
    expect(slip.netPay).toBe(135.5);
    expect(slip.currency).toBe('USD');
    // Break time never appears on the slip.
    expect(JSON.stringify(slip)).not.toMatch(/break/i);
  });

  it('removes a bonus', async () => {
    const e = await createEmployee();
    const b = await pay.addBonus({ employeeId: e.id, month: MONTH, amount: 20, reason: 'Oops' });
    await pay.deleteBonus(b.id);
    expect(await pay.listBonuses({ month: MONTH })).toHaveLength(0);
    await expect(pay.deleteBonus(b.id)).rejects.toMatchObject({ status: 404 });
  });

  it('bulk bonuses are all or nothing', async () => {
    const e = await createEmployee({ email: 'ann@kdmarketing.in' });

    await expect(
      pay.bulkAddBonuses([
        { email: 'ann@kdmarketing.in', month: MONTH, amount: 10, reason: 'A' },
        { email: 'ann@kdmarketing.in', month: MONTH, amount: 10, reason: '' },
      ])
    ).rejects.toMatchObject({ status: 400, details: [expect.objectContaining({ row: 2 })] });
    expect(await pay.listBonuses({ month: MONTH })).toHaveLength(0);

    const ok = await pay.bulkAddBonuses([
      { email: 'ann@kdmarketing.in', month: MONTH, amount: 10, reason: 'A' },
      { email: 'ann@kdmarketing.in', month: MONTH, amount: 5, reason: 'B' },
    ]);
    expect(ok.created).toBe(2);
    expect((await pay.listBonuses({ month: MONTH, employeeId: e.id })).map((b) => b.amount)).toEqual([10, 5]);
  });

  it('a payslip needs the month to have been generated', async () => {
    const e = await createEmployee();
    await expect(pay.payslip({ employeeId: e.id, month: MONTH })).rejects.toMatchObject({ status: 404 });
  });
});

describe('the pay API is admin only', () => {
  it('turns an employee away and lets an admin set a rate and read the payslip', async () => {
    const e = await createEmployee();
    const employeeApi = as(await login(e));
    const { api } = await admin();

    expect((await employeeApi.get('/api/payroll/rates')).status).toBe(403);
    expect((await employeeApi.post('/api/payroll/bonuses').send({})).status).toBe(403);

    const created = await api
      .post('/api/payroll/rates')
      .send({ employeeId: e.id, dailyRate: '52.40', effectiveFrom: '2026-01-01' });
    expect(created.status).toBe(201);
    expect(created.body.dailyRate).toBe(52.4);

    await addShift(e, 3, 9 * 3600);
    await api.post('/api/payroll/generate').send({ month: MONTH });
    const slip = await api.get(`/api/payroll/payslip?employeeId=${e.id}&month=${MONTH}`);
    expect(slip.status).toBe(200);
    expect(slip.body.basePay).toBe(52.4);

    const csv = await api.get(`/api/payroll/export?month=${MONTH}`);
    expect(csv.text).toMatch(/Net Pay \(USD\)/);
  });

  it('answers a bad bulk upload with the failing rows', async () => {
    const { api } = await admin();
    const res = await api
      .post('/api/payroll/rates/bulk')
      .send({ rows: [{ email: 'missing@kdmarketing.in', dailyRate: 40, effectiveFrom: '2026-01-01' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].row).toBe(1);
  });
});
