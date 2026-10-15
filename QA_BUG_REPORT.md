# KD-Tracker — QA / Test Bug Report

**Date:** 2026-10-15  
**Build under test:** `main` @ `1da6a0f` + uncommitted working-tree changes (agent-connect feature)  
**Scope:** backend API, web portal (Next.js dev), desktop-agent (unit level), code review of uncommitted diff  
**Environment:** Windows 11, Node, backend on a throwaway SQLite DB (seeded demo data), web on `next dev --turbopack`

## Summary

| Area | Result |
|---|---|
| Backend automated tests | 126 / 127 pass — **1 fail** |
| Desktop-agent automated tests | 80 / 81 pass — **1 fail** |
| API manual probes (auth, RBAC, validation, punch flow) | Pass, 2 minor findings |
| Web UI / portal | **1 high, 2 medium, 2 low** findings |
| Code review (uncommitted agent-connect diff) | **1 high (security design), 2 medium/low** |

Not covered: `next build` / production build (dev server was in use), Electron GUI/native capture on a real desktop, visual
screenshot review (browser pane was hidden, screenshots timed out), mobile layout, load/perf, PostgreSQL path.

---

## Retest — 2026-10-15

| ID | Status |
|---|---|
| BUG-1 wrong password shows no error | **Fixed, verified in browser** (banner "Invalid email or password", page not reloaded) |
| BUG-2 punch-out overwrites auto-close | **Fixed**, failing test now passes |
| BUG-3 unknown employee id 500 | **Fixed, verified** (404) |
| BUG-4 multi-display test | **Fixed** (test corrected) |
| BUG-5 BFF malformed JSON 500 | **Fixed, verified** (400) |
| SEC-1 connect link account takeover | **Fixed in code** (confirm dialog); not exercised in a live Electron run |
| BUG-6, BUG-7, REV-1..3 | Open |

Automated: backend 127/127, desktop-agent 81/81.

## Bugs (original findings)

### BUG-1 — Wrong password shows no error; the login page just reloads  · **High** · Web
- **Where:** `web/lib/client.js:19-26`, used by `web/app/login/LoginForm.js:23`
- **Steps:** open `/login` → enter a valid email + wrong password → Sign in.
- **Expected:** red "Invalid credentials" banner (`LoginForm` renders one on `catch`).
- **Actual:** backend returns 401 → `call()` treats every 401 as "session expired" and does
  `window.location.href = '/login'` then never resolves. The page hard-reloads, the form is wiped and the error
  is never shown. User gets zero feedback. Confirmed in browser (console `401`, navigation, no `[role=alert]`).
- **Fix idea:** don't redirect on 401 for the `/login` call (or for any call when already on `/login`); let the
  error propagate.

### BUG-2 — Concurrent punch-out can overwrite an auto-closed shift (test failing)  · **High** · Backend
- **Where:** `backend/src/modules/attendance/attendance.service.js:221`
- **Test:** `tests/attendance.test.js` › *stale shift sweeper › does not clobber a real punch-out…* — fails
  (`row.auto_closed` is `1`, expected falsy).
- **Cause:** `punchOut()` reads the open shift, does several awaits, then runs
  `update(patch).where({ id })` with **no `status IN ('open','on_break')` guard**. The sweeper
  (`closeShifts.job.js:59`) *is* guarded, but if the sweeper commits between punchOut's read and write, punchOut
  overwrites `punch_out`/`worked` while `auto_closed`/`needs_review` stay set → mixed, corrupt record
  (flagged "never punched out" yet has a real punch-out).
- **Fix idea:** add the same status guard to the punch-out update and treat 0 affected rows as a 409.

### BUG-3 — Unknown employee id renders HTTP 500 instead of 404  · **Medium** · Web
- **Steps:** as admin, GET `/admin/employees/does-not-exist`.
- **Actual:** `500` (server log: `Error: Employee not found`, `lib/api.js:43`, `status: 404`).
- **Expected:** the portal's not-found page / 404.
- **Fix idea:** in the page, catch `error.status === 404` and call `notFound()`.

### BUG-4 — Agent test `queues one item per display…` fails (4 items, expected 2)  · **Medium** · Desktop agent (test)
- **Where:** `desktop-agent/tests/agent.test.js:187-211`. Fails deterministically, also in isolation.
- **Cause:** `agent.syncStatus()` in the test flips capture off→on, which triggers the "capture immediately on
  punch-in" path (`agent.js:~188`) → 2 queued by that, then the test's explicit `captureScreens()` adds 2 more.
  Either the test needs to account for the immediate capture, or the immediate capture needs to be injectable.
  The production behaviour (one item per display, shared group) is not wrong; the suite is red though.

