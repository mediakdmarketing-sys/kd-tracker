'use strict';

const { migrate, truncate, createEmployee, login, as, app, request } = require('./helpers');
const { db, destroy } = require('../src/db');
const config = require('../src/config');
const holidays = require('../src/modules/payroll/holidays.service');
const payroll = require('../src/modules/payroll/payroll.service');
const pay = require('../src/modules/payroll/pay.service');
const calendar = require('../src/services/holidayCalendar');
const attendance = require('../src/modules/attendance/attendance.service');
const settings = require('../src/services/settings');
const { uuid } = require('../src/utils/ids');
const t = require('../src/utils/time');

// 2026-07-05 is a Sunday; 2026-07-06 is a Monday.
const at = (date, hour = 15) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`).getTime();

beforeAll(async () => {
  await migrate();
  config.calendar.enforceDayOff = true; // the suite normally has it off, since it runs on any weekday
});
beforeEach(async () => {
  await truncate();
  await settings.update({ payroll: { paidLeaveTypes: ['vacation'], workDays: [1, 2, 3, 4, 5] } });
});
afterAll(async () => {
  config.calendar.enforceDayOff = false;
  await destroy();
});

async function admin() {
  const a = await createEmployee({ role: 'admin', email: `admin-${uuid().slice(0, 6)}@kdmarketing.in` });
  return as(await login(a));
}

describe('Sundays and holidays are days off', () => {
  it('knows Sundays without being told, and a marked holiday', async () => {
    await holidays.add({ date: '2026-07-07', name: 'Founders Day' });
    expect(await calendar.dayOff('2026-07-05')).toEqual({ kind: 'sunday', name: 'Sunday' });
    expect(await calendar.dayOff('2026-07-07')).toEqual({ kind: 'holiday', name: 'Founders Day' });
    expect(await calendar.dayOff('2026-07-06')).toBeNull();
    expect(await calendar.dayOff('2026-07-04')).toBeNull(); // a Saturday is a working day unless marked
  });

  it('refuses a punch-in on a Sunday or a holiday, and allows one on any other day', async () => {
    const e = await createEmployee();
    const person = { id: e.id, consentMonitoring: true };
    await holidays.add({ date: '2026-07-07', name: 'Founders Day' });

    await expect(attendance.punchIn({ employee: person, at: at('2026-07-05') })).rejects.toMatchObject({
      status: 409,
      code: 'DAY_OFF',
      message: expect.stringMatching(/Sunday/),
      details: expect.objectContaining({ kind: 'sunday' }),
    });
    await expect(attendance.punchIn({ employee: person, at: at('2026-07-07') })).rejects.toMatchObject({
      code: 'DAY_OFF',
      message: expect.stringMatching(/Founders Day is a company holiday/),
    });
    expect(await db()('attendance').where({ employee_id: e.id })).toHaveLength(0);

    const ok = await attendance.punchIn({ employee: person, at: at('2026-07-06') });
    expect(ok.status).toBe('open');
  });

  it('tells the apps in the status that today is a day off, and closes Punch in', async () => {
    const e = await createEmployee();
    const today = t.localDate();
    if (!calendar.isSunday(today)) await holidays.add({ date: today, name: 'Today off' });

    const status = await attendance.currentStatus({ id: e.id, consentMonitoring: true });
    expect(status.dayOff).toMatchObject({ kind: expect.stringMatching(/sunday|holiday/) });
    expect(status.canPunchIn).toBe(false);
  });

  it('judges a punch by the company day: late Saturday night in New York is still Saturday', async () => {
    const e = await createEmployee();
    // 02:30 UTC on Sunday 5 July is 22:30 on Saturday 4 July in New York.
    const ok = await attendance.punchIn({ employee: { id: e.id, consentMonitoring: true }, at: Date.UTC(2026, 6, 5, 2, 30) });
    expect(ok.date).toBe('2026-07-04');
  });

  it('keeps Sunday out of the holidays you can mark, and out of the working days setting', async () => {
    await expect(holidays.add({ date: '2026-07-05', name: 'Sunday holiday' })).rejects.toMatchObject({ status: 400 });
    await expect(holidays.bulkAdd([{ date: '2026-07-05', name: 'x' }])).rejects.toMatchObject({ status: 400 });

    const api = await admin();
    expect((await api.patch('/api/admin/settings').send({ payroll: { workDays: [0, 1, 2] } })).status).toBe(400);
    expect((await api.patch('/api/admin/settings').send({ payroll: { workDays: [1, 2, 3, 4, 5, 6] } })).status).toBe(200);
  });
});

describe('holidays repeat every year', () => {
  it('fills next year in from this one, flags the copies, and leaves out what does not repeat', async () => {
    await holidays.add({ date: '2026-12-25', name: 'Christmas Day' });
    await holidays.add({ date: '2026-08-15', name: 'Independence Day' });
    await holidays.add({ date: '2026-10-20', name: 'One-off festival', repeats: false });

    const next = await holidays.list({ year: '2027' });
    expect(next.map((h) => [h.date, h.name, h.autoCopied])).toEqual([
      ['2027-08-15', 'Independence Day', true],
      ['2027-12-25', 'Christmas Day', true],
    ]);
    // This year's own are not flagged.
    expect((await holidays.list({ year: '2026' })).every((h) => h.autoCopied === false)).toBe(true);
  });

  it('is filled in once: a copy HR removes or moves does not come back', async () => {
    await holidays.add({ date: '2026-12-25', name: 'Christmas Day' });
    await holidays.add({ date: '2026-08-15', name: 'Independence Day' });
    const [aug, dec] = await holidays.list({ year: '2027' });

    await holidays.remove(dec.id);
    await holidays.update(aug.id, { date: '2027-08-16', name: 'Independence Day (observed)' });

    const again = await holidays.list({ year: '2027' });
    expect(again.map((h) => [h.date, h.name, h.autoCopied])).toEqual([['2027-08-16', 'Independence Day (observed)', false]]);
  });

  it('carries on year after year, even skipping ahead, and handles 29 February', async () => {
    await holidays.add({ date: '2028-02-29', name: 'Leap day' });
    await holidays.add({ date: '2028-05-01', name: 'May Day' });

    const y2031 = await holidays.list({ year: '2031' }); // two years never looked at in between
    expect(y2031.map((h) => h.date)).toEqual(['2031-02-28', '2031-05-01']);
    expect((await holidays.list({ year: '2029' })).map((h) => h.date)).toEqual(['2029-02-28', '2029-05-01']);
    expect((await holidays.list({ year: '2032' })).map((h) => h.date)).toEqual(['2032-02-28', '2032-05-01']); // copies of copies
  });

  it('a holiday added later also appears in the years that were already filled in', async () => {
    await holidays.add({ date: '2026-12-25', name: 'Christmas Day' });
    await holidays.list({ year: '2027' }); // 2027 now exists

    await holidays.add({ date: '2026-12-31', name: 'Year end' });
    expect((await holidays.list({ year: '2027' })).map((h) => h.date)).toEqual(['2027-12-25', '2027-12-31']);
  });

  it('can be switched to not repeat, and a confirmed copy stops being flagged', async () => {
    const a = await holidays.add({ date: '2026-12-25', name: 'Christmas Day' });
    const b = await holidays.add({ date: '2026-08-15', name: 'Independence Day' });
    await holidays.update(a.id, { repeats: false });

    const next = await holidays.list({ year: '2027' });
    expect(next.map((h) => h.name)).toEqual(['Independence Day']);
    const kept = await holidays.update(next[0].id, { keep: true });
    expect(kept.autoCopied).toBe(false);
    expect(b.repeats).toBe(true);
  });

  it('pays a copied holiday in next year’s payroll', async () => {
    await holidays.add({ date: '2026-12-24', name: 'Christmas Eve' }); // a Thursday
    const e = await createEmployee({ created_at: new Date('2026-01-01T00:00:00Z').getTime() });
    await pay.setRate({ employeeId: e.id, dailyRate: 60, effectiveFrom: '2026-01-01' });

    await payroll.generate({ month: '2027-12' }); // 24 December 2027 is a Friday
    const [row] = await payroll.list({ month: '2027-12' });
    expect(row).toMatchObject({ employeeId: e.id, holidayDays: 1, basePay: 60 });
  });
});

describe('editing holidays through the API, and the calendar everyone can read', () => {
  it('lets HR rename, move and confirm a holiday, and says no to a clash or a bad day', async () => {
    const api = await admin();
    const made = (await api.post('/api/payroll/holidays').send({ date: '2026-12-25', name: 'Christmas Day' })).body;
    expect(made.repeats).toBe(true);
    const other = (await api.post('/api/payroll/holidays').send({ date: '2026-12-28', name: 'Boxing Day (observed)', repeats: false })).body;
    expect(other.repeats).toBe(false);

    const renamed = await api.patch(`/api/payroll/holidays/${made.id}`).send({ name: 'Christmas' });
    expect(renamed.body.name).toBe('Christmas');
    expect((await api.patch(`/api/payroll/holidays/${made.id}`).send({ date: '2026-12-28' })).status).toBe(409); // taken
    expect((await api.patch(`/api/payroll/holidays/${made.id}`).send({ date: '2026-12-27' })).status).toBe(400); // a Sunday
    expect((await api.patch(`/api/payroll/holidays/${made.id}`).send({})).status).toBe(400);
  });

  it('shows everyone the year’s holidays without the HR flags, and needs a session', async () => {
    await holidays.add({ date: '2026-12-25', name: 'Christmas Day' });
    const e = await createEmployee();
    const api = as(await login(e));

    const res = await api.get('/api/calendar?year=2027'); // filled in automatically
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ year: '2027', holidays: [{ date: '2027-12-25', name: 'Christmas Day' }] });
    expect((await request(app).get('/api/calendar?year=2027')).status).toBe(401);
  });

  it('only admins change holidays', async () => {
    const e = await createEmployee();
    const api = as(await login(e));
    expect((await api.post('/api/payroll/holidays').send({ date: '2026-12-25', name: 'x' })).status).toBe(403);
  });
});
