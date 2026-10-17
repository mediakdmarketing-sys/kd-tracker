'use strict';

// Creates the first (or any further) admin account without seeding demo data.
//
//   ADMIN_NAME="Priya" ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npm run db:create-admin
//
// Values come from the environment, not argv, so the password stays out of shell history and
// process listings.

const { destroy } = require('./index');
const adminService = require('../modules/admin/admin.service');

const MIN_PASSWORD_LENGTH = 12;

async function main() {
  const { ADMIN_NAME: name, ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = process.env;

  if (!name || !email || !password) {
    console.error('Set ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD, then run again.');
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
    const admin = await adminService.createEmployee({ name, email, password, role: 'admin' });
    console.log(`Admin created: ${admin.email}`);
    await destroy();
    process.exit(0);
  } catch (err) {
    console.error(`db:create-admin failed: ${err.message}`);
    await destroy();
    process.exit(1);
  }
}

main();
