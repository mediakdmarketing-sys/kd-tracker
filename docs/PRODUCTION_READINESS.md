# Production Readiness Report — KD Tracker

**Date:** 2026-09-05
**Scope:** Backend API, Web Portal, Desktop Agent (core logic)
**Prepared for:** Go/no-go decision on production rollout

---

## 1. Overall assessment

| Component | Status | Confidence |
|---|---|---|
| Backend API | ✅ Production-ready | High — 107 automated tests, live-verified, two audit passes |
| Web Portal | ✅ Production-ready | High — builds clean, session/security fixes verified live |
| Desktop Agent (logic) | ✅ Code complete | High — 54 tests, live-verified against the real API |
| Desktop Agent (packaged installer) | 🟡 **Not built** | Blocked on a native-module rebuild toolchain — see §6 |

**Recommendation:** Backend + Web Portal can go to production now. The desktop agent's
*logic* is done and tested; do not ship a packaged installer built on a machine that skipped
the native-module rebuild step (§6) — it will crash on launch.

---

## 2. What changed in this audit pass

A full read-through of every backend module, every web request-handling path, and the
desktop agent's core, specifically hunting for concurrency bugs, silent data loss, and
session-handling gaps that unit tests in isolation don't naturally surface. **10 real defects**
found and fixed, all with regression tests, three confirmed against the live server with real
concurrent HTTP requests (not just in-process simulation).

### Concurrency / race conditions (the largest category)

| # | Where | The bug | The fix |
|---|---|---|---|
| 1 | `attendance.service.js` `punchIn()` | Two punch-in requests landing close together (double-click, a client retry, the agent and the web portal both firing) could **both** pass the "no open shift exists" check before either wrote — SQLite's transaction is deferred and takes no write lock until the INSERT. Result: two `open` shifts for the same employee. | Added a **database-level partial unique index** (`attendance(employee_id) WHERE status IN ('open','on_break')`) — a real constraint, not just an application check. The service catches the violation and returns the same clean 409 the non-racing path already gives. **Verified live**: 5 concurrent real HTTP punch-ins → exactly one 201, four 409s, one row in the database. |
| 2 | `closeShifts.job.js` (the stale-shift sweeper) | The hourly sweep reads a batch of stale shifts, then loops through several more queries per shift before its own `UPDATE`. If the employee genuinely punched out for real in that window, the sweep's **unconditional** write silently overwrote their real punch-out with its own estimate — flagging a normal day as `auto_closed`/"never punched out" and recording the wrong worked-hours. | Re-reads each shift immediately before acting on it, and guards the final `UPDATE` with `WHERE status IN ('open','on_break')` — if a real punch-out already closed it, the guarded write matches zero rows and is skipped instead of clobbering. |
| 3 | `admin.service.js` `createEmployee()` | Same check-then-insert race on the work-email uniqueness check: two admins (or a double-click) creating the same email at once could both pass the pre-check, and the loser hit a raw 500 instead of the friendly "already exists" the non-racing path returns. | Catch the database's unique-constraint violation and convert it to the same 409. |
| 4 | `payroll.service.js` `generate()` | Same pattern again: two `POST /api/payroll/generate` calls for the same month racing on the per-employee upsert could 500 on the loser instead of the intended idempotent overwrite. | Catch the violation, fall back to the update the winner's insert should have raced against. |

### Data loss / silent-failure bugs

| # | Where | The bug | The fix |
|---|---|---|---|
| 5 | `jobRunner.js` | A job that fails partway through a batch (retention purge failing to delete some files) attaches exactly which items succeeded and failed via `err.details`/`err.partialResult` — the generic catch handler discarded both, keeping only the top-level error message. An operator looking at `job_runs` for a failed purge had no way to tell *which* files failed without digging through raw server logs. | Both fields are now preserved in the stored job-run details, and the partial success count is surfaced on the row itself. |
| 6 | `payroll.service.js` `markSynced()` | `employeeIds?.length` is falsy for both `undefined` *and* `[]` — an explicit empty array ("these zero employees") was silently treated the same as "mark the whole month synced." | Distinguishes `undefined` (whole month) from an explicit `[]` (no-op) with an `Array.isArray` check. |

### Session-handling gaps (web portal)

