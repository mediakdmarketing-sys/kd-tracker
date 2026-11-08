'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const mail = (p) => `${p}-${uuid().slice(0, 6)}@kdmarketing.in`;

/** An account admin (payroll and payments) and an ordinary HR admin. */
async function both() {
  const acc = await createEmployee({ role: 'admin', email: mail('acc') });
  const hr = await createEmployee({ role: 'admin', is_account_admin: false, email: mail('hr') });
  return { acc, hr, accApi: as(await login(acc)), hrApi: as(await login(hr)) };
}

const PAYROLL_READS = [
  '/api/payroll?month=2026-07',
  '/api/payroll/export?month=2026-07',
  '/api/payroll/payment-list?month=2026-07',
  '/api/payroll/rates',
  '/api/payroll/bonuses?month=2026-07',
  '/api/payroll/finalize/status?month=2026-07',
  '/api/payroll/payslips/status?month=2026-07',
];

describe('payroll and payments are for account admins only', () => {
  it('turns an ordinary HR admin away from every payroll and payment read', async () => {
    const { hrApi, accApi } = await both();
    for (const path of PAYROLL_READS) {
      const denied = await hrApi.get(path);
      expect([path, denied.status]).toEqual([path, 403]);
      expect(denied.body.error.message).toMatch(/account admin/i);
      // The account admin gets past the door (the answer may be an error about the month, never a 403).
      expect((await accApi.get(path)).status).not.toBe(403);
    }
  });

  it('turns an HR admin away from the writes too', async () => {
    const { hrApi } = await both();
    const e = await createEmployee();
    expect((await hrApi.post('/api/payroll/generate').send({ month: '2026-07' })).status).toBe(403);
    expect((await hrApi.post('/api/payroll/finalize').send({ month: '2026-07' })).status).toBe(403);
    expect((await hrApi.post('/api/payroll/rates').send({ employeeId: e.id, dailyRate: 50, effectiveFrom: '2026-01-01' })).status).toBe(403);
    expect((await hrApi.post('/api/payroll/bonuses').send({ employeeId: e.id, month: '2026-07', amount: 10, reason: 'x' })).status).toBe(403);
    expect((await hrApi.post('/api/payroll/payslips/send').send({ month: '2026-07' })).status).toBe(403);
  });

  it('leaves the company holidays with HR admins', async () => {
    const { hrApi } = await both();
    const add = await hrApi.post('/api/payroll/holidays').send({ date: '2026-12-25', name: 'Christmas Day' });
    expect(add.status).toBe(201);
    expect((await hrApi.get('/api/payroll/holidays?year=2026')).status).toBe(200);
    expect((await hrApi.delete(`/api/payroll/holidays/${add.body.id}`)).status).toBe(200);
  });

  it('keeps bank details from HR admins, including the list of who has them', async () => {
    const { hrApi, accApi } = await both();
    const e = await createEmployee();
    const details = { bank: 'BOC', accountName: 'K. Kumar', accountNumber: '12345678' };
    expect((await hrApi.get(`/api/admin/employees/${e.id}/bank`)).status).toBe(403);
    expect((await hrApi.put(`/api/admin/employees/${e.id}/bank`).send(details)).status).toBe(403);
    expect((await hrApi.delete(`/api/admin/employees/${e.id}/bank`)).status).toBe(403);
    expect((await hrApi.get('/api/admin/bank-details/status')).status).toBe(403);
    expect((await accApi.put(`/api/admin/employees/${e.id}/bank`).send(details)).status).toBe(200);
  });

  it('still lets an HR admin run everything else', async () => {
    const { hrApi } = await both();
    const e = await createEmployee();
    expect((await hrApi.get('/api/admin/employees')).status).toBe(200);
    expect((await hrApi.get(`/api/admin/employees/${e.id}`)).status).toBe(200);
    expect((await hrApi.get('/api/admin/departments')).status).toBe(200);
  });

  it('is not given to leaders or employees, and needs a sign-in', async () => {
    const lead = as(await login(await createEmployee({ role: 'leader' })));
    const user = as(await login(await createEmployee()));
    for (const who of [lead, user]) expect((await who.get('/api/payroll?month=2026-07')).status).toBe(403);
    expect((await request(app).get('/api/payroll?month=2026-07')).status).toBe(401);
  });
});

