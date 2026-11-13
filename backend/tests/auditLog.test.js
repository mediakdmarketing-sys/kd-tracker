'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const audit = require('../src/services/audit');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

async function setup() {
  const hr = await createEmployee({ name: 'Hana HR', role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` });
  const person = await createEmployee({ name: 'Pavi Person', department: 'Sales' });
  const req = { user: hr, ip: '10.1.2.3' };
  return { hr, person, req, api: as(await login(hr)) };
}

describe('GET /api/admin/audit-logs', () => {
  it('names who did what to whom, newest first, and can be filtered', async () => {
    const { hr, person, req, api } = await setup();
    await audit.record(req, { action: audit.ACTIONS.VIEWED_BANK_DETAILS, targetEmployeeId: person.id, targetType: 'employee', targetId: person.id, details: { revealed: false } });
    await audit.record(req, { action: audit.ACTIONS.VIEWED_SCREENSHOT, targetEmployeeId: person.id, targetType: 'screenshot', targetId: uuid() });

    const all = (await api.get('/api/admin/audit-logs')).body;
    expect(all.pagination.total).toBe(2);
    expect(all.data[0].action).toBe('viewed_screenshot'); // newest first
    expect(all.data[1]).toMatchObject({
      action: 'viewed_bank_details', adminName: 'Hana HR', adminId: hr.id, targetName: 'Pavi Person', ipAddress: '10.1.2.3', details: { revealed: false },
    });

    const onlyBank = (await api.get('/api/admin/audit-logs?action=viewed_bank_details')).body;
    expect(onlyBank.data).toHaveLength(1);
    expect((await api.get(`/api/admin/audit-logs?targetEmployeeId=${person.id}`)).body.pagination.total).toBe(2);
    expect((await api.get(`/api/admin/audit-logs?adminId=${uuid()}`)).body.pagination.total).toBe(0);

    expect((await api.get('/api/admin/audit-actions')).body).toEqual(['viewed_bank_details', 'viewed_screenshot']);
  });

  it('refuses a backwards date range, and everyone but HR', async () => {
    const { api } = await setup();
    expect((await api.get('/api/admin/audit-logs?from=2026-11-10&to=2026-11-01')).status).toBe(400);
    const employee = as(await login(await createEmployee()));
    expect((await employee.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await employee.get('/api/admin/audit-actions')).status).toBe(403);
  });
});
