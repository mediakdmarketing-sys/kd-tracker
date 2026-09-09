'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const attendanceService = require('../src/modules/attendance/attendance.service');
const { closeStaleShifts } = require('../src/jobs/closeShifts.job');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');
const config = require('../src/config');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const HOUR = 3600 * 1000;

describe('punch in', () => {
  it('opens a shift', async () => {
    const token = await login(await createEmployee());
    const res = await as(token).post('/api/attendance/punch-in');

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('open');
    expect(res.body.punchOut).toBeNull();
  });

  it('is blocked until the monitoring notice is accepted', async () => {
    const token = await login(
      await createEmployee({ consent_monitoring: false, consent_given_at: null })
    );
    const res = await as(token).post('/api/attendance/punch-in');

    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/consent|notice/i);
  });

  it('refuses a second shift while one is open', async () => {
    const token = await login(await createEmployee());
    await as(token).post('/api/attendance/punch-in');

    const res = await as(token).post('/api/attendance/punch-in');
    expect(res.status).toBe(409);
    expect(res.body.error.details.attendanceId).toBeTruthy();
  });

  // Regression: the check-then-insert in punchIn() is not atomic on its own (SQLite's
  // transaction is deferred and takes no write lock until the INSERT), so two requests
  // landing close together used to both pass the "no open shift" check. A partial unique
  // index on attendance(employee_id) WHERE status IN ('open','on_break') is the actual
  // guarantee; this proves it holds even when the application-level check races.
  it('never ends up with two open shifts for the same employee under a concurrent race', async () => {
    const employee = await createEmployee();
    const user = toUser(employee);

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => attendanceService.punchIn({ employee: user }))
    );

    const succeeded = attempts.filter((a) => a.status === 'fulfilled');
    const failed = attempts.filter((a) => a.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(7);
    // Every rejection is the ordinary "already have an open shift" conflict, not a raw
    // constraint-violation error leaking out of the service.
    expect(failed.every((f) => f.reason.status === 409)).toBe(true);

    const openShifts = await db()('attendance')
      .where({ employee_id: employee.id })
      .whereIn('status', ['open', 'on_break']);
    expect(openShifts).toHaveLength(1);
  });

  it('cannot be performed on behalf of somebody else', async () => {
    const attacker = await createEmployee();
    const victim = await createEmployee();
    const token = await login(attacker);

    // The spec's payload carries employeeId; the server ignores it and uses the token.
    await as(token).post('/api/attendance/punch-in').send({ employeeId: victim.id });

    const victimShifts = await db()('attendance').where({ employee_id: victim.id });
    expect(victimShifts).toHaveLength(0);
  });
});

describe('breaks and worked time', () => {
  it('subtracts break time from worked time', async () => {
    const employee = await createEmployee();
    const start = t.now() - 9 * HOUR;

    await attendanceService.punchIn({ employee: toUser(employee), at: start });
    await attendanceService.startBreak({ employee: toUser(employee), at: start + 4 * HOUR });
    await attendanceService.endBreak({ employee: toUser(employee), at: start + 4.5 * HOUR });
    const closed = await attendanceService.punchOut({
      employee: toUser(employee),
      at: start + 9 * HOUR,
    });

    expect(closed.totalBreakSeconds).toBe(1800);
    expect(closed.totalWorkedSeconds).toBe(9 * 3600 - 1800);
    expect(closed.overBreak).toBe(false);
  });

  it('flags a day where breaks exceed the one-hour allowance', async () => {
    const employee = await createEmployee();
    const start = t.now() - 9 * HOUR;

    await attendanceService.punchIn({ employee: toUser(employee), at: start });
    await attendanceService.startBreak({ employee: toUser(employee), at: start + 2 * HOUR });
    await attendanceService.endBreak({ employee: toUser(employee), at: start + 3.5 * HOUR });
    const closed = await attendanceService.punchOut({
      employee: toUser(employee),
      at: start + 9 * HOUR,
    });

    expect(closed.overBreak).toBe(true);
    expect(closed.needsReview).toBe(true);
    expect(closed.reviewReason).toMatch(/allowance/i);
  });

  it('sums several breaks in a day', async () => {
    const employee = await createEmployee();
    const start = t.now() - 9 * HOUR;
    const user = toUser(employee);

    await attendanceService.punchIn({ employee: user, at: start });
    await attendanceService.startBreak({ employee: user, at: start + 2 * HOUR });
    await attendanceService.endBreak({ employee: user, at: start + 2.25 * HOUR });
    await attendanceService.startBreak({ employee: user, at: start + 5 * HOUR });
    await attendanceService.endBreak({ employee: user, at: start + 5.5 * HOUR });
    const closed = await attendanceService.punchOut({ employee: user, at: start + 9 * HOUR });

    expect(closed.breaks).toHaveLength(2);
    expect(closed.totalBreakSeconds).toBe(900 + 1800);
  });

  it('closes a forgotten break when the employee punches out', async () => {
    const employee = await createEmployee();
    const start = t.now() - 9 * HOUR;
    const user = toUser(employee);

    await attendanceService.punchIn({ employee: user, at: start });
    await attendanceService.startBreak({ employee: user, at: start + 8 * HOUR });
    const closed = await attendanceService.punchOut({ employee: user, at: start + 9 * HOUR });

    expect(closed.status).toBe('closed');
    expect(closed.totalBreakSeconds).toBe(3600);
  });

  it('rejects a break when no shift is open', async () => {
    const token = await login(await createEmployee());
    const res = await as(token).post('/api/attendance/break-start');
    expect(res.status).toBe(409);
  });

  it('rejects punch-out with no open shift', async () => {
    const token = await login(await createEmployee());
    const res = await as(token).post('/api/attendance/punch-out');
    expect(res.status).toBe(409);
  });
});

