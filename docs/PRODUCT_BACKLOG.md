# Product Backlog

Ordered by value. Items above the line are committed; below the line is the icebox — real,
but not scheduled. Estimates are story points (Fibonacci), not days.

## Epics

| Epic | Description |
|---|---|
| E1 Identity | Work-email login, sessions, roles, consent record |
| E2 Attendance | Punch in/out, breaks, idle, shift rules, corrections |
| E3 Capture | Screenshots, audio, activity counters, upload pipeline |
| E4 Oversight | Admin dashboard, reports, exports, audit trail |
| E5 Payroll | Monthly aggregation, export, provider sync |
| E6 Retention | 31-day file purge, job monitoring |
| E7 Clients | Web portal, desktop agent, ChromeOS extension |

## Committed (Sprints 0–8)

Delivered items and their sprint assignment are tracked in
[SPRINT_PLAN.md](SPRINT_PLAN.md). Sprints 0–5 are complete; 6–8 are planned.

## Icebox — valuable, not scheduled

| ID | Story | Epic | Est. | Why it is waiting |
|---|---|---|---|---|
| I-1 | Google / Microsoft SSO login | E1 | 8 | Needs the customer's IdP tenant and admin consent |
| I-2 | Live push to Zoho Payroll / GreytHR | E5 | 8 | Needs provider credentials + sandbox tenant |
| I-3 | Socket.io live dashboard push | E4 | 5 | Polling is adequate until the portal exists |
| I-4 | Employee-initiated attendance correction request + HR approval | E2 | 8 | Wanted by HR; no agreed approval policy yet |
| I-5 | Geo/IP anomaly flag on punch-in | E2 | 5 | Privacy review required before we collect IPs |
| I-6 | Screenshot blur/redaction of flagged apps (password managers, banking) | E3 | 13 | Strong privacy win; needs an app-detection design |
| I-7 | Employee self-service export of their own captured data | E1 | 5 | Likely a DPDP/GDPR requirement — confirm with legal |
| I-8 | Per-department retention overrides | E6 | 5 | 31 days is uniform for now |
| I-9 | Mobile client | E7 | 21 | Out of scope for WFH desk work |
| I-10 | Anomaly detection on activity patterns | E4 | 13 | High false-positive risk; needs a baseline of real data |

## Still open after Sprint 6.5

The offline contract closed the API-side gaps. These remain, and belong to the agent or to HR
tooling rather than to the API:

| ID | Story | Epic | Est. | Note |
|---|---|---|---|---|
| I-11 | HR correction UI for flagged shifts (auto-closed, capped queued punches) | E4 | 8 | Sprint 6.5 creates more flagged shifts; today HR can see them but not fix them. Overlaps I-4. |
| I-12 | Alert when an employee's agent has not uploaded for N hours | E4 | 5 | A silent agent and an idle employee look the same from the server. Distinguishing them needs a heartbeat. |
| I-13 | Agent heartbeat endpoint, separate from activity | E3 | 3 | Would let the live board say "agent offline" instead of "appears idle" — a materially different message to show HR. |
| I-14 | Queue depth reported to the server, shown on the live board | E4 | 3 | HR sees who is running a large backlog, i.e. who has a connectivity problem. |

## Open questions for the Product Owner

These block or reshape stories above. Raised at sprint review; answers go into an ADR.

1. **Idle time and pay.** Idle is currently recorded but still counts as worked time in
   `payroll_summary`. Should idle be deducted, and if so past what threshold? This changes P-1.
2. **Over-break handling.** Today it flags for HR review only. Should it auto-deduct?
3. **Shift window.** Is the 9-hour shift anchored to fixed office hours, or does it start
   whenever the employee punches in? The implementation assumes the latter.
4. **Overnight shifts.** Shifts open past midnight are auto-closed at the configured cutoff and
   flagged. Is that right for employees who legitimately work late?
5. **Consent revocation.** An employee can revoke audio consent. Does previously captured audio
   get purged immediately, or age out at 31 days as usual? Currently: ages out.
6. **Who counts as Admin?** The spec has one admin role. HR, a team lead, and an IT
   administrator plausibly need different views — is a single role enough for rollout?
