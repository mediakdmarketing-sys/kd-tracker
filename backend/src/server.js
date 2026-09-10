'use strict';

const config = require('./config');
const { createApp } = require('./app');
const { db, destroy } = require('./db');
const scheduler = require('./jobs/scheduler');
const logger = require('./utils/logger');

async function main() {
  // Refuse to serve on an unmigrated database rather than failing one request at a time.
  // Skipped on Vercel: the platform captures the Express app from index.js instead, and
  // migrations there are applied out of band (locally, or by CI) — see index.js.
  if (!process.env.VERCEL) {
    const [, pending] = await db().migrate.list();
    if (pending.length) {
      logger.error('Database has pending migrations. Run: npm run db:migrate', {
        pending: pending.map((p) => p.file || p),
      });
      process.exit(1);
    }
  }

  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info('API listening', {
      port: config.port,
      env: config.env,
      database: config.db.client,
      storage: config.storage.driver,
    });
  });

  // The in-process scheduler is for long-lived hosts. On Vercel the process is frozen
  // between requests, so cron runs as GitHub Actions workflows instead.
  if (!process.env.VERCEL) scheduler.start();

  const shutdown = async (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    scheduler.stop();
    server.close(async () => {
      await destroy();
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start server', { message: err.message, stack: err.stack });
  process.exit(1);
});
