'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const config = require('../src/config');
const bankDetails = require('../src/services/bankDetails');
const payroll = require('../src/modules/payroll/payroll.service');
const pay = require('../src/modules/payroll/pay.service');
const finalizeService = require('../src/modules/payroll/finalize.service');
const settings = require('../src/services/settings');
const { uuid } = require('../src/utils/ids');

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  await settings.update({ payroll: { paidLeaveTypes: ['vacation'], workDays: [1, 2, 3, 4, 5] } });
});
afterAll(destroy);

const DETAILS = { bank: 'Bank of Ceylon', branch: 'Jaffna Main', accountName: 'K. Kumar', accountNumber: '0012 3456 7890' };

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return as(await login(a));
}

const auditOf = (action) => db()('audit_logs').where({ action }).orderBy('timestamp', 'asc');

describe('saving bank details', () => {
  it('keeps nothing readable in the database, and shows the account number masked', async () => {
    const hr = await admin();
    const e = await createEmployee();
    const res = await hr.put(`/api/admin/employees/${e.id}/bank`).send(DETAILS);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hasDetails: true, bank: 'Bank of Ceylon', accountNumberMasked: '****7890' });
    expect(JSON.stringify(res.body)).not.toContain('0012');

    const row = await db()('employee_bank_details').where({ employee_id: e.id }).first();
    const stored = JSON.stringify(row);
    for (const secret of ['0012', '34567890', 'Jaffna', 'K. Kumar']) expect(stored).not.toContain(secret);
    expect(row.account_last4).toBe('7890');
    expect(row.details_enc).toMatch(/^v1\./);
  });

  it('replaces the old details when saved again', async () => {
    const hr = await admin();
    const e = await createEmployee();
    await hr.put(`/api/admin/employees/${e.id}/bank`).send(DETAILS);
    await hr.put(`/api/admin/employees/${e.id}/bank`).send({ ...DETAILS, bank: 'People’s Bank', accountNumber: '55550001' });
    expect(await db()('employee_bank_details').where({ employee_id: e.id })).toHaveLength(1);
    const full = (await hr.get(`/api/admin/employees/${e.id}/bank?reveal=1`)).body;
    expect(full).toMatchObject({ bank: 'People’s Bank', accountNumber: '55550001' });
  });

  it('refuses missing or odd fields', async () => {
    const hr = await admin();
    const e = await createEmployee();
    for (const bad of [{ ...DETAILS, accountNumber: '12' }, { ...DETAILS, accountNumber: 'ab cd!!' }, { ...DETAILS, bank: '' }, { ...DETAILS, accountName: '' }]) {
      expect((await hr.put(`/api/admin/employees/${e.id}/bank`).send(bad)).status).toBe(400);
    }
    expect((await hr.put(`/api/admin/employees/${uuid()}/bank`).send(DETAILS)).status).toBe(404);
  });

  it('cannot be read with another employee’s id: the blob is tied to its owner', async () => {
    const a = await createEmployee();
    const b = await createEmployee();
    await bankDetails.save(a.id, DETAILS);
    const stolen = (await db()('employee_bank_details').where({ employee_id: a.id }).first()).details_enc;
    expect(() => bankDetails.decrypt(b.id, stolen)).toThrow();
    expect(bankDetails.decrypt(a.id, stolen).bank).toBe('Bank of Ceylon');
  });
});

describe('who can see them, and the audit trail', () => {
  it('is for HR only', async () => {
    const e = await createEmployee();
    const user = as(await login(await createEmployee()));
    const leader = as(await login(await createEmployee({ role: 'leader' })));
    for (const who of [user, leader]) {
      expect((await who.get(`/api/admin/employees/${e.id}/bank`)).status).toBe(403);
      expect((await who.put(`/api/admin/employees/${e.id}/bank`).send(DETAILS)).status).toBe(403);
      expect((await who.get('/api/admin/bank-details/status')).status).toBe(403);
    }
    expect((await request(app).get(`/api/admin/employees/${e.id}/bank`)).status).toBe(401);
  });

  it('records every look, saying whether the account number was shown, and never the values', async () => {
    const hr = await admin();
    const e = await createEmployee();
    await hr.put(`/api/admin/employees/${e.id}/bank`).send(DETAILS);
    await hr.get(`/api/admin/employees/${e.id}/bank`);
    await hr.get(`/api/admin/employees/${e.id}/bank?reveal=1`);

    const views = await auditOf('viewed_bank_details');
    expect(views).toHaveLength(2);
    expect(views.map((v) => JSON.parse(v.details).accountNumberShown)).toEqual([false, true]);
    expect(views[0].target_employee_id).toBe(e.id);
    expect(await auditOf('updated_bank_details')).toHaveLength(1);

    const everything = JSON.stringify(await db()('audit_logs'));
    expect(everything).not.toContain('34567890');
    expect(everything).not.toContain('0012');
  });

  it('removes details and records it', async () => {
    const hr = await admin();
    const e = await createEmployee();
    await hr.put(`/api/admin/employees/${e.id}/bank`).send(DETAILS);
    expect((await hr.delete(`/api/admin/employees/${e.id}/bank`)).body).toEqual({ removed: true });
    expect((await hr.get(`/api/admin/employees/${e.id}/bank`)).body).toEqual({ hasDetails: false });
    expect(await auditOf('removed_bank_details')).toHaveLength(1);
  });

  it('lists who has details without decrypting any', async () => {
    const hr = await admin();
    const a = await createEmployee();
    await createEmployee();
    await hr.put(`/api/admin/employees/${a.id}/bank`).send(DETAILS);
    const res = await hr.get('/api/admin/bank-details/status');
    expect(res.body.rows).toEqual([{ employeeId: a.id, bank: 'Bank of Ceylon', accountNumberMasked: '****7890' }]);
  });
});

