# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
NODE_ENV=development
PORT=4000
# Force IPv4 DNS resolution — prevents ECONNREFUSED on IPv6-only Supabase endpoints
NODE_OPTIONS=--dns-result-order=ipv4first
# Comma-separated list of origins allowed to call the API (web portal, agent).
CORS_ORIGINS=http://localhost:3000

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# Supabase PostgreSQL (single source of truth)
DB_CLIENT=pg
DATABASE_URL=postgresql://postgres.umzkxcmojfkgfmsbagms:myI1N5vHY3L4JMsn@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
# CHANGE THESE. Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=dev-only-change-me-before-any-real-deployment
JWT_REFRESH_SECRET=dev-only-change-me-too
# Access token lifetime. Kept short; the agent refreshes silently.
JWT_EXPIRES_IN=30m
# Refresh lifetime must outlast a 9-hour shift plus a margin.
JWT_REFRESH_EXPIRES_IN=14d
BCRYPT_ROUNDS=10

# ---------------------------------------------------------------------------
# File storage (screenshots / audio)
# ---------------------------------------------------------------------------
# `local` writes to disk; `s3` uses the bucket below. Keys are identical either way.
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./storage
# --- Cloudflare R2 (fill in and set STORAGE_DRIVER=s3 to switch) ---
# STORAGE_DRIVER=s3
# S3_BUCKET=kd-tracker-captures
# S3_REGION=auto
# S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# S3_ACCESS_KEY=
# S3_SECRET_KEY=

# ---------------------------------------------------------------------------
# Shift & capture rules
# ---------------------------------------------------------------------------
# 9-hour shift inclusive of a 1-hour break.
SHIFT_TARGET_SECONDS=32400
BREAK_ALLOWANCE_SECONDS=3600
# No activity for this long marks the span as idle (distinct from break).
IDLE_THRESHOLD_SECONDS=600
# Randomised screenshot interval used by the agent, served via /api/config.
SCREENSHOT_MIN_INTERVAL_SEC=300
SCREENSHOT_MAX_INTERVAL_SEC=600
# Audio sampling: record 5 min, then wait 8 min. Non-overlapping by design.
AUDIO_SAMPLE_DURATION_SEC=300
AUDIO_SAMPLE_GAP_SEC=480
# Max accepted upload size (base64-decoded) in bytes.
MAX_UPLOAD_BYTES=5242880

# ---------------------------------------------------------------------------
# Retention & jobs
# ---------------------------------------------------------------------------
RETENTION_DAYS=31
# Run scheduled jobs inside the API process. Set false if you run them via
# system cron / a separate worker (recommended once there is >1 API instance).
ENABLE_SCHEDULER=true
# Daily purge at 02:15, monthly payroll on the 1st at 03:00, shift sweep hourly.
CRON_PURGE=15 2 * * *
CRON_PAYROLL=0 3 1 * *
CRON_CLOSE_SHIFTS=10 * * * *
# A shift still open this many hours after punch-in is auto-closed and flagged.
SHIFT_AUTO_CLOSE_HOURS=16

# ---------------------------------------------------------------------------
# Payroll integration (Sprint 5 ships CSV export; live sync is icebox I-2)
# ---------------------------------------------------------------------------
# PAYROLL_API_URL=
# PAYROLL_API_KEY=



# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
NODE_ENV=development
PORT=4000
# Comma-separated list of origins allowed to call the API (web portal, agent).
CORS_ORIGINS=http://localhost:3000

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
# `sqlite` today. Set to `pg` and fill DATABASE_URL to move to PostgreSQL —
# no application code changes required (see docs/adr/0001-*).
DB_CLIENT=sqlite
SQLITE_FILE=./data/kdtracker.sqlite3
# DATABASE_URL=postgres://user:pass@localhost:5432/kdtracker

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
# CHANGE THESE. Generate with: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=dev-only-change-me-before-any-real-deployment
JWT_REFRESH_SECRET=dev-only-change-me-too
# Access token lifetime. Kept short; the agent refreshes silently.
JWT_EXPIRES_IN=30m
# Refresh lifetime must outlast a 9-hour shift plus a margin.
JWT_REFRESH_EXPIRES_IN=14d
BCRYPT_ROUNDS=10
# A rotated refresh token stays usable for this long, so a lost rotation response on a flaky
# connection does not sign the employee out mid-shift. Reuse after this window is treated as
# token theft and every session for that employee is revoked.
REFRESH_GRACE_SECONDS=120

