# Sprint Plan

**Cadence:** 1-week sprints. **Team assumption:** 2–3 devs.
**Definition of Done:** see [DEFINITION_OF_DONE.md](DEFINITION_OF_DONE.md).

Each sprint ships a working, demoable increment. Nothing is "done" in a later sprint that a
stakeholder cannot click through at the end of this one.

| Sprint | Goal (demoable increment) | Status |
|---|---|---|
| 0 | Repo, toolchain, portable DB layer, migrations, seed data | ✅ Done |
| 1 | Auth + employees + consent capture (vertical slice, login → token → me) | ✅ Done |
| 2 | Attendance: punch in/out, breaks, over-break flag, idle detection | ✅ Done |
| 3 | Capture ingest: screenshots, audio (consent-gated), activity counters | ✅ Done |
| 4 | Admin dashboard API, reports, CSV export, audit logs, live status | ✅ Done |
| 5 | Payroll summary + export, 31-day retention job, scheduler | ✅ Done |
| 6 | Web portal (Next.js): Admin + User views on the live API | ✅ Done |
| 6.5 | Offline contract: idempotent uploads, refresh grace, queued punch events | ✅ Done |
| 6.6 | Multi-display capture: one row per monitor, grouped | ✅ Done |
| 7 | Desktop agent (Electron): tray, capture, retry-safe uploader | 🟡 Code complete, packaging blocked |
| 8 | ChromeOS extension (MV3), pilot rollout, hardening | ⬜ Planned |

---

## Sprint 0 — Foundation

**Sprint goal:** A running API process with a migrated, seeded database that a developer can
hit in under two minutes, and that can move to PostgreSQL without a rewrite.

| ID | Story | Points | Status |
|---|---|---|---|
| F-1 | As a dev, I can install and run the API with one command | 2 | ✅ |
| F-2 | As a dev, schema changes ship as reversible migrations | 3 | ✅ |
| F-3 | As an architect, I can swap SQLite → Postgres via config only | 5 | ✅ |
| F-4 | As a dev, seed data gives me an admin + realistic employees | 2 | ✅ |
| F-5 | As an operator, the API exposes a health endpoint and structured errors | 2 | ✅ |

**Sprint review notes:** timestamps are stored as epoch-milliseconds integers and dates as
`YYYY-MM-DD` text — the one deliberate deviation from the spec's `TIMESTAMP`/`DATE` types, taken
so SQLite and Postgres behave identically. Rationale in ADR-0001.

---

## Sprint 1 — Identity & consent

**Sprint goal:** An employee logs in with their work email and records consent; nothing that
captures data will run until they have.

| ID | Story | Points | Status |
|---|---|---|---|
| A-1 | Login with work email + password, receive a short-lived JWT | 3 | ✅ |
| A-2 | Refresh token flow so the agent survives an 9-hour shift | 3 | ✅ |
| A-3 | `GET /api/auth/me` returns profile, role and consent state | 1 | ✅ |
| A-4 | Consent screen contract: what is captured is returned by the API | 3 | ✅ |
| A-5 | Recording consent stamps `consent_given_at`; revocation supported | 3 | ✅ |
| A-6 | Role-based access enforced server-side on every admin route | 3 | ✅ |
| A-7 | Login rate-limited; password hashes are bcrypt | 2 | ✅ |

**Deferred:** Google/Microsoft SSO (A-8). The callback route exists and returns 501 with a
clear message; wiring it needs the customer's IdP tenant, which is not available yet.

---

## Sprint 2 — Attendance

**Sprint goal:** An employee can complete a full shift and see accurate worked time.

| ID | Story | Points | Status |
|---|---|---|---|
| T-1 | Punch in — rejected if a shift is already open, or consent missing | 3 | ✅ |
| T-2 | Punch out — computes worked seconds net of breaks | 3 | ✅ |
| T-3 | Multiple breaks per day via a `breaks` table | 5 | ✅ |
| T-4 | Over-break (>1h) flags the day for HR review | 2 | ✅ |
| T-5 | Idle detection: no activity for N minutes marks idle, not break | 5 | ✅ |
| T-6 | `GET /api/attendance/me` history with pagination | 2 | ✅ |
| T-7 | Auto-close shifts left open overnight, flagged for HR | 3 | ✅ |