| # | Where | The bug | The fix |
|---|---|---|---|
| 7 | `web/lib/api.js` (server-side page data) | An employee deactivated mid-session gets a `403 ACCOUNT_DEACTIVATED` — not a `401` — because the access token itself hasn't expired yet, so the middleware's time-based refresh check never notices. The old code only redirected to `/login` on `401`, so a deactivated employee hit the generic crash-page error boundary instead of a clean sign-in prompt. | Redirects to `/login` on either `401` or the `ACCOUNT_DEACTIVATED` code. |
| 8 | `web/lib/client.js` (browser-side actions) | Same gap on the client side: clicking punch/report actions after deactivation showed an inline error banner and left the employee stuck on a dead page instead of returning them to sign-in. | Same check, centralised in the one function every browser-side call goes through — navigates to `/login` directly. |
| 9 | `web/middleware.js` | The in-flight cookie rewrite during a token refresh hardcoded a 30-minute access-token lifetime instead of using the actual value the API returned — harmless only because nothing downstream read that specific value within the same request, but it would have silently drifted from reality the moment `JWT_EXPIRES_IN` was ever changed from its default. | Computed from the real `expiresIn` the refresh response returned, using the same formula the persisted cookie already uses. |

### UI

| # | Where | The change |
|---|---|---|
| 10 | `web/app/globals.css`, `desktop-agent/src/renderer/popup.html` | Both surfaces auto-switched between light and dark palettes based on the OS/browser preference. Converted to **light-only** by request — `color-scheme: light` and the `prefers-color-scheme: dark` blocks removed. Verified: portal renders light even with the browser forced into dark mode. |

All fixes ship with regression tests. Backend: **107/107 passing** (was 98 before this pass).
Desktop agent core: **54/54 passing** (unaffected — no agent-core bugs found in this specific
pass beyond the earlier Sprint 7 review, see §5).

---

## 3. Test coverage summary

| Suite | Count | What it covers |
|---|---|---|
| Backend (`backend/tests/*`) | 107 | Auth & sessions, attendance & breaks, capture ingest & replay protection, retention purge, payroll, admin/reports/audit, job runner, multi-display capture |
| Desktop agent core (`desktop-agent/tests/*`) | 54 | Outbox durability, upload classification/retry, scheduling, session death handling, punch queueing |
| Web portal | No automated tests | Build passes; verified manually via browser automation (login, punch flow, admin dashboard, screenshot viewer, payroll generation, light-theme rendering under forced dark mode) |

**Gap to flag:** the web portal has zero automated tests. Everything about it was verified by
hand in this session (repeatedly, across several rounds of fixes) rather than by a suite that
runs on every change. This is the single biggest gap between "looks right today" and "stays
right after the next change" — see §7.

---

## 4. Security posture

- Passwords hashed with bcrypt; login gives an identical response/timing shape for an unknown
  email and a wrong password (no account-enumeration oracle).
- Session tokens live in `httpOnly` cookies behind a server-side proxy — never in
  `localStorage`, never readable by page JavaScript (ADR-0003).
- Refresh token rotation with a short grace window for legitimate retries; reuse outside the
  window revokes every session for the account (ADR-0004), now correctly triggered for the
  `ACCOUNT_DEACTIVATED` case too (found and fixed during Sprint 7's pre-packaging review).
- Role checks are enforced server-side on every request against the current database row, not
  trusted from a JWT claim — a role or status change takes effect on the very next request.
- CSV exports are guarded against formula injection (a cell starting `=`, `+`, `-`, `@` is
  neutralised).
- Rate limiting on login and uploads.
- Audit log for every admin view of a screenshot or audio file; append-only.
- Consent is enforced server-side, not just hidden in the client: no audio upload is accepted
  without `consent_audio = true` on the employee row, re-checked on every request.

**Before a public-internet deployment** (this was built assuming an internal/VPN-reachable
API): rotate `JWT_SECRET`/`JWT_REFRESH_SECRET` to strong generated values (the config layer
already refuses to start in `NODE_ENV=production` with the default dev secrets), confirm
`CORS_ORIGINS` is locked to the real portal domain, and put TLS in front of both the API and
the portal.

---

## 5. What was already fixed before this session's final audit pass

For context, these were found and fixed earlier in the same build, during the desktop agent's
own pre-packaging code review — listed here so this report is a complete record in one place:

- A session killed server-side (HR deactivation, a password reset) never demoted the agent's
  local "signed in" state — the tray kept showing "working" indefinitely with nothing telling
  the employee to sign back in.
- A `409` on a screenshot/audio upload was treated as "already delivered" and the item deleted
  with no trace — but for captures (unlike punch events) a `409` only ever means the capture's
  timestamp falls outside any valid shift/break window, a permanent rejection most likely
  caused by a queued punch-in getting capped under the 4-hour backdating rule.
- Tray/popup queue-depth display lagged up to 60 seconds behind the real queue because the
  uploader's fresh stats were discarded by the wiring.
- The backend's `ACCOUNT_DEACTIVATED` distinct error code (added specifically so the above
  fixes could tell "this whole account is dead" apart from an ordinary per-action `403`) is
  also what made bugs #7 and #8 in this pass fixable at all — without it, the web portal would
  have had no reliable signal to redirect on either.

