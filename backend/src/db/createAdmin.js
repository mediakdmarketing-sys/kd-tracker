'use strict';

// Creates an admin account without seeding demo data, or resets that account's password.
//
//   ADMIN_NAME="Priya" ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npm run db:create-admin
//   ... same, plus ADMIN_RESET=1, to set a new password on an account that already exists.
//   ... add ADMIN_SUPER=1 to make the account a super admin (the platform owner, who creates
//       companies and chooses their features). With ADMIN_RESET=1 it promotes an existing account.
//
// Values come from the environment, not argv, so the password stays out of shell history and
// process listings.

const bcrypt = require('bcryptjs');
const config = require('../config');
const { db, destroy } = require('./index');
const adminService = require('../modules/admin/admin.service');
const t = require('../utils/time');

const MIN_PASSWORD_LENGTH = 12;

async function resetPassword(email, password) {
  const row = await db()('employees').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first();
  if (!row) throw new Error('No account with that email to reset.');

  await db()('employees')
    .where({ id: row.id })
    .update({
      password_hash: await bcrypt.hash(password, config.auth.bcryptRounds),
      updated_at: t.now(),
    });
  // Any session signed in with the old password must not outlive the reset.
  await db()('refresh_tokens').where({ employee_id: row.id }).whereNull('revoked_at').update({ revoked_at: t.now() });
  return row.email;
}

async function main() {
  const { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password, ADMIN_RESET: reset } = process.env;
  const resetting = ['1', 'true', 'yes'].includes(String(reset || '').toLowerCase());
  const makeSuper = ['1', 'true', 'yes'].includes(String(process.env.ADMIN_SUPER || '').toLowerCase());

  if (!email || !password || (!resetting && !name)) {
    console.error('Set ADMIN_NAME (not needed for reset), ADMIN_EMAIL and ADMIN_PASSWORD, then run again.');
    process.exit(2);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('ADMIN_EMAIL is not a valid email address.');
    process.exit(2);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    process.exit(2);
  }

  try {
    if (resetting) {
      console.log(`Password reset for: ${await resetPassword(email, password)}`);
    } else {
      // The person running this script picked the password themselves: no forced change.
      const admin = await adminService.createEmployee({
        name,
        email,
        password,
        role: 'admin',
        mustChangePassword: false,
      });
      console.log(`Admin created: ${admin.email}`);
    }
    if (makeSuper) {
      await db()('employees')
        .whereRaw('LOWER(email) = ?', [email.toLowerCase()])
        .update({ is_super_admin: true, updated_at: t.now() });
      console.log(`Super admin: ${email}`);
    }
    await destroy();
    process.exit(0);
  } catch (err) {
    console.error(`db:create-admin failed: ${err.message}`);
    await destroy();
    process.exit(1);
  }
}

main();