describe('the key', () => {
  it('switches the feature off, clearly, when the key is missing, but the server is fine', async () => {
    const hr = await admin();
    const e = await createEmployee();
    const original = config.bank.dataKey;
    config.bank.dataKey = '';
    try {
      const res = await hr.put(`/api/admin/employees/${e.id}/bank`).send(DETAILS);
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('BANK_KEY_MISSING');
      expect((await hr.get('/health')).status).toBe(200);
    } finally {
      config.bank.dataKey = original;
    }
  });

  it('rejects a key that is not 32 bytes', async () => {
    const original = config.bank.dataKey;
    config.bank.dataKey = 'tooshort';
    try {
      await expect(bankDetails.save((await createEmployee()).id, DETAILS)).rejects.toMatchObject({ code: 'BANK_KEY_INVALID' });
    } finally {
      config.bank.dataKey = original;
    }
  });
});

describe('the payment list carries where to pay', () => {
  const MONTH = '2026-07';
  async function paidEmployee(name, rate = 50) {
    const e = await createEmployee({ name, created_at: new Date('2026-01-01T00:00:00Z').getTime() });
    await pay.setRate({ employeeId: e.id, dailyRate: rate, effectiveFrom: '2026-01-01' });
    const punchIn = new Date('2026-07-01T09:00:00Z').getTime();
    await db()('attendance').insert({
      id: uuid(), employee_id: e.id, punch_in: punchIn, punch_out: punchIn + 36_000_000, date: '2026-07-01',
      total_break_seconds: 3600, total_worked_seconds: 9 * 3600, idle_seconds: 0, status: 'closed',
      over_break: false, auto_closed: false, needs_review: false, review_reason: null, created_at: punchIn, updated_at: punchIn,
    });
    return e;
  }

  it('puts bank, branch, account name and number in the CSV, flags who has none, and audits it', async () => {
    const hr = await admin();
    const ann = await paidEmployee('Ann');
    await paidEmployee('Bob'); // no bank details
    await bankDetails.save(ann.id, DETAILS);
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });

    const csv = await hr.get(`/api/payroll/payment-list?month=${MONTH}`);
    const lines = csv.text.replace(/^﻿/, '').split('\r\n');
    expect(lines[0]).toContain('Bank,Branch,Account Name,Account Number,Note');
    expect(lines[1]).toContain('Ann');
    expect(lines[1]).toContain('Bank of Ceylon,Jaffna Main,K. Kumar,001234567890');
    expect(lines[2]).toContain('Bob');
    expect(lines[2]).toContain('NO BANK DETAILS');
    expect(csv.headers['cache-control']).toBe('no-store');

    const entry = JSON.parse((await auditOf('exported_payroll')).pop().details);
    expect(entry).toMatchObject({ kind: 'payment-list', accountNumbersIncluded: true, missingBankDetails: 1 });
  });

  it('shows only the masked number in the JSON view', async () => {
    const hr = await admin();
    const ann = await paidEmployee('Ann');
    await bankDetails.save(ann.id, DETAILS);
    await payroll.generate({ month: MONTH });
    await finalizeService.finalize({ month: MONTH });

    const res = await hr.get(`/api/payroll/payment-list?month=${MONTH}&format=json`);
    expect(res.body.rows[0]).toMatchObject({ bank: 'Bank of Ceylon', accountNumberMasked: '****7890', hasBankDetails: true });
    expect(JSON.stringify(res.body)).not.toContain('001234567890');
    expect(res.body.missingBank).toBe(0);
  });
});
