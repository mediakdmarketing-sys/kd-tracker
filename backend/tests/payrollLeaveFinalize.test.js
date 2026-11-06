'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const payroll = require('../src/modules/payroll/payroll.service');
const pay = require('../src/modules/payroll/pay.service');
const holidays = require('../src/modules/payroll/holidays.service');
const finalizeService = require('../src/modules/payroll/finalize.service');
const mail = require('../src/modules/payroll/payslipMail.service');
const mailer = require('../src/services/mailer');
const settings = require('../src/services/settings');
const { uuid } = require('../src/utils/ids');

const MONTH = '2026-07'; // 1 July 2026 is a Wednesday
const H = 3600;
const DEFAULT_PAYROLL = { paidLeaveTypes: ['vacation'], workDays: [1, 2, 3, 4, 5] };

beforeAll(async () => {
  await migrate();
  mail.setPace(0);
});
beforeEach(async () => {
  await truncate();
  await settings.update({ payroll: DEFAULT_PAYROLL });
});
afterEach(() => mailer.setTransport(null));
afterAll(destroy);

/** Someone who joined long before the month, with a rate. */
async function employee(overrides = {}, rate = 50) {
  const e = await createEmployee({ created_at: new Date('2026-01-01T00:00:00Z').getTime(), ...overrides });
  if (rate) await pay.setRate({ employeeId: e.id, dailyRate: rate, effectiveFrom: '2026-01-01' });
  return e;
}

async function shift(e, date, workedSeconds, extra = {}) {
  const punchIn = new Date(`${date}T09:00:00Z`).getTime();
  await db()('attendance').insert({
    id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: punchIn + (workedSeconds + H) * 1000, date,
    total_break_seconds: H, total_worked_seconds: workedSeconds, idle_seconds: 0, status: 'closed',
    over_break: false, auto_closed: false, needs_review: false, review_reason: null,
    created_at: punchIn, updated_at: punchIn, ...extra,
  });
}

async function leave(e, { type = 'vacation', from, to = from, status = 'approved', dayPart = 'full' }) {
  const now = Date.now();
  await db()('leave_requests').insert({
    id: uuid(), employee_id: e.id, type, day_part: dayPart, start_date: from, end_date: to,
    reason: 'test', status, created_at: now, updated_at: now,
  });
}

async function rowOf(e) {
  const rows = await payroll.list({ month: MONTH });
  return rows.find((r) => r.employeeId === e.id);
}

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return as(await login(a));
}

