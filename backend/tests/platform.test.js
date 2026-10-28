'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const config = require('../src/config');
const companies = require('../src/services/companies');
const totp = require('../src/utils/totp');
const t = require('../src/utils/time');

const A = companies.DEFAULT_COMPANY_ID;

beforeAll(migrate);
afterAll(destroy);
beforeEach(async () => {
  await truncate();
  await db()('platform_audit_logs').del();
  await db()('companies').whereNot({ id: A }).del();
  companies.invalidate();
});

const owner = () => createEmployee({ name: 'Owner', role: 'admin', is_super_admin: true, company_id: A });

async function newCompany(api, name = 'Acme', email = 'hr@acme.test') {
  const res = await api.post('/api/super/companies').send({ name, admin: { name: name + ' HR', email } });
  expect(res.status).toBe(201);
  return res.body;
}

describe('platform audit log', () => {
  it('records what the platform staff do, and survives a company being changed', async () => {
    const api = as(await login(await owner()));
    const { company } = await newCompany(api);
    await api.patch(`/api/super/companies/${company.id}`).send({ status: 'suspended' });
    await api.patch(`/api/super/companies/${company.id}`).send({ status: 'active', maxEmployees: 9 });
    await api.patch(`/api/super/companies/${company.id}/branding`).send({ brandName: 'Acme Co' });

    const log = (await api.get('/api/super/audit')).body;
    const actions = log.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['company_created', 'company_suspended', 'company_reactivated', 'branding_updated']));
    const created = log.rows.find((r) => r.action === 'company_created');
    expect(created).toMatchObject({ actorName: 'Owner', companyName: 'Acme' });

    const only = (await api.get(`/api/super/audit?companyId=${company.id}&action=company_suspended`)).body;
    expect(only.rows).toHaveLength(1);
  });

  it('is closed to company admins', async () => {
    const hr = await createEmployee({ role: 'admin', company_id: A });
    expect((await as(await login(hr)).get('/api/super/audit')).status).toBe(403);
  });
});

describe('support staff', () => {
  async function support(api) {
    const res = await api.post('/api/super/staff').send({ name: 'Sam Support', email: 'sam@platform.test' });
    expect(res.status).toBe(201);
    const pw = res.body.temporaryPassword;
    const first = await request(app).post('/api/auth/login').send({ email: 'sam@platform.test', password: pw });
    await as(first.body.accessToken).post('/api/auth/change-password').send({ currentPassword: pw, newPassword: 'Support#Pass123' });
    const again = await request(app).post('/api/auth/login').send({ email: 'sam@platform.test', password: 'Support#Pass123' });
    return { id: res.body.id, token: again.body.accessToken, body: again.body };
  }

  it('can look at everything and step in to help, but change nothing', async () => {
    const ownerApi = as(await login(await owner()));
    const { company } = await newCompany(ownerApi);
    const sam = await support(ownerApi);
    const api = as(sam.token);

    expect(sam.body.employee.platformRole).toBe('support');
    expect(sam.body.employee.consent.required).toBe(false);
    expect((await api.get('/api/super/companies')).body.map((c) => c.name)).toEqual(['KD Marketing', 'Acme']);
    expect((await api.get(`/api/super/companies/${company.id}/people`)).status).toBe(200);
    expect((await api.get('/api/super/audit')).status).toBe(200);

    expect((await api.post('/api/super/companies').send({ name: 'Nope', admin: { name: 'x', email: 'x@y.test' } })).status).toBe(403);
    expect((await api.patch(`/api/super/companies/${company.id}`).send({ status: 'suspended' })).status).toBe(403);
    expect((await api.patch(`/api/super/companies/${company.id}/branding`).send({ brandName: 'X' })).status).toBe(403);
    expect((await api.get('/api/super/staff')).status).toBe(403);
    expect((await api.post('/api/super/staff').send({ name: 'a', email: 'a@b.test' })).status).toBe(403);

    const people = (await api.get(`/api/super/companies/${company.id}/people`)).body;
    const view = await api.post('/api/super/impersonate').send({ employeeId: people[0].id });
    expect(view.status).toBe(201);
    const log = (await ownerApi.get('/api/super/audit')).body.rows;
    expect(log.find((r) => r.action === 'view_as_started')).toMatchObject({ actorName: 'Sam Support', companyName: 'Acme' });
  });

  it('hides the staff holding company, and removing a person ends their access', async () => {
    const ownerApi = as(await login(await owner()));
    const sam = await support(ownerApi);
    const list = (await ownerApi.get('/api/super/companies')).body;
    expect(list.some((c) => c.name === 'Platform team')).toBe(false);
    expect((await ownerApi.get('/api/super/staff')).body.map((s) => s.platformRole).sort()).toEqual(['owner', 'support']);

    expect((await ownerApi.delete(`/api/super/staff/${sam.id}`)).status).toBe(200);
    expect((await as(sam.token).get('/api/super/companies')).status).toBe(403);
    const again = await request(app).post('/api/auth/login').send({ email: 'sam@platform.test', password: 'Support#Pass123' });
    expect(again.status).toBe(403);
  });
});

