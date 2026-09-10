# Deployment — fully free, no credit card

| Component | Service | Card | Notes |
|---|---|---|---|
| Web portal (`web/`) | **Vercel** | no | Native Next.js, no sleep |
| Backend API (`backend/`) | **Render** free web service | no | Sleeps after 15 min idle — kept awake by a pinger |
| Keep-awake pinger | **cron-job.org** | no | Hits the Render URL every 10 min |
| PostgreSQL | **Supabase** free | no | Already set up (pooler URL) |
| Screenshots / audio | **Backblaze B2** 10 GB free | no | S3-compatible — `s3.js` already supports it |

**Constraints to accept:** Render cold-start ~30–50 s if the pinger misses or right
after a deploy; B2 free egress is 1 GB/day (uploads are free, admin *viewing* lots of
media in one day can hit it); 10 GB storage means short retention. Tune the backend:

```
RETENTION_DAYS=7
SCREENSHOT_MIN_INTERVAL_SEC=600
SCREENSHOT_MAX_INTERVAL_SEC=1200
AUDIO_SAMPLE_GAP_SEC=900
```

---

## Order of operations

### 1. Backblaze B2  (5 min, no card)

1. [backblaze.com/sign-up/cloud-storage](https://www.backblaze.com/sign-up/cloud-storage) —
   email + password, verify email. No card.
2. **B2 Cloud Storage → Buckets → Create a Bucket**
   - Name: `kd-tracker-captures` (globally unique — add a suffix if taken)
   - Files in Bucket are: **Private**
3. Note the bucket's **Endpoint** on its row, e.g. `s3.us-west-004.backblazeb2.com`.
   The region is the middle part: `us-west-004`.
4. **Account → Application Keys → Add a New Application Key**
   - Name: `kd-tracker`
   - Allow access to: **just `kd-tracker-captures`**
   - Type: **Read and Write**
   - Copy **keyID** and **applicationKey** (shown once).

**Hand over:** keyID, applicationKey, endpoint, region.

### 2. Code is already on GitHub

`github.com/mediakdmarketing-sys/kd-tracker`, branch `main`. Render and Vercel read
straight from it.

### 3. Render — backend  (10 min, no card)

1. [render.com](https://render.com) → **Sign in with GitHub**. No card on the free plan.
2. **New → Web Service** → connect the `kd-tracker` repo.
3. Settings:
   - Name: `kd-tracker-api`
   - Root Directory: `backend`
   - Runtime: Node
   - Build Command: `npm ci`
   - Start Command: `npm start`
   - Instance Type: **Free**
4. **Environment** → add:
   ```
   NODE_ENV=production
   NODE_OPTIONS=--dns-result-order=ipv4first
   DB_CLIENT=pg
   DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
   JWT_SECRET=<64 hex chars>
   JWT_REFRESH_SECRET=<different 64 hex chars>
   BCRYPT_ROUNDS=12
   ENABLE_SCHEDULER=true
   RETENTION_DAYS=7
   SCREENSHOT_MIN_INTERVAL_SEC=600
   SCREENSHOT_MAX_INTERVAL_SEC=1200
   STORAGE_DRIVER=s3
   S3_BUCKET=kd-tracker-captures
   S3_REGION=us-west-004
   S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com
   S3_ACCESS_KEY=<B2 keyID>
   S3_SECRET_KEY=<B2 applicationKey>
   CORS_ORIGINS=https://<your-vercel-domain>.vercel.app
   ```
   Generate each secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
5. Deploy. When live, note the URL: `https://kd-tracker-api.onrender.com`.
6. Migrations are already applied on Supabase — nothing to run. (If ever needed:
   Render **Shell** tab → `npm run db:migrate`.)

### 4. Vercel — web  (5 min, no card)

1. [vercel.com](https://vercel.com) → **Continue with GitHub**. No card.
2. **Add New → Project** → import `kd-tracker`.
3. Settings:
   - Root Directory: `web`
   - Framework Preset: Next.js (auto)
4. **Environment Variables:**
   ```
   API_BASE_URL=https://kd-tracker-api.onrender.com
   COOKIE_SECURE=1
   ```
5. Deploy → note the domain, e.g. `https://kd-tracker.vercel.app`.
6. Go back to Render and set `CORS_ORIGINS` to that exact domain; redeploy the backend.

### 5. cron-job.org — keep Render awake  (2 min, no card)

1. [cron-job.org](https://cron-job.org) → sign up.
2. **Create cronjob**
   - URL: `https://kd-tracker-api.onrender.com/health`
   - Schedule: every 10 minutes
3. Save + enable.

### 6. First admin user

Render **Shell** tab (or run locally with the production `DATABASE_URL`):

```bash
cd backend
cat > seed-admin.js <<'EOF'
require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, destroy } = require('./src/db');
(async () => {
  const now = Date.now();
  await db()('employees').insert({
    id: crypto.randomUUID(),
    name: 'KD Admin',
    email: 'admin@kdmarketing.in',
    password_hash: await bcrypt.hash('CHANGE_THIS_NOW', 12),
    role: 'admin', status: 'active', timezone: 'Asia/Kolkata',
    consent_monitoring: false, consent_audio: false,
    created_at: now, updated_at: now,
  });
  await destroy(); console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
EOF
node seed-admin.js && rm seed-admin.js
```

Log in at the Vercel domain, change the password, accept the consent screen.

### 7. Desktop agent

Point its API base URL at `https://kd-tracker-api.onrender.com`, rebuild, distribute
via GitHub Releases.

---

## When to move off free

- Render cold-starts annoy the team, or one always-on service isn't enough → a
  $4–6/mo VPS (Hetzner) or Oracle Always Free ($1 refundable hold), per
  [DEPLOYMENT.md](DEPLOYMENT.md).
- B2 storage nears 10 GB or egress caps bite → same move, with local-disk storage on
  the VM.
