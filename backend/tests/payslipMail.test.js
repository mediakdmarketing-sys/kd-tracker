'use strict';

const { migrate, truncate, createEmployee, login, as, app, request } = require('./helpers');
const { db, destroy } = require('../src/db');
const payroll = require('../src/modules/payroll/payroll.service');
const pay = require('../src/modules/payroll/pay.service');
const mail = require('../src/modules/payroll/payslipMail.service');
const mailer = require('../src/services/mailer');
const branding = require('../src/services/branding');
const settings = require('../src/services/settings');
const { uuid } = require('../src/utils/ids');

const MONTH = '2026-07';

// A real 1x1 PNG.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

let sent;

beforeAll(async () => {
  await migrate();
  mail.setPace(0);
});
beforeEach(async () => {
  await truncate();
  await branding.removeLogo({});
  await settings.update({ company: { name: null } });
  sent = [];
  mailer.setTransport(async (message) => {
    sent.push(message);
    return { id: `msg-${sent.length}` };
  });
});
afterEach(() => mailer.setTransport(null));
afterAll(destroy);

async function paidEmployee(overrides = {}) {
  const e = await createEmployee(overrides);
  await pay.setRate({ employeeId: e.id, dailyRate: 50, effectiveFrom: '2026-01-01' });
  const date = `${MONTH}-02`;
  const punchIn = new Date(`${date}T09:00:00Z`).getTime();
  await db()('attendance').insert({
    id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: punchIn + 9 * 3600 * 1000, date,
    total_break_seconds: 3600, total_worked_seconds: 9 * 3600, idle_seconds: 0, status: 'closed',
    over_break: false, auto_closed: false, needs_review: false, review_reason: null,
    created_at: punchIn, updated_at: punchIn,
  });
  return e;
}

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return as(await login(a));
}

describe('company logo', () => {
  it('stores a real image, serves it publicly, and replaces the old one', async () => {
    await branding.setLogo({ contentType: 'image/png', dataBase64: PNG_B64 });
    const first = settings.get().company.logoKey;

    const res = await request(app).get('/api/branding/logo');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/png/);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');

    await new Promise((r) => setTimeout(r, 5)); // a different timestamp, so a different key
    await branding.setLogo({ contentType: 'image/png', dataBase64: PNG_B64 });
    expect(settings.get().company.logoKey).not.toBe(first);
  });

  it('answers 404 when there is no logo', async () => {
    expect((await request(app).get('/api/branding/logo')).status).toBe(404);
  });

  it('refuses a file that is not the image it claims to be, SVG, and anything too big', async () => {
    await expect(branding.setLogo({ contentType: 'image/png', dataBase64: Buffer.from('not an image').toString('base64') }))
      .rejects.toMatchObject({ status: 400 });
    await expect(branding.setLogo({ contentType: 'image/svg+xml', dataBase64: Buffer.from('<svg/>').toString('base64') }))
      .rejects.toMatchObject({ status: 400 });
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(1024 * 1024 + 10)]);
    await expect(branding.setLogo({ contentType: 'image/png', dataBase64: big.toString('base64') }))
      .rejects.toMatchObject({ status: 400 });
    expect(settings.get().company.logoKey).toBeNull();
  });

  it('is changed by admins only, and shows in the settings', async () => {
    const employee = as(await login(await createEmployee()));
    expect((await employee.post('/api/branding/logo').send({ contentType: 'image/png', data: PNG_B64 })).status).toBe(403);

    const api = await admin();
    expect((await api.post('/api/branding/logo').send({ contentType: 'image/png', data: PNG_B64 })).status).toBe(201);
    await api.patch('/api/admin/settings').send({ company: { name: 'Acme Ltd' } });

    const s = (await api.get('/api/admin/settings')).body;
    expect(s.company).toMatchObject({ name: 'Acme Ltd', hasLogo: true });
    expect(s.company.logoKey).toBeUndefined();
    expect(s.email).toEqual({ configured: true }); // the test transport counts as configured

    expect((await api.delete('/api/branding/logo')).status).toBe(200);
    expect((await request(app).get('/api/branding/logo')).status).toBe(404);
  });
});

