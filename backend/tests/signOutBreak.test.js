'use strict';

const { migrate, truncate, createEmployee, as, request, app } = require('./helpers');
const { db, destroy } = require('../src/db');
const attendance = require('../src/modules/attendance/attendance.service');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

/** Signs in through the API, so there is a real refresh token to sign out with. */
async function signIn(employee) {
  const res = await request(app).post('/api/auth/login').send({ email: employee.email, password: 'Password123!', client: 'web' });
  expect(res.status).toBe(200);
  return { access: res.body.accessToken, refresh: res.body.refreshToken };
}

const person = (e) => ({ id: e.id, consentMonitoring: true });
const signOut = (refresh) => request(app).post('/api/auth/logout').send({ refreshToken: refresh });
const breaksOf = (e) => db()('breaks').where({ employee_id: e.id }).orderBy('break_start');

describe('signing out while punched in', () => {
  it('puts the shift on a break, and says so', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 2 * 3600 * 1000 });
    const { refresh } = await signIn(e);

    const res = await signOut(refresh);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ revoked: 1 }); // the employee id is not handed back to the client

    const open = (await breaksOf(e)).filter((b) => b.break_end === null);
    expect(open).toHaveLength(1);
    expect(open[0].reason).toBe('signed_out');
    expect((await db()('attendance').where({ employee_id: e.id }).first()).status).toBe('on_break');

    // Back in: the portal shows a break, with the reason, and capture stays off.
    const back = await signIn(e);
    const status = (await as(back.access).get('/api/attendance/status')).body;
    expect(status).toMatchObject({ state: 'on_break', captureAllowed: false });
    expect(status.shift.breaks.find((b) => !b.end).reason).toBe('signed_out');
  });

  it('takes the Zoom camera reason from the agent, and no other reason', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 3600 * 1000 });
    const { access } = await signIn(e);

    // The server alone sets 'signed_out'; a client cannot claim it, or make up another.
    expect((await as(access).post('/api/attendance/break-start').send({ reason: 'signed_out' })).status).toBe(400);
    expect((await as(access).post('/api/attendance/break-start').send({ reason: 'whatever' })).status).toBe(400);

    const res = await as(access).post('/api/attendance/break-start').send({ reason: 'zoom_camera_off' });
    expect(res.status).toBe(200);
    expect((await breaksOf(e))[0].reason).toBe('zoom_camera_off');
    const status = (await as(access).get('/api/attendance/status')).body;
    expect(status.shift.breaks.find((b) => !b.end).reason).toBe('zoom_camera_off');
  });

  it('shows the Zoom camera setting to agents, and lets HR change it', async () => {
    const e = await createEmployee();
    const hr = await createEmployee({ role: 'admin' });
    const cfg = async () => (await as((await signIn(e)).access).get('/api/config')).body.shift.zoomCameraBreakMinutes;
    expect(await cfg()).toBe(0); // off unless HR turns it on

    const hrAccess = (await signIn(hr)).access;
    expect((await as(hrAccess).patch('/api/admin/settings').send({ shift: { zoomCameraBreakMinutes: 5 } })).status).toBe(200);
    expect(await cfg()).toBe(5);
    expect((await as(hrAccess).patch('/api/admin/settings').send({ shift: { zoomCameraBreakMinutes: 500 } })).status).toBe(400);
    await as(hrAccess).patch('/api/admin/settings').send({ shift: { zoomCameraBreakMinutes: 0 } });
  });

  it('shows on the live board as On break', async () => {
    const e = await createEmployee();
    const hr = await createEmployee({ role: 'admin' });
    await attendance.punchIn({ employee: person(e), at: t.now() - 3600 * 1000 });
    await signOut((await signIn(e)).refresh);

    const hrToken = (await signIn(hr)).access;
    const board = (await as(hrToken).get('/api/admin/dashboard')).body;
    const row = board.employees.find((r) => r.employeeId === e.id);
    expect(row.state).toBe('on_break');
    expect(board.summary.onBreak).toBe(1);
  });

  it('carries on when they press End break, and the break counts as break time', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 4 * 3600 * 1000 });
    await signOut((await signIn(e)).refresh);
    // The break began a moment ago; pretend it was half an hour.
    await db()('breaks').where({ employee_id: e.id }).update({ break_start: t.now() - 30 * 60 * 1000 });

    const back = await signIn(e);
    const ended = await as(back.access).post('/api/attendance/break-end');
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('open');
    expect(ended.body.totalBreakSeconds).toBeGreaterThanOrEqual(29 * 60);
  });

  it('does nothing for someone who is not punched in', async () => {
    const e = await createEmployee();
    const res = await signOut((await signIn(e)).refresh);
    expect(res.status).toBe(200);
    expect(await breaksOf(e)).toHaveLength(0);
  });

  it('does not start a second break when they are already on one', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 3600 * 1000 });
    await attendance.startBreak({ employee: person(e) }); // their own break, no reason
    await signOut((await signIn(e)).refresh);

    const all = await breaksOf(e);
    expect(all).toHaveLength(1);
    expect(all[0].reason).toBeNull(); // still the one they started themselves
  });

  it('is not started again by a token that was already signed out', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 3600 * 1000 });
    const { refresh } = await signIn(e);
    await signOut(refresh);
    await attendance.endBreak({ employee: person(e) }); // they are back at work

    await signOut(refresh); // the same, dead token again
    expect((await breaksOf(e)).filter((b) => b.break_end === null)).toHaveLength(0);
    expect((await db()('attendance').where({ employee_id: e.id }).first()).status).toBe('open');
  });

  it('also happens when they sign out everywhere', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 3600 * 1000 });
    const { access } = await signIn(e);

    expect((await as(access).post('/api/auth/logout-all')).status).toBe(200);
    expect((await breaksOf(e))[0].reason).toBe('signed_out');
  });

  it('is not triggered by changing a password, which also ends every session', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 3600 * 1000 });
    const { access } = await signIn(e);

    const changed = await as(access).post('/api/auth/change-password').send({ currentPassword: 'Password123!', newPassword: 'Blue-tea-morning-9' });
    expect(changed.status).toBe(200);
    expect(await breaksOf(e)).toHaveLength(0);
  });

  it('keeps the worked time right when the shift is punched out afterwards', async () => {
    const e = await createEmployee();
    await attendance.punchIn({ employee: person(e), at: t.now() - 5 * 3600 * 1000 });
    await signOut((await signIn(e)).refresh);
    await db()('breaks').where({ employee_id: e.id }).update({ break_start: t.now() - 60 * 60 * 1000 });

    const out = await attendance.punchOut({ employee: person(e), at: t.now() });
    // Five hours in, the last of them a break: about four worked.
    expect(out.totalBreakSeconds).toBeGreaterThanOrEqual(59 * 60);
    expect(out.totalWorkedSeconds).toBeGreaterThan(3.9 * 3600);
    expect(out.totalWorkedSeconds).toBeLessThan(4.1 * 3600);
  });
});
