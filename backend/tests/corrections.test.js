'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');
const { zonedToMs } = require('../src/modules/corrections/corrections.service');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const day = (daysAgo) => t.localDate(t.now() - daysAgo * t.DAY_MS);

async function setup() {
  const employee = await createEmployee({ name: 'Eve Employee', department: 'Sales' });
  const hr = await createEmployee({ name: 'Hana HR', role: 'admin', email: `hr-${uuid().slice(0, 6)}@kdmarketing.in` });
  return { employee, hr, eve: as(await login(employee)), hana: as(await login(hr)) };
}

/** A finished shift 09:00 to 15:00 company time, `daysAgo` days back, with 30 minutes of break. */
async function closedShift(employee, daysAgo = 1, over = {}) {
  const date = day(daysAgo);
  const row = {
    id: uuid(), employee_id: employee.id, punch_in: zonedToMs(date, '09:00'), punch_out: zonedToMs(date, '15:00'), date,
    total_break_seconds: 1800, total_worked_seconds: 5.5 * 3600, idle_seconds: 0, status: 'closed', over_break: false,
    auto_closed: true, needs_review: true, review_reason: 'Shift was never punched out; auto-closed.',
    created_at: t.now(), updated_at: t.now(), ...over,
  };
  await db()('attendance').insert(row);
  return row;
}

describe('company clock to an instant', () => {
  it('handles winter and summer time', () => {
    expect(new Date(zonedToMs('2026-11-10', '09:00')).toISOString()).toBe('2026-11-10T14:00:00.000Z'); // EST, UTC-5
    expect(new Date(zonedToMs('2026-07-01', '09:00')).toISOString()).toBe('2026-07-01T13:00:00.000Z'); // EDT, UTC-4
  });
});

