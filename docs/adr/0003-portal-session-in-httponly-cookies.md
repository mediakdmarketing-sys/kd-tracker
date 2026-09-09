# ADR-0003 — The portal keeps its session in httpOnly cookies, behind a BFF

**Status:** Accepted (Sprint 6)

## Context

The API issues JWTs. The obvious portal implementation stores the access token in
`localStorage` and attaches it from the browser. This portal, though, displays screenshots and
audio recordings of employees at work. A single XSS on any page would hand an attacker a token
that reads all of it — and, because refresh tokens last 14 days, would keep working long after
the bug was patched.

## Decision

The browser never holds a token.

1. `POST /bff/login` exchanges credentials for tokens **server-side** and writes them into
   `httpOnly`, `SameSite=Lax`, `Secure`-in-production cookies. Only the employee profile is
   returned to the page.
2. React Server Components call the API directly with the access token read from the cookie.
   The token never enters a client bundle or a network response.
3. Browser-side calls (punch buttons, the live board poll, CSV downloads, screenshot files) go
   to `/bff/api/...`, a catch-all proxy that attaches the token server-side. It forwards only
   paths beginning `api/`, so it cannot be turned into an open proxy.
4. **Refresh happens in `middleware.js`**, not in the pages. A Server Component cannot set a
   cookie during render, so it has nowhere to store a rotated refresh token. Middleware can,
   and it runs ahead of both page renders and BFF calls — one implementation covers everything.
   It refreshes 60 seconds before expiry so no request starts with a token that dies in flight.

## Consequences

- XSS in the portal can still *act* as the user while they are on the page, but it cannot
  exfiltrate a credential that outlives the session. That is a meaningful reduction.
- Every browser-side call takes an extra hop through Next. At 60 employees this is irrelevant;
  at much larger scale the proxy is the first thing to measure.
- The portal cannot be deployed as a static export — it needs the Node runtime for the BFF
  routes and middleware. That is already true for the server-rendered pages.
- If the API becomes unreachable, middleware deliberately lets the request through rather than
  redirecting to `/login`: bouncing someone to a login screen that will also fail hides the
  real problem. The page shows the error instead.

## Related decision: screenshot thumbnails do not auto-load

Fetching a screenshot file writes an `audit_logs` row — that is the compliance promise. A grid
of 57 auto-loading thumbnails therefore stamped 57 "opened a screenshot" entries every time an
admin glanced at a day, burying the deliberate views the log exists to surface.

Tiles now render as placeholders and load on click ("Open all" is available for a genuine
review session). The log records intent rather than page loads; that an admin browsed the day
at all is already captured by the `listed_screenshots` entry.
