'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');

const config = require('./config');
const { db } = require('./db');
const { authenticate } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { asyncHandler } = require('./utils/http');
const { lastRuns } = require('./jobs/jobRunner');

const authRoutes = require('./modules/auth/auth.routes');
const attendanceRoutes = require('./modules/attendance/attendance.routes');
const capture = require('./modules/capture/capture.routes');
const adminRoutes = require('./modules/admin/admin.routes');
const leaderRoutes = require('./modules/leader/leader.routes');
const payrollRoutes = require('./modules/payroll/payroll.routes');

function createApp() {
  const app = express();

  // Behind nginx/ALB, so req.ip reflects the client rather than the proxy — rate limits and
  // audit-log IPs depend on it.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // No Origin header: the desktop agent and server-to-server calls. Browsers always
        // send one, so this does not weaken the browser-facing policy.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} is not allowed`));
      },
      credentials: true,
    })
  );
  app.use(compression());

  // Screenshots arrive base64-encoded in JSON, which inflates them by ~33%.
  app.use(express.json({ limit: `${Math.ceil((config.capture.maxUploadBytes * 1.4) / 1024 / 1024)}mb` }));
  app.use(express.urlencoded({ extended: false }));
  app.use('/api', apiLimiter);

  app.get(
    '/health',
    asyncHandler(async (req, res) => {
      // A process that is up but cannot reach its database is not healthy.
      await db().raw('select 1 as ok');
      res.json({
        status: 'ok',
        version: require('../package.json').version,
        env: config.env,
        database: config.db.client,
        storage: config.storage.driver,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    })
  );

  /** Job health — what an external monitor should alert on (story P-5).
   *  Requires authentication: exposes internal job names, run times and failure details. */
  app.get(
    '/health/jobs',
    authenticate,
    asyncHandler(async (req, res) => {
      const runs = await lastRuns();
      const purgeRun = runs.find((r) => r.job === 'purge');
      const stale =
        !purgeRun || Date.now() - new Date(purgeRun.startedAt).getTime() > 48 * 60 * 60 * 1000;
      res.status(stale || runs.some((r) => r.status === 'failed') ? 503 : 200).json({
        status: stale ? 'purge_overdue' : 'ok',
        jobs: runs,
      });
    })
  );

  /** Capture settings the agent reads on start, so intervals are changed server-side. */
  app.get('/api/config', authenticate, (req, res) => {
    res.json({
      screenshot: {
        minIntervalSeconds: config.capture.screenshotMinIntervalSec,
        maxIntervalSeconds: config.capture.screenshotMaxIntervalSec,
      },
      audio: {
        enabled: req.user.consentAudio,
        sampleDurationSeconds: config.capture.audioSampleDurationSec,
        sampleGapSeconds: config.capture.audioSampleGapSec,
      },
      shift: {
        targetSeconds: config.shift.targetSeconds,
        breakAllowanceSeconds: config.shift.breakAllowanceSeconds,
        idleThresholdSeconds: config.shift.idleThresholdSeconds,
      },
      retentionDays: config.retention.days,
      maxUploadBytes: config.capture.maxUploadBytes,
    });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/attendance', attendanceRoutes);
  // Single canonical path. The old /api/screenshot (singular) alias is removed: it allowed
  // the upload rate limit to be bypassed by splitting requests across both paths.
  app.use('/api/screenshots', capture.screenshots);
  app.use('/api/audio', capture.audio);
  app.use('/api/activity', capture.activity);
  app.use('/api/admin', adminRoutes);
  app.use('/api/leader', leaderRoutes);
  app.use('/api/payroll', payrollRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
