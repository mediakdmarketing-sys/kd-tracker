'use strict';

const { migrate, truncate, createEmployee, login, as } = require('./helpers');
const { db, destroy } = require('../src/db');
const { check } = require('../src/utils/passwordPolicy');

beforeAll(migrate);
beforeEach(truncate);
afterAll(destroy);

describe('password rules', () => {
  const admin = { role: 'admin', email: 'priya@kdmarketing.in', name: 'Priya Raman' };

  it('asks 12 characters of an HR / admin and 8 of everyone else', () => {
    expect(check('Blue-tea-42', admin)).toMatch(/at least 12/); // 11
    expect(check('blue-tea-morning-bus', admin)).toBeNull();
    expect(check('Blue-tea', { role: 'user' })).toBeNull(); // 8
    expect(check('Blue-te', { role: 'user' })).toMatch(/at least 8/);
    expect(check('Blue-te', { role: 'leader' })).toMatch(/at least 8/);
  });

  it('refuses well-known passwords however they are dressed up', () => {
    for (const weak of ['Password123!', 'P@ssw0rd2024', 'PASSWORD', 'Welcome@2026', 'qwertyuiop12', 'WorkBuddy#2026', 'iloveyou1234']) {
      expect(check(weak, { role: 'user' })).toMatch(/common/);
    }
  });

  it('refuses a repeated character and obvious runs', () => {
    for (const weak of ['aaaaaaaaaaaa', '123456789012', 'abcdefghijkl', '987654321098']) {
      expect(check(weak, admin)).toMatch(/too easy/);
    }
  });

  it('refuses a password made from the person’s own name or email', () => {
    expect(check('priya-raman-2026-x', admin)).toMatch(/name or email/);
    expect(check('my-priya-secret-99', admin)).toMatch(/name or email/);
    expect(check('river-lantern-bridge-9', admin)).toBeNull();
  });

  it('accepts a passphrase and an ordinary strong password', () => {
    expect(check('correct horse battery staple', admin)).toBeNull();
    expect(check('Vq7#mTz!pL2x', admin)).toBeNull();
  });
});

describe('where the rules apply', () => {
  const change = (token, currentPassword, newPassword) =>
    as(token).post('/api/auth/change-password').send({ currentPassword, newPassword });

  it('holds an admin changing their own password to 12 characters', async () => {
    const a = await createEmployee({ role: 'admin' });
    const token = await login(a);
    const short = await change(token, 'Password123!', 'Blue-tea-42');
    expect(short.status).toBe(400);
    expect(short.body.error.message).toMatch(/at least 12/);
    expect((await change(token, 'Password123!', 'blue-tea-morning-bus')).status).toBe(200);
  });

  it('lets an ordinary employee use 8 characters, but not a common password', async () => {
    const e = await createEmployee();
    const token = await login(e);
    expect((await change(token, 'Password123!', 'Welcome@2026')).status).toBe(400);
    expect((await change(token, 'Password123!', 'Blue-tea-9')).status).toBe(200);
  });

  it('holds a password HR types for an admin to the same rules, but not a generated one', async () => {
    const hr = as(await login(await createEmployee({ role: 'admin' })));
    const weak = await hr.post('/api/admin/employees').send({ name: 'New Admin', email: 'na@kdmarketing.in', role: 'admin', password: 'Blue-tea-42' });
    expect(weak.status).toBe(400);
    const generated = await hr.post('/api/admin/employees').send({ name: 'New Admin', email: 'na@kdmarketing.in', role: 'admin' });
    expect(generated.status).toBe(201);
    expect(generated.body.temporaryPassword).toBeTruthy();
  });

  it('makes someone choose a new password when they are made an admin', async () => {
    const hr = as(await login(await createEmployee({ role: 'admin' })));
    const e = await createEmployee({ email: 'promote@kdmarketing.in' });
    expect((await hr.patch(`/api/admin/employees/${e.id}`).send({ role: 'admin' })).status).toBe(200);
    const row = await db()('employees').where({ id: e.id }).first();
    expect(Boolean(row.must_change_password)).toBe(true);
  });
});
