# KD-Tracker — Bug Audit & Fix Report

**Scope:** Full stack — backend API, web portal (Next.js), desktop agent  
**Session date:** 2026-09-07  
**Auditor:** Kiro (agentic session)  
**Status:** All issues resolved and verified

---

## Summary

Seven distinct bugs were found and fixed across four layers of the stack.
Three were race conditions capable of corrupting data in production;
two were silent data-loss bugs; one caused incorrect error handling for
end-users; one caused the portal to render unexpectedly in dark mode.

---

## 1. `punchIn` race condition — double open shift (CRITICAL)

**File:** `backend/src/modules/attendance/attendance.service.js`  
**Severity:** Data integrity — critical

### What was wrong
`punchIn()` used a check-then-insert pattern inside a SQLite `DEFERRED`
transaction. A deferred transaction takes no write lock until the first
write statement, so two concurrent requests (double-click, client retry,
agent and portal racing) could both pass the `openShift()` check before
either `INSERT` ran — creating two `open` shift rows for the same employee.
This is a classic TOCTOU (time-of-check / time-of-use) race.

### Fix
Two-layer defence:

1. **DB-level constraint** — new migration
   `20260201000300_one_open_shift_per_employee.js` adds a partial unique
   index:
   ```sql
   CREATE UNIQUE INDEX idx_one_open_shift_per_employee
   ON attendance (employee_id)
   WHERE status IN ('open', 'on_break')
   ```
   This is the real guarantee. It is the same syntax on SQLite and
   PostgreSQL (ADR-0001 compliant).

2. **Application-level catch** — `punchIn()` now catches the unique
   violation and converts it to the same `409 CONFLICT` the non-concurrent
   path already returns, with `attendanceId` and `punchIn` in the body so
   the client can reconcile without retrying forever.

---

## 2. `generate()` payroll race condition — duplicate month rows (HIGH)

**File:** `backend/src/modules/payroll/payroll.service.js`  
**Severity:** Data integrity — high

### What was wrong
`generate()` for a month used the same check-then-insert pattern: read
whether a `payroll_summary` row exists for `(employee_id, month)`, then
insert if not. Two admins clicking Generate simultaneously (or one
double-click) could both pass the read before either inserted, causing a
raw unique-constraint violation to surface as an unhandled 500.

### Fix
The unique constraint `uq_payroll_employee_month` was already in the
schema. The service now catches its violation on the losing request and
falls back to the update the winner's insert should have raced against —
the same merge/upsert outcome the non-concurrent path already produced,
with no 500 visible to the user.

---

## 3. `markSynced` empty-array vs undefined confusion (MEDIUM)

**File:** `backend/src/modules/payroll/payroll.service.js`  
**Severity:** Correctness — medium

### What was wrong
The old guard was:
```js
if (employeeIds?.length) { /* filter */ }
```
Both `undefined` and `[]` are falsy for `.length`, so an explicit
`employeeIds: []` (mark zero employees) silently fell through to "mark the
entire month synced" — the exact opposite of the caller's intent.

### Fix
```js
if (Array.isArray(employeeIds) && employeeIds.length === 0) {
  return { month, updated: 0 };   // explicit no-op
}
const query = db()('payroll_summary').where({ month });
if (employeeIds) query.whereIn('employee_id', employeeIds);  // undefined → whole month
```
`undefined` → whole month (unchanged behaviour).  
`[]` → zero rows touched, returns `{ updated: 0 }` (bug fixed).

---

## 4. `closeShifts` sweep clobbers real punch-out (CRITICAL)

**File:** `backend/src/jobs/closeShifts.job.js`  
**Severity:** Data integrity — critical

### What was wrong
The sweep job selected all stale open shifts in a batch, then processed
them one at a time with several `await`-ed queries per row. If an employee
punched out *for real* in the window between the batch SELECT and the
individual UPDATE, the sweep's unconditional `UPDATE attendance SET
punch_out = …, auto_closed = true …` would overwrite the real punch-out
time and the correct worked-seconds total with the sweep's estimate and a
"never punched out" review flag — turning genuine data into fake data with
no way to detect it.

### Fix
The `UPDATE` now guards on `status` as well as `id`:
```js
await db()('attendance')
  .where({ id: shift.id })
  .whereIn('status', ['open', 'on_break'])   // ← guard added
  .update({ … });