describe('paid leave', () => {
  it('pays approved vacation on working days only, and not the weekend inside it', async () => {
    const e = await employee();
    await shift(e, `${MONTH}-01`, 9 * H); // so there is a row
    await leave(e, { from: `${MONTH}-03`, to: `${MONTH}-07` }); // Fri, Sat, Sun, Mon, Tue

    await payroll.generate({ month: MONTH });
    const row = await rowOf(e);
    expect(row.paidLeaveDays).toBe(3);
    expect(row.basePay).toBe(50 + 3 * 50);
  });

  it('does not pay leave of an unpaid type, or a request that is not approved', async () => {
    const e = await employee();
    await shift(e, `${MONTH}-01`, 9 * H);
    await leave(e, { type: 'personal', from: `${MONTH}-06` });
    await leave(e, { type: 'sick', from: `${MONTH}-07` });
    await leave(e, { type: 'vacation', from: `${MONTH}-08`, status: 'pending' });
    await leave(e, { type: 'vacation', from: `${MONTH}-09`, status: 'rejected' });

    await payroll.generate({ month: MONTH });
    expect((await rowOf(e)).paidLeaveDays).toBe(0);
  });

  it('pays half for a half-day leave, and the types and working days follow Settings', async () => {
    const e = await employee();
    await shift(e, `${MONTH}-01`, 9 * H);
    await leave(e, { from: `${MONTH}-06`, dayPart: 'half_pm' });
    await leave(e, { type: 'personal', from: `${MONTH}-07` });
    await leave(e, { from: `${MONTH}-04` }); // a Saturday

    await payroll.generate({ month: MONTH });
    expect((await rowOf(e)).basePay).toBe(50 + 25);

    await settings.update({ payroll: { paidLeaveTypes: ['vacation', 'personal'], workDays: [1, 2, 3, 4, 5, 6] } });
    await payroll.generate({ month: MONTH });
    const row = await rowOf(e);
    expect(row.paidLeaveDays).toBe(0.5 + 1 + 1); // half day, personal, and now Saturday counts
    expect(row.basePay).toBe(50 + 25 + 50 + 50);
  });

  it('never pays more than one day for a date: leave covers only what was not worked', async () => {
    const e = await employee();
    await shift(e, `${MONTH}-06`, 4.5 * H); // a half day worked...
    await leave(e, { from: `${MONTH}-06`, dayPart: 'half_pm' }); // ...and the other half on leave
    await shift(e, `${MONTH}-07`, 9 * H); // a full day worked...
    await leave(e, { from: `${MONTH}-07` }); // ...on a day of leave

    await payroll.generate({ month: MONTH });
    const row = await rowOf(e);
    expect(row.basePay).toBe(50 + 50); // one whole day each
    expect(row.paidLeaveDays).toBe(0.5);
  });

  it('gives someone with no shifts at all in the month a row when leave earns them pay', async () => {
    const e = await employee();
    await leave(e, { from: `${MONTH}-06`, to: `${MONTH}-08` });
    await payroll.generate({ month: MONTH });
    const row = await rowOf(e);
    expect(row).toMatchObject({ daysPresent: 0, paidLeaveDays: 3, basePay: 150 });
  });
});

describe('company holidays', () => {
  it('pays every active employee with a rate who had joined, once, on working days', async () => {
    const worker = await employee();
    const noRate = await employee({}, 0);
    const late = await employee({ created_at: new Date('2026-07-20T00:00:00Z').getTime() });
    const gone = await employee({ status: 'inactive' });
    await holidays.add({ date: `${MONTH}-03`, name: 'Independence Day (observed)' }); // a Friday
    await holidays.add({ date: `${MONTH}-04`, name: 'Saturday holiday' }); // not a working day
    await shift(worker, `${MONTH}-01`, 9 * H);
    await leave(worker, { from: `${MONTH}-03` }); // a vacation on the holiday is not paid twice

    await payroll.generate({ month: MONTH });
    const rows = await payroll.list({ month: MONTH });
    const byId = Object.fromEntries(rows.map((r) => [r.employeeId, r]));

    expect(byId[worker.id]).toMatchObject({ holidayDays: 1, paidLeaveDays: 0, basePay: 100 });
    expect(byId[noRate.id]).toBeUndefined(); // nothing to pay, so no row
    expect(byId[late.id]).toBeUndefined(); // joined after the holiday
    expect(byId[gone.id]).toBeUndefined(); // no longer active
  });

  it('adds, renames in bulk, removes, and refuses a bad or repeated date', async () => {
    const a = await holidays.add({ date: '2026-12-25', name: 'Christmas' });
    await expect(holidays.add({ date: '2026-12-25', name: 'Again' })).rejects.toMatchObject({ status: 409 });
    await expect(holidays.add({ date: '2026-02-31', name: 'Nope' })).rejects.toMatchObject({ status: 400 });

    const bulk = await holidays.bulkAdd([
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-26', name: 'Boxing Day' },
    ]);
    expect(bulk).toEqual({ created: 1, renamed: 1 });
    expect((await holidays.list({ year: '2026' })).map((h) => h.name)).toEqual(['Christmas Day', 'Boxing Day']);

    await expect(holidays.bulkAdd([{ date: '2026-13-01', name: 'x' }, { date: '2026-12-27', name: '' }])).rejects.toMatchObject({
      status: 400,
      details: [expect.objectContaining({ row: 1 }), expect.objectContaining({ row: 2 })],
    });
    await holidays.remove(a.id);
    expect(await holidays.list({ year: '2026' })).toHaveLength(1);
  });
});

