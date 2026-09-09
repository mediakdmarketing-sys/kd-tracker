'use strict';

// Migration CLI driven through Knex's programmatic API rather than the `knex` binary, so it
// picks up the same config, .env loading and SQLite pragmas as the running server.
//
//   npm run db:migrate | db:rollback | db:seed | db:reset

const { db, destroy } = require('./index');
const config = require('../config');

async function migrate() {
  const [batch, files] = await db().migrate.latest();
  if (!files.length) console.log('Already up to date. No migrations to run.');
  else console.log(`Batch ${batch} applied:\n${files.map((f) => `  - ${f}`).join('\n')}`);
}

async function rollback() {
  const [batch, files] = await db().migrate.rollback();
  if (!files.length) console.log('Nothing to roll back.');
  else console.log(`Batch ${batch} rolled back:\n${files.map((f) => `  - ${f}`).join('\n')}`);
}

async function seed() {
  const [files] = await db().seed.run();
  console.log(files.length ? `Seeded:\n${files.map((f) => `  - ${f}`).join('\n')}` : 'No seed files.');
}

/** Drops everything and rebuilds — development only, and it says so before it acts. */
async function reset() {
  if (config.isProd) {
    console.error('Refusing to run db:reset with NODE_ENV=production.');
    process.exit(1);
  }
  await db().migrate.rollback(undefined, true); // roll back every batch
  await migrate();
  await seed();
}

const COMMANDS = { migrate, rollback, seed, reset };

async function main() {
  const command = process.argv[2];
  if (!COMMANDS[command]) {
    console.error(`Unknown command "${command}". Available: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(2);
  }
  try {
    await COMMANDS[command]();
    await destroy();
    process.exit(0);
  } catch (err) {
    console.error(`db:${command} failed: ${err.message}`);
    await destroy();
    process.exit(1);
  }
}

main();