describe('two-factor sign-in for platform accounts', () => {
  async function enable(person) {
    const api = as(await login(person));
    const setup = await api.post('/api/auth/2fa/setup').send({});
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const code = totp.codeAt(setup.body.secret, totp.currentStep());
    const on = await api.post('/api/auth/2fa/enable').send({ code });
    expect(on.status).toBe(200);
    return { secret: setup.body.secret, recovery: on.body.recoveryCodes, step: totp.currentStep() };
  }

  it('asks for a code after the password, accepts a good one once, and refuses a repeat', async () => {
    const person = await owner();
    const { secret, recovery } = await enable(person);
    expect(recovery).toHaveLength(8);

    const first = await request(app).post('/api/auth/login').send({ email: person.email, password: 'Password123!' });
    expect(first.status).toBe(200);
    expect(first.body.twoFactorRequired).toBe(true);
    expect(first.body.accessToken).toBeUndefined();

    const next = totp.currentStep() + 1;
    const ok = await request(app).post('/api/auth/2fa/verify').send({ challenge: first.body.challenge, code: totp.codeAt(secret, next) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect((await as(ok.body.accessToken).get('/api/auth/me')).body.twoFactorEnabled).toBe(true);

    const replay = await request(app).post('/api/auth/2fa/verify').send({ challenge: first.body.challenge, code: totp.codeAt(secret, next) });
    expect(replay.status).toBe(401);
    expect((await request(app).post('/api/auth/2fa/verify').send({ challenge: first.body.challenge, code: '123456' })).status).toBe(401);
    expect((await request(app).post('/api/auth/2fa/verify').send({ challenge: 'x'.repeat(30), code: '123456' })).status).toBe(401);
  });

  it('takes a recovery code once, and turning it off needs the password and a code', async () => {
    const person = await owner();
    const { secret, recovery } = await enable(person);
    const c1 = await request(app).post('/api/auth/login').send({ email: person.email, password: 'Password123!' });
    const used = await request(app).post('/api/auth/2fa/verify').send({ challenge: c1.body.challenge, code: recovery[0] });
    expect(used.status).toBe(200);
    const c2 = await request(app).post('/api/auth/login').send({ email: person.email, password: 'Password123!' });
    expect((await request(app).post('/api/auth/2fa/verify').send({ challenge: c2.body.challenge, code: recovery[0] })).status).toBe(401);

    const api = as(used.body.accessToken);
    expect((await api.post('/api/auth/2fa/disable').send({ password: 'wrong', code: totp.codeAt(secret, totp.currentStep() + 2) })).status).toBe(400);
    const off = await api.post('/api/auth/2fa/disable').send({ password: 'Password123!', code: totp.codeAt(secret, totp.currentStep() + 1) });
    expect(off.status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: person.email, password: 'Password123!' })).body.accessToken).toBeTruthy();
  });

  it('is for platform accounts only, and a bad first code does not turn it on', async () => {
    const hr = await createEmployee({ role: 'admin', company_id: A });
    expect((await as(await login(hr)).post('/api/auth/2fa/setup').send({})).status).toBe(403);
    const api = as(await login(await owner()));
    await api.post('/api/auth/2fa/setup').send({});
    expect((await api.post('/api/auth/2fa/enable').send({ code: '000000' })).status).toBe(400);
    const row = await db()('employees').where({ is_super_admin: true }).first();
    expect(row.totp_enabled).toBeFalsy();
  });

  it('can be required: until it is set up the account can do nothing else', async () => {
    const person = await owner();
    const token = await login(person);
    config.auth.superTwoFactorRequired = true;
    try {
      const blocked = await as(token).get('/api/super/companies');
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
      expect((await as(token).post('/api/auth/2fa/setup').send({})).status).toBe(200);
    } finally {
      config.auth.superTwoFactorRequired = false;
    }
  });
});