---

## 6. Desktop agent packaging — the one open item

The agent's logic is done, tested, and verified against the live API (offline queueing,
multi-display capture, replay protection, session handling). **Producing an actual installer
is blocked**: `better-sqlite3`'s bundled Windows binary crashes the whole Electron process —
uncatchable, no JS error at all — the instant it opens a database, confirmed against both
Electron 33 and Electron 30 on the machine this was built on.

The fix is standard for native Node modules under Electron: rebuild the module against
Electron's own headers, which needs a C++ toolchain.

| Platform | What's needed |
|---|---|
| Windows | Visual Studio **Build Tools** — "Desktop development with C++" workload. **Not** the Visual Studio IDE, and unrelated to any code editor (VS Code included) — it is a command-line compiler toolchain. `winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"` |
| macOS | `xcode-select --install` |
| Linux | `build-essential` (Debian/Ubuntu) or the distro equivalent |

**By explicit customer decision, this toolchain was not installed on the build machine used
for this project** — a multi-GB system-wide install, deferred to whichever machine actually
produces the packaged build (IT's build box, or CI). Everything else needed to package is
already in place: `electron-builder.yml` is configured for Windows (NSIS), macOS (dmg,
unsigned — no Developer ID configured), and Linux (AppImage + deb); a placeholder icon is
generated. Full detail and the exact commands:
[`desktop-agent/README.md`](../desktop-agent/README.md#️-native-module-better-sqlite3-needs-a-real-rebuild-for-electron-on-windows).

**Whoever picks this up:** install the toolchain, run `npm run rebuild:native` inside
`desktop-agent/`, then `npm start` and confirm the tray icon actually appears before trusting
any packaged build.

---

## 7. Known limitations & recommended follow-ups

Not blockers for the backend/web rollout, but worth planning for:

| Item | Why it matters | Suggested priority |
|---|---|---|
| No automated web-portal tests | Every UI verification in this session was manual; a future change could regress silently | High — before the next feature sprint |
| Idle time reported but not deducted from pay | Open product question (documented in `PRODUCT_BACKLOG.md`); payroll currently pays for idle time inside a shift | Needs a Product Owner decision |
| `admin.report()`/`detailedReport()` count an in-progress (still-open) shift as "present" but contribute 0 worked seconds to it, unlike `payroll.generate()` which excludes open shifts entirely | A report pulled mid-day for a range including today can look like someone worked 0 hours on a day they are, in fact, still working | Low — cosmetic on a live-data report; the Live Board already shows correct in-progress hours |
| Refresh-token cookie lifetime is hardcoded to match the backend's *default* `JWT_REFRESH_EXPIRES_IN` rather than reading it from the API | Only manifests if that environment variable is ever changed from its default without a matching frontend update | Low |
| Google/Microsoft SSO, live payroll provider push, Socket.io live dashboard push | All deliberately deferred (see `PRODUCT_BACKLOG.md`) — routes exist and return a clear `501` where relevant | As prioritised by the Product Owner |
| Desktop agent packaging | See §6 | Blocks a real installer only — does not block backend/web go-live |

---

## 8. Deployment checklist

- [ ] `NODE_ENV=production` on the API; confirm it refuses to start with default JWT secrets
      (it does, by design — see `src/config/index.js`)
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` set to strong, generated values (32+ chars)
- [ ] `DB_CLIENT=pg` + `DATABASE_URL` if moving off SQLite for this deployment (optional —
      SQLite is a supported single-instance choice; see ADR-0001)
- [ ] `CORS_ORIGINS` set to the real portal origin only
- [ ] `STORAGE_DRIVER=s3` + bucket credentials if not using local disk (required for anything
      beyond a single API instance)
- [ ] TLS in front of both the API and the portal; `COOKIE_SECURE=1` on the portal
- [ ] `ENABLE_SCHEDULER` confirmed on exactly one instance if running more than one API process
- [ ] `/health/jobs` wired into whatever external monitor watches this service — it returns
      `503` if the retention purge hasn't succeeded in 48 hours
- [ ] Seed/demo data **not** run against production (`db:seed` refuses to run with
      `NODE_ENV=production`, by design)
- [ ] Desktop agent: do not distribute an installer built on a machine that could not run
      `npm run rebuild:native` successfully (§6)
