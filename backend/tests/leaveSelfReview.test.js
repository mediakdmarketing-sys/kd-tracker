'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const LEAVE = { type: 'personal', startDate: '2026-12-01', endDate: '2026-12-02', dayPart: 'full' };

async function ask(person) {
  const res = await as(await login(person)).post('/api/leave').send(LEAVE);
  expect(res.status).toBe(201);
  return res.body;
}

const decide = (api, base, id, status = 'approved') => api.patch(`${base}/leave/${id}`).send({ status });

describe('nobody decides their own leave', () => {
  it('refuses an admin approving or rejecting their own request, and leaves it pending', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'Hana HR' });
    const request = await ask(hr);
    const api = as(await login(hr));

    for (const status of ['approved', 'rejected']) {
      const res = await decide(api, '/api/admin', request.id, status);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/your own leave request/);
    }
    const row = await db()('leave_requests').where({ id: request.id }).first();
    expect(row.status).toBe('pending');
    expect(row.reviewed_by).toBeNull();
  });

  it('lets a different admin decide it', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'Hana HR' });
    const other = await createEmployee({ role: 'admin', name: 'Omar Other' });
    const request = await ask(hr);

    const res = await decide(as(await login(other)), '/api/admin', request.id, 'approved');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', reviewedByName: 'Omar Other' });
  });

  it('tells the other admins about an admin’s request, and not the admin themselves', async () => {
    const hr = await createEmployee({ role: 'admin', name: 'Hana HR' });
    const other = await createEmployee({ role: 'admin', name: 'Omar Other' });
    await ask(hr);

    const inbox = async (p) => (await as(await login(p)).get('/api/notifications')).body.items;
    expect((await inbox(other)).map((n) => n.type)).toEqual(['leave_requested']);
    expect(await inbox(hr)).toHaveLength(0);
  });

  it('still lets an admin decide an employee’s request', async () => {
    const hr = await createEmployee({ role: 'admin' });
    const worker = await createEmployee();
    const request = await ask(worker);
    expect((await decide(as(await login(hr)), '/api/admin', request.id)).status).toBe(200);
  });

  it('keeps a leader from deciding their own request, and sends it to HR instead', async () => {
    const hr = await createEmployee({ role: 'admin' });
    const lead = await createEmployee({ role: 'leader', department: 'Sales' });
    await db()('department_leaders').insert({ department: 'Sales', employee_id: lead.id, assigned_at: t.now() });
    const request = await ask(lead);

    const own = await decide(as(await login(lead)), '/api/leader', request.id);
    expect([403, 404]).toContain(own.status);
    expect((await db()('leave_requests').where({ id: request.id }).first()).status).toBe('pending');

    expect((await decide(as(await login(hr)), '/api/admin', request.id)).status).toBe(200);
  });
});
