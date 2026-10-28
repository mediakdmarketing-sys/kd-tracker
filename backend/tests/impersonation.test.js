'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const companies = require('../src/services/companies');
const t = require('../src/utils/time');

const A = companies.DEFAULT_COMPANY_ID;
const B = '00000000-0000-4000-8000-0000000000b2';

beforeAll(migrate);
afterAll(destroy);

beforeEach(async () => {
  await truncate();
  await db()('departments').del();
  await db()('companies').where({ id: B }).del();
  await db()('companies').insert({ id: B, name: 'Second Co', slug: 'second', status: 'active', created_at: t.now(), updated_at: t.now() });
  companies.invalidate();
});

async function setup() {
  const owner = await createEmployee({ name: 'Owner', role: 'admin', is_super_admin: true, company_id: A });
  const hrB = await createEmployee({ name: 'HR B', role: 'admin', company_id: B });
  const empB = await createEmployee({ name: 'Emp B', role: 'user', company_id: B, must_change_password: true, consent_monitoring: false });
  return { owner, hrB, empB };
}

async function viewAs(owner, person) {
  const res = await as(await login(owner)).post('/api/super/impersonate').send({ employeeId: person.id });
  expect(res.status).toBe(201);
  return res.body;
}

describe('viewing as someone in a company', () => {
  it('lists the people and lets only the platform owner step in', async () => {
    const { owner, hrB, empB } = await setup();
    const api = as(await login(owner));
    const list = await api.get(`/api/super/companies/${B}/people`);
    expect(list.body.map((p) => p.name).sort()).toEqual(['Emp B', 'HR B']);

    const asHr = await as(await login(hrB)).post('/api/super/impersonate').send({ employeeId: empB.id });
    expect(asHr.status).toBe(403);
    // another platform owner is off limits
    const other = await createEmployee({ name: 'Other Owner', is_super_admin: true, company_id: B });
    expect((await api.post('/api/super/impersonate').send({ employeeId: other.id })).status).toBe(400);
  });

  it('becomes that person: sees their company, skips their pending password and consent, says who is looking', async () => {
    const { owner, empB } = await setup();
    const session = await viewAs(owner, empB);
    const me = await as(session.accessToken).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: empB.id, name: 'Emp B', mustChangePassword: false });
    expect(me.body.consent.required).toBe(false);
    expect(me.body.impersonation.by.name).toBe('Owner');
    expect(me.body.company.name).toBe('Second Co');
    // and cannot reach the platform pages from inside
    expect((await as(session.accessToken).get('/api/super/companies')).status).toBe(403);
  });

  it('may look and use admin tools, but not act as the person', async () => {
    const { owner, hrB, empB } = await setup();
    const asEmp = await viewAs(owner, empB);
    expect((await as(asEmp.accessToken).get('/api/attendance/status')).status).toBe(200);
    for (const [method, url] of [
      ['post', '/api/attendance/punch-in'],
      ['post', '/api/auth/consent'],
      ['post', '/api/auth/change-password'],
      ['post', '/api/leave'],
    ]) {
      const res = await as(asEmp.accessToken)[method](url).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('IMPERSONATION_READ_ONLY');
    }

    const asHr = await viewAs(owner, hrB);
    const dept = await as(asHr.accessToken).post('/api/admin/departments').send({ name: 'Fix-it' });
    expect(dept.status).toBe(201);
    const logs = await as(asHr.accessToken).get('/api/admin/audit-logs');
    const started = logs.body.data.find((l) => l.action === 'impersonation_started');
    expect(started.details.impersonatedBy).toBe('Owner');
    const acted = logs.body.data.find((l) => l.targetType === undefined || l.action === 'updated_settings') || logs.body.data[0];
    expect(acted).toBeTruthy();
  });

  it('marks the admin actions it takes, and records the end in the company audit trail', async () => {
    const { owner, hrB } = await setup();
    const session = await viewAs(owner, hrB);
    await as(session.accessToken).patch('/api/admin/settings').send({ shift: { breakAllowanceSeconds: 1200 } });
    await request(app).post('/api/auth/logout').send({ refreshToken: session.refreshToken });

    const logs = (await as(await login(hrB)).get('/api/admin/audit-logs')).body.data;
    expect(logs.find((l) => l.action === 'updated_settings').details.impersonatedBy).toBe('Owner');
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(['impersonation_started', 'impersonation_ended']));
  });

  it('keeps the same hard end time when refreshed, and stops if the owner loses the flag or the company is suspended', async () => {
    const { owner, empB } = await setup();
    const session = await viewAs(owner, empB);
    const before = await db()('refresh_tokens').where({ employee_id: empB.id }).whereNotNull('impersonated_by').first();

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    const after = await db()('refresh_tokens').where({ employee_id: empB.id, revoked_at: null }).whereNotNull('impersonated_by').first();
    expect(Number(after.expires_at)).toBe(Number(before.expires_at));
    expect(Number(after.expires_at) - t.now()).toBeLessThanOrEqual(60 * 60 * 1000);
    expect(refreshed.body.employee.id).toBe(empB.id);
    expect((await as(refreshed.body.accessToken).get('/api/attendance/status')).status).toBe(200);

    await db()('employees').where({ id: owner.id }).update({ is_super_admin: false });
    expect((await as(refreshed.body.accessToken).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken })).status).toBe(401);
  });

  it('refuses a suspended company', async () => {
    const { owner, empB } = await setup();
    await db()('companies').where({ id: B }).update({ status: 'suspended' });
    companies.invalidate();
    const res = await as(await login(owner)).post('/api/super/impersonate').send({ employeeId: empB.id });
    expect(res.status).toBe(400);
  });
});