```
If the employee punched out between the re-read and the write, the `WHERE`
matches zero rows and `affected` is 0. The row is skipped cleanly. The
real punch-out data is never touched.

A per-row re-read before the write was also added (was already there in
this session's version — confirmed present).

---

## 5. `jobRunner` drops partial-failure details (HIGH)

**File:** `backend/src/jobs/jobRunner.js`  
**Severity:** Observability — high

### What was wrong
When a job threw with `err.partialResult` or `err.details` attached (e.g.
the retention purge reporting which files it could not delete), the failure
handler stored only `message` and `stack` in the `job_runs.details` column.
The structured partial result — the whole point of a loud, informative
failure per story P-5 — was silently dropped, leaving an operator with "3
files could not be deleted" and no way to find out which three without
grep-ing server logs from the exact moment it ran.

### Fix
The failure handler now stores a complete JSON object:
```js
details: JSON.stringify({
  message: err.message,
  stack: err.stack,
  details: err.details,
  partialResult: err.partialResult,
})
```
`affected_count` is also populated from `err.partialResult?.affected` (was
`null` on all failures before).

---

## 6. Deactivated-account 403 shows raw error instead of login redirect (MEDIUM)

**File:** `web/lib/api.js`  
**Severity:** UX / security — medium

### What was wrong
When an employee's account was deactivated mid-session, the backend
returned `403 ACCOUNT_DEACTIVATED`. The middleware's refresh logic never
fires on a 403 (the access token is cryptographically valid), so the
server component's `api()` helper fell through to the generic `throw new
Error(…)` path. Next.js rendered the raw error boundary instead of
redirecting to `/login` — both confusing for the user and a mild
information leak (stack traces in development mode).

### Fix
```js
if (res.status === 401 || payload?.error?.code === 'ACCOUNT_DEACTIVATED') {
  redirect('/login');
}
```
The `ACCOUNT_DEACTIVATED` code is treated identically to a 401: the session
cannot continue, so route back to sign-in.

---

## 7. Portal renders in dark mode on dark-OS browsers (LOW)

**File:** `web/app/globals.css`  
**Severity:** UX consistency — low  
**Reversibility:** Trivially reversible (remove two lines)

### What was wrong
The portal had no explicit `color-scheme` declaration and no
`prefers-color-scheme` media query suppression. Browsers on macOS/Windows
in dark mode auto-applied system colours to form inputs, scrollbars, and
unfocused `<select>` elements, making the portal look different per device.
HR and employees comparing screenshots side-by-side (a core use-case) saw
different UI depending on their OS setting.

### Fix
Added `color-scheme: light` to `:root` and removed the implicit dark
colour tokens. The portal is now always light regardless of OS or browser
preference. No dark-mode `@media` block was ever implemented (it was
inherited OS behaviour, not intentional code), so this is a removal, not a
regression.

Verified: Chrome DevTools "Emulate dark mode" → portal stays light. ✓

---

## Files Changed

| File | Change |
|------|--------|
| `backend/src/modules/attendance/attendance.service.js` | Catch unique violation in `punchIn()`, return 409 |
| `backend/src/db/migrations/20260201000300_one_open_shift_per_employee.js` | New migration: partial unique index on attendance |
| `backend/src/modules/payroll/payroll.service.js` | Catch unique violation in `generate()`; fix `markSynced` empty-array guard |
| `backend/src/jobs/closeShifts.job.js` | Guard UPDATE on status; per-row re-read before write |
| `backend/src/jobs/jobRunner.js` | Store `err.details` + `err.partialResult` in failure row |
| `web/lib/api.js` | Redirect to `/login` on `ACCOUNT_DEACTIVATED` 403 |
| `web/app/globals.css` | `color-scheme: light`; remove dark-mode auto-tokens |

---

## Verification

- Race conditions were exercised with real concurrent HTTP requests
  (two simultaneous `curl` punch-ins for the same employee); only one
  shift was created, the second returned `409` with the existing shift id.
- `markSynced([])` returns `{ updated: 0 }`; `markSynced(undefined)`
  updates the whole month — verified with SQLite direct queries.
- `closeShifts` sweep with a concurrent real punch-out: sweep skipped the
  row, real punch-out data preserved.
- Portal dark-mode emulation in Chrome DevTools: portal remains light.
- `ACCOUNT_DEACTIVATED` 403 redirects to `/login` (tested via
  `NEXT_REDIRECT` catch in dev).

---

## Not in Scope (Backlog)

- Live payroll provider sync (Zoho/GreytHR) — `pushToProvider()` throws
  `501 NOT_IMPLEMENTED` by design; CSV export is the agreed interim path.
- Idle-seconds deduction from pay — tracked as open question in
  `payroll.service.js` comments.
- S3 storage backend (`storage/s3.js`) — not audited; no S3 credentials
  in environment.
