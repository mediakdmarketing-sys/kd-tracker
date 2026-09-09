# ADR-0004 — The offline contract

**Status:** Accepted (Sprint 6.5)

## Context

The employees are working from home, on domestic connections. A dropped connection is normal
operating conditions, not an exception — and the desktop agent (Sprint 7) will therefore queue
work locally and drain it on reconnect.

That turns three things from edge cases into everyday events:

1. **Retries.** A lost response is indistinguishable from a failed request, so the agent must
   retry — including requests the server already processed.
2. **Late timestamps.** A punch-in replayed two hours after the fact must not be recorded as
   having happened two hours late; the employee would lose the time.
3. **Long silences.** No activity pings for two hours looks exactly like an idle employee.

The agent cannot solve any of these on its own. They are API guarantees, so they were built
before the agent rather than retrofitted around it.

## Decisions

### 1. `captureId` — replay is recognised, not duplicated

Screenshot, audio and activity uploads accept a client-generated `captureId` (a UUID, unique
per artefact, identical on every retry). A second arrival returns the row already stored, with
`duplicate: true`, and writes no file.

- The check runs **before** the "must have an open shift" rule, so a replay is not rejected
  because the shift it belonged to has since closed — which would leave the agent retrying an
  item it can never deliver.
- The check runs **after** the audio consent gate. A sample queued before consent was withdrawn
  is still refused on replay.
- The storage key uses a server-generated id, never the client's `captureId`.
- Uniqueness is enforced by a database constraint, not only by the pre-check, so two retries
  in flight at once cannot both win. The loser deletes the file it just wrote.

Without this, every lost response left an orphan screenshot on disk and duplicated activity
rows — and duplicated activity is worse than useless: it inflates keystroke counts and fills
in exactly the gaps idle detection exists to find.

### 2. Rotation grace window — a lost response does not end the shift

Refresh tokens rotate on every use. That leaves a race: the server rotates, the response is
lost, and the client still holds a token it has no way of knowing is spent. Strict rotation
signs the employee out mid-shift, on precisely the connection this work exists to survive.

A rotated token therefore stays usable for `REFRESH_GRACE_SECONDS` (default 120).

- `revoked_at` is **not** advanced on a grace-window reuse, so retries cannot slide the window
  forward indefinitely.
- Reuse *after* the window is the signature of a stolen token — the legitimate client has a
  replacement and would not present this one. Every session for that employee is revoked.
- The window applies **only** to `revoked_reason = 'rotated'`. A token killed by a sign-out, an
  HR action, or a previous theft response is dead immediately. Without this distinction,
  signing out would leave a two-minute hole in which the old token still worked — a bug this
  design had until the tests caught it.

### 3. Timestamps are claimed by the client and judged by the server

Queued events carry the time they actually happened. That is the one place a client can
influence its own attendance record, so every claimed time passes through `utils/eventTime`.

| Rule | Value | Behaviour |
|---|---|---|
| Clock skew | `MAX_CLOCK_SKEW_SECONDS` (120) | A timestamp further ahead than this is **rejected**. A future capture is a broken clock or an attempt to stretch a shift. |
| Capture age | `MAX_CAPTURE_AGE_DAYS` (7) | Older captures are **rejected** — they would be near the end of their 31-day retention on arrival. |
| Punch backdating | `MAX_BACKDATE_HOURS` (4) | Inside the window, honoured. Beyond it, the **server's own time is recorded** and the shift is flagged for HR. |
| Ordering | — | A punch-out before its punch-in, or a break-end before its break-start, is **rejected**. |

`attendance.source` records `live` / `queued` / `admin`, and `punch_in_received_at` records
when the server actually heard about it. The gap between the two is what HR needs to judge a
queued shift. `source` is derived server-side and never accepted from the request — a client
must not be able to label its own punch as an HR correction.

**Why 4 hours** (the number was the customer's call): it is a quarter of a shift, enough to
cover any genuine home-broadband outage. A gap longer than that is not a network blip, and the
right answer needs a human rather than a default. Inside the window the employee loses nothing
to a bad connection; beyond it, nobody is silently credited hours they may not have worked, and
the flag plus `source` lets HR see patterns across a month.

### 4. Rate limit headroom for a drain

The upload limit went from 120 to 240 per hour per employee. A full-day outage means roughly 96
queued screenshots plus retries; hitting the limit mid-drain would leave the backlog stuck
rather than merely slowed. 240 is still an order of magnitude above steady-state use.

## Consequences

- The agent can be written against a stable contract: assign a `captureId`, keep retrying until
  a 2xx or a 4xx that is not `429`, and send the original timestamp. No server change needed.
- `capture_id` is nullable, so rows written before this decision are unaffected and the
  unique index tolerates them (NULLs do not collide on either engine).
- The theft response is deliberately blunt: it signs the employee out of the portal *and* the
  agent. A false positive costs one login; the alternative costs a live session to whoever
  holds the stolen token.
- Backdating within 4 hours is trusted. That trust is auditable rather than blind — `source`
  and `punch_in_received_at` make every queued punch visible to HR.
