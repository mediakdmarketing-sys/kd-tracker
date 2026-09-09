# KD Tracker — Employee Monitoring & Attendance System

Internal platform for ~60 work-from-home employees: punch in/out on work email, 9-hour shift
tracking (incl. 1h break), consent-gated screenshot/audio/activity capture, an HR/Admin
dashboard, and a payroll feed.

Built incrementally with Scrum-style sprints. See [docs/SPRINT_PLAN.md](docs/SPRINT_PLAN.md)
for what is done and what is next.

## Repository layout

```
KD-tracker/
├── docs/                  # Agile artefacts: backlog, sprint plan, ADRs
├── backend/               # Node.js + Express REST API (single source of truth)
├── web/                   # Next.js Admin + User portal            (Sprint 6)
├── desktop-agent/         # Electron agent for Win/macOS/Linux     (Sprint 7)
└── chromeos-extension/    # Manifest V3 Chrome extension           (Sprint 8)
```

## Status

Sprints 0–6.6 are complete and verified: the API runs (98 automated tests), and the web
portal drives the whole system end to end against a seeded month of demo data.

Sprint 7 (the Electron desktop agent) is **code complete, packaging unverified**: the agent's
logic (54 tests, plus live verification against the running backend — offline queueing,
multi-display capture, replay protection, session handling) is done and a code review before
packaging caught and fixed 4 real bugs. Producing an actual installer needs a C++ toolchain
(Visual Studio Build Tools on Windows) to rebuild a native dependency for Electron — not
installed on this project's build machine by explicit choice. See
[desktop-agent/README.md](desktop-agent/README.md#️-native-module-better-sqlite3-needs-a-real-rebuild-for-electron-on-windows)
for exactly what's needed and what's already been verified.

**A follow-up full-codebase audit** (backend + web + agent, hunting specifically for
concurrency bugs and silent data loss) found and fixed 10 further defects — mostly
check-then-write races that let two simultaneous requests both pass a validation that only
one should. Full writeup, live-verification evidence, and a go/no-go recommendation:
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

The web portal (and the desktop agent's tray popup) render **light theme only** — the
automatic dark-mode switch was removed by request.

The API is built for clients on unreliable home connections — idempotent uploads, a refresh
grace window, and queued punch events with a 4-hour backdating limit. See
[docs/adr/0004-offline-contract.md](docs/adr/0004-offline-contract.md).

## Quick start

Two terminals. Backend first — the portal needs it.

```bash
cd backend && npm install && cp .env.example .env && npm run db:reset && npm run dev
```

```bash
cd web && npm install && cp .env.example .env.local && npm run dev
```

API on `http://localhost:4000`, portal on `http://localhost:3000`. Seeded logins are printed
by `npm run db:reset`:

| Role | Email | Password |
|---|---|---|
| Admin / HR | `priya.raman@kdmarketing.in` | `Password123!` |
| Employee | `karthik.s@kdmarketing.in` | `Password123!` |
| Employee, audio declined | `sneha.iyer@kdmarketing.in` | `Password123!` |

```bash
cd backend && npm test
```

Endpoints are listed in [backend/API.md](backend/API.md).

## Portal

| Route | Who | What |
|---|---|---|
| `/login` | anyone | Work-email sign-in |
| `/consent` | any employee | The disclosure screen; blocks the first punch-in until accepted |
| `/me` | any employee | Punch in/out, breaks, live shift clock, recent shifts |
| `/me/history` | any employee | Own attendance history |
| `/admin` | admin | Live board — who is working, on break, idle, flagged |
| `/admin/reports` | admin | Filtered attendance reports + CSV export |
| `/admin/employees` | admin | Employee administration; per-employee day view with the screenshot and audio viewer |
| `/admin/payroll` | admin | Generate, review and export a month |
| `/admin/audit` | admin | Every admin access to monitoring data |

Session tokens are held in `httpOnly` cookies behind a server-side proxy, never in
`localStorage` — see [docs/adr/0003-portal-session-in-httponly-cookies.md](docs/adr/0003-portal-session-in-httponly-cookies.md).

> **Windows note:** `better-sqlite3` needs a prebuilt binary for your Node version. Node 24
> requires `better-sqlite3` v13+ (pinned in `package.json`); older majors try to compile from
> source and fail without Visual Studio build tools.

## Persistence

SQLite 3 today, PostgreSQL later — with no application code changes. The data layer is Knex
with a deliberately portable schema; see
[docs/adr/0001-sqlite-first-portable-persistence.md](docs/adr/0001-sqlite-first-portable-persistence.md).

Switching is a `.env` edit:

```
DB_CLIENT=pg
DATABASE_URL=postgres://user:pass@host:5432/kdtracker
```

## Scope note

This is *disclosed* workplace monitoring: a visible tray agent, an explicit consent screen
before capture begins, audit logs on every admin view of captured media, and a 31-day file
purge. Consent-gating for audio is enforced server-side, not just in the client.