describe('emailing payslips', () => {
  it('sends each person their own payslip at their own address', async () => {
    const a = await paidEmployee({ email: 'ann@kdmarketing.in', name: 'Ann <b>Lee</b>' });
    await paidEmployee({ email: 'bob@kdmarketing.in', name: 'Bob' });
    await payroll.generate({ month: MONTH });
    await pay.addBonus({ employeeId: a.id, month: MONTH, amount: 25, reason: 'Great <i>work</i>' });

    const queued = await mail.queue({ month: MONTH });
    expect(queued.queued).toBe(2);
    await mail.processQueue();

    expect(sent.map((m) => m.to).sort()).toEqual(['ann@kdmarketing.in', 'bob@kdmarketing.in']);
    const ann = sent.find((m) => m.to === 'ann@kdmarketing.in');
    expect(ann.subject).toBe('Your payslip for July 2026');
    expect(ann.text).toMatch(/Net pay: \$75\.00/);
    // Names and reasons are escaped, never injected as markup.
    expect(ann.html).not.toMatch(/<b>Lee/);
    expect(ann.html).toMatch(/&lt;b&gt;Lee/);
    expect(ann.html).toMatch(/Great &lt;i&gt;work/);
    expect(ann.text).toMatch(/Full day: 1 × \$50\.00/);
    expect(ann.text).toMatch(/You worked 1 day: 1 full, 0 half/);
  });

  it('skips inactive staff in a send to everyone, and anyone with no payroll', async () => {
    await paidEmployee({ email: 'ann@kdmarketing.in' });
    await paidEmployee({ email: 'gone@kdmarketing.in', status: 'inactive' });
    const nopay = await createEmployee({ email: 'new@kdmarketing.in' });
    await payroll.generate({ month: MONTH });

    expect((await mail.queue({ month: MONTH })).queued).toBe(1);
    const one = await mail.queue({ month: MONTH, employeeIds: [nopay.id] });
    expect(one.queued).toBe(0);
    expect(one.skipped[0].reason).toMatch(/Generate the month/);
  });

  it('one failure does not stop the rest, and is shown against that person', async () => {
    await paidEmployee({ email: 'ann@kdmarketing.in' });
    await paidEmployee({ email: 'bad@kdmarketing.in' });
    await payroll.generate({ month: MONTH });
    mailer.setTransport(async (m) => {
      if (m.to === 'bad@kdmarketing.in') throw new Error('Mailbox does not exist');
      sent.push(m);
      return { id: 'ok' };
    });

    await mail.queue({ month: MONTH });
    const result = await mail.processQueue();
    expect(result).toEqual({ sent: 1, failed: 1 });

    const { rows } = await mail.status(MONTH);
    expect(rows.find((r) => r.email === 'bad@kdmarketing.in')).toMatchObject({ status: 'failed', error: 'Mailbox does not exist' });
    expect(rows.find((r) => r.email === 'ann@kdmarketing.in').status).toBe('sent');
  });

  it('retries a busy service a few times, then gives up', async () => {
    await paidEmployee({ email: 'ann@kdmarketing.in' });
    await payroll.generate({ month: MONTH });
    let calls = 0;
    mailer.setTransport(async () => {
      calls += 1;
      throw new mailer.TemporaryMailError('The email service is busy');
    });

    await mail.queue({ month: MONTH });
    await mail.processQueue();

    expect(calls).toBe(3);
    expect((await mail.status(MONTH)).rows[0]).toMatchObject({ status: 'failed' });
  });

  it('sending again overwrites the row rather than adding one', async () => {
    const a = await paidEmployee({ email: 'ann@kdmarketing.in' });
    await payroll.generate({ month: MONTH });

    await mail.queue({ month: MONTH, employeeIds: [a.id] });
    await mail.processQueue();
    await mail.queue({ month: MONTH, employeeIds: [a.id] });
    await mail.processQueue();

    expect(await db()('payslip_emails').where({ employee_id: a.id })).toHaveLength(1);
    expect(sent).toHaveLength(2);
  });

  it('does not queue someone twice while they are still waiting', async () => {
    const a = await paidEmployee({ email: 'ann@kdmarketing.in' });
    await payroll.generate({ month: MONTH });
    expect((await mail.queue({ month: MONTH, employeeIds: [a.id] })).queued).toBe(1);
    expect((await mail.queue({ month: MONTH, employeeIds: [a.id] })).queued).toBe(0);
  });

  it('refuses to queue anything when email is not set up', async () => {
    await paidEmployee();
    await payroll.generate({ month: MONTH });
    mailer.setTransport(null);
    await expect(mail.queue({ month: MONTH })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not set up/) });
  });

  it('uses the company name and logo from settings', async () => {
    const e = await paidEmployee();
    await payroll.generate({ month: MONTH });
    await settings.update({ company: { name: 'Acme Ltd' } });
    const slip = await pay.payslip({ employeeId: e.id, month: MONTH });
    const built = mail.buildEmail(slip, { logo: 'https://api.example.com/api/branding/logo?v=1' });
    expect(built.html).toMatch(/Acme Ltd/);
    expect(built.html).toMatch(/api\.example\.com\/api\/branding\/logo\?v=1/);
  });
});

describe('the send API', () => {
  it('sends one payslip at once and reports it; employees cannot use it', async () => {
    const e = await paidEmployee({ email: 'ann@kdmarketing.in' });
    await payroll.generate({ month: MONTH });

    expect((await as(await login(e)).post('/api/payroll/payslips/send').send({ month: MONTH })).status).toBe(403);

    const api = await admin();
    const res = await api.post('/api/payroll/payslips/send').send({ month: MONTH, employeeIds: [e.id] });
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(1);
    expect(res.body.rows[0]).toMatchObject({ email: 'ann@kdmarketing.in', status: 'sent' });
    expect(sent).toHaveLength(1);

    const status = await api.get(`/api/payroll/payslips/status?month=${MONTH}`);
    expect(status.body.emailConfigured).toBe(true);
    expect(status.body.rows).toHaveLength(1);
  });

  it('queues a send to everyone and leaves the worker to deliver it', async () => {
    for (let i = 0; i < 7; i += 1) await paidEmployee({ email: `p${i}@kdmarketing.in` });
    await payroll.generate({ month: MONTH });

    const api = await admin();
    const res = await api.post('/api/payroll/payslips/send').send({ month: MONTH });
    expect(res.status).toBe(202);
    expect(res.body.queued).toBe(7);

    // The background worker was started; give it a moment, then wait on it directly.
    await mail.processQueue();
    for (let i = 0; i < 50 && sent.length < 7; i += 1) await new Promise((r) => setTimeout(r, 20));
    expect(sent).toHaveLength(7);
    expect((await mail.status(MONTH)).rows.every((r) => r.status === 'sent')).toBe(true);
  });
});
