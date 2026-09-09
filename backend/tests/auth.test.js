'use strict';

const { app, request, migrate, truncate, createEmployee, login, as } = require('./helpers');
const { destroy } = require('../src/db');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

describe('POST /api/auth/login', () => {
  it('returns tokens and a password-free profile', async () => {
    const employee = await createEmployee({ email: 'ok@kdmarketing.in' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ok@kdmarketing.in', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.employee.id).toBe(employee.id);
    expect(JSON.stringify(res.body)).not.toContain('password_hash');
    expect(JSON.stringify(res.body)).not.toContain('$2a$');
  });

  it('is case-insensitive on the work email', async () => {
    await createEmployee({ email: 'mixed@kdmarketing.in' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'MiXeD@KDMarketing.in', password: 'Password123!' });
    expect(res.status).toBe(200);
  });

  it('gives the same answer for an unknown email and a wrong password', async () => {
    await createEmployee({ email: 'known@kdmarketing.in' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'known@kdmarketing.in', password: 'nope' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@kdmarketing.in', password: 'nope' });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    // Account enumeration: the two responses must be indistinguishable.
    expect(unknownEmail.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it('refuses a deactivated account', async () => {
    await createEmployee({ email: 'gone@kdmarketing.in', status: 'inactive' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gone@kdmarketing.in', password: 'Password123!' });
    expect(res.status).toBe(403);
  });

  // The desktop agent needs to tell "this whole account is dead" apart from an ordinary
  // per-action 403 (e.g. audio consent withdrawn) so it knows to stop pretending it is signed
  // in rather than quietly discarding queued work item by item. A distinct error code is the
  // only reliable way to do that, since both cases are otherwise a plain HTTP 403.
  it('marks a deactivated-account rejection with a distinct code from an ordinary 403', async () => {
    const employee = await createEmployee();
    const token = await login(employee);

    const { db } = require('../src/db');
    await db()('employees').where({ id: employee.id }).update({ status: 'inactive' });

    const res = await as(token).get('/api/auth/me');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DEACTIVATED');
  });
});

describe('token handling', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a refresh token used as an access token', async () => {
    const employee = await createEmployee();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    const res = await as(loginRes.body.refreshToken).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rotates the refresh token on every use', async () => {
    const employee = await createEmployee();
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refreshToken).not.toBe(first.body.refreshToken);
  });

  // Sprint 6.5 / ADR-0004: on a bad connection the server may rotate and the response never
  // arrive, leaving the client holding a token it has no way to know is spent.
  it('accepts a rotated token again inside the grace window', async () => {
    const employee = await createEmployee();
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    await request(app).post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });

    const retry = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });

    expect(retry.status).toBe(200);
    expect(retry.body.accessToken).toBeTruthy();
  });

  it('treats reuse after the grace window as theft and ends every session', async () => {
    const { db } = require('../src/db');
    const employee = await createEmployee();
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    const rotated = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });

    // Age the rotation past the grace window.
    await db()('refresh_tokens')
      .whereNotNull('revoked_at')
      .update({ revoked_at: Date.now() - 10 * 60 * 1000 });

    const reuse = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(reuse.status).toBe(401);

    // The replacement token is revoked too — whoever holds it, the session is over.
    const replacement = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(replacement.status).toBe(401);
  });

  // The grace window is for rotation only. If it applied to every revocation, signing out
  // would leave a two-minute hole in which the old token still worked.
  it('gives no grace to a token killed by signing out', async () => {
    const employee = await createEmployee();
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    await request(app).post('/api/auth/logout').send({ refreshToken: first.body.refreshToken });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(res.status).toBe(401);
  });

  it('gives no grace to a token killed by HR deactivating the account', async () => {
    const employee = await createEmployee();
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    const adminToken = await login(await createEmployee({ role: 'admin' }));
    await as(adminToken).patch(`/api/admin/employees/${employee.id}`).send({ status: 'inactive' });

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: first.body.refreshToken });
    expect(res.status).toBe(401);
  });

  it('does not let repeated retries slide the grace window forward', async () => {
    const { db } = require('../src/db');
    const employee = await createEmployee();
    const first = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.email, password: 'Password123!' });

    await request(app).post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });
    const original = await db()('refresh_tokens').whereNotNull('revoked_at').first();

    await request(app).post('/api/auth/refresh').send({ refreshToken: first.body.refreshToken });
    const afterRetry = await db()('refresh_tokens').where({ id: original.id }).first();

    expect(Number(afterRetry.revoked_at)).toBe(Number(original.revoked_at));
    expect(afterRetry.reuse_count).toBeGreaterThan(1);
  });

  it('stops working the moment the account is deactivated', async () => {
    const employee = await createEmployee();
    const token = await login(employee);

    expect((await as(token).get('/api/auth/me')).status).toBe(200);

    const { db } = require('../src/db');
    await db()('employees').where({ id: employee.id }).update({ status: 'inactive' });

    // Not "when the token expires" -- now.
    expect((await as(token).get('/api/auth/me')).status).toBe(403);
  });
});

describe('consent', () => {
  it('publishes what is captured, before anything is captured', async () => {
    const token = await login(await createEmployee());
    const res = await as(token).get('/api/auth/consent');

    expect(res.status).toBe(200);
    expect(res.body.version).toBeTruthy();
    const keys = res.body.captured.map((c) => c.key);
    expect(keys).toContain('screenshots');
    expect(keys).toContain('activity');
    expect(keys).toContain('audio');
    expect(res.body.captured.find((c) => c.key === 'audio').required).toBe(false);
  });

  it('records audio consent and allows the employee to revoke it', async () => {
    const employee = await createEmployee({ consent_audio: false });
    const token = await login(employee);

    const given = await as(token).post('/api/auth/consent').send({ audioConsent: true });
    expect(given.status).toBe(200);
    expect(given.body.consent.audio).toBe(true);

    const revoked = await as(token).post('/api/auth/consent').send({ audioConsent: false });
    expect(revoked.body.consent.audio).toBe(false);
  });

  it('does not let monitoring consent be withdrawn through the API', async () => {
    const token = await login(await createEmployee({ consent_monitoring: true }));
    const res = await as(token).post('/api/auth/consent').send({ monitoringConsent: false });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/HR/i);
  });
});

describe('role enforcement', () => {
  it('keeps a normal user out of admin routes', async () => {
    const token = await login(await createEmployee({ role: 'user' }));
    const res = await as(token).get('/api/admin/dashboard');
    expect(res.status).toBe(403);
  });

  it('lets an admin in', async () => {
    const token = await login(await createEmployee({ role: 'admin' }));
    const res = await as(token).get('/api/admin/dashboard');
    expect(res.status).toBe(200);
  });
});
