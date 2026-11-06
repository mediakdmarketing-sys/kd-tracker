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

  // The one clock the whole company runs on: attendance dates, the day a shift belongs to and
  // every time the portal shows. An IANA name; set APP_TIMEZONE to change it for everyone.
  timezone: str('APP_TIMEZONE', 'America/New_York'),

  storage: {
    driver: str('STORAGE_DRIVER', 'local'),
    localDir: resolveFromRoot(str('STORAGE_LOCAL_DIR', './storage')),
    s3: {
      // Trimmed: a stray space/newline pasted into a hosting dashboard silently breaks the
      // request signature (SignatureDoesNotMatch) and is very hard to spot by eye.
      bucket: (process.env.S3_BUCKET || '').trim() || null,
      region: (process.env.S3_REGION || '').trim() || null,
      accessKey: (process.env.S3_ACCESS_KEY || '').trim() || null,
      secretKey: (process.env.S3_SECRET_KEY || '').trim() || null,
      // Set for S3-compatible providers (Cloudflare R2, MinIO, Backblaze B2).
      // R2: https://<ACCOUNT_ID>.r2.cloudflarestorage.com  with S3_REGION=auto
      endpoint: (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '') || null,
      forcePathStyle: ['1', 'true', 'yes', 'on'].includes(
        String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase()
      ),
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
    // A day's work (breaks already taken out) of at least this long is a FULL day, at least the
    // half-day limit a HALF day; less than that is paid by the hour. Editable in Settings.
    fullDaySeconds: int('PAYROLL_FULL_DAY_SECONDS', 9 * 3600),
    halfDaySeconds: int('PAYROLL_HALF_DAY_SECONDS', 4.5 * 3600),
    // Approved leave of these types is paid (at the daily rate, on working days). Editable in Settings.
    paidLeaveTypes: str('PAYROLL_PAID_LEAVE_TYPES', 'vacation')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    // Working days of the week, 0 = Sunday ... 6 = Saturday. Leave and holidays are only paid on these.
    workDays: str('PAYROLL_WORK_DAYS', '1,2,3,4,5')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  },

  calendar: {
    // Refuse punch-ins on Sundays and company holidays. Off in the test suite only, which runs on
    // whatever weekday it is; the tests that cover the rule switch it on.
    enforceDayOff: bool('ENFORCE_DAY_OFF', !isTest),
  },

  // Outgoing email (payslips), through Resend's HTTP API: SMTP ports are blocked on some hosts,
  // port 443 never is. Leave RESEND_API_KEY empty and the portal says email is not set up.
  mail: {
    resendApiKey: str('RESEND_API_KEY', ''),
    // "Name <address@your-verified-domain>", the address must be on a domain verified in Resend.
    from: str('MAIL_FROM', ''),
    // The public address of THIS API, so an email can link its logo (mail clients fetch it from
    // the internet). Without it emails are sent without a logo.
    publicApiUrl: str('PUBLIC_API_URL', '').replace(/\/$/, ''),
  },

  jobs: {
    enabled: bool('ENABLE_SCHEDULER', true) && !isTest,
    purgeCron: str('CRON_PURGE', '15 2 * * *'),
    payrollCron: str('CRON_PAYROLL', '0 3 1 * *'),
    // Birthday reminders: hourly through the working day (company time). Each reminder is written
    // once, so the repeats are harmless and cover a server that was asleep at the first run.
    birthdayCron: str('CRON_BIRTHDAYS', '5 8-20 * * *'),
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
