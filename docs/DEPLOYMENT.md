# Deployment — Oracle Cloud (Always Free) + Supabase + Cloudflare R2

Target topology, all on free tiers:

| Component | Where | Notes |
|---|---|---|
| Backend API (`backend/`) | Oracle VM, port 4000, pm2 | Always on, runs the cron jobs |
| Web portal (`web/`) | Same Oracle VM, port 3000, pm2 | Next.js `start` |
| nginx | Same VM | TLS + reverse proxy for both hostnames |
| PostgreSQL | Supabase free | Pooler connection string (IPv4) |
| Screenshots / audio | Cloudflare R2 | S3-compatible, 10 GB free, zero egress fees |

Two DNS names point at the VM:
`app.example.com` → web (3000), `api.example.com` → backend (4000).
The desktop agent talks to `api.example.com` directly, so the backend must be public.

---

## 1. Cloudflare R2 bucket

1. Cloudflare dashboard → **R2** → *Create bucket* → name `kd-tracker-captures`, location Automatic.
2. **R2 → Manage R2 API Tokens → Create API token**
   - Permissions: **Object Read & Write**
   - Scope: the one bucket
   - Copy **Access Key ID**, **Secret Access Key**, and the **endpoint**
     `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
3. (Optional) Bucket → Settings → **Object lifecycle rule**: delete objects after
   31 days — mirrors `RETENTION_DAYS` so nothing lingers if the purge job misses a run.

No public access, no custom domain — the backend streams every file itself behind an
audit log.

**Free-tier fit:** ~60 employees × screenshots every 5–10 min + 5-min audio samples,
31-day retention ≈ 25–40 GB — over the 10 GB free storage. To stay free, lower capture
frequency and retention in the backend `.env`:

```
RETENTION_DAYS=7
SCREENSHOT_MIN_INTERVAL_SEC=600
SCREENSHOT_MAX_INTERVAL_SEC=1200
AUDIO_SAMPLE_GAP_SEC=900
```

That lands around 6–9 GB. Class-A operations (writes) free allowance is 1M/month —
60 employees × ~120 writes/day ≈ 216k/month, well under.

---

## 2. Oracle VM

1. [cloud.oracle.com](https://cloud.oracle.com) → sign up (card for identity check, not billed).
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 22.04**
   - Shape: **VM.Standard.A1.Flex** (Ampere ARM) — Always Free covers 4 OCPU / 24 GB.
     Start with 2 OCPU / 12 GB.
   - Boot volume: 100–150 GB (Always Free allows up to 200 GB total).
   - Add your SSH public key.
3. **VCN → Security List → Ingress rules**: allow TCP 80 and 443 from `0.0.0.0/0`
   (22 is open by default).
4. SSH in: `ssh ubuntu@<public-ip>`
5. Open the host firewall too (Oracle images ship with iptables locked down):

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

---

## 3. Server setup

```bash
# Node 20 LTS (ARM build from NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential python3 nginx certbot python3-certbot-nginx git
sudo npm install -g pm2

# swap — 12 GB RAM is plenty but a build spike shouldn't OOM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

---

## 4. Deploy the app

```bash
cd /opt && sudo git clone <your-repo-url> kd-tracker && sudo chown -R ubuntu:ubuntu kd-tracker
cd /opt/kd-tracker
```

### Backend

```bash
cd /opt/kd-tracker/backend
npm ci --omit=dev            # installs pg + @aws-sdk/client-s3 (optionalDependencies)
cp .env.example .env
nano .env
```

```ini
NODE_ENV=production
PORT=4000
CORS_ORIGINS=https://app.example.com

DB_CLIENT=pg
DATABASE_URL=postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres

# generate each: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
JWT_SECRET=<64+ hex chars>
JWT_REFRESH_SECRET=<different 64+ hex chars>
BCRYPT_ROUNDS=12

STORAGE_DRIVER=s3
S3_BUCKET=kd-tracker-captures
S3_REGION=auto
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY=<R2 access key id>
S3_SECRET_KEY=<R2 secret access key>

ENABLE_SCHEDULER=true
RETENTION_DAYS=7
```

Migrations are already applied on this Supabase project. If you ever move to a fresh
project: `NODE_OPTIONS=--dns-result-order=ipv4first npm run db:migrate`.

Smoke-test storage + DB before starting under pm2:

```bash
node -e "require('dotenv').config();const{storage}=require('./src/storage');(async()=>{await storage().put('healthcheck/ping.txt',Buffer.from('ok'),'text/plain');console.log('R2 write OK');await storage().remove('healthcheck/ping.txt')})().catch(e=>{console.error(e);process.exit(1)})"
```

```bash
pm2 start "npm start" --name kd-api --time
```

### Web

```bash
cd /opt/kd-tracker/web
npm ci
cp .env.example .env.local
nano .env.local
```

```ini
API_BASE_URL=https://api.example.com
COOKIE_SECURE=1
```

```bash
npm run build
pm2 start "npm start" --name kd-web --time
pm2 save
pm2 startup    # run the command it prints
```

---

## 5. DNS + nginx + TLS

Point both A records at the VM's public IP (Cloudflare DNS is fine — set the records
to **DNS only / grey cloud** for `api` so the agent gets a direct TLS connection; `app`
can be proxied/orange if you want).

`/etc/nginx/sites-available/kd-tracker`:

```nginx
server {
  listen 80;
  server_name app.example.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  listen 80;
  server_name api.example.com;
  client_max_body_size 10m;          # capture uploads
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kd-tracker /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d app.example.com -d api.example.com
```

Certbot rewrites the config for 443 and installs a renewal timer.

---

## 6. First admin user

The Supabase DB has schema but no seeded logins. Create one real admin with a short
script (uses the backend's own bcrypt settings):

```bash
cd /opt/kd-tracker/backend
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
    email: 'admin@example.com',
    password_hash: await bcrypt.hash('CHANGE_THIS_NOW', 12),
    role: 'admin',
    status: 'active',
    timezone: 'Asia/Kolkata',
    consent_monitoring: false,
    consent_audio: false,
    created_at: now,
    updated_at: now,
  });
  await destroy();
  console.log('admin created');
})().catch((e) => { console.error(e); process.exit(1); });
EOF
node seed-admin.js && rm seed-admin.js
```

Then log in at `https://app.example.com/login` and change the password. An admin still
has to accept the consent screen once before the dashboard opens.

---

## 7. Desktop agent

In `desktop-agent/` config, set the API base URL to `https://api.example.com`, rebuild
the installer (needs the C++ toolchain per `desktop-agent/README.md`), and distribute via
GitHub Releases.

---

## 8. Ongoing

```bash
pm2 logs kd-api            # tail backend
pm2 monit                  # cpu / mem
cd /opt/kd-tracker && git pull && \
  (cd backend && npm ci --omit=dev) && \
  (cd web && npm ci && npm run build) && \
  pm2 restart kd-api kd-web
```

- **Supabase free** pauses a project after 7 days of no activity — the cron jobs hitting
  it hourly keep it awake.
- Watch R2 storage in the Cloudflare dashboard; if it approaches 10 GB, lower
  `RETENTION_DAYS` further or add the lifecycle rule.
- Back up the `.env` files somewhere safe — they hold the only copy of the JWT secrets.
