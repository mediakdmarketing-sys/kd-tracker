'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const mailer = require('../src/services/mailer');
const t = require('../src/utils/time');
const { sha256 } = require('../src/utils/ids');

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  mailer.setTransport(async (m) => { sent.push(m); return { id: 'x' }; });
  sent.length = 0;
});
afterAll(async () => {
  mailer.setTransport(null);
  await destroy();
});

const sent = [];
const ask = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const tokenFrom = (message) => /reset-password\?token=([0-9a-f]+)/.exec(message.text)[1];
const reset = (token, newPassword) => request(app).post('/api/auth/reset-password').send({ token, newPassword });

describe('forgot password', () => {
  it('emails a one-time link, and the link sets a new password and ends old sessions', async () => {
    const eve = await createEmployee({ name: 'Eve' });
    const oldToken = await login(eve);

    const res = await ask(eve.email);
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(eve.email);
    const token = tokenFrom(sent[0]);
    // Only a hash is kept.
    const row = await db()('password_resets').first();
    expect(row.token_hash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);

    expect((await request(app).post('/api/auth/reset-password/check').send({ token })).status).toBe(200);
    const done = await reset(token, 'Brand-New-Pass-77!');
    expect(done.status).toBe(200);

    // The new password works, the old one does not, and the old session is over.
    expect((await request(app).post('/api/auth/login').send({ email: eve.email, password: 'Brand-New-Pass-77!' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: eve.email, password: 'Password123!' })).status).toBe(401);
    expect((await as(oldToken).get('/api/auth/me')).status).toBe(401);
  });

  it('works once only', async () => {
    const eve = await createEmployee();
    await ask(eve.email);
    const token = tokenFrom(sent[0]);
    expect((await reset(token, 'Brand-New-Pass-77!')).status).toBe(200);
    const again = await reset(token, 'Another-New-Pass-88!');
    expect(again.status).toBe(400);
    expect(again.body.error.message).toMatch(/not valid any more/i);
  });

  it('expires, and a newer link replaces an older one', async () => {
    const eve = await createEmployee();
    await ask(eve.email);
    const first = tokenFrom(sent[0]);
    await ask(eve.email);
    const second = tokenFrom(sent[1]);
    expect((await reset(first, 'Brand-New-Pass-77!')).status).toBe(400);

    await db()('password_resets').where({ token_hash: sha256(second) }).update({ expires_at: t.now() - 1000 });
    expect((await reset(second, 'Brand-New-Pass-77!')).status).toBe(400);
  });

  it('refuses a weak new password and keeps the link usable', async () => {
    const eve = await createEmployee();
    await ask(eve.email);
    const token = tokenFrom(sent[0]);
    expect((await reset(token, 'short')).status).toBe(400);
    expect((await reset(token, 'password')).status).toBe(400);
    expect((await reset(token, 'Brand-New-Pass-77!')).status).toBe(200);
  });

  it('answers the same for an unknown or deactivated account and sends nothing', async () => {
    const gone = await createEmployee({ status: 'inactive' });
    const known = await ask(gone.email);
    const unknown = await ask('nobody@kdmarketing.in');
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body);
    expect(sent).toHaveLength(0);
  });

  it('allows only a few emails an hour for one account', async () => {
    const eve = await createEmployee();
    for (let i = 0; i < 5; i += 1) await ask(eve.email);
    expect(sent).toHaveLength(3);
  });

  it('does not skip two-step sign-in', async () => {
    const eve = await createEmployee({ totp_secret: 'x', totp_enabled_at: t.now() });
    await ask(eve.email);
    await reset(tokenFrom(sent[0]), 'Brand-New-Pass-77!');
    const res = await request(app).post('/api/auth/login').send({ email: eve.email, password: 'Brand-New-Pass-77!' });
    expect(res.body.twoFactorRequired).toBe(true);
  });
});
