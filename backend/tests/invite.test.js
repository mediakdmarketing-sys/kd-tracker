'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { generateTemporaryPassword } = require('../src/utils/password');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

async function hr() {
  return createEmployee({ name: 'Hana HR', role: 'admin', department: 'HR' });
}

async function invite(adminToken, body = {}) {
  const res = await as(adminToken)
    .post('/api/admin/employees')
    .send({ name: 'Nia New', email: 'nia.new@kdmarketing.in', role: 'user', department: 'Sales', ...body });
  expect(res.status).toBe(201);
  return res.body;
}

const signIn = (email, password) => request(app).post('/api/auth/login').send({ email, password });

describe('generated passwords', () => {
  it('are readable, unambiguous and different every time', () => {
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}(-[A-HJ-NP-Za-km-z2-9]{4}){2}$/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('inviting an employee', () => {
  it('makes a temporary password when none is typed, and returns it once', async () => {
    const admin = await hr();
    const created = await invite(await login(admin));

    expect(created.temporaryPassword).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    expect(created.mustChangePassword).toBe(true);
    expect(created.password_hash).toBeUndefined();

    // Not readable again afterwards.
    const read = await as(await login(admin)).get(`/api/admin/employees/${created.id}`);
    expect(read.body.temporaryPassword).toBeUndefined();

    // The generated password is the one that works.
    expect((await signIn('nia.new@kdmarketing.in', created.temporaryPassword)).status).toBe(200);
  });

  it('uses a typed password if HR gives one, and still asks for a change', async () => {
    const admin = await hr();
    const created = await invite(await login(admin), { password: 'Hand-typed-1' });
    expect(created.temporaryPassword).toBe('Hand-typed-1');
    expect(created.mustChangePassword).toBe(true);
  });

  it('does not log the password in the audit trail', async () => {
    const admin = await hr();
    const created = await invite(await login(admin));
    const rows = await db()('audit_logs').where({ target_employee_id: created.id });
    expect(JSON.stringify(rows)).not.toContain(created.temporaryPassword);
  });
});

describe('a temporary password', () => {
  async function newcomer() {
    const admin = await hr();
    const created = await invite(await login(admin));
    const session = await signIn('nia.new@kdmarketing.in', created.temporaryPassword);
    return { admin, created, session: session.body, token: session.body.accessToken };
  }

  it('is flagged at sign-in and opens nothing but the change-password screen', async () => {
    const { session, token } = await newcomer();
    expect(session.employee.mustChangePassword).toBe(true);

    expect((await as(token).get('/api/auth/me')).status).toBe(200);

    const blocked = await as(token).get('/api/attendance/status');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await as(token).get('/api/auth/consent')).status).toBe(403);
  });

  it('is replaced by the person: sessions end, the new password works, the old one does not', async () => {
    const { created, session, token } = await newcomer();

    const changed = await as(token).post('/api/auth/change-password')
      .send({ currentPassword: created.temporaryPassword, newPassword: 'My-own-pass-9' });
    expect(changed.status).toBe(200);

    // Every earlier session is over, including the one that made the change.
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(401);

    expect((await signIn('nia.new@kdmarketing.in', created.temporaryPassword)).status).toBe(401);
    const fresh = await signIn('nia.new@kdmarketing.in', 'My-own-pass-9');
    expect(fresh.status).toBe(200);
    expect(fresh.body.employee.mustChangePassword).toBe(false);

    // And the rest of the API is open again.
    expect((await as(fresh.body.accessToken).get('/api/attendance/status')).status).toBe(200);
  });

  it('needs the right current password and a different new one', async () => {
    const { created, token } = await newcomer();
    const wrong = await as(token).post('/api/auth/change-password')
      .send({ currentPassword: 'not-the-password', newPassword: 'My-own-pass-9' });
    expect(wrong.status).toBe(400);

    const same = await as(token).post('/api/auth/change-password')
      .send({ currentPassword: created.temporaryPassword, newPassword: created.temporaryPassword });
    expect(same.status).toBe(400);

    const short = await as(token).post('/api/auth/change-password')
      .send({ currentPassword: created.temporaryPassword, newPassword: 'short' });
    expect(short.status).toBe(400);
  });
});

describe('resetting a password', () => {
  it('can generate a new temporary one, returns it once and signs the person out', async () => {
    const admin = await hr();
    const employee = await createEmployee({ name: 'Rae Regular', department: 'Sales' });
    const employeeSession = (await signIn(employee.email, 'Password123!')).body;

    const res = await as(await login(admin))
      .patch(`/api/admin/employees/${employee.id}`)
      .send({ generatePassword: true });
    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    expect(res.body.mustChangePassword).toBe(true);

    expect(
      (await request(app).post('/api/auth/refresh').send({ refreshToken: employeeSession.refreshToken })).status
    ).toBe(401);
    const back = await signIn(employee.email, res.body.temporaryPassword);
    expect(back.status).toBe(200);
    expect(back.body.employee.mustChangePassword).toBe(true);
  });

  it('leaves accounts that were never invited exactly as they were', async () => {
    const employee = await createEmployee({ name: 'Old Hand' });
    const session = await signIn(employee.email, 'Password123!');
    expect(session.body.employee.mustChangePassword).toBe(false);
    expect((await as(session.body.accessToken).get('/api/attendance/status')).status).toBe(200);
  });
});
