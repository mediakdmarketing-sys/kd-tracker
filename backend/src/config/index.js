'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config();

const ROOT = path.resolve(__dirname, '..', '..');

function str(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing required env var ${name}`);
    return fallback;
  }
  return v;
}

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Env var ${name} must be an integer, got "${raw}"`);
  return n;
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function resolveFromRoot(p) {
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

const env = str('NODE_ENV', 'development');
const isProd = env === 'production';
const isTest = env === 'test';

const config = {
  root: ROOT,
  env,
  isProd,
  isTest,
  port: int('PORT', 4000),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  db: {
    client: str('DB_CLIENT', 'sqlite'),
    sqliteFile: resolveFromRoot(str('SQLITE_FILE', './data/kdtracker.sqlite3')),
    url: process.env.DATABASE_URL || null,
  },

  auth: {
    jwtSecret: str('JWT_SECRET', isProd ? undefined : 'dev-only-secret'),
    jwtRefreshSecret: str('JWT_REFRESH_SECRET', isProd ? undefined : 'dev-only-refresh-secret'),
    expiresIn: str('JWT_EXPIRES_IN', '30m'),
    refreshExpiresIn: str('JWT_REFRESH_EXPIRES_IN', '14d'),
    bcryptRounds: int('BCRYPT_ROUNDS', isTest ? 4 : 10),
    // A rotated refresh token stays usable for this long. Covers the case where the server
    // rotated but the response never reached the client (ADR-0004).
    refreshGraceSeconds: int('REFRESH_GRACE_SECONDS', 120),
  },

  offline: {
    // Timestamps this far ahead of the server are a broken client clock, not a late upload.
    maxClockSkewSeconds: int('MAX_CLOCK_SKEW_SECONDS', 120),
    // How far back a queued punch event may be dated. Beyond this it is not a network blip
    // and HR should look at it.
    maxBackdateHours: int('MAX_BACKDATE_HOURS', 4),
    // A capture older than this would be near the end of its retention life on arrival.
    maxCaptureAgeDays: int('MAX_CAPTURE_AGE_DAYS', 7),
  },

  storage: {
    driver: str('STORAGE_DRIVER', 'local'),
    localDir: resolveFromRoot(str('STORAGE_LOCAL_DIR', './storage')),
    s3: {
      bucket: process.env.S3_BUCKET || null,
      region: process.env.S3_REGION || null,
      accessKey: process.env.S3_ACCESS_KEY || null,
      secretKey: process.env.S3_SECRET_KEY || null,
    },
  },

  shift: {
    targetSeconds: int('SHIFT_TARGET_SECONDS', 32400),
    breakAllowanceSeconds: int('BREAK_ALLOWANCE_SECONDS', 3600),
    idleThresholdSeconds: int('IDLE_THRESHOLD_SECONDS', 600),
    autoCloseHours: int('SHIFT_AUTO_CLOSE_HOURS', 16),
  },

  capture: {
    screenshotMinIntervalSec: int('SCREENSHOT_MIN_INTERVAL_SEC', 300),
    screenshotMaxIntervalSec: int('SCREENSHOT_MAX_INTERVAL_SEC', 600),
    audioSampleDurationSec: int('AUDIO_SAMPLE_DURATION_SEC', 300),
    audioSampleGapSec: int('AUDIO_SAMPLE_GAP_SEC', 480),
    maxUploadBytes: int('MAX_UPLOAD_BYTES', 5 * 1024 * 1024),
  },

  retention: {
    days: int('RETENTION_DAYS', 31),
  },

  payroll: {
    // Whether idle seconds are deducted from paid hours when generating payroll summaries.
    // Default: false — idle time is reported but not deducted (the safe default; enable only
    // after the policy has been communicated to employees and recorded in the consent notice).
    deductIdle: bool('PAYROLL_DEDUCT_IDLE', false),
  },

  jobs: {
    enabled: bool('ENABLE_SCHEDULER', true) && !isTest,
    purgeCron: str('CRON_PURGE', '15 2 * * *'),
    payrollCron: str('CRON_PAYROLL', '0 3 1 * *'),
    closeShiftsCron: str('CRON_CLOSE_SHIFTS', '10 * * * *'),
  },
};

// Fail fast rather than shipping a deployment that signs tokens with a known secret.
if (isProd) {
  for (const [key, value] of [
    ['JWT_SECRET', config.auth.jwtSecret],
    ['JWT_REFRESH_SECRET', config.auth.jwtRefreshSecret],
  ]) {
    if (!value || value.includes('dev-only') || value.length < 32) {
      throw new Error(`${key} must be set to a strong value (32+ chars) in production`);
    }
  }
  if (config.db.client === 'sqlite') {
    // Not fatal — a small single-instance deployment is a legitimate choice — but it must
    // be a decision someone made rather than a default nobody noticed.
    // eslint-disable-next-line no-console
    console.warn(
      '[config] Running in production on SQLite. Single writer, single instance only. ' +
        'See docs/adr/0001-sqlite-first-portable-persistence.md before scaling.'
    );
  }
}

if (config.db.client === 'sqlite') {
  fs.mkdirSync(path.dirname(config.db.sqliteFile), { recursive: true });
}

module.exports = config;