---

## Sprint 3 — Capture ingest

**Sprint goal:** The agent can upload what it captures, and the backend refuses anything it
does not have consent for.

| ID | Story | Points | Status |
|---|---|---|---|
| C-1 | Storage abstraction: local disk now, S3 later, same interface | 5 | ✅ |
| C-2 | Screenshot upload, rejected when no shift is open or on break | 3 | ✅ |
| C-3 | Audio upload hard-gated on `consent_audio` server-side (403) | 3 | ✅ |
| C-4 | Activity counters (keystroke/mouse counts only — never content) | 3 | ✅ |
| C-5 | Batch activity endpoint so an offline agent can drain its queue | 3 | ✅ |
| C-6 | Upload rate limits and payload size caps | 2 | ✅ |

---

## Sprint 4 — Admin dashboard

**Sprint goal:** HR can answer "who is working right now" and "export last month".

| ID | Story | Points | Status |
|---|---|---|---|
| D-1 | Live dashboard: who is online, on break, punched out | 5 | ✅ |
| D-2 | Reports filtered by date range and department | 3 | ✅ |
| D-3 | CSV export of a report | 2 | ✅ |
| D-4 | Every admin view of a screenshot/audio writes an audit log row | 3 | ✅ |
| D-5 | Audit log is itself viewable (and not editable) by admins | 2 | ✅ |
| D-6 | Employee CRUD for HR | 3 | ✅ |

**Deferred:** Socket.io live push (D-7). The dashboard endpoint is poll-friendly and cheap;
real-time is only worth its complexity once the web portal exists in Sprint 6.

---

## Sprint 5 — Payroll & retention

**Sprint goal:** Month-end runs itself, and nothing captured outlives 31 days.

| ID | Story | Points | Status |
|---|---|---|---|
| P-1 | Generate `payroll_summary` for a month, idempotently | 5 | ✅ |
| P-2 | Export payroll as CSV | 2 | ✅ |
| P-3 | 31-day purge deletes *files*, retains rows | 5 | ✅ |
| P-4 | Scheduler runs purge daily and payroll monthly | 3 | ✅ |
| P-5 | Purge failures are loud (job run log + non-zero exit) | 3 | ✅ |

**Deferred:** live push to a payroll provider (P-6) — needs Zoho/GreytHR credentials and a
sandbox tenant. CSV export is the interim path and is what the client asked to start with.

---

## Sprint 6 — Web portal

**Sprint goal:** Everything built in sprints 1–5 is usable by a person, not just by curl.

| ID | Story | Points | Status |
|---|---|---|---|
| W-1 | Next.js app, login, session handling, role-gated routing | 5 | ✅ |
| W-2 | User portal: punch in/out, breaks, live shift clock, own history | 5 | ✅ |
| W-3 | Consent screen that blocks the first punch-in | 3 | ✅ |
| W-4 | Admin live board: who is working, on break, idle, flagged | 5 | ✅ |
| W-5 | Admin reports with filters + CSV export | 5 | ✅ |
| W-6 | Screenshot/audio viewer, audit-logged per view | 5 | ✅ |
| W-7 | Employee administration: create, deactivate, reset password | 3 | ✅ |
| W-8 | Payroll: generate a month, review, export | 3 | ✅ |
| W-9 | Audit log browser | 2 | ✅ |

**Sprint review notes:**

- Tokens live in `httpOnly` cookies behind a BFF proxy, not in `localStorage`, and refresh
  happens in middleware. Rationale in ADR-0003.
- Screenshot tiles load on click rather than automatically — auto-loading a grid of thumbnails
  wrote one audit row per thumbnail and drowned the deliberate views. Also in ADR-0003.
