'use strict';

const jwt = require('jsonwebtoken');
const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { destroy } = require('../src/db');
const config = require('../src/config');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

describe('cross-origin requests', () => {
  it('refuses an unknown browser origin with a 403, not a 500', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('still allows the portal origin and calls with no Origin (the desktop agent)', async () => {
    const allowed = config.corsOrigins[0];
    expect((await request(app).get('/health').set('Origin', allowed)).status).toBe(200);
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('access tokens', () => {
  it('accepts a normal signed-in token', async () => {
    const e = await createEmployee();
    expect((await as(await login(e)).get('/api/auth/me')).status).toBe(200);
  });

  it('rejects a token signed with a different algorithm, or with none', async () => {
    const e = await createEmployee();
    const claims = { sub: e.id, role: 'admin', type: 'access' };
    const hs512 = jwt.sign(claims, config.auth.jwtSecret, { algorithm: 'HS512', expiresIn: '5m' });
    const none = jwt.sign(claims, '', { algorithm: 'none' });
    for (const token of [hs512, none]) {
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });
});
