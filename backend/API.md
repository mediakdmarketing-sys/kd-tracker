# API Reference

Base URL: `http://localhost:4000`. All `/api/*` routes except `POST /api/auth/login`,
`POST /api/auth/refresh` and `POST /api/auth/logout` require `Authorization: Bearer <accessToken>`.

Errors are always shaped:

```json
{ "error": { "code": "FORBIDDEN", "message": "…", "details": [] } }
```

| Status | Meaning here |
|---|---|
| 400 | Validation failed, or a rule the request violated (`details` lists the fields) |
| 401 | Missing, expired or wrong-type token |
| 403 | Authenticated but not allowed — including **audio consent not given** |
| 404 | Not found, or the file was purged under the 31-day rule |
| 409 | State conflict — already punched in, no open shift, capture during a break |
| 413 | Upload over `MAX_UPLOAD_BYTES` |
| 429 | Rate limited |
| 501 | Deliberately not implemented yet (SSO, live payroll sync) |

---

## Health

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Process + database reachability |
| GET | `/health/jobs` | Last run of each scheduled job. **503** if the purge has not succeeded in 48h — this is what to alert on |

## Auth

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | — | `{ email, password, client? }` → `{ accessToken, refreshToken, employee }` |
| POST | `/api/auth/refresh` | — | `{ refreshToken }` → new pair. The presented token is retired (rotation) |
| | | | A rotated token still works for `REFRESH_GRACE_SECONDS` (120), so a lost response on a bad connection does not end the shift. Reuse after that revokes **every** session for the account. A token ended by sign-out or by HR gets no grace at all. |
| POST | `/api/auth/logout` | — | `{ refreshToken }` |
| POST | `/api/auth/logout-all` | any | Revokes every session for the caller |
| GET | `/api/auth/me` | any | Profile, role and consent state |
| GET | `/api/auth/consent` | any | The disclosure the consent screen must render, versioned |
| POST | `/api/auth/consent` | any | `{ monitoringConsent?, audioConsent? }` |
| POST | `/api/auth/sso/callback` | — | **501** — backlog I-1 |

`employee.consent.required` is `true` when the consent screen must be shown before punch-in.

Monitoring consent cannot be withdrawn through this API (400, directing the employee to HR).
Audio consent can be given and revoked freely, and revocation takes effect on the next upload.

## Attendance

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/attendance/punch-in` | any | 201. **403** if monitoring consent is missing, **409** if a shift is open |
| POST | `/api/attendance/punch-out` | any | Computes worked seconds; closes a forgotten break |
| POST | `/api/attendance/break-start` | any | **409** if not punched in, or already on a break |
| POST | `/api/attendance/break-end` | any | Recomputes `totalBreakSeconds` from the break rows |

All four accept an optional `{ "at": "<ISO 8601>" }` — the time the event really happened, for
an agent replaying something it queued while offline. The server judges the claim (ADR-0004):

- More than 120s in the future → **400** (broken clock).
- Out of order — a punch-out before its punch-in → **400**.
- Backdated up to **4 hours** → honoured; the shift is marked `source: "queued"`.
- Backdated beyond 4 hours → the **server's own time** is recorded, `needsReview: true`, and
  `reviewReason` says why.

`source` (`live` / `queued` / `admin`) and `punchInReceivedAt` are returned on every shift, so
HR can see how late a queued punch arrived. `source` is derived server-side and is never read
from the request.
| GET | `/api/attendance/status` | any | Live state for the tray icon: `working` / `on_break` / `punched_out` |
| | | | Also returns `workedSeconds`, `breakSeconds`, `breakRemainingSeconds` (clamped at 0), `breakAllowanceSeconds`, `overBreak`, `captureAllowed`, `audioAllowed` |
| GET | `/api/attendance/me` | any | Own history. `?from=&to=&page=&limit=` |
| GET | `/api/attendance/:employeeId` | self or admin | Admin reads are audit-logged |

The punch endpoints take no `employeeId` — the acting employee comes from the token, so a
client cannot punch in as somebody else. A body containing `employeeId` is ignored.

## Capture

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/screenshot/upload` | any | `{ imageBase64, capturedAt?, contentType? }`. **409** with no open shift or during a break |
| GET | `/api/screenshots/:employeeId` | self or admin | List metadata. `?date=` or `?from=&to=` |
| GET | `/api/screenshots/file/:id` | admin | Streams the image. **Writes an audit row every time** |
| POST | `/api/audio/upload` | any | `{ audioBase64, durationSeconds, recordedAt?, contentType? }`. **403 without audio consent** |
| GET | `/api/audio/:employeeId` | self or admin | List metadata |
| GET | `/api/audio/file/:id` | admin | Streams the sample; audit-logged |
| POST | `/api/activity/log` | any | One entry, or `{ entries: [...] }` (max 500) for an offline agent draining its queue |
| GET | `/api/activity/:employeeId` | self or admin | Counts only |

