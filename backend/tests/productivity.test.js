'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { uuid } = require('../src/utils/ids');
const { score, band } = require('../src/modules/productivity/productivity.service');
const { normaliseApp } = require('../src/modules/productivity/categories');
const t = require('../src/utils/time');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

const DATE = '2026-09-10';

async function shift(employee, { workedSeconds, idleSeconds }) {
  const nowMs = t.now();
  await db()('attendance').insert({
    id: uuid(),
    employee_id: employee.id,
    punch_in: nowMs - workedSeconds * 1000,
    punch_out: nowMs,
    date: DATE,
    total_worked_seconds: workedSeconds,
    idle_seconds: idleSeconds,
    status: 'closed',
    created_at: nowMs,
    updated_at: nowMs,
  });
}

async function samples(employee, app, count) {
  const nowMs = t.now();
  const rows = Array.from({ length: count }, (_, i) => ({
    id: uuid(),
    employee_id: employee.id,
    keystroke_count: 0,
    mouse_count: 0,
    window_title: app,
    timestamp: nowMs - i * 60000,
    date: DATE,
    created_at: nowMs,
  }));
  await db().batchInsert('activity_logs', rows, 50);
}

describe('score()', () => {
  it('is null with no worked time', () => {
    expect(score({ workedSeconds: 0, idleSeconds: 0, samples: { productive: 0, neutral: 0, distracting: 0 } })).toBeNull();
  });

  it('uses the active ratio alone when no app data was reported', () => {
    const s = { productive: 0, neutral: 0, distracting: 0 };
    expect(score({ workedSeconds: 1000, idleSeconds: 250, samples: s })).toBe(75);
  });

  it('blends in the app mix', () => {
    // Fully active (1.0) and all-productive apps (1.0) -> 100; all-distracting -> 60.
    expect(score({ workedSeconds: 1000, idleSeconds: 0, samples: { productive: 10, neutral: 0, distracting: 0 } })).toBe(100);
    expect(score({ workedSeconds: 1000, idleSeconds: 0, samples: { productive: 0, neutral: 0, distracting: 10 } })).toBe(60);
  });

  it('never goes outside 0-100 even if idle exceeds worked', () => {
    const s = { productive: 0, neutral: 0, distracting: 0 };
    expect(score({ workedSeconds: 100, idleSeconds: 500, samples: s })).toBe(0);
  });

  it('bands scores', () => {
    expect([band(90), band(65), band(55), band(10)]).toEqual(['great', 'good', 'average', 'review']);
  });
});

describe('normaliseApp()', () => {
  it('folds case and .exe', () => {
    expect(normaliseApp(' Code.EXE ')).toBe('code');
    expect(normaliseApp('Google Chrome')).toBe('google chrome');
  });
});

describe('GET /api/admin/productivity', () => {
  it('ranks employees, applies default and overridden categories', async () => {
    const admin = await createEmployee({ role: 'admin', name: 'Admin' });
    const dev = await createEmployee({ name: 'Dev', department: 'Engineering' });
    const idler = await createEmployee({ name: 'Idler', department: 'Sales' });

    await shift(dev, { workedSeconds: 8 * 3600, idleSeconds: 1800 });
    await samples(dev, 'Code', 40);
    await shift(idler, { workedSeconds: 8 * 3600, idleSeconds: 4 * 3600 });
    await samples(idler, 'YouTube', 20);

    const token = await login(admin);
    const res = await as(token).get(`/api/admin/productivity?from=${DATE}&to=${DATE}`);

    expect(res.status).toBe(200);
    expect(res.body.employees).toHaveLength(2);
    // Lowest score first, so "needs attention" people surface at the top.
    expect(res.body.employees[0].name).toBe('Idler');
    expect(res.body.employees[0].band).toBe('review');
    expect(res.body.employees[1].topApp).toBe('Code');
    expect(res.body.summary.needsAttention).toBe(1);
    expect(res.body.departments.map((d) => d.department)).toEqual(['Engineering', 'Sales']);

    // Reclassify YouTube as productive (e.g. a video-editing team): Idler's score rises.
    const before = res.body.employees[0].score;
    const patched = await as(token).patch('/api/admin/app-categories').send({ appName: 'YouTube', category: 'productive' });
    expect(patched.status).toBe(200);

    const after = await as(token).get(`/api/admin/productivity?from=${DATE}&to=${DATE}`);
    expect(after.body.employees.find((e) => e.name === 'Idler').score).toBeGreaterThan(before);
  });

  it('filters by department and validates the date range', async () => {
    const admin = await createEmployee({ role: 'admin' });
    const dev = await createEmployee({ department: 'Engineering' });
    await shift(dev, { workedSeconds: 3600, idleSeconds: 0 });

    const token = await login(admin);
    const none = await as(token).get(`/api/admin/productivity?from=${DATE}&to=${DATE}&department=Sales`);
    expect(none.body.employees).toHaveLength(0);

    const bad = await as(token).get(`/api/admin/productivity?from=${DATE}&to=2026-01-01`);
    expect(bad.status).toBe(400);
  });

  it('is admin-only', async () => {
    const user = await createEmployee();
    const token = await login(user);
    const res = await as(token).get(`/api/admin/productivity?from=${DATE}&to=${DATE}`);
    expect(res.status).toBe(403);
  });
});

describe('app categories', () => {
  it('lists seen apps with effective category and supports reset', async () => {
    const admin = await createEmployee({ role: 'admin' });
    const emp = await createEmployee();
    await samples(emp, 'Spotify', 3);

    // listApps looks back 30 days from now; the fixed DATE may be older, so insert a fresh row.
    await db()('activity_logs').insert({
      id: uuid(),
      employee_id: emp.id,
      keystroke_count: 0,
      mouse_count: 0,
      window_title: 'Spotify',
      timestamp: t.now(),
      date: new Date().toISOString().slice(0, 10),
      created_at: t.now(),
    });

    const token = await login(admin);
    let list = await as(token).get('/api/admin/app-categories');
    const spotify = list.body.find((a) => a.appKey === 'spotify');
    expect(spotify.category).toBe('distracting');
    expect(spotify.overridden).toBe(false);

    await as(token).patch('/api/admin/app-categories').send({ appName: 'Spotify', category: 'neutral' });
    list = await as(token).get('/api/admin/app-categories');
    expect(list.body.find((a) => a.appKey === 'spotify')).toMatchObject({ category: 'neutral', overridden: true });

    await as(token).delete('/api/admin/app-categories?appName=Spotify');
    list = await as(token).get('/api/admin/app-categories');
    expect(list.body.find((a) => a.appKey === 'spotify').category).toBe('distracting');
  });

  it('rejects an unknown category', async () => {
    const token = await login(await createEmployee({ role: 'admin' }));
    const res = await as(token).patch('/api/admin/app-categories').send({ appName: 'X', category: 'evil' });
    expect(res.status).toBe(400);
  });
});