### BUG-5 — Web `/bff/login` returns 500 on malformed JSON  · **Low** · Web
- **Steps:** `POST /bff/login` with body `{bad` → `500`. The backend itself correctly answers 400.
- **Fix idea:** wrap `req.json()` in the BFF handler and return 400.

### BUG-6 — Missing HTTP security headers on the web portal  · **Low/Medium** · Web
- `GET /login` has no `X-Frame-Options`/`frame-ancestors`, `Content-Security-Policy`, `X-Content-Type-Options`,
  `Referrer-Policy` (the backend uses `helmet`, the portal doesn't). Admin pages that show employee screenshots
  should not be framable. (Observed on dev server; confirm on a production build.)

### BUG-7 — Employee hitting `/admin/*` logs unhandled 403 errors server-side  · **Low** · Web
- Role mismatch is handled by throwing from the page (`Requires role: admin`, `app/admin/page.js:9`) and being
  redirected to `/me`. Works for the user, but every attempt is logged as an unhandled render error and the
  redirect response carries a ~60 KB body. A role check in `middleware.js` would be cleaner.

---

## Review findings on the uncommitted agent-connect feature

### SEC-1 — `workbuddy://connect?code=…` signs a signed-out agent in as *whoever the code belongs to*  · **High (design)**
- **Where:** `desktop-agent/src/core/agent.js` `connect()`, `connectLink.js`.
- **Risk:** the agent only refuses when someone is already signed in. When signed out, any web page can open a
  `workbuddy://connect?code=<attacker's own freshly minted code>` link and the victim's agent silently becomes
  signed in as the **attacker's** account — victim's screenshots/audio then upload to an account the attacker
  controls (login-CSRF). Codes are 60 s / single-use but an attacker can mint one on demand.
- **Fix idea:** require an in-app confirmation ("Connect as <name>?") before applying a link-supplied code, or bind
  the code to a one-time state the agent generated.

### REV-1 — `agentTokenLimiter` is 30 requests / 15 min **per IP**  · **Medium**
- `backend/src/middleware/rateLimit.js`. Offices behind one NAT/proxy will exceed this around start-of-shift
  (every employee's login triggers one exchange) → legitimate agent sign-ins fail with 429. Key per code-hash/
  employee or raise the ceiling.

### REV-2 — `POST /api/auth/agent-code` is only covered by the generic limiter  · **Low**
- Each call inserts a row; cleanup only prunes rows older than 1 h. An authenticated user can inflate the table.
  Add a small per-user limiter.

### REV-3 — Agent sign-in on every web login, even with no agent / a different user already signed in  · **Low (UX)**
- `LoginForm.js:25` fires `connectDesktopAgent()` unconditionally. If the agent is signed in as user A and user B
  signs into the portal on the same machine, the agent silently keeps monitoring A (`already_signed_in`) and
  nothing tells B. Consider surfacing that.

---

## Passed checks (for the record)
- Login: bad password 401, missing fields / malformed JSON / NoSQL-style object email → 400.
- JWT tampering → 401; employee token on `/api/admin/*`, `/api/payroll`, `/api/leader/*` → 403.
- Pagination bounds (`limit=-1`, `limit=99999999`) → 400.
- Punch flow: punch-in 201, second punch-in 409, punch-out 200, second punch-out 409.
- Portal routes load for admin: `/admin`, `/employees`, `/departments`, `/productivity`, `/reports`, `/audit`,
  `/leave`, `/payroll`, `/projects`, `/settings`, `/leader`, `/me`, `/me/history`, `/me/leave`; unknown route → 404.
- Unauthenticated access to `/admin` and `/bff/*` → 307 to `/login?next=…`; BFF refuses unknown routes with 404.
- Session cookies are `HttpOnly`. (`Secure` off in dev by design — set `COOKIE_SECURE=1` behind HTTPS.)
- Agent-connect backend: one-time use, race-safe, expiry, hash-only storage, deactivated account refused (9/9).

## Environment notes
- `backend/.env` has `DB_CLIENT=pg`; I deliberately ran everything on a scratch SQLite file, nothing touched that DB.
- Dev note: the login form can submit natively (GET `/login?`) if clicked before hydration finishes — only
  seen under slow first compile in dev; worth confirming it isn't reproducible in production.