describe('finalizing a month', () => {
  async function readyMonth() {
    const e = await employee();
    await shift(e, `${MONTH}-02`, 9 * H);
    await payroll.generate({ month: MONTH });
    return e;
  }

  it('freezes the payslip, blocks regeneration and changes to bonuses and holidays, until reopened', async () => {
    const e = await readyMonth();
    await pay.addBonus({ employeeId: e.id, month: MONTH, amount: 20, reason: 'Before' });

    const done = await finalizeService.finalize({ month: MONTH });
    expect(done).toMatchObject({ employees: 1, netTotal: 70 });
    expect(await finalizeService.status(MONTH)).toMatchObject({ final: true, employees: 1, netTotal: 70 });

    // Nothing that feeds the pay can change now.
    await expect(payroll.generate({ month: MONTH })).rejects.toMatchObject({ status: 409 });
    await expect(pay.addBonus({ employeeId: e.id, month: MONTH, amount: 5, reason: 'After' })).rejects.toMatchObject({ status: 409 });
    await expect(holidays.add({ date: `${MONTH}-10`, name: 'Late holiday' })).rejects.toMatchObject({ status: 409 });
    const [bonus] = await pay.listBonuses({ month: MONTH });
    await expect(pay.deleteBonus(bonus.id)).rejects.toMatchObject({ status: 409 });

    // A later raise and a changed shift do not touch the frozen payslip.
    await pay.setRate({ employeeId: e.id, dailyRate: 500, effectiveFrom: '2026-07-01' });
    const slip = await pay.payslip({ employeeId: e.id, month: MONTH });
    expect(slip).toMatchObject({ netPay: 70, basePay: 50, finalized: true, stale: false });

    // Reopening unfreezes it, and regenerating picks up the raise.
    await finalizeService.reopen({ month: MONTH });
    expect((await finalizeService.status(MONTH)).final).toBe(false);
    await payroll.generate({ month: MONTH });
    expect((await pay.payslip({ employeeId: e.id, month: MONTH })).basePay).toBe(500);
  });

  it('refuses to freeze a payslip that is out of date, and asks before going ahead despite warnings', async () => {
    const e = await readyMonth();
    await pay.setRate({ employeeId: e.id, dailyRate: 80, effectiveFrom: '2026-07-01' }); // changed since generating
    await expect(finalizeService.finalize({ month: MONTH })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/out of date/) });
    await payroll.generate({ month: MONTH });

    // An open shift is a warning: finalizing needs force.
    const punchIn = new Date(`${MONTH}-03T09:00:00Z`).getTime();
    await db()('attendance').insert({
      id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: null, date: `${MONTH}-03`, total_break_seconds: 0,
      total_worked_seconds: null, idle_seconds: 0, status: 'open', over_break: false, auto_closed: false,
      needs_review: false, review_reason: null, created_at: punchIn, updated_at: punchIn,
    });
    await expect(finalizeService.finalize({ month: MONTH })).rejects.toMatchObject({
      status: 409,
      details: [expect.objectContaining({ code: 'open_shifts' })],
    });
    expect((await finalizeService.finalize({ month: MONTH, force: true })).warnings).toHaveLength(1);
  });

  it('needs a generated month, and cannot be finalized twice or reopened when open', async () => {
    await expect(finalizeService.finalize({ month: MONTH })).rejects.toMatchObject({ status: 400 });
    await readyMonth();
    await finalizeService.finalize({ month: MONTH });
    await expect(finalizeService.finalize({ month: MONTH })).rejects.toMatchObject({ status: 409 });
    await finalizeService.reopen({ month: MONTH });
    await expect(finalizeService.reopen({ month: MONTH })).rejects.toMatchObject({ status: 409 });
  });

  it('is admin only through the API, asks for a reason to reopen, and notifies each person', async () => {
    const e = await readyMonth();
    const api = await admin();
    const employeeApi = as(await login(e));

    expect((await employeeApi.post('/api/payroll/finalize').send({ month: MONTH })).status).toBe(403);
    expect((await api.post('/api/payroll/finalize').send({ month: MONTH })).status).toBe(200);
    expect((await api.get(`/api/payroll/finalize/status?month=${MONTH}`)).body.final).toBe(true);

    const notice = await db()('notifications').where({ employee_id: e.id, type: 'payslip_ready' }).first();
    expect(notice).toMatchObject({ link: `/me/payslips/${MONTH}` });

    expect((await api.post('/api/payroll/reopen').send({ month: MONTH, reason: 'x' })).status).toBe(400);
    expect((await api.post('/api/payroll/reopen').send({ month: MONTH, reason: 'Wrong rate for one person' })).status).toBe(200);
    const audit = await db()('audit_logs').whereIn('action', ['finalized_payroll', 'reopened_payroll']).orderBy('timestamp');
    expect(audit.map((a) => a.action)).toEqual(['finalized_payroll', 'reopened_payroll']);
    expect(JSON.parse(audit[1].details).reason).toBe('Wrong rate for one person');
  });

  it('a finalized month is emailed from the frozen figures', async () => {
    const e = await readyMonth();
    await finalizeService.finalize({ month: MONTH });
    await pay.setRate({ employeeId: e.id, dailyRate: 900, effectiveFrom: '2026-07-01' });

    const sent = [];
    mailer.setTransport(async (m) => {
      sent.push(m);
      return { id: 'ok' };
    });
    await mail.queue({ month: MONTH, employeeIds: [e.id] });
    await mail.processQueue();
    expect(sent[0].text).toMatch(/Net pay: \$50\.00/);
  });
});

