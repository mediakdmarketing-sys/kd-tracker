'use strict';

const { migrate, truncate, createEmployee, login, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const hrOf = async () => as(await login(await createEmployee({ name: 'Hana HR', role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` })));

/** Signs the person's desktop agent in and has it say which version it is, the way the real agent does. */
async function agentOn(e, version) {
  const res = await request(app).post('/api/auth/login').send({ email: e.email, password: 'Password123!', client: 'desktop' });
  const call = request(app).get('/api/attendance/status').set('Authorization', `Bearer ${res.body.accessToken}`);
  if (version) call.set('X-Agent-Version', version);
  await call;
}

const publish = (api, body) => api.post('/api/admin/agent-releases').send({ version: '1.2.0', notes: ['Fix some bugs', 'Faster start'], ...body });

describe('publishing an agent release', () => {
  it('stores the version and notes, shows them in the agent config, and refuses a bad, repeated or older version', async () => {
    const hr = await hrOf();
    const eve = await createEmployee();

    const done = await publish(hr, { mandatory: true });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ version: '1.2.0', notes: ['Fix some bugs', 'Faster start'], mandatory: true });

    const config = await as(await login(eve)).get('/api/config');
    expect(config.body.agentRelease).toEqual({ version: '1.2.0', notes: ['Fix some bugs', 'Faster start'], mandatory: true });

    expect((await publish(hr, { version: 'banana' })).status).toBe(400);
    expect((await publish(hr, { notes: [] })).status).toBe(400);
    expect((await publish(hr, {})).status).toBe(409); // already published
    const older = await publish(hr, { version: '1.1.0' });
    expect(older.status).toBe(400);
    expect(older.body.error.message).toMatch(/newer version/i);
    expect((await publish(hr, { version: '1.10.0' })).status).toBe(201); // 1.10 is newer than 1.2

    expect((await publish(as(await login(eve)), { version: '9.0.0' })).status).toBe(403);
    expect(await db()('audit_logs').where({ action: 'published_agent_release' }).count({ n: '*' }).first().then((r) => Number(r.n))).toBe(2);
  });

  it('has no release in the config before one is published', async () => {
    const eve = await createEmployee();
    expect((await as(await login(eve)).get('/api/config')).body.agentRelease).toBeNull();
  });
});

describe('who has updated', () => {
  it('tells current, outdated, unknown and not-installed apart, and records the reported version', async () => {
    const hr = await hrOf();
    const [a, b, c, d] = await Promise.all(['Ann', 'Bob', 'Cy', 'Di'].map((name) => createEmployee({ name, department: 'Sales' })));
    await agentOn(a, '1.2.0'); // on the newest
    await agentOn(b, '1.1.0'); // behind
    await agentOn(c); // an agent that never says its version
    // d has no agent at all
    await publish(hr, {});

    expect((await db()('sessions').where({ employee_id: a.id }).first()).agent_version).toBe('1.2.0');

    const res = await hr.get('/api/admin/agent-updates');
    expect(res.status).toBe(200);
    const by = (e) => res.body.rows.find((r) => r.employeeId === e.id);
    expect(by(a)).toMatchObject({ update: 'current', version: '1.2.0' });
    expect(by(b)).toMatchObject({ update: 'outdated', version: '1.1.0' });
    expect(by(c)).toMatchObject({ update: 'unknown', version: null });
    expect(by(d)).toMatchObject({ update: 'not_installed' });
    expect(res.body.summary).toMatchObject({ current: 1, outdated: 1, unknown: 1, notInstalled: 2 }); // Di, and HR who has no agent
    expect(res.body.release.version).toBe('1.2.0');
    expect(res.body.rows[0].update).toBe('outdated'); // the ones to chase come first

    // Updating shows at once on the next request.
    await agentOn(b, '1.2.0');
    expect((await hr.get('/api/admin/agent-updates')).body.rows.find((r) => r.employeeId === b.id).update).toBe('current');
  });

  it('ignores a made-up version string', async () => {
    const eve = await createEmployee();
    await agentOn(eve, '1.0.0');
    await agentOn(eve, '<script>');
    expect((await db()('sessions').where({ employee_id: eve.id }).first()).agent_version).toBe('1.0.0');
  });

  it('gives a team leader their own people only', async () => {
    const hr = await hrOf();
    const lena = await createEmployee({ name: 'Lena Leader', role: 'leader', department: 'Sales' });
    await db()('department_leaders').insert({ department: 'Sales', employee_id: lena.id, assigned_at: t.now() });
    const mine = await createEmployee({ name: 'Mine', department: 'Sales' });
    const other = await createEmployee({ name: 'Other', department: 'Support' });
    await agentOn(mine, '1.0.0');
    await agentOn(other, '1.0.0');
    await publish(hr, {});

    const res = await as(await login(lena)).get('/api/leader/agent-updates');
    expect(res.status).toBe(200);
    expect(res.body.rows.map((r) => r.name)).toEqual(['Mine']);
    expect(res.body.rows[0].update).toBe('outdated');

    expect((await as(await login(mine)).get('/api/leader/agent-updates')).status).toBe(403);
    expect((await as(await login(mine)).get('/api/admin/agent-updates')).status).toBe(403);
  });
});
