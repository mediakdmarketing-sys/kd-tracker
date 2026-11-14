# API reference

Base: `https://<api host>/api`. JSON in and out. Authenticated calls send `Authorization: Bearer <access token>`.
The portal never exposes the token to the browser; it calls these through its `/bff/api/...` proxy.

Errors look like `{ "error": { "code": "CONFLICT", "message": "…", "details": … } }`. Common codes: `BAD_REQUEST` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `ACCOUNT_DEACTIVATED` 403, `PASSWORD_CHANGE_REQUIRED` 403, `TWO_FACTOR_SETUP_REQUIRED` 403, `NOT_FOUND` 404, `CONFLICT` 409, `DAY_OFF` 409, `PAYLOAD_TOO_LARGE` 413, `TOO_MANY_ATTEMPTS` / rate limit 429, `BANK_KEY_MISSING` 503.

**Access column:** Any = any signed-in person; Self = the caller's own data; Leader = leader of the person's department (or admin); Admin = HR; Acct = account admin.
The older, shorter list is [backend/API.md](../backend/API.md).

## Health and config
| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | none | Process and database health |
| GET | `/health/jobs` | none | Job health for an external monitor |
| GET | `/config` | Any | Capture cadence, shift rules and Zoom-rule minutes for agents |

## Auth (`/auth`)
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/auth/login` | none, rate limited | Password step. Returns tokens, or `{twoFactorRequired, challengeToken}` |
| POST | `/auth/2fa/verify` | none, rate limited | Code step: `challengeToken` + `code` or `recoveryCode` |
| POST | `/auth/refresh` | refresh token | Rotate tokens (session kept) |
| POST | `/auth/logout` | refresh token | End this session (puts a punched-in shift on a break) |
| POST | `/auth/logout-all` | Any | End every session |
| POST | `/auth/change-password` | Any | Change password (ends all sessions) |
| GET | `/auth/me` | Any | Profile, consent, `isAccountAdmin`, two-step flags |
| GET/POST | `/auth/consent` | Any | Notice text; accept monitoring / audio |
| POST | `/auth/agent-code` | Any | One-time code for the desktop agent (60 s) |
| POST | `/auth/agent-token` | none, rate limited | Agent trades the code for its own session |
| GET | `/auth/security` | Any | Two-step status, current session id |
| POST | `/auth/2fa/setup` | Any | New secret and `otpauth` URL (not yet on) |
| POST | `/auth/2fa/enable` | Any | Confirm with a code; returns 10 recovery codes once |
| POST | `/auth/2fa/disable` | Any | Password + code or recovery code |
| POST | `/auth/2fa/recovery-codes` | Any | Password + code; replaces the codes |
| GET | `/auth/sessions` | Any | Own live sessions |
| POST | `/auth/sessions/revoke-others` | Any | End all but this one |
| DELETE | `/auth/sessions/:id` | Any | End one (not the current one) |
| GET | `/auth/login-history` | Any | Own recent sign-ins and failed tries |
| POST | `/auth/sso/callback` | none | 501: not enabled |

## Attendance (`/attendance`)
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/punch-in`, `/punch-out`, `/break-start`, `/break-end` | Self | Optional `at` (queued time); `break-start` also takes `reason: "zoom_camera_off"` |
| POST | `/project` | Self | Switch current project |
| GET | `/status` | Self | State, worked and break seconds, allowance, capture allowed, day-off info |
| GET | `/me` | Self | Own shifts (range, paged) |
| GET | `/:employeeId` | Self or Admin | A person's shifts |
| GET | `/:employeeId/projects` | Self or Admin | Project time for a day |