describe('settings', () => {
  it('shows an HR admin no payroll rules or payslip template, but the working days', async () => {
    const { hrApi, accApi } = await both();
    const hr = (await hrApi.get('/api/admin/settings')).body;
    expect(hr.payroll).toEqual({ workDays: expect.any(Array) });
    expect(hr).not.toHaveProperty('payslip');
    expect(hr).not.toHaveProperty('payslipDefaults');
    expect(hr.capture).toBeTruthy(); // the rest is still theirs

    const acc = (await accApi.get('/api/admin/settings')).body;
    expect(acc.payroll.fullDaySeconds).toBeGreaterThan(0);
    expect(acc.payslip).toBeTruthy();
  });

  it('lets an HR admin change non-payroll settings but not payroll ones or the template', async () => {
    const { hrApi, accApi } = await both();
    expect((await hrApi.patch('/api/admin/settings').send({ retention: { days: 20 } })).status).toBe(200);
    expect((await hrApi.patch('/api/admin/settings').send({ payroll: { fullDaySeconds: 30000 } })).status).toBe(403);
    expect((await hrApi.patch('/api/admin/settings').send({ payslip: { title: 'Pay slip' } })).status).toBe(403);
    expect((await accApi.patch('/api/admin/settings').send({ payroll: { fullDaySeconds: 30000 } })).status).toBe(200);
  });
});

