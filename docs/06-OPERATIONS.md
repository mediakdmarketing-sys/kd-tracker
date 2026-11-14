# Operations and deployment

Current production shape: **web on Vercel, API on Render, PostgreSQL on Supabase, files on Cloudflare R2, email through Resend.**
An older all-in-one guide (Oracle VM, nginx) is in [DEPLOYMENT.md](DEPLOYMENT.md); the free-tier notes are in [DEPLOYMENT-FREE.md](DEPLOYMENT-FREE.md).

## 1. Run it locally

```bash
# terminal 1: API on :4000 (SQLite, demo data)
cd backend && npm install && cp .env.example .env && npm run db:reset && npm run dev

# terminal 2: portal on :3000
cd web && npm install && cp .env.example .env.local && npm run dev
```

Demo logins (password `Password123!`): HR `priya.raman@kdmarketing.in`, employees `karthik.s@…`, `sneha.iyer@…`.
Tests: `cd backend && npm test` (about 380 tests, several minutes) and `cd desktop-agent && npx vitest run`. Web build check: `cd web && npx next build` (delete `web/.next` first; on OneDrive a stale cache causes a false "no direct app page entry" error).

For a throwaway database use `DB_CLIENT=sqlite SQLITE_FILE=<path> STORAGE_DRIVER=local STORAGE_LOCAL_DIR=<dir> ENABLE_SCHEDULER=false` and `node src/db/cli.js migrate`. Never run local tests against the production `DATABASE_URL`.

## 2. Environment variables

