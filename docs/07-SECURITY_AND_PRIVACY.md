# Security and privacy

## 1. Principles
- **Disclosed monitoring.** Employees accept a notice before capture; a visible agent shows when it is on; audio is optional and consent is enforced on the server.
- **Least access.** Employees see only themselves; leaders only their departments; HR everything about people; only account admins see pay and bank details.
- **Everything sensitive is logged**, and the log cannot be edited.
- **No content capture:** counts of keys and mouse actions and the active app name, never what is typed.
- **Short retention:** screenshot and audio files are deleted after 31 days by default; the record that a capture happened stays.

## 2. Who can do what
| | Employee | Leader | Admin | Account admin |
|---|---|---|---|---|
| Punch, breaks, own history, leave, corrections, payslips, security | ✅ | ✅ | ✅ | ✅ |
| Team live board, member detail, screenshots, audio, leave approvals | | own departments | everyone | everyone |
| Employees, departments, timesheet, screenshots, reports, productivity | | | ✅ | ✅ |
| Time corrections, leave for everyone, audit log, settings (non-pay), see sign-in security | | | ✅ | ✅ |
| Company holidays | | | ✅ | ✅ |
| Pay rates, bonuses, payroll, payslips, payment list, bank details, pay settings and payslip template | | | | ✅ |
| Reset someone's two-step sign-in | | | | ✅ (not your own) |

Special rules
- Nobody decides their **own** leave or time correction.
- HR can give another admin the account-admin flag, **not themselves**; all account admins are notified of every grant or removal.
- Leaders never see admins; a leader sees a sub-leader only if they manage every department that person leads.
- Monitoring consent cannot be withdrawn through the app. Audio consent can.

## 3. Sign-in security
- Password: 8+ characters for staff, **12+ and a common-password check** for admins; look-alike substitutions (0 for o, @ for a) are caught.
- Rate limit 10 attempts per 15 minutes per IP and email; unknown email and wrong password look the same.
- **Two-step sign-in** (authenticator app, RFC 6238). Code works once; 5 wrong in 15 minutes holds the account; 10 hashed recovery codes; secrets encrypted (AES-256-GCM bound to the owner). Admins can be required to use it.
- **Sessions:** each sign-in is a session, listed under Security with device, address and last activity; ending one invalidates its tokens on the next request.
- **History and alerts:** every sign-in and failed try is recorded; a device never used before triggers a notification and an email.
- **Tokens:** HS256 pinned, 30-minute access tokens, rotating refresh tokens stored only as hashes, theft response on late reuse.
- **Browser:** tokens only in httpOnly, SameSite Lax, Secure cookies; the portal's proxy rejects cross-origin writes; security headers set in `next.config.mjs`.
- **CORS:** only the configured origins.

## 4. Data protection
| Data | Protection |
|---|---|
| Passwords | bcrypt |
| Refresh tokens, agent codes | SHA-256 hash only |
| Bank details | AES-256-GCM, key `BANK_DATA_KEY`, bound to the employee id; account admins only; each look audited; values never in logs |
| Authenticator secrets | AES-256-GCM, key `TOTP_ENCRYPTION_KEY` or derived from `JWT_SECRET` |
| Recovery codes | HMAC hash |
| Files | In R2/local storage, served only through the API; capture fetches are audited |
| In transit | HTTPS everywhere in production |

## 5. What is audited
Opening a screenshot, playing audio, listing captures, viewing or saving or removing bank details, viewing payslips, exporting reports and payroll, generating, finalizing and reopening payroll, setting pay rates and bonuses and holidays, employee create and change and deactivate, leader assignments, settings changes, leave and time-correction decisions, leave proof views, account-admin grants and removals, viewing someone's sign-in security, ending their sessions, resetting their two-step, and the two-step rule.

Each entry: who, what, about whom, when, from which address, and non-sensitive details. Admin, Audit log shows them with filters.

## 6. Privacy notes for HR
- Tell employees what is captured before they start. The in-app notice says it, but say it aloud too.
- Sign-in addresses are personal data: looking at someone's sign-in history is itself audited.
- The "Who needs attention" score and the productivity score are **conversation starters**. Meetings, calls, leave and a mic muted by mistake can lower them; do not use them as the sole basis for a decision.
- The Zoom camera rule reads only whether a meeting is open and whether Zoom uses the camera. It removes break time from pay, so switch it on only after telling staff.
- Birthday reminders never include the year of birth.

## 7. Known limits
- Two-step uses an authenticator app; there is no SMS or email code and no single sign-on (planned: backlog I-1).
- The web portal has no offline queue.
- The agent's Zoom check works on Windows only.
- Sign-in addresses seen by the API are the portal server's unless `BFF_KEY` is set on both sides.
- The agent installers are not code-signed; Windows SmartScreen and macOS Gatekeeper warnings are expected for internal distribution.