# ---------------------------------------------------------------------------
# Offline / unreliable network handling (see docs/adr/0004-*)
# ---------------------------------------------------------------------------
# Timestamps further ahead of the server than this are rejected as a broken client clock.
MAX_CLOCK_SKEW_SECONDS=120
# How far back a queued punch event may be dated. Beyond this the server records its own time
# and flags the shift for HR review.
MAX_BACKDATE_HOURS=4
# Captures older than this are rejected — they would be near the end of retention on arrival.
MAX_CAPTURE_AGE_DAYS=7

# ---------------------------------------------------------------------------
# File storage (screenshots / audio)
# ---------------------------------------------------------------------------
# `local` writes to disk; `s3` uses the bucket below. Keys are identical either way.
STORAGE_DRIVER=local
STORAGE_LOCAL_DIR=./storage
# --- AWS S3 ---
# S3_BUCKET=employee-monitoring-bucket
# S3_REGION=ap-south-1
# S3_ACCESS_KEY=
# S3_SECRET_KEY=
# --- Cloudflare R2 (S3-compatible) ---
# STORAGE_DRIVER=s3
# S3_BUCKET=kd-tracker-captures
# S3_REGION=auto
# S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
# S3_ACCESS_KEY=<R2 access key id>
# S3_SECRET_KEY=<R2 secret access key>

# ---------------------------------------------------------------------------
# Shift & capture rules
# ---------------------------------------------------------------------------
# 9-hour shift inclusive of a 1-hour break.
SHIFT_TARGET_SECONDS=32400
BREAK_ALLOWANCE_SECONDS=3600
# No activity for this long marks the span as idle (distinct from break).
IDLE_THRESHOLD_SECONDS=600
# Randomised screenshot interval used by the agent, served via /api/config.
SCREENSHOT_MIN_INTERVAL_SEC=300
SCREENSHOT_MAX_INTERVAL_SEC=600
# Audio sampling: record 5 min, then wait 8 min. Non-overlapping by design.
AUDIO_SAMPLE_DURATION_SEC=300
AUDIO_SAMPLE_GAP_SEC=480
# Max accepted upload size (base64-decoded) in bytes.
MAX_UPLOAD_BYTES=5242880

# ---------------------------------------------------------------------------
# Retention & jobs
# ---------------------------------------------------------------------------
RETENTION_DAYS=31
# Run scheduled jobs inside the API process. Set false if you run them via
# system cron / a separate worker (recommended once there is >1 API instance).
ENABLE_SCHEDULER=true
# Daily purge at 02:15, monthly payroll on the 1st at 03:00, shift sweep hourly.
CRON_PURGE=15 2 * * *
CRON_PAYROLL=0 3 1 * *
CRON_CLOSE_SHIFTS=10 * * * *
# A shift still open this many hours after punch-in is auto-closed and flagged.
SHIFT_AUTO_CLOSE_HOURS=16

# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------
# Set to true to deduct idle seconds from paid hours when generating payroll summaries.
# Default false — idle time is reported for visibility but not deducted.
# Change only after communicating the policy to employees and updating the consent notice.
PAYROLL_DEDUCT_IDLE=false

# ---------------------------------------------------------------------------
# Payroll integration (Sprint 5 ships CSV export; live sync is icebox I-2)
# ---------------------------------------------------------------------------
# PAYROLL_API_URL=
# PAYROLL_API_KEY=