Activity entries carry `keystrokeCount`, `mouseCount` and an optional `windowTitle`. There is
no field for keystroke *content*, and no column that could hold it.

### Replaying a queued upload

All three upload endpoints accept an optional `captureId` (a UUID, one per captured artefact,
**identical on every retry**). Send it and a retry is recognised instead of duplicated:

- A repeat returns `201` with the id already stored and `"duplicate": true`. No second file is
  written, no second row created.
- A replay is accepted even if the shift it belonged to has since closed — otherwise the agent
  would retry an item it can never deliver.
- An audio replay is still refused with **403** if consent has been withdrawn in the meantime.
- The activity batch reports `{ accepted, duplicates }`.

Capture timestamps (`capturedAt`, `recordedAt`, `timestamp`) are validated: more than 120s in
the future → **400**; older than 7 days → **400**. A few hours late is normal and expected.

### Multiple displays

A capture at one moment is **one upload per display** (ADR-0005), tied together by
`captureGroupId`:

```json
{
  "imageBase64": "...",
  "captureId":      "<uuid, unique per image — the replay key>",
  "captureGroupId": "<uuid, the same for every display in this capture>",
  "displayIndex": 0,
  "displayCount": 2,
  "displayLabel": "DELL U2720Q",
  "capturedAt": "2026-09-04T09:15:00.000Z"
}
```

`displayIndex` must be less than `displayCount` (**400** otherwise); `displayCount` is capped
at 8. Omit them and the capture is recorded as a single-display group of one.

`GET /api/screenshots/:employeeId` returns rows **flat**, newest moment first and primary
display first, each carrying `captureGroupId`, `displayIndex`, `displayCount` and
`displayLabel`. Clients group them. Ask for a large enough `limit` that a group is not split
across a page — a full day on two monitors is about 128 rows.

Upload rate limit: **240/hour per employee** — headroom for draining a full day's backlog.

`GET /api/config` (any role) returns the capture intervals and shift rules the agent should
use, so cadence is changed server-side rather than by re-releasing the agent.

## Admin

All admin routes require `role=admin`, enforced server-side.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/dashboard` | Live status of every active employee. `?date=` for a past day. Includes any shift still open, whatever date it started on — a night shift stays on the board past midnight, marked `overnight` with its `shiftDate` |
| GET | `/api/admin/reports` | `?from=&to=` required; `&department=&employeeId=&detail=summary\|daily&format=json\|csv` |
| GET | `/api/admin/employees` | `?department=&status=&search=&page=&limit=` |
| GET | `/api/admin/employees/:id` | Single employee, same shape as the list rows |
| POST | `/api/admin/employees` | Creates with consent **not** given — the employee gives it at first login |
| PATCH | `/api/admin/employees/:id` | Name, role, department, timezone, status, password reset. `consentAudio` may only be set to `false` |
| GET | `/api/admin/audit-logs` | `?adminId=&targetEmployeeId=&action=&from=&to=`. Read-only: no route updates or deletes a row |

Deactivating an employee or resetting a password revokes their refresh tokens immediately.

## Payroll

| Method | Path | Notes |
|---|---|---|
| POST | `/api/payroll/generate` | `{ month: "2026-08" }`. Idempotent — re-running overwrites and clears `syncedToPayroll` |
| GET | `/api/payroll?month=` | Generated summary rows |
| GET | `/api/payroll/export?month=` | CSV (`&format=json` for JSON). Audit-logged |
| POST | `/api/payroll/mark-synced` | `{ month, employeeIds? }` — confirms an upload actually happened |
| POST | `/api/payroll/sync` | **501** — backlog I-2 |

Only **closed** shifts count. Idle seconds are reported but not deducted — see open question 1
in [docs/PRODUCT_BACKLOG.md](../docs/PRODUCT_BACKLOG.md).

## Jobs

Run in-process on a schedule when `ENABLE_SCHEDULER=true`, or from cron:

```bash
npm run job:purge          # 31-day file purge; exits non-zero if any file could not be deleted
npm run job:close-shifts   # auto-closes shifts never punched out, flags them for HR
npm run job:payroll        # last month, or: npm run job:payroll -- 2026-08
```

Every run writes a `job_runs` row, which is what `/health/jobs` reports on.