describe('plans, trials and company defaults', () => {
  const DAY = 86400000;

  async function setupHr(api, extra = {}) {
    const res = await api.post('/api/super/companies').send({ name: 'Planned', admin: { name: 'P HR', email: 'hr@planned.test' }, ...extra });
    expect(res.status).toBe(201);
    const pw = res.body.admin.temporaryPassword;
    const first = await request(app).post('/api/auth/login').send({ email: 'hr@planned.test', password: pw });
    await as(first.body.accessToken).post('/api/auth/change-password').send({ currentPassword: pw, newPassword: 'Planned#Pass123' });
    return { company: res.body.company, login: () => request(app).post('/api/auth/login').send({ email: 'hr@planned.test', password: 'Planned#Pass123' }) };
  }

  it('puts a company on a plan template, and lets the owner adjust it afterwards', async () => {
    const api = as(await login(await owner()));
    const { company } = await setupHr(api, { plan: 'free' });
    expect(company.plan).toBe('free');
    expect(company).toMatchObject({ maxEmployees: 5, storageLimitBytes: 1024 ** 3 });
    expect(company.features).toMatchObject({ screenCapture: false, audioCapture: false, payroll: false, leave: true });

    const pro = await api.patch(`/api/super/companies/${company.id}`).send({ plan: 'pro' });
    expect(pro.body.features).toMatchObject({ screenCapture: true, payroll: true });
    expect(pro.body.maxEmployees).toBe(100);

    const mixed = await api.patch(`/api/super/companies/${company.id}`).send({ plan: 'free', features: { payroll: true }, maxEmployees: 8 });
    expect(mixed.body).toMatchObject({ plan: 'free', maxEmployees: 8 });
    expect(mixed.body.features.payroll).toBe(true);
    expect((await api.patch(`/api/super/companies/${company.id}`).send({ plan: 'gold' })).status).toBe(400);
  });

  it('blocks a company when its trial runs out (with auto-suspend), and unblocks it when extended', async () => {
    const api = as(await login(await owner()));
    const { company, login: hrLogin } = await setupHr(api, { plan: 'pro', trialDays: 14 });
    const ok = await hrLogin();
    expect(ok.status).toBe(200);
    expect(ok.body.employee.company.trialEndsAt).toBeTruthy();

    await api.patch(`/api/super/companies/${company.id}`).send({ trialEndsAt: new Date(Date.now() - DAY).toISOString() });
    const blocked = await hrLogin();
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('COMPANY_SUSPENDED');
    expect(blocked.body.error.message).toMatch(/trial/i);
    expect((await as(ok.body.accessToken).get('/api/attendance/status')).status).toBe(403);
    expect((await api.get(`/api/super/companies/${company.id}`)).body.trialExpired).toBe(true);

    await api.patch(`/api/super/companies/${company.id}`).send({ autoSuspend: false });
    expect((await hrLogin()).status).toBe(200);
    await api.patch(`/api/super/companies/${company.id}`).send({ autoSuspend: true, trialEndsAt: new Date(Date.now() + 7 * DAY).toISOString() });
    expect((await hrLogin()).status).toBe(200);
    await api.patch(`/api/super/companies/${company.id}`).send({ trialEndsAt: null });
    expect((await api.get(`/api/super/companies/${company.id}`)).body.trialEndsAt).toBeNull();
  });

  it("sets a company's shift, break and retention defaults, from the start or later, and only the owner may", async () => {
    const api = as(await login(await owner()));
    const { company, login: hrLogin } = await setupHr(api, { settings: { shift: { breakAllowanceSeconds: 1800 }, retention: { days: 14 } } });
    const hr = as((await hrLogin()).body.accessToken);
    const mine = (await hr.get('/api/admin/settings')).body;
    expect(mine.shift.breakAllowanceSeconds).toBe(1800);
    expect(mine.retention.days).toBe(14);

    const later = await api.patch(`/api/super/companies/${company.id}/settings`).send({ shift: { idleThresholdSeconds: 600 } });
    expect(later.status).toBe(200);
    expect((await hr.get('/api/admin/settings')).body.shift.idleThresholdSeconds).toBe(600);
    expect((await api.get(`/api/super/companies/${company.id}/settings`)).body.retention.days).toBe(14);
    expect((await api.patch(`/api/super/companies/${company.id}/settings`).send({ shift: { halfDaySeconds: 40000, fullDaySeconds: 3600 } })).status).toBe(400);

    // another company is untouched
    const other = (await as(await login(await createEmployee({ role: 'admin', company_id: A }))).get('/api/admin/settings')).body;
    expect(other.shift.breakAllowanceSeconds).not.toBe(1800);

    const log = (await api.get('/api/super/audit?action=settings_updated')).body.rows;
    expect(log).toHaveLength(1);
  });
});