- Two defects found and fixed while demoing: the seed put today's shifts in the *future*
  (so the live board showed nobody working and no captures), and an open shift rendered as
  "0m worked" because `total_worked_seconds` is only written at punch-out.
- `/api/attendance/status` gained `breakAllowanceSeconds` and `overBreak`: once the break is
  over the allowance, `breakRemainingSeconds` is clamped to 0 and the client could not tell
  what the allowance had been, so the UI read "1h 29m of 1h 29m".

**Deferred:** Socket.io live push (I-3) — the board polls every 20 seconds, which is
comfortably fresh for a 60-person team and needs no reconnect handling.

## Sprint 6.5 — Offline contract

**Sprint goal:** The API behaves correctly for a client on an unreliable home connection, so
the agent can be written against a stable contract instead of working around gaps in it.

Raised after a stakeholder question — *what happens when an employee's network is unstable?* —
which surfaced five gaps. Full reasoning in [ADR-0004](adr/0004-offline-contract.md).

| ID | Story | Points | Status |
|---|---|---|---|
| O-1 | `captureId` makes screenshot, audio and activity uploads idempotent | 5 | ✅ |
| O-2 | Rotated refresh tokens stay valid for a grace window; reuse after it revokes the account's sessions | 5 | ✅ |
| O-3 | Client timestamps validated: future rejected, stale captures rejected, order enforced | 3 | ✅ |
| O-4 | Punch events may be backdated up to 4h; beyond that the server's time is used and the shift is flagged | 5 | ✅ |
| O-5 | Upload rate limit raised to 240/hour so a full-day drain does not stall | 1 | ✅ |

**Sprint review notes:**

- Product owner set the backdating limit at **4 hours** and chose *accept + cap + flag* over
  rejecting queued punches outright.
- The replay check sits **before** the open-shift rule (so a replay after punch-out is not
  rejected forever) but **after** the audio consent gate (so a sample queued before consent was
  withdrawn is still refused). That ordering is the whole design.
- A defect in the first cut of the grace window: revoking a session set `revoked_at` to *now*,
  which put the token inside its own grace window and kept it alive for another two minutes.
  Fixed by recording `revoked_reason` — only `rotated` is eligible for grace. Two regression
  tests cover sign-out and HR deactivation.
- 89 tests passing (was 70).

## Sprint 6.6 — Multi-display capture

**Sprint goal:** An employee with an external monitor is fully covered, and the viewer shows a
capture as the set of screens it actually was.

Raised by a stakeholder question — *does tracking still work with an external monitor?* The
answer was "only if we build it that way", and it had to be settled before the agent's uploader
existed. Reasoning in [ADR-0005](adr/0005-multi-display-capture.md).

| ID | Story | Points | Status |
|---|---|---|---|
| M-1 | `capture_group_id`, `display_index`, `display_count`, `display_label` on screenshots | 3 | ✅ |
| M-2 | Upload accepts display metadata; one request per display | 3 | ✅ |
| M-3 | Listing returns grouped-friendly ordering; viewer renders a capture as N screens | 5 | ✅ |
| M-4 | Seed data gives a third of employees two monitors | 1 | ✅ |
| M-5 | Retention purges every display of a group independently | 2 | ✅ |

**Sprint review notes:**

- Found while fixing a test that only failed after midnight IST: **the live board dropped
  anyone whose shift began before midnight in their own timezone.** It filtered by calendar
  date, so a night-shift employee showed as "not started" while they were still working. The
  board now includes every open shift whatever date it belongs to, flagged `overnight` with its
  `shiftDate`. Regression test added. This was a real defect, not a test artefact.
- One flaky full-suite run: a test timed out under load, and because vitest does not cancel the
  overrunning request, its `truncate` ran underneath the next test and produced unrelated
  foreign-key failures. Raised the timeout and capped worker threads.
- 95 tests passing (was 89).

## Sprint 7 — Desktop agent

**Sprint goal:** Electron tray app: punch controls, randomised 5–10 min screenshots (every
display, ADR-0005), consent-gated audio sampling (5 min record / 8 min gap), activity
counters, retry-safe batched uploader built on the offline contract (Sprint 6.5).

