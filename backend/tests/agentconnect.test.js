'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { sha256 } = require('../src/utils/ids');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const exchange = (code) => request(app).post('/api/auth/agent-token').send({ code });

async function mintCode(employee) {
  const token = await login(employee);
  const res = await as(token).post('/api/auth/agent-code').send({});
  expect(res.status).toBe(200);
  return res.body.code;
}

describe('agent connect (web login -> desktop agent)', () => {
  it('trades a code for a working session as the same employee', async () => {
    const employee = await createEmployee({ name: 'Karthik' });
    const code = await mintCode(employee);

    const res = await exchange(code);
    expect(res.status).toBe(200);
    expect(res.body.employee.id).toBe(employee.id);
    expect(res.body.refreshToken).toBeTruthy();

    // The tokens are real: the agent can call authenticated routes with them.
    const me = await as(res.body.accessToken).get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(employee.id);
  });

  it('issues the agent its own refresh token, tagged as desktop', async () => {
    const employee = await createEmployee();
    const res = await exchange(await mintCode(employee));

    const row = await db()('refresh_tokens').where({ token_hash: sha256(res.body.refreshToken) }).first();
    expect(row.client).toBe('desktop');
    expect(row.employee_id).toBe(employee.id);
  });

  it('works only once', async () => {
    const code = await mintCode(await createEmployee());

    expect((await exchange(code)).status).toBe(200);
    expect((await exchange(code)).status).toBe(401);
  });

  it('only one of two simultaneous exchanges wins', async () => {
    const code = await mintCode(await createEmployee());

    const results = await Promise.all([exchange(code), exchange(code)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
  });

  it('expires after its short lifetime', async () => {
    const code = await mintCode(await createEmployee());
    await db()('agent_connect_codes').update({ expires_at: Date.now() - 1000 });

    expect((await exchange(code)).status).toBe(401);
  });

  it('rejects an unknown code with the same answer as an expired one', async () => {
    const unknown = await exchange('x'.repeat(43));
    expect(unknown.status).toBe(401);

    const code = await mintCode(await createEmployee());
    await db()('agent_connect_codes').update({ expires_at: Date.now() - 1000 });
    const expired = await exchange(code);

    expect(unknown.body.error.message).toBe(expired.body.error.message);
  });

  it('refuses a deactivated account even with a valid code', async () => {
    const employee = await createEmployee();
    const code = await mintCode(employee);
    await db()('employees').where({ id: employee.id }).update({ status: 'inactive' });

    expect((await exchange(code)).status).toBe(403);
  });

  it('stores only a hash of the code', async () => {
    const code = await mintCode(await createEmployee());
    const rows = await db()('agent_connect_codes').select('code_hash');

    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).toBe(sha256(code));
    expect(rows[0].code_hash).not.toBe(code);
  });

  it('needs a signed-in session to mint a code, but not to exchange one', async () => {
    const res = await request(app).post('/api/auth/agent-code').send({});
    expect(res.status).toBe(401);

    const short = await exchange('too-short');
    expect(short.status).toBe(400);
  });
});