## Capture
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/screenshots/upload` | Self (agent) | One image, idempotent by capture id |
| GET | `/screenshots/file/:id` | Admin | The image (audited) |
| GET | `/screenshots/:employeeId` | Self or Admin or Leader | Records for a person |
| POST | `/audio/upload` | Self (agent, audio consent) | One sample |
| POST | `/audio/mic-status` | Self (agent) | `muted`, `unavailable`, `live` |
| GET | `/audio/file/:id`, `/audio/:employeeId`, `/audio/:employeeId/mic-log` | Admin / Leader | Samples and mic log |
| POST | `/activity/log` | Self (agent) | Minute counters, app, domain |
| GET | `/activity/:employeeId` | Admin / Leader | Activity |

## Leave, corrections, notifications, calendar
| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/leave` | Any | Request leave (optional base64 proof) |
| GET | `/leave/me` | Self | Own requests |
| GET | `/leave/balance?year=` | Self | Allowance, taken, waiting, left per type |
| POST | `/leave/:id/cancel` | Self | Cancel while pending |
| GET | `/leave/:id/proof` | Self | Own proof file |
| POST | `/corrections` | Self | Ask for a time correction |
| GET | `/corrections/me` | Self | Own requests |
| POST | `/corrections/:id/cancel` | Self | Cancel while pending |
| GET | `/corrections/review?status=` | Admin | Waiting / approved / rejected / all |
| POST | `/corrections/:id/review` | Admin | `{status: approved\|rejected, note}`; not your own |
| GET | `/notifications` | Self | List |
| POST | `/notifications/read` | Self | Mark read |
| GET | `/calendar`, `/calendar/month?month=YYYY-MM` | Any | Holidays, leave, birthdays (birthdays for HR) |
| GET | `/payslips`, `/payslips/:month`, `/payslips/:month/pdf` | Self | Own finalized payslips |
| GET/POST/DELETE | `/branding/logo` | read: Any; write: Admin | Company logo |
| GET | `/projects` | Any | Active projects |

## Leader (`/leader`) — scoped to the leader's departments
`GET /departments`, `/members`, `/members/:id/info`, `/members/:id/attendance`, `/members/:id/screenshots` (+ `/file/:id`), `/members/:id/audio` (+ `/file/:id`), `/members/:id/mic-log`, `/members/:id/activity`, `/members/:id/projects`, `GET /leave`, `PATCH /leave/:id`, `GET /leave/:id/proof`. Viewing media is audited.

## Admin (`/admin`) — HR
| Group | Endpoints |
|---|---|
| **Views** | `GET /dashboard`, `/timesheet`, `/screenshots`, `/mic-log`, `/reports`, `/attendance-summary`, `/productivity`, `/daily-trend?days=7\|14\|30`, `/performance?days=&department=` |
| **People** | `GET/POST /employees`, `GET/PATCH /employees/:id`, `GET /employee-options`, `GET /birthdays` |
| **Departments** | `GET /departments`, `/departments/full`, `POST/PATCH/DELETE /departments[/:id]`, `GET/POST/DELETE /department-leaders` |
| **Leave** | `GET /leave`, `PATCH /leave/:id`, `GET /leave/:id/proof` (requests carry `days` and `balance`) |
| **Security** | `GET /employees/:id/security` (audited), `POST /employees/:id/sessions/revoke-all`, `POST /employees/:id/2fa/reset` (Acct, not your own) |
| **Audit** | `GET /audit-logs?adminId=&targetEmployeeId=&action=&from=&to=&page=`, `GET /audit-actions` |
| **Settings** | `GET/PATCH /settings` (pay rules and payslip template: Acct only) |
| **Bank details** | `GET /bank-details/status`, `GET/PUT/DELETE /employees/:id/bank` (all Acct, audited) |
| **Projects and apps** | `GET/POST/PATCH /projects`, `GET/PATCH/DELETE /app-categories` |

Filters on `/timesheet` and `/screenshots`: `from`, `to`, `department`, `employee` (text) or `employeeId` (exact, wins). Timesheet allows 31 days, screenshots 7.

## Payroll (`/payroll`) — account admin, except holidays
`POST /generate`, `GET /` (month summary), `GET /export` (payroll CSV), `GET /payment-list` (CSV with bank details, finalized months only), `GET/POST /rates`, `/rates/bulk`, `GET /rates/:employeeId`, `PATCH /rates/:id`, `GET/POST /bonuses`, `/bonuses/bulk`, `DELETE /bonuses/:id`, `GET /finalize/status`, `POST /finalize`, `POST /reopen`, `POST /payslips/send`, `GET /payslips/status`, `GET /payslip`, `GET /payslip.pdf`, `POST /mark-synced`, `POST /sync`. Holidays (`GET/POST/PATCH/DELETE /holidays`, `/holidays/bulk`) are open to any admin.

## Rate limits
Sign-in and code checks: 10 per 15 minutes per IP and email. Agent code exchange: 30 per 15 minutes per IP. Uploads: 240 per hour per employee. Everything else: 300 per minute.