describe('usage and announcements', () => {
  it('gives a 30-day series of hours, people and capture data for one company', async () => {
    const api = as(await login(await owner()));
    const emp = await createEmployee({ company_id: A });
    const { uuid } = require('../src/utils/ids');
    const today = t.localDate(t.now());
    await db()('attendance').insert({ id: uuid(), employee_id: emp.id, date: today, punch_in: 1, punch_out: 2, status: 'closed', total_worked_seconds: 7200, total_break_seconds: 600, idle_seconds: 0, created_at: 1, updated_at: 1 });
    await db()('screenshots').insert({ id: uuid(), employee_id: emp.id, image_url: 'x', content_type: 'image/png', captured_at: 1, date: today, size_bytes: 4000, created_at: 1 });

    const res = await api.get(`/api/super/companies/${A}/usage`);
    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(30);
    const last = res.body.series[29];
    expect(last).toMatchObject({ date: today, workedSeconds: 7200, breakSeconds: 600, people: 1, storageBytes: 4000 });
    expect(res.body.series[0].workedSeconds).toBe(0);
    expect((await api.get(`/api/super/companies/${A}/usage?days=7`)).body.series).toHaveLength(7);
    expect((await api.get(`/api/super/companies/${A}/usage?days=3`)).status).toBe(400);
  });

  it('shows an announcement to everyone signed in until it ends, set by the owner only', async () => {
    const ownerApi = as(await login(await owner()));
    const emp = await createEmployee({ company_id: A });
    const empApi = as(await login(emp));
    expect((await empApi.get('/api/auth/me')).body.announcements).toEqual([]);

    expect((await empApi.post('/api/super/announcements').send({ message: 'Maintenance at 10 PM' })).status).toBe(403);
    const made = await ownerApi.post('/api/super/announcements').send({ message: 'Maintenance at 10 PM', level: 'warn' });
    expect(made.status).toBe(201);
    const seen = (await empApi.get('/api/auth/me')).body.announcements;
    expect(seen).toEqual([{ id: made.body.id, message: 'Maintenance at 10 PM', level: 'warn' }]);

    // scheduled for later: not shown yet
    await ownerApi.post('/api/super/announcements').send({ message: 'Later', startsAt: new Date(Date.now() + 3600_000).toISOString() });
    expect((await empApi.get('/api/auth/me')).body.announcements).toHaveLength(1);

    expect((await ownerApi.delete(`/api/super/announcements/${made.body.id}`)).status).toBe(200);
    expect((await empApi.get('/api/auth/me')).body.announcements).toEqual([]);
    expect((await ownerApi.get('/api/super/announcements')).body).toHaveLength(2);
    expect((await ownerApi.get('/api/super/audit?action=announcement_created')).body.rows).toHaveLength(2);
  });
});