describe('my payslips', () => {
  async function finalizedFor(e) {
    await shift(e, `${MONTH}-02`, 9 * H);
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });
  }

  it('lists and shows only the signed-in person’s own finalized payslips', async () => {
    const ann = await employee({ email: 'ann@kdmarketing.in' });
    const bob = await employee({ email: 'bob@kdmarketing.in' }, 70);
    await shift(bob, `${MONTH}-02`, 9 * H);
    await finalizedFor(ann);

    const annApi = as(await login(ann));
    const list = await annApi.get('/api/payslips');
    expect(list.status).toBe(200);
    expect(list.body.rows).toEqual([expect.objectContaining({ month: MONTH, netPay: 50 })]);

    const one = await annApi.get(`/api/payslips/${MONTH}`);
    expect(one.body.slip).toMatchObject({ netPay: 50, finalized: true });
    expect(one.body.slip.employee.email).toBe('ann@kdmarketing.in');
    expect(one.body.template.title).toBe('Payslip');
    expect(one.body.company).toBeDefined();

    // Bob has his own, different one, and there is no way to ask for Ann's.
    const bobApi = as(await login(bob));
    expect((await bobApi.get(`/api/payslips/${MONTH}`)).body.slip.netPay).toBe(70);
    expect((await bobApi.get('/api/payslips/2026-06')).status).toBe(404);
  });

  it('shows nothing until the month is finalized, then again nothing once it is reopened', async () => {
    const ann = await employee();
    await shift(ann, `${MONTH}-02`, 9 * H);
    await payroll.generate({ month: MONTH });
    const api = as(await login(ann));

    expect((await api.get('/api/payslips')).body.rows).toEqual([]);
    expect((await api.get(`/api/payslips/${MONTH}`)).status).toBe(404);

    await finalizeService.finalize({ month: MONTH });
    expect((await api.get('/api/payslips')).body.rows).toHaveLength(1);

    await finalizeService.reopen({ month: MONTH });
    expect((await api.get(`/api/payslips/${MONTH}`)).status).toBe(404);
  });

  it('gives a PDF of their own payslip, and needs a session', async () => {
    const ann = await employee();
    await finalizedFor(ann);
    const api = as(await login(ann));

    const res = await api.get(`/api/payslips/${MONTH}/pdf`).buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
    expect(res.body.subarray(0, 5).toString()).toBe('%PDF-');

    const { app, request } = require('./helpers');
    expect((await request(app).get('/api/payslips')).status).toBe(401);
  });
});