| ID | Story | Points | Status |
|---|---|---|---|
| G-1 | Tray app shell: punch in/out, break, live status | 5 | ✅ |
| G-2 | Local durable queue (SQLite) for punch events, captures and activity | 8 | ✅ |
| G-3 | Every queued item carries a `captureId` and its original timestamp | 3 | ✅ |
| G-4 | Uploader with exponential backoff; honours `429` and never drops an item | 5 | ✅ |
| G-5 | Randomised screenshot scheduling from `/api/config`; nothing during a break | 5 | ✅ |
| G-6 | Consent-gated audio sampling, non-overlapping | 5 | ✅ |
| G-7 | Activity counters via native hooks — counts only, never content | 5 | ✅ |
| G-8 | Visible state: tray icon shows when capture is active, and when the queue is backed up | 3 | ✅ |
| G-9 | Packaging: Windows, macOS (dmg), Linux (AppImage/deb) | 5 | 🟡 Config done, unverified |

**Sprint review notes:**

- `src/core/*` (all the actual decision logic — punch queueing, upload classification,
  scheduling, session handling) has no Electron dependency and is unit-tested directly: 46
  tests initially, growing to **54** after the code review below. `src/main/*` is thin wiring
  by design — screen/mic/input access, tray, IPC — so almost nothing needed an Electron test
  harness.
- **Code review before packaging found and fixed 4 real bugs**, three from manual review and
  one surfaced only by live-verifying the first fix against the running backend:
  1. A session killed server-side (HR deactivation, a password reset) never demoted
     `agent.state.signedIn` — the tray kept showing "working" forever with nothing telling the
     employee to sign back in, and every future capture silently queued and was never
     delivered.
  2. A 409 on a screenshot/audio upload was treated as "already delivered" and the item
     deleted with zero trace — but for captures (unlike punch events) 409 only ever means the
     capture's timestamp falls outside any shift/break window, a permanent rejection most
     likely caused by a queued punch-in getting capped under the 4-hour rule (ADR-0004). Now
     abandoned with a visible reason instead of vanishing.
  3. Tray/popup queue-depth display lagged up to 60s behind the actual queue because the
     uploader's fresh stats were discarded by the wiring in `main/index.js`.
  4. **Found while verifying fix #1 live**: a deactivated employee's still-valid access token
     gets `403`, not `401` (the row-status check runs on every request, independent of JWT
     expiry) — using the *same* generic `FORBIDDEN` code as an ordinary per-action 403 (e.g.
     audio consent withdrawn), so the fix for #1 couldn't tell the two apart. Backend now
     raises a distinct `ACCOUNT_DEACTIVATED` code (`utils/errors.js`, `middleware/auth.js`);
     the uploader treats it as an account-wide signal instead of a per-item rejection.
- **Packaging is configured but not verified on this project's build machine.** Windows,
  macOS and Linux targets are all set up in `electron-builder.yml`, and a placeholder icon is
  generated (`build/generate-icon.js`) — but `better-sqlite3`'s bundled Windows binary crashes
  the whole process, uncatchable, the instant it opens a database inside Electron, on both
  Electron 33 and 30. The fix is the standard one (rebuild the native module against
  Electron's headers), but needs a C++ toolchain (Visual Studio Build Tools on Windows) that,
  by the customer's explicit choice, was not installed on this machine — deferred to whichever
  machine does the actual packaging. Full detail and the exact fix command:
  [desktop-agent/README.md](../desktop-agent/README.md#️-native-module-better-sqlite3-needs-a-real-rebuild-for-electron-on-windows).
  Everything upstream of that one step — the agent's actual logic — is tested and, where it
  talks to the API, verified against the live backend.

## Sprint 8 — ChromeOS extension (planned)

MV3 service worker, `chrome.desktopCapture`, `chrome.alarms`, popup punch controls, in-browser
activity signal. Documented limitation: cannot see activity outside the browser window.