describe('company export and delete', () => {
  async function populated(api) {
    const { company, admin } = await newCompany(api, 'Doomed Co', 'hr@doomed.test');
    const { uuid } = require('../src/utils/ids');
    const emp = await createEmployee({ company_id: company.id, department: 'Sales', name: 'Dee Employee' });
    const attId = uuid();
    await db()('attendance').insert({ id: attId, employee_id: emp.id, date: '2026-10-01', punch_in: 1, punch_out: 2, status: 'closed', total_worked_seconds: 3600, total_break_seconds: 0, idle_seconds: 0, created_at: 1, updated_at: 1 });
    await db()('breaks').insert({ id: uuid(), employee_id: emp.id, attendance_id: attId, break_start: 1, break_end: 2, duration_seconds: 1, created_at: 1 });
    await db()('departments').insert({ id: uuid(), company_id: company.id, name: 'Sales', created_at: 1, updated_at: 1 });
    await db()('screenshots').insert({ id: uuid(), employee_id: emp.id, image_url: 'screenshots/doomed.jpg', content_type: 'image/jpeg', captured_at: 1, date: '2026-10-01', size_bytes: 10, created_at: 1 });
    const { storage } = require('../src/storage');
    await storage().put('screenshots/doomed.jpg', Buffer.from('img'), 'image/jpeg');
    return { company, emp, admin };
  }

  it('exports the company records without secrets', async () => {
    const api = as(await login(await owner()));
    const { company, emp } = await populated(api);
    const res = await api.get(`/api/super/companies/${company.id}/export`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/doomed-co-export\.json/);
    const data = JSON.parse(res.text);
    expect(data.company.name).toBe('Doomed Co');
    expect(data.employees.map((e) => e.name)).toContain('Dee Employee');
    expect(data.attendance).toHaveLength(1);
    expect(data.breaks).toHaveLength(1);
    expect(data.captureFiles.screenshots).toHaveLength(1);
    expect(res.text).not.toMatch(/password_hash|totp_secret/);
    expect(res.text).not.toContain(emp.password_hash);
  });

  it('removes everything only when suspended, with the exact name, and never for the wrong people', async () => {
    const api = as(await login(await owner()));
    const { company, emp } = await populated(api);
    const remove = (body) => api.delete(`/api/super/companies/${company.id}`).send(body);

    expect((await remove({ confirmName: 'Doomed Co' })).status).toBe(409); // still active
    await api.patch(`/api/super/companies/${company.id}`).send({ status: 'suspended' });
    expect((await remove({ confirmName: 'doomed co' })).status).toBe(400); // wrong name
    expect((await api.delete(`/api/super/companies/${A}`).send({ confirmName: 'KD Marketing' })).status).toBe(400); // own company

    const hr = await createEmployee({ role: 'admin', company_id: A });
    expect((await as(await login(hr)).delete(`/api/super/companies/${company.id}`).send({ confirmName: 'Doomed Co' })).status).toBe(403);

    const ok = await remove({ confirmName: 'Doomed Co' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ deleted: true, name: 'Doomed Co', filesRemoved: 1, filesFailed: 0 });

    expect(await db()('companies').where({ id: company.id })).toHaveLength(0);
    expect(await db()('employees').where({ company_id: company.id })).toHaveLength(0);
    expect(await db()('attendance').where({ employee_id: emp.id })).toHaveLength(0);
    expect(await db()('screenshots').where({ employee_id: emp.id })).toHaveLength(0);
    expect(await db()('departments').where({ company_id: company.id })).toHaveLength(0);
    const { storage } = require('../src/storage');
    await expect(storage().get('screenshots/doomed.jpg')).rejects.toThrow();
    // other companies are untouched, and the platform log keeps the record
    expect((await db()('employees').where({ company_id: A }).count({ n: '*' }))[0].n).toBeGreaterThan(0);
    const log = (await api.get('/api/super/audit?action=company_deleted')).body.rows;
    expect(log[0]).toMatchObject({ companyName: 'Doomed Co' });
    expect(log[0].details.employees).toBe(2);
  });
});