// Sprint 6.5 / ADR-0004. An agent that was offline when the employee pressed the button
// replays the event with the time it actually happened.
describe('queued punch events', () => {
  it('honours a punch-in backdated inside the 4-hour window', async () => {
    const token = await login(await createEmployee());
    const at = new Date(Date.now() - 2 * HOUR).toISOString();

    const res = await as(token).post('/api/attendance/punch-in').send({ at });

    expect(res.status).toBe(201);
    expect(res.body.punchIn).toBe(at);
    expect(res.body.source).toBe('queued');
    expect(res.body.needsReview).toBe(false);
    // The gap between claim and arrival is recorded, so HR can see it was replayed late.
    expect(res.body.punchInReceivedAt).toBeTruthy();
  });

  it('caps a punch-in backdated beyond the window and flags it for HR', async () => {
    const token = await login(await createEmployee());
    const at = new Date(Date.now() - 9 * HOUR).toISOString();

    const res = await as(token).post('/api/attendance/punch-in').send({ at });

    expect(res.status).toBe(201);
    // Server time was used instead: the employee does not get 9 hours for free.
    expect(new Date(res.body.punchIn).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(res.body.needsReview).toBe(true);
    expect(res.body.reviewReason).toMatch(/4-hour limit/i);
  });

  it('refuses a punch-in dated in the future', async () => {
    const token = await login(await createEmployee());
    const at = new Date(Date.now() + 2 * HOUR).toISOString();

    const res = await as(token).post('/api/attendance/punch-in').send({ at });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/future|clock/i);
    expect(await db()('attendance').count({ c: '*' })).toEqual([{ c: 0 }]);
  });

  it('refuses a punch-out dated before the punch-in it closes', async () => {
    const employee = await createEmployee();
    const token = await login(employee);
    await attendanceService.punchIn({ employee: toUser(employee), at: t.now() - HOUR });

    const res = await as(token)
      .post('/api/attendance/punch-out')
      .send({ at: new Date(Date.now() - 3 * HOUR).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/before the shift started/i);
  });

  it('records a live punch-in as live', async () => {
    const token = await login(await createEmployee());
    const res = await as(token).post('/api/attendance/punch-in');
    expect(res.body.source).toBe('live');
  });
});

describe('live status', () => {
  it('reports the break allowance even once it has been exceeded', async () => {
    const employee = await createEmployee();
    const user = toUser(employee);
    const start = t.now() - 5 * HOUR;

    await attendanceService.punchIn({ employee: user, at: start });
    await attendanceService.startBreak({ employee: user, at: start + 1 * HOUR });
    await attendanceService.endBreak({ employee: user, at: start + 2.5 * HOUR });

    const token = await login(employee);
    const res = await as(token).get('/api/attendance/status');

    expect(res.status).toBe(200);
    expect(res.body.state).toBe('working');
    // Without this the client cannot tell what the allowance was: remaining is clamped to 0.
    expect(res.body.breakRemainingSeconds).toBe(0);
    expect(res.body.breakAllowanceSeconds).toBe(3600);
    expect(res.body.overBreak).toBe(true);
  });

  it('does not allow capture while on a break', async () => {
    const employee = await createEmployee();
    const user = toUser(employee);

    await attendanceService.punchIn({ employee: user, at: t.now() - HOUR });
    await attendanceService.startBreak({ employee: user, at: t.now() - 10 * 60000 });

    const token = await login(employee);
    const res = await as(token).get('/api/attendance/status');

    expect(res.body.state).toBe('on_break');
    expect(res.body.captureAllowed).toBe(false);
    expect(res.body.audioAllowed).toBe(false);
  });
});

describe('idle detection', () => {
  it('counts a long activity gap as idle but not a declared break', async () => {
    const employee = await createEmployee();
    const start = t.now() - 8 * HOUR;
    const user = toUser(employee);

    const shift = await attendanceService.punchIn({ employee: user, at: start });

    // Activity for the first hour, then a two-hour silence, then activity again.
    const pings = [];
    for (let ts = start; ts <= start + HOUR; ts += 5 * 60 * 1000) pings.push(ts);
    for (let ts = start + 3 * HOUR; ts <= start + 8 * HOUR; ts += 5 * 60 * 1000) pings.push(ts);

    await db()('activity_logs').insert(
      pings.map((ts) => ({
        id: uuid(),
        employee_id: employee.id,
        attendance_id: shift.id,
        keystroke_count: 10,
        mouse_count: 5,
        window_title: 'VS Code',
        timestamp: ts,
        date: t.localDate(ts, employee.timezone),
        created_at: ts,
      }))
    );

    const closed = await attendanceService.punchOut({ employee: user, at: start + 8 * HOUR });

    // ~2 hours of silence, allowing for the ping spacing.
    expect(closed.idleSeconds).toBeGreaterThan(1.9 * 3600);
    expect(closed.idleSeconds).toBeLessThan(2.2 * 3600);
  });
});

describe('stale shift sweeper', () => {
  it('auto-closes a shift that was never punched out and flags it', async () => {
    const employee = await createEmployee();
    await attendanceService.punchIn({ employee: toUser(employee), at: t.now() - 30 * HOUR });

    const result = await closeStaleShifts();
    expect(result.affected).toBe(1);

    const row = await db()('attendance').where({ employee_id: employee.id }).first();
    expect(row.status).toBe('closed');
    expect(row.auto_closed).toBeTruthy();
    expect(row.needs_review).toBeTruthy();
    // The employee can start their next shift.
    expect(await attendanceService.openShift(employee.id)).toBeUndefined();
  });

  it('leaves a shift that is merely long alone', async () => {
    const employee = await createEmployee();
    await attendanceService.punchIn({ employee: toUser(employee), at: t.now() - 5 * HOUR });

    const result = await closeStaleShifts();
    expect(result.affected).toBe(0);
  });

  // Regression: the sweep used to SELECT stale shifts, then loop through several more
  // queries per shift before its own UPDATE — an unconditional write by id. An employee who
  // genuinely punches out for real in that window had their real punch-out silently
  // overwritten with the sweep's estimated time and a false "never punched out" flag. The
  // fix guards the final write on the row still being open; this races the two paths for
  // real and checks the result is one clean outcome or the other, never a corrupted mix.
  it('does not clobber a real punch-out that lands while the sweep is processing the same shift', async () => {
    const employee = await createEmployee();
    const user = toUser(employee);
    const punchInAt = t.now() - (config.shift.autoCloseHours + 1) * HOUR;
    await attendanceService.punchIn({ employee: user, at: punchInAt });

    const [sweep, realPunchOut] = await Promise.allSettled([
      closeStaleShifts(),
      attendanceService.punchOut({ employee: user }),
    ]);

    const row = await db()('attendance').where({ employee_id: employee.id }).first();
    expect(row.status).toBe('closed');

    if (realPunchOut.status === 'fulfilled') {
      // The employee's own punch-out won the race: it must be intact, not overwritten by the
      // sweep's guess. auto_closed must not be true over a shift that was, in fact, punched
      // out normally moments later.
      expect(row.auto_closed).toBeFalsy();
      expect(row.review_reason || '').not.toMatch(/never punched out/i);
    } else {
      // The sweep won first and closed it before the real punch-out could land; the real
      // punch-out then correctly saw no open shift left to close.
      expect(row.auto_closed).toBeTruthy();
      expect(realPunchOut.reason?.status).toBe(409);
    }
    expect(sweep.status).toBe('fulfilled');
  });
});

describe('history access', () => {
  it('lets an employee read their own history but not that of a colleague', async () => {
    const employee = await createEmployee();
    const colleague = await createEmployee();
    const token = await login(employee);

    expect((await as(token).get(`/api/attendance/${employee.id}`)).status).toBe(200);
    expect((await as(token).get(`/api/attendance/${colleague.id}`)).status).toBe(403);
  });

  it('audits an admin reading the history of another employee', async () => {
    const admin = await createEmployee({ role: 'admin' });
    const employee = await createEmployee();
    const token = await login(admin);

    await as(token).get(`/api/attendance/${employee.id}`);

    const logs = await db()('audit_logs').where({ target_employee_id: employee.id });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('viewed_attendance');
  });
});

/** The shape `req.user` has, for tests that call the service directly. */
function toUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    timezone: row.timezone,
    consentMonitoring: true,
    consentAudio: !!row.consent_audio,
  };
}