describe('asking for a correction, and HR deciding', () => {
  it('changes a shift’s times once approved, recounts the hours, and tells the employee', async () => {
    const { employee, hr, eve, hana } = await setup();
    const shift = await closedShift(employee);

    const sent = await eve.post('/api/corrections').send({ attendanceId: shift.id, punchIn: '09:00', punchOut: '18:00', reason: 'Forgot to punch out, worked until 6' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'pending', kind: 'change', requestedSeconds: 9 * 3600 });
    expect(sent.body.original.punchOut).toBe(new Date(shift.punch_out).toISOString());

    // HR is told, and the shift has not changed yet.
    const inbox = (await hana.get('/api/notifications')).body.items.find((i) => i.type === 'time_correction_request');
    expect(inbox.title).toBe('Time correction: Eve Employee');
    expect(Number((await db()('attendance').where({ id: shift.id }).first()).punch_out)).toBe(shift.punch_out);

    const decided = await hana.post(`/api/corrections/${sent.body.id}/review`).send({ status: 'approved', note: 'Checked with the team' });
    expect(decided.status).toBe(200);
    expect(decided.body).toMatchObject({ status: 'approved', reviewedBy: 'Hana HR' });

    const after = await db()('attendance').where({ id: shift.id }).first();
    expect(Number(after.punch_out)).toBe(zonedToMs(shift.date, '18:00'));
    expect(after.total_worked_seconds).toBe(9 * 3600 - 1800); // the break already taken still comes off
    expect([true, 1]).toContain(after.corrected);
    expect([false, 0]).toContain(after.needs_review);
    expect([false, 0]).toContain(after.auto_closed);

    const note = (await eve.get('/api/notifications')).body.items.find((i) => i.type === 'time_correction_approved');
    expect(note.body).toContain('were changed');
    expect(await db()('audit_logs').where({ action: 'reviewed_time_correction', admin_id: hr.id }).count({ n: '*' }).first().then((r) => Number(r.n))).toBe(1);
  });

  it('adds a whole forgotten shift when none is named', async () => {
    const { employee, eve, hana } = await setup();
    const date = day(2);
    const sent = await eve.post('/api/corrections').send({ date, punchIn: '10:00', punchOut: '16:30', reason: 'Laptop was broken, worked from a desktop' });
    expect(sent.body).toMatchObject({ kind: 'add', original: null, requestedSeconds: 6.5 * 3600 });
    expect((await hana.post(`/api/corrections/${sent.body.id}/review`).send({ status: 'approved' })).status).toBe(200);

    const rows = await db()('attendance').where({ employee_id: employee.id, date });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'closed', source: 'correction', total_worked_seconds: 6.5 * 3600 });
  });

  it('leaves the shift alone when rejected, and a rejection needs a reason', async () => {
    const { employee, eve, hana } = await setup();
    const shift = await closedShift(employee);
    const sent = await eve.post('/api/corrections').send({ attendanceId: shift.id, punchIn: '07:00', punchOut: '15:00', reason: 'I came in early that day' });

    expect((await hana.post(`/api/corrections/${sent.body.id}/review`).send({ status: 'rejected' })).status).toBe(400);
    const rejected = await hana.post(`/api/corrections/${sent.body.id}/review`).send({ status: 'rejected', note: 'No record of that' });
    expect(rejected.body.status).toBe('rejected');
    expect(Number((await db()('attendance').where({ id: shift.id }).first()).punch_in)).toBe(shift.punch_in);
    expect((await hana.post(`/api/corrections/${sent.body.id}/review`).send({ status: 'approved' })).status).toBe(409); // already decided
  });

  it('refuses requests that cannot be right', async () => {
    const { employee, eve } = await setup();
    const shift = await closedShift(employee, 1);
    const send = (body) => eve.post('/api/corrections').send({ punchIn: '09:00', punchOut: '17:00', reason: 'Forgot to punch', ...body });

    expect((await send({ attendanceId: shift.id, reason: 'x' })).status).toBe(400); // no real reason
    expect((await send({})).status).toBe(400); // no date, no shift
    expect((await send({ date: day(-1) })).status).toBe(400); // tomorrow
    expect((await send({ date: day(20) })).status).toBe(400); // past the 14 day window
    expect((await send({ date: day(1) })).status).toBe(409); // runs into the shift already there
    expect((await send({ date: day(3), punchIn: '09:00', punchOut: '09:00' })).status).toBe(400); // no length... wraps to 24h
    expect((await eve.post('/api/corrections').send({ date: day(3), punchIn: '9am', punchOut: '17:00', reason: 'Forgot to punch' })).status).toBe(400);

    const open = await closedShift(employee, 2, { status: 'open', punch_out: null, total_worked_seconds: null });
    expect((await send({ attendanceId: open.id })).status).toBe(409); // not finished yet
    expect((await send({ attendanceId: uuid() })).status).toBe(404);
  });

  it('allows one pending request per shift, and lets the employee cancel it', async () => {
    const { employee, eve } = await setup();
    const shift = await closedShift(employee);
    const body = { attendanceId: shift.id, punchIn: '09:00', punchOut: '18:00', reason: 'Forgot to punch out' };
    const first = await eve.post('/api/corrections').send(body);
    expect((await eve.post('/api/corrections').send(body)).status).toBe(409);

    expect((await eve.post(`/api/corrections/${first.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await eve.post('/api/corrections').send(body)).status).toBe(201); // can ask again
    expect((await eve.get('/api/corrections/me')).body).toHaveLength(2);
  });

  it('keeps HR from deciding their own request, and everyone else from deciding any', async () => {
    const { hr, employee, eve, hana } = await setup();
    const shift = await closedShift(hr);
    const own = await hana.post('/api/corrections').send({ attendanceId: shift.id, punchIn: '09:00', punchOut: '18:00', reason: 'Forgot to punch out' });
    expect((await hana.post(`/api/corrections/${own.body.id}/review`).send({ status: 'approved' })).status).toBe(403);

    const other = await createEmployee({ name: 'Other Person' });
    const eveShift = await closedShift(employee);
    const mine = await eve.post('/api/corrections').send({ attendanceId: eveShift.id, punchIn: '09:00', punchOut: '18:00', reason: 'Forgot to punch out' });
    expect((await eve.post(`/api/corrections/${mine.body.id}/review`).send({ status: 'approved' })).status).toBe(403); // not an admin
    expect((await eve.get('/api/corrections/review')).status).toBe(403);
    expect((await as(await login(other)).post(`/api/corrections/${mine.body.id}/cancel`)).status).toBe(403);

    // HR sees what is waiting, with names.
    const waiting = (await hana.get('/api/corrections/review')).body;
    expect(waiting.map((r) => r.employeeName).sort()).toEqual(['Eve Employee', 'Hana HR']);
  });

  it('does not touch a finalized payroll month', async () => {
    const { employee, eve } = await setup();
    const shift = await closedShift(employee);
    await db()('payroll_months').insert({ month: shift.date.slice(0, 7), finalized_at: t.now(), finalized_by: null });
    const res = await eve.post('/api/corrections').send({ attendanceId: shift.id, punchIn: '09:00', punchOut: '18:00', reason: 'Forgot to punch out' });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('finalized');
  });
});