describe('custom domain per company', () => {
  it('sets a domain, verifies it only when its DNS points at the platform, and then serves the company', async () => {
    const api = as(await login(await owner()));
    const { company } = await newCompany(api, 'Domained', 'hr@domained.test');
    const svc = require('../src/modules/super/super.service');

    expect((await api.patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: 'localhost' })).status).toBe(400);
    expect((await api.patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: 'not a domain' })).status).toBe(400);
    const set = await api.patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: 'Track.Domained.com' });
    expect(set.body).toMatchObject({ customDomain: 'track.domained.com', customDomainVerified: false });

    // unverified: serves nothing
    expect((await request(app).get('/api/public/brand-by-host?host=track.domained.com')).status).toBe(404);

    config.customDomain.target = 'edge.workbuddy.test';
    try {
      const wrong = await svc.verifyDomain(company.id, { resolveCname: async () => ['somewhere.else.net.'] });
      expect(wrong.verified).toBe(false);
      const none = await svc.verifyDomain(company.id, { resolveCname: async () => { throw new Error('ENODATA'); } });
      expect(none.verified).toBe(false);
      const right = await svc.verifyDomain(company.id, { resolveCname: async () => ['Edge.WorkBuddy.test.'] });
      expect(right.verified).toBe(true);
    } finally {
      config.customDomain.target = '';
    }

    const by = await request(app).get('/api/public/brand-by-host?host=track.domained.com:443');
    expect(by.status).toBe(200);
    expect(by.body.slug).toBe(company.slug);
    expect(by.body.name).toBeTruthy();
    expect((await request(app).get('/api/public/brand-by-host?host=other.example.com')).status).toBe(404);

    // another company cannot take it; changing it un-verifies; clearing it stops serving
    const other = await newCompany(api, 'Other', 'hr@other.test');
    expect((await api.patch(`/api/super/companies/${other.company.id}/domain`).send({ customDomain: 'track.domained.com' })).status).toBe(409);
    await api.patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: 'new.domained.com' });
    expect((await request(app).get('/api/public/brand-by-host?host=track.domained.com')).status).toBe(404);
    expect((await api.patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: null })).body.customDomain).toBeNull();
  });

  it('cannot be verified without a platform target, and is the owner\'s to set', async () => {
    const api = as(await login(await owner()));
    const { company } = await newCompany(api, 'NoTarget', 'hr@notarget.test');
    await api.patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: 'x.notarget.com' });
    expect((await api.post(`/api/super/companies/${company.id}/domain/verify`).send({})).status).toBe(400);
    const hr = await createEmployee({ role: 'admin', company_id: A });
    expect((await as(await login(hr)).patch(`/api/super/companies/${company.id}/domain`).send({ customDomain: 'y.notarget.com' })).status).toBe(403);
  });
});

