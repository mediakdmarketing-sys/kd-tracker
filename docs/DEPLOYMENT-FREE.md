# Deployment — fully free, no credit card

| Component | Service | Card | Notes |
|---|---|---|---|
| Web portal (`web/`) | **Vercel** project #1 | no | Native Next.js |
| Backend API (`backend/`) | **Vercel** project #2 | no | Express captured as one Function — no wrapper |
| Scheduled jobs | **GitHub Actions** (`.github/workflows/scheduled-jobs.yml`) | no | Runs the real job code against Supabase + B2 |
| PostgreSQL | **Supabase** free | no | Already set up (pooler URL) |
| Screenshots / audio | **Backblaze B2** 10 GB free | no | S3-compatible; verified working |

**Why two Vercel projects:** one repo, two "Root Directory" settings. The web project
serves the portal; the backend project points at `backend/` and Vercel auto-detects the
Express app exported from `backend/index.js`
([guide](https://vercel.com/kb/guide/ship-a-express-app-on-vercel)).

**Constraints to accept:**
- Serverless cold start ~1–2 s after idle.
- `express-rate-limit` uses an in-memory store — on serverless it is per-instance, so the
  login/upload limits are weaker than on a single long-lived host. Auth (bcrypt rounds 12
  + short-lived JWTs) still holds. Move to a Postgres-backed limiter later if abuse shows.
- B2 free egress is 1 GB/day (uploads free); an admin bulk-viewing media can hit it.
- 10 GB storage → keep `RETENTION_DAYS` low (7) and capture intervals wide.
- GitHub Actions cron is "best effort" — a run can be delayed several minutes, and
  scheduled workflows pause after 60 days with no repo commits.
- Vercel Hobby is nominally non-commercial; fine to start, upgrade to Pro or a VPS when
  the team depends on it.

---

## Order of operations

### 1. Backblaze B2 — done

Bucket `kd-tracker-captures`, region `us-east-005`, endpoint
`s3.us-east-005.backblazeb2.com`, an app key with Read & Write on that bucket.
Verified with a real put/get/delete through the app's own storage driver.

### 2. Code is on GitHub

`github.com/mediakdmarketing-sys/kd-tracker`, branch `main`. The serverless entry
(`backend/index.js`), the `VERCEL` guards in `src/server.js`, the serverless DB pool in
`knexfile.js`, and the Actions workflow are all committed.

### 3. Vercel — backend  (no card)

1. [vercel.com](https://vercel.com) → **Continue with GitHub**.
2. **Add New → Project** → import `kd-tracker`.
3. **Root Directory: `backend`**  → **Edit** → pick the `backend` folder.
4. Framework Preset: **Other** (auto). Leave build/output blank.
5. **Environment Variables:**
   ```
   NODE_OPTIONS=--dns-result-order=ipv4first
   DB_CLIENT=pg
   DATABASE_URL=postgresql://postgres.umzkxcmojfkgfmsbagms:<pw>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres
   JWT_SECRET=<64 hex chars>
   JWT_REFRESH_SECRET=<different 64 hex chars>
   BCRYPT_ROUNDS=12
   RETENTION_DAYS=7
   SCREENSHOT_MIN_INTERVAL_SEC=600
   SCREENSHOT_MAX_INTERVAL_SEC=1200
   AUDIO_SAMPLE_GAP_SEC=900
   STORAGE_DRIVER=s3
   S3_BUCKET=kd-tracker-captures
   S3_REGION=us-east-005
   S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com
   S3_ACCESS_KEY=<B2 keyID>
   S3_SECRET_KEY=<B2 applicationKey>
   CORS_ORIGINS=https://PLACEHOLDER.vercel.app
   ```
   Do **not** set `NODE_ENV=production` (it would force extra secret-strength checks that
   the job runner does not need) — Vercel serves it fine on the default.
6. Deploy → note the URL, e.g. `https://kd-tracker-api.vercel.app`.
7. Check `https://kd-tracker-api.vercel.app/health` → `{"status":"ok","database":"pg"}`.

Migrations are already applied on Supabase. Nothing to run.

### 4. Vercel — web  (no card)

1. **Add New → Project** → import the same repo again.
2. **Root Directory: `web`**.
3. Framework Preset: **Next.js** (auto).
4. **Environment Variables:**
   ```
   API_BASE_URL=https://kd-tracker-api.vercel.app
   COOKIE_SECURE=1
   ```
5. Deploy → note the domain, e.g. `https://kd-tracker.vercel.app`.
6. Back in the **backend** project → Settings → Environment Variables → set
   `CORS_ORIGINS=https://kd-tracker.vercel.app` (exact, no trailing slash) → redeploy.

### 5. GitHub Actions — scheduled jobs

Repo → **Settings → Secrets and variables → Actions**:

*Secrets:*
```
DATABASE_URL   = <same Supabase pooler URL as above>
S3_ENDPOINT    = https://s3.us-east-005.backblazeb2.com
S3_ACCESS_KEY  = <B2 keyID>
S3_SECRET_KEY  = <B2 applicationKey>
```
*Variables (optional — defaults shown):*
```
S3_BUCKET=kd-tracker-captures   S3_REGION=us-east-005   RETENTION_DAYS=7
```

The workflow (`.github/workflows/scheduled-jobs.yml`) then runs purge daily,
close-shifts hourly, payroll monthly. Test it now: **Actions → Scheduled jobs → Run
workflow → `close-shifts`**.

### 6. First admin user

Run locally against the production DB (or from any machine with Node):

```bash
cd backend
# .env already has the Supabase DATABASE_URL
node -e "require('dotenv').config();const c=require('crypto'),b=require('bcryptjs'),{db,destroy}=require('./src/db');(async()=>{const n=Date.now();await db()('employees').insert({id:c.randomUUID(),name:'KD Admin',email:'admin@kdmarketing.in',password_hash:await b.hash('CHANGE_THIS_NOW',12),role:'admin',status:'active',timezone:'Asia/Kolkata',consent_monitoring:false,consent_audio:false,created_at:n,updated_at:n});await destroy();console.log('done')})()"
```

(An admin already exists from earlier testing: `admin@kdmarketing.in` / `ChangeMe#2026`
— change the password after first login.)

### 7. Desktop agent

Point its API base URL at `https://kd-tracker-api.vercel.app`, rebuild, distribute via
GitHub Releases.

---

## When to move off free

Serverless cold starts or the rate-limit weakness start to matter → a $4–6/mo VPS
(Hetzner) or Oracle Always Free ($1 refundable hold), per [DEPLOYMENT.md](DEPLOYMENT.md).
That setup runs the in-process scheduler again (disable the Actions workflow) and can use
local-disk storage.
