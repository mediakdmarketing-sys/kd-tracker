'use strict';

const { migrate, truncate, createEmployee, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const config = require('../src/config');
const settings = require('../src/services/settings');
const totp = require('../src/utils/totp');
const secretBox = require('../src/utils/secretBox');
const { describe: describeDevice } = require('../src/utils/device');

beforeAll(migrate);
beforeEach(async () => {
  await truncate();
  await settings.update({ security: { requireAdmin2fa: false } });
  config.auth.bffKey = '';
});
afterAll(destroy);

const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const signIn = (employee, { ua = CHROME, password = 'Password123!', client = 'web', headers = {} } = {}) =>
  request(app).post('/api/auth/login').set('User-Agent', ua).set(headers).send({ email: employee.email, password, client });

async function session(employee, opts) {
  const res = await signIn(employee, opts);
  expect(res.status).toBe(200);
  return { ...res.body, api: as(res.body.accessToken) };
}

/** Turns two-step on for a person; returns the secret, so a test can make codes. */
async function enableTwoStep(employee, s) {
  const setup = (await s.api.post('/api/auth/2fa/setup')).body;
  const code = totp.codeAtStep(setup.secret, totp.stepAt(Date.now()));
  const res = await s.api.post('/api/auth/2fa/enable').send({ code });
  expect(res.status).toBe(200);
  return { secret: setup.secret, recoveryCodes: res.body.recoveryCodes };
}

/** A fresh code for the next step, and pretend time has moved on so the last one can be used again. */
async function nextCode(employee, secret) {
  await db()('employees').where({ id: employee.id }).update({ totp_last_step: totp.stepAt(Date.now()) - 5 });
  return totp.codeAtStep(secret, totp.stepAt(Date.now()));
}

describe('one-time codes (RFC 6238)', () => {
  const rfcSecret = totp.base32Encode(Buffer.from('12345678901234567890'));

  it('gives the published test values', () => {
    expect(totp.codeAtStep(rfcSecret, Math.floor(59 / 30))).toBe('287082');
    expect(totp.codeAtStep(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totp.codeAtStep(rfcSecret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totp.codeAtStep(rfcSecret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('accepts one step either side, not more, and never the same step twice', () => {
    const now = 1_700_000_000_000;
    const step = totp.stepAt(now);
    expect(totp.verify(rfcSecret, totp.codeAtStep(rfcSecret, step), { now })).toBe(step);
    expect(totp.verify(rfcSecret, totp.codeAtStep(rfcSecret, step - 1), { now })).toBe(step - 1);
    expect(totp.verify(rfcSecret, totp.codeAtStep(rfcSecret, step + 1), { now })).toBe(step + 1);
    expect(totp.verify(rfcSecret, totp.codeAtStep(rfcSecret, step + 2), { now })).toBeNull();
    expect(totp.verify(rfcSecret, totp.codeAtStep(rfcSecret, step), { now, lastStep: step })).toBeNull(); // used already
    expect(totp.verify(rfcSecret, '12345', { now })).toBeNull();
    expect(totp.verify(rfcSecret, 'abcdef', { now })).toBeNull();
  });

  it('round-trips a secret through encryption, bound to its owner', () => {
    const sealed = secretBox.seal('JBSWY3DPEHPK3PXP', 'owner-1');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(secretBox.open(sealed, 'owner-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => secretBox.open(sealed, 'someone-else')).toThrow();
  });

  it('describes a device without a version number', () => {
    expect(describeDevice(CHROME, 'web').label).toBe('Chrome on Windows');
    expect(describeDevice(SAFARI, 'web').label).toBe('Safari on iOS');
    expect(describeDevice(CHROME.replace('126.0', '127.0'), 'web').hash).toBe(describeDevice(CHROME, 'web').hash);
    expect(describeDevice('', 'web').label).toBe('Unknown device');
  });
});

describe('two-step sign-in', () => {
  it('is set up with a code from the app, then asked for at sign-in', async () => {
    const e = await createEmployee({ name: 'Eve' });
    const s = await session(e);

    const setup = (await s.api.post('/api/auth/2fa/setup')).body;
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUrl).toContain('otpauth://totp/WorkInvigilator');
    expect((await s.api.get('/api/auth/security')).body.twoFactor).toMatchObject({ enabled: false, setupPending: true });
    // The secret is stored encrypted.
    expect((await db()('employees').where({ id: e.id }).first()).totp_secret).not.toContain(setup.secret);

    expect((await s.api.post('/api/auth/2fa/enable').send({ code: '000000' })).status).toBe(400); // wrong code: not on yet
    // (Starting set-up again replaces the unfinished secret, so use the one enableTwoStep made.)
    const { recoveryCodes, secret } = await enableTwoStep(e, s);
    setup.secret = secret;
    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes[0]).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/);
    expect((await s.api.get('/api/auth/security')).body.twoFactor).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    // Next sign-in: the password alone gives no session.
    const step1 = await signIn(e);
    expect(step1.status).toBe(200);
    expect(step1.body).toMatchObject({ twoFactorRequired: true });
    expect(step1.body.accessToken).toBeUndefined();
    expect(step1.body.refreshToken).toBeUndefined();

    const verify = (body) => request(app).post('/api/auth/2fa/verify').set('User-Agent', CHROME).send({ challengeToken: step1.body.challengeToken, ...body });
    expect((await verify({ code: '123456' })).status).toBe(401);
    const ok = await verify({ code: await nextCode(e, setup.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(ok.body.employee.twoFactorEnabled).toBe(true);
    expect((await as(ok.body.accessToken).get('/api/auth/me')).status).toBe(200);

    // The same code does not work twice.
    expect((await verify({ code: totp.codeAtStep(setup.secret, totp.stepAt(Date.now())) })).status).toBe(401);
  });

  it('accepts a recovery code once, and holds the account after too many wrong codes', async () => {
    const e = await createEmployee();
    const s = await session(e);
    const { secret, recoveryCodes } = await enableTwoStep(e, s);

    const challenge = async () => (await signIn(e)).body.challengeToken;
    const verify = async (body) => request(app).post('/api/auth/2fa/verify').send({ challengeToken: await challenge(), ...body });

    const used = await verify({ recoveryCode: recoveryCodes[0].toUpperCase() });
    expect(used.status).toBe(200); // case and dashes do not matter
    expect((await verify({ recoveryCode: recoveryCodes[0] })).status).toBe(401); // gone
    expect((await as(used.body.accessToken).get('/api/auth/security')).body.twoFactor.recoveryCodesLeft).toBe(9);

    // The reused recovery code was the first wrong try; four more reach the limit of five.
    for (let i = 0; i < config.auth.maxBadCodes - 1; i += 1) expect((await verify({ code: '111111' })).status).toBe(401);
    const held = await verify({ code: await nextCode(e, secret) }); // even a right code is refused now
    expect(held.status).toBe(429);
    expect(held.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('is not available to the other apps, which sign in through the portal', async () => {
    const e = await createEmployee();
    await enableTwoStep(e, await session(e));
    const res = await signIn(e, { client: 'android' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('web portal');
  });

  it('can be switched off with the password and a code, and is refused for an admin while HR requires it', async () => {
    const e = await createEmployee();
    const s = await session(e);
    const { secret } = await enableTwoStep(e, s);

    expect((await s.api.post('/api/auth/2fa/disable').send({ password: 'wrong', code: await nextCode(e, secret) })).status).toBe(400);
    const off = await s.api.post('/api/auth/2fa/disable').send({ password: 'Password123!', code: await nextCode(e, secret) });
    expect(off.status).toBe(200);
    expect((await signIn(e)).body.accessToken).toBeTruthy(); // password alone again

    const hr = await createEmployee({ role: 'admin', email: `hr-${Math.random().toString(36).slice(2, 8)}@kdmarketing.in` });
    const hs = await session(hr);
    const hrSecret = (await enableTwoStep(hr, hs)).secret;
    await settings.update({ security: { requireAdmin2fa: true } });
    const refused = await hs.api.post('/api/auth/2fa/disable').send({ password: 'Password123!', code: await nextCode(hr, hrSecret) });
    expect(refused.status).toBe(403);
  });
});

describe('where you are signed in', () => {
  it('lists sessions, and ending one stops its tokens at once', async () => {
    const e = await createEmployee();
    const laptop = await session(e);
    const phone = await session(e, { ua: SAFARI });

    const list = (await laptop.api.get('/api/auth/sessions')).body;
    expect(list).toHaveLength(2);
    expect(list.find((x) => x.current).device).toBe('Chrome on Windows');
    expect(list.find((x) => !x.current).device).toBe('Safari on iOS');

    const phoneSession = list.find((x) => !x.current);
    expect((await phone.api.get('/api/auth/me')).status).toBe(200);
    expect((await laptop.api.delete(`/api/auth/sessions/${phoneSession.id}`)).status).toBe(200);

    // The phone's access token no longer works, though it has not expired, and neither does its refresh token.
    const dead = await phone.api.get('/api/auth/me');
    expect(dead.status).toBe(401);
    expect(dead.body.error.message).toContain('ended');
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: phone.refreshToken })).status).toBe(401);

    expect((await laptop.api.get('/api/auth/sessions')).body).toHaveLength(1);
    expect((await laptop.api.get('/api/auth/me')).status).toBe(200);
  });

  it('will not end the session you are using, someone else’s session, or one that is already gone', async () => {
    const a = await createEmployee();
    const b = await createEmployee();
    const sa = await session(a);
    const sb = await session(b);
    const mine = (await sa.api.get('/api/auth/sessions')).body[0].id;
    const theirs = (await sb.api.get('/api/auth/sessions')).body[0].id;

    expect((await sa.api.delete(`/api/auth/sessions/${mine}`)).status).toBe(400);
    expect((await sa.api.delete(`/api/auth/sessions/${theirs}`)).status).toBe(404);
    expect((await sb.api.get('/api/auth/me')).status).toBe(200); // untouched
  });

  it('ends all the others and keeps this one, and a refresh keeps the same session', async () => {
    const e = await createEmployee();
    const one = await session(e);
    const two = await session(e, { ua: SAFARI });
    const three = await session(e, { ua: 'okhttp/4.12' });

    const ended = await one.api.post('/api/auth/sessions/revoke-others');
    expect(ended.body.ended).toBe(2);
    expect((await two.api.get('/api/auth/me')).status).toBe(401);
    expect((await three.api.get('/api/auth/me')).status).toBe(401);
    expect((await one.api.get('/api/auth/me')).status).toBe(200);

    // Rotating the tokens does not make a new session.
    const before = (await one.api.get('/api/auth/sessions')).body.map((x) => x.id);
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: one.refreshToken });
    expect(rotated.status).toBe(200);
    const after = (await as(rotated.body.accessToken).get('/api/auth/sessions')).body.map((x) => x.id);
    expect(after).toEqual(before);
  });

  it('keeps a session ended even inside the refresh grace window', async () => {
    const e = await createEmployee();
    const one = await session(e);
    const two = await session(e, { ua: SAFARI });
    // Rotate the phone's token, so its old one would normally still work for a couple of minutes.
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: two.refreshToken });
    expect(rotated.status).toBe(200);
    const id = (await one.api.get('/api/auth/sessions')).body.find((x) => !x.current).id;
    await one.api.delete(`/api/auth/sessions/${id}`);

    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: two.refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken })).status).toBe(401);
  });

  it('ends a session on sign out, and every session when the password changes', async () => {
    const e = await createEmployee();
    const one = await session(e);
    const two = await session(e, { ua: SAFARI });
    await request(app).post('/api/auth/logout').send({ refreshToken: two.refreshToken });
    expect((await two.api.get('/api/auth/me')).status).toBe(401);
    expect((await one.api.get('/api/auth/me')).status).toBe(200);

    const changed = await one.api.post('/api/auth/change-password').send({ currentPassword: 'Password123!', newPassword: 'A-Much-Longer-Passw0rd-2026' });
    expect(changed.status).toBe(200);
    expect((await one.api.get('/api/auth/me')).status).toBe(401);
    expect(await db()('sessions').where({ employee_id: e.id }).whereNull('revoked_at').count({ n: '*' }).first().then((r) => Number(r.n))).toBe(0);
  });
});

describe('sign-in history and the new-device alert', () => {
  const alerts = async (api) => (await api.get('/api/notifications')).body.items.filter((i) => i.type === 'new_device_login');

  it('records good and bad sign-ins, and tells you about a device you have not used before', async () => {
    const e = await createEmployee();
    const first = await session(e); // the very first sign-in is not "new"
    expect(await alerts(first.api)).toHaveLength(0);

    expect((await signIn(e, { password: 'wrong' })).status).toBe(401);
    const again = await session(e); // same browser again: nothing to say
    expect(await alerts(again.api)).toHaveLength(0);

    const phone = await session(e, { ua: SAFARI, headers: {} });
    const found = await alerts(phone.api);
    expect(found).toHaveLength(1);
    expect(found[0].body).toContain('Safari on iOS');
    expect(found[0].link).toBe('/security');

    const history = (await phone.api.get('/api/auth/login-history')).body;
    expect(history.map((h) => h.result)).toEqual(['success', 'success', 'bad_password', 'success']); // newest first
    expect(history[0]).toMatchObject({ device: 'Safari on iOS', newDevice: true });
    expect(history[1].newDevice).toBe(false);
    expect(history[2]).toMatchObject({ result: 'bad_password', device: 'Chrome on Windows' });

    // And only the owner's own history.
    const other = await createEmployee();
    expect((await (await session(other)).api.get('/api/auth/login-history')).body).toHaveLength(1);
  });

  it('also emails the alert when email is set up', async () => {
    const mailer = require('../src/services/mailer');
    const sent = [];
    mailer.setTransport(async (m) => { sent.push(m); return { id: 'x' }; });
    try {
      const e = await createEmployee({ name: 'Eve' });
      await session(e);
      await session(e, { ua: SAFARI });
      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(e.email);
      expect(sent[0].text).toContain('Safari on iOS');
    } finally {
      mailer.setTransport(null);
    }
  });

  it('believes the portal’s forwarded address only with the shared key', async () => {
    const e = await createEmployee();
    config.auth.bffKey = 'portal-shared-key-for-tests-0123456789';
    const forwarded = { 'x-client-ip': '203.0.113.7', 'x-client-ua': SAFARI };

    await session(e, { ua: CHROME, headers: forwarded }); // no key: ignored, the request's own details are used
    const noKey = (await db()('login_events').where({ employee_id: e.id }).first());
    expect(noKey.ip).not.toBe('203.0.113.7');
    expect(noKey.device_label).toBe('Chrome on Windows');

    await session(e, { ua: CHROME, headers: { ...forwarded, 'x-bff-key': 'portal-shared-key-for-tests-0123456789' } });
    const last = (await db()('login_events').where({ employee_id: e.id }).orderBy('at', 'desc').first());
    expect(last.ip).toBe('203.0.113.7');
    expect(last.device_label).toBe('Safari on iOS');

    await session(e, { ua: CHROME, headers: { ...forwarded, 'x-bff-key': 'wrong-key-wrong-key-wrong-key-wrong-0' } });
    const wrong = (await db()('login_events').where({ employee_id: e.id }).orderBy('at', 'desc').first());
    expect(wrong.ip).not.toBe('203.0.113.7');
  });
});

describe('two-step sign-in for admins', () => {
  const admin = (extra = {}) => createEmployee({ role: 'admin', email: `hr-${Math.random().toString(36).slice(2, 8)}@kdmarketing.in`, ...extra });

  it('can be required, which sends an admin without it to set it up first', async () => {
    const a1 = await admin();
    const a2 = await admin();
    const s1 = await session(a1);
    const s2 = await session(a2);

    // The person switching it on needs it themselves first.
    const early = await s1.api.patch('/api/admin/settings').send({ security: { requireAdmin2fa: true } });
    expect(early.status).toBe(400);
    await enableTwoStep(a1, s1);
    expect((await s1.api.patch('/api/admin/settings').send({ security: { requireAdmin2fa: true } })).status).toBe(200);

    // The other admin has no way to do admin things until they set it up, but can reach the set-up.
    const blocked = await s2.api.get('/api/admin/timesheet');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
    expect((await s2.api.get('/api/auth/me')).body.twoFactorSetupRequired).toBe(true);
    expect((await s2.api.get('/api/auth/security')).status).toBe(200);
    await enableTwoStep(a2, s2);
    expect((await s2.api.get('/api/admin/timesheet')).status).toBe(200);

    // An ordinary employee is not affected.
    const worker = await session(await createEmployee());
    expect((await worker.api.get('/api/auth/me')).body.twoFactorSetupRequired).toBe(false);
  });

  it('lets an account admin reset someone’s two-step sign-in, never their own, and not an ordinary HR admin', async () => {
    const boss = await admin();
    const hr = await admin({ is_account_admin: false });
    const lost = await admin();
    const sb = await session(boss);
    const sh = await session(hr);
    const sl = await session(lost);
    await enableTwoStep(lost, sl);
    await enableTwoStep(boss, sb);

    expect((await sb.api.post(`/api/admin/employees/${boss.id}/2fa/reset`)).status).toBe(403); // not your own
    expect((await sh.api.post(`/api/admin/employees/${lost.id}/2fa/reset`)).status).toBe(403); // not an account admin

    const done = await sb.api.post(`/api/admin/employees/${lost.id}/2fa/reset`);
    expect(done.status).toBe(200);
    expect((await sb.api.get('/api/admin/employees/' + lost.id + '/security')).body.twoFactor.enabled).toBe(false);
    expect((await sl.api.get('/api/auth/me')).status).toBe(401); // their sessions ended too
    expect((await signIn(lost)).body.accessToken).toBeTruthy(); // password alone, until they set it up again
    expect(await db()('audit_logs').where({ action: 'reset_two_factor', target_employee_id: lost.id }).count({ n: '*' }).first().then((r) => Number(r.n))).toBe(1);
  });

  it('shows HR a person’s sessions and history (audited), and lets HR end their sessions', async () => {
    const hr = await admin();
    const person = await createEmployee({ name: 'Pavi' });
    const sh = await session(hr);
    const sp = await session(person);
    await session(person, { ua: SAFARI });

    const view = (await sh.api.get(`/api/admin/employees/${person.id}/security`)).body;
    expect(view.sessions).toHaveLength(2);
    expect(view.history.length).toBe(2);
    expect(view.twoFactor.enabled).toBe(false);
    expect(await db()('audit_logs').where({ action: 'viewed_security', target_employee_id: person.id }).count({ n: '*' }).first().then((r) => Number(r.n))).toBe(1);

    const ended = await sh.api.post(`/api/admin/employees/${person.id}/sessions/revoke-all`);
    expect(ended.body.ended).toBe(2);
    expect((await sp.api.get('/api/auth/me')).status).toBe(401);

    // Not for ordinary employees.
    expect((await (await session(await createEmployee())).api.get(`/api/admin/employees/${person.id}/security`)).status).toBe(403);
  });
});

describe('tokens from before sessions existed', () => {
  it('still work until they are refreshed, and then become a session that can be seen', async () => {
    const jwt = require('jsonwebtoken');
    const { randomToken, sha256, uuid } = require('../src/utils/ids');
    const e = await createEmployee();
    const old = jwt.sign({ sub: e.id, role: e.role, type: 'access' }, config.auth.jwtSecret, { algorithm: 'HS256', expiresIn: '30m' });
    expect((await as(old).get('/api/auth/me')).status).toBe(200); // no sid: allowed

    const refreshToken = randomToken();
    await db()('refresh_tokens').insert({ id: uuid(), employee_id: e.id, token_hash: sha256(refreshToken), client: 'desktop', expires_at: Date.now() + 1e9, created_at: Date.now() });
    const res = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    const list = (await as(res.body.accessToken).get('/api/auth/sessions')).body;
    expect(list).toHaveLength(1);
    expect(list[0].client).toBe('desktop');
  });
});