describe('who can be an account admin', () => {
  it('is something an account admin gives and takes, and shows on the account', async () => {
    const { hr, accApi } = await both();
    const give = await accApi.patch(`/api/admin/employees/${hr.id}`).send({ accountAdmin: true });
    expect(give.status).toBe(200);
    expect(give.body.isAccountAdmin).toBe(true);
    // The right works at once: the next request is let in.
    expect((await as(await login(hr)).get('/api/payroll/rates')).status).toBe(200);
    const take = await accApi.patch(`/api/admin/employees/${hr.id}`).send({ accountAdmin: false });
    expect(take.body.isAccountAdmin).toBe(false);
  });

  it('can be given by an HR admin to someone else, but not to themselves', async () => {
    const { hr, hrApi } = await both();
    const other = await createEmployee({ role: 'admin', is_account_admin: false, email: mail('o') });
    expect((await hrApi.patch(`/api/admin/employees/${hr.id}`).send({ accountAdmin: true })).status).toBe(403);
    expect(Boolean((await db()('employees').where({ id: hr.id }).first()).is_account_admin)).toBe(false);

    const given = await hrApi.patch(`/api/admin/employees/${other.id}`).send({ accountAdmin: true });
    expect(given.status).toBe(200);
    expect(given.body.isAccountAdmin).toBe(true);
    expect((await as(await login(other)).get('/api/payroll/rates')).status).toBe(200);
  });

  it('can be given by an HR admin when creating an admin, but only an admin can hold it', async () => {
    const { hrApi } = await both();
    const made = await hrApi.post('/api/admin/employees').send({ name: 'New Admin', email: mail('n'), role: 'admin', accountAdmin: true });
    expect(made.status).toBe(201);
    expect(made.body.isAccountAdmin).toBe(true);
    const notAdmin = await hrApi.post('/api/admin/employees').send({ name: 'Worker', email: mail('w'), role: 'user', accountAdmin: true });
    expect(notAdmin.status).toBe(201);
    expect(notAdmin.body.isAccountAdmin).toBe(false);
  });

  it('cannot be taken away by an HR admin, only by an account admin', async () => {
    const { acc, hrApi, accApi } = await both();
    const second = await createEmployee({ role: 'admin', email: mail('s') }); // another account admin
    expect((await hrApi.patch(`/api/admin/employees/${second.id}`).send({ accountAdmin: false })).status).toBe(403);
    expect((await hrApi.patch(`/api/admin/employees/${acc.id}`).send({ accountAdmin: false })).status).toBe(403);
    expect(Boolean((await db()('employees').where({ id: second.id }).first()).is_account_admin)).toBe(true);
    expect((await accApi.patch(`/api/admin/employees/${second.id}`).send({ accountAdmin: false })).status).toBe(200);
  });

  it('is written to the audit log and every other account admin and the person are told', async () => {
    const { acc, hr, hrApi } = await both();
    const second = await createEmployee({ role: 'admin', email: mail('s') }); // a second account admin
    const target = await createEmployee({ role: 'admin', is_account_admin: false, name: 'Meena', email: mail('m') });
    await hrApi.patch(`/api/admin/employees/${target.id}`).send({ accountAdmin: true });

    const audit = await db()('audit_logs').where({ action: 'granted_account_admin' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ admin_id: hr.id, target_employee_id: target.id });
    expect(JSON.parse(audit[0].details)).toEqual({ byAccountAdmin: false });

    const told = async (id) => db()('notifications').where({ employee_id: id, type: 'account_admin_changed' });
    for (const watcher of [acc, second]) {
      const rows = await told(watcher.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('Meena was made an account admin');
      expect(rows[0].body).toContain('an HR admin');
    }
    expect((await told(target.id))[0].title).toBe('You are now an account admin');
    expect(await told(hr.id)).toHaveLength(0); // the person who did it is not told about their own act
  });

  it('records taking it away too, and says nothing when nothing changed', async () => {
    const { hr, accApi } = await both();
    await accApi.patch(`/api/admin/employees/${hr.id}`).send({ accountAdmin: true });
    await accApi.patch(`/api/admin/employees/${hr.id}`).send({ accountAdmin: true }); // already so
    await accApi.patch(`/api/admin/employees/${hr.id}`).send({ accountAdmin: false });
    expect(await db()('audit_logs').where({ action: 'granted_account_admin' })).toHaveLength(1);
    expect(await db()('audit_logs').where({ action: 'revoked_account_admin' })).toHaveLength(1);
  });

  it('cannot be got round by changing an account admin’s password, email or status', async () => {
    const { acc, hrApi } = await both();
    for (const body of [{ generatePassword: true }, { password: 'Quiet-River-42-x' }, { status: 'inactive' }, { email: mail('new') }, { role: 'user' }]) {
      expect([JSON.stringify(body), (await hrApi.patch(`/api/admin/employees/${acc.id}`).send(body)).status]).toEqual([JSON.stringify(body), 403]);
    }
    expect((await db()('employees').where({ id: acc.id }).first()).status).toBe('active');
  });

  it('an HR admin can still manage other HR admins and ordinary people', async () => {
    const { hrApi } = await both();
    const other = await createEmployee({ role: 'admin', is_account_admin: false, email: mail('o') });
    const e = await createEmployee();
    expect((await hrApi.patch(`/api/admin/employees/${other.id}`).send({ department: 'HR' })).status).toBe(200);
    expect((await hrApi.patch(`/api/admin/employees/${e.id}`).send({ department: 'Sales' })).status).toBe(200);
  });

  it('only an admin can be one, and it goes when the role does', async () => {
    const { accApi } = await both();
    const worker = await createEmployee({ email: mail('w') });
    expect((await accApi.patch(`/api/admin/employees/${worker.id}`).send({ accountAdmin: true })).status).toBe(400);

    const second = await createEmployee({ role: 'admin', email: mail('s') });
    expect((await accApi.patch(`/api/admin/employees/${second.id}`).send({ role: 'user' })).status).toBe(200);
    expect(Boolean((await db()('employees').where({ id: second.id }).first()).is_account_admin)).toBe(false);
  });

  it('can be made when an admin is created', async () => {
    const { accApi } = await both();
    const made = await accApi.post('/api/admin/employees').send({ name: 'New Finance', email: mail('f'), role: 'admin', accountAdmin: true });
    expect(made.status).toBe(201);
    expect(made.body.isAccountAdmin).toBe(true);
    const plain = await accApi.post('/api/admin/employees').send({ name: 'New HR', email: mail('p'), role: 'admin' });
    expect(plain.body.isAccountAdmin).toBe(false);
  });

  it('never leaves the company without an active account admin', async () => {
    const { acc, accApi } = await both();
    const own = `/api/admin/employees/${acc.id}`;
    for (const body of [{ accountAdmin: false }, { role: 'user' }, { status: 'inactive' }]) {
      const res = await accApi.patch(own).send(body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 409]);
      expect(res.body.error.message).toMatch(/at least one active account admin/);
    }
    // With a second account admin the first can step down.
    const second = await createEmployee({ role: 'admin', email: mail('s2') });
    expect((await accApi.patch(own).send({ accountAdmin: false })).status).toBe(200);
    expect(second.is_account_admin).toBe(true);
  });
});