### Backend (Render)
| Variable | Needed | Default | Meaning |
|---|---|---|---|
| `NODE_ENV` | yes | | `production` |
| `PORT` | | 4000 | |
| `DB_CLIENT`, `DATABASE_URL` | yes | sqlite | `pg` and the Supabase connection string |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | **yes** | | Long random values (48 bytes hex). The server refuses to start in production with weak ones |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | | 30m / 14d | |
| `REFRESH_GRACE_SECONDS` | | 120 | Rotation grace |
| `BCRYPT_ROUNDS` | | 10 | |
| `CORS_ORIGINS` | yes | | The portal's address(es) |
| `APP_TIMEZONE` | | America/New_York | Company clock |
| `STORAGE_DRIVER` | yes | local | `s3` for R2, with `S3_BUCKET`, `S3_REGION` (`auto`), `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), optional `S3_FORCE_PATH_STYLE` |
| `BANK_DATA_KEY` | for bank details | | 32 bytes (64 hex or base64) encrypting bank details. **Back it up.** Without it the feature is off (503) |
| `TOTP_ENCRYPTION_KEY` | optional | derived from `JWT_SECRET` | 64 hex characters; encrypts authenticator secrets. Set it so rotating `JWT_SECRET` does not break two-step |
| `BFF_KEY` | recommended | | Same value as on Vercel. Makes sign-in history show the real visitor address and browser |
| `TWO_STEP_MAX_BAD_CODES`, `TWO_STEP_LOCK_MINUTES` | | 5, 15 | Wrong-code limit |
| `RESEND_API_KEY`, `MAIL_FROM`, `PUBLIC_API_URL` | for email | | Resend key, a verified sender, the API's public address. Without them payslip and new-device emails are skipped |
| `ENABLE_SCHEDULER` | | true | `false` when more than one API instance runs |
| `CRON_PURGE`, `CRON_CLOSE_SHIFTS`, `CRON_PAYROLL`, `CRON_BIRTHDAYS` | | see [Workflows](02-WORKFLOWS.md#15-scheduled-jobs) | Cron expressions |
| `RETENTION_DAYS` | | 31 | First-run default; then edited in Settings |
| `SCREENSHOT_MIN/MAX_INTERVAL_SEC`, `AUDIO_SAMPLE_DURATION_SEC`, `AUDIO_SAMPLE_GAP_SEC` | | 300/600, 300, 480 | First-run defaults |
| `SHIFT_TARGET_SECONDS`, `BREAK_ALLOWANCE_SECONDS`, `IDLE_THRESHOLD_SECONDS`, `SHIFT_AUTO_CLOSE_HOURS`, `ZOOM_CAMERA_BREAK_MINUTES` | | 32400, 3600, 600, 16, 0 | First-run defaults |
| `PAYROLL_FULL_DAY_SECONDS`, `PAYROLL_HALF_DAY_SECONDS`, `PAYROLL_PAID_LEAVE_TYPES`, `PAYROLL_WORK_DAYS`, `PAYROLL_DEDUCT_IDLE` | | | First-run pay rules |
| `MAX_BACKDATE_HOURS`, `MAX_CAPTURE_AGE_DAYS`, `MAX_CLOCK_SKEW_SECONDS`, `MAX_UPLOAD_BYTES` | | 4, 7, small, ~5 MB | Offline contract and upload limit |
| `ENFORCE_DAY_OFF` | | true (off in tests) | Refuse punches on Sundays and holidays |

Settings marked "first-run defaults" are copied into the database the first time; after that HR edits them in **Settings** and the environment value is ignored.

### Web (Vercel)
| Variable | Meaning |
|---|---|
| `API_BASE_URL` | The API's address (server-side only) |
| `BFF_KEY` | Same as the backend |
| `COOKIE_SECURE` | `1` behind HTTPS (automatic in production builds) |
| `AGENT_DOWNLOAD_URL`, `…_MAC`, `…_MAC_ARM`, `…_LINUX`, `…_LINUX_DEB`, `…_APK`, `ANDROID_DOWNLOAD_URL` | Installer links; the download page also reads the latest builds from R2 |

### Desktop agent
`KD_UPDATE_URL` overrides the update feed; defaults live in `desktop-agent/src/config/defaults.json`.

## 3. Release checklist

**Before deploying the backend**
1. Take a database backup (Supabase point-in-time or a dump).
2. Run migrations on production **before** the new code starts: `node src/db/cli.js migrate`. The batch for the latest work is `20261112` to `20261120` (birthdays, bank details, account admin, break reason, Zoom minutes, workday hours, time corrections, leave allowances, sessions and two-step). All are additive.
3. Set new variables: `BANK_DATA_KEY` (and store a copy somewhere safe), `BFF_KEY` on **both** Render and Vercel with the same value, optionally `TOTP_ENCRYPTION_KEY`, and the Resend variables if email should work.
4. Deploy backend, then the web portal.

**After deploying**
1. Sign in as HR; Settings: set the **workday start and end** (needed for the "Who needs attention" punch times), leave allowances, and check the Zoom minutes (0 = off).
2. Set up **two-step for yourself first**, then decide whether to require it for admins.
3. Give an account admin the flag if payroll people exist (Employees, the person's page).
4. Check `/health` and `/health/jobs`; open the Audit log to see entries are being written.
5. Rotate any secret that was ever pasted into a chat or log (for example the Supabase password and Render `DATABASE_URL`).

**Agents**
- Existing desktop agents keep working (link scheme and app id unchanged). A new build carries the new name, logo, Zoom rule and notifications: build with `npm run build:win` (or the GitHub workflows `build-agent.yml`, `build-android.yml`), upload the installer, `.blockmap` and `latest.yml` to R2 with `scripts/publish-update.js`. Agents with auto-update install it only while punched out.
- An account with two-step on cannot sign in directly in the agent or Android app: the person signs in on the portal and connects from there.

## 4. Monitoring and routine care

| Check | How |
|---|---|
| API alive and database reachable | `GET /health` |
| Jobs ran | `GET /health/jobs`, and the `job_runs` table |
| Audit log writing | Admin, Audit log |
| Failed payslip emails | Payroll, payslip status (per person) |
| Mic problems | Mic log and notifications |
| Storage growth | R2 bucket size; the purge job removes files after retention |

Weekly: review flagged days and pending time corrections and leave; before payroll: clear flags, regenerate, finalize.

## 5. Backup and recovery

- **Database:** use the host's backups. Losing it loses attendance, leave and payroll.
- **Files:** R2 holds screenshots, audio, proofs, logo; screenshots and audio expire by design.
- **Keys:** `JWT_SECRET` (a change signs everyone out; and without `TOTP_ENCRYPTION_KEY` it also invalidates authenticator secrets), `BANK_DATA_KEY` (losing it makes saved bank details unreadable), `TOTP_ENCRYPTION_KEY`. Store copies in a password manager.
- **Restore test:** restore a backup into a throwaway database and run `node src/db/cli.js migrate` on it now and then.

## 6. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Portal shows an API unreachable error | Render service asleep or down; check `API_BASE_URL` and `/health`. First request after idle can take up to a minute on free hosting |
| Everyone sent to sign-in | `JWT_SECRET` changed, or the API restarted with a different secret |
| "This session was ended" | The session was signed out from another device, by HR, or by a password change |
| Admin stuck on Security page | HR requires two-step and that admin has not set it up; they set it up there, or an account admin does a reset for someone who cannot |
| Locked out of two-step | Use a recovery code; else an account admin resets it on the employee page |
| "Too many wrong codes" | Wait for the 15-minute window, or use a recovery code |
| Sign-in history shows the portal server's address | `BFF_KEY` missing or different on one side |
| Bank details answer "switched off" | `BANK_DATA_KEY` not set on the API |
| Payslip emails do nothing | Resend not configured (`RESEND_API_KEY`, `MAIL_FROM`) or the sender is not verified |
| Punched in, no screenshots | Agent not running or signed in, person on a break, or consent missing; on macOS the Screen Recording permission (screenshots are blank without it) |
| Zoom rule does nothing | Not Windows, minutes still 0, person not punched in and working, or Windows blocked the check |
| Payroll month refuses a change | It is finalized: Reopen first |
| Build says "no direct app page entry for /_not-found" | Stale `.next` on OneDrive; delete `web/.next` and rebuild |
| Tests time out only in the full run | The machine is busy; run the failing file alone, or add `--testTimeout=60000` |
