# ADR-0005 — A capture is a group of displays, not a single image

**Status:** Accepted (before Sprint 7)

## Context

Electron's `desktopCapturer.getSources({ types: ['screen'] })` returns **one source per
display**. The obvious implementation takes `sources[0]` and captures the primary monitor.

For a work-from-home team where external monitors are normal, that leaves an employee's second
screen invisible. Someone could do all their work there and every screenshot would show an
idle primary display — a blind spot that quietly defeats the purpose of the system, and one
nobody would notice from the admin portal because the screenshots look fine.

The existing schema assumed one image per capture: `screenshots` had a single `image_url`, and
after ADR-0004 a `capture_id` unique per row. Two displays captured at the same instant need
two rows, two `capture_id`s, and some way to say they belong together.

## Decision

**Capture every display. One row per display, grouped by `capture_group_id`.**

- `capture_group_id` — shared by every image from one capture moment. Defaults to the row's own
  `capture_id`, so a single-display capture is a group of one and the viewer has no special case.
- `display_index` (0-based, 0 = primary), `display_count`, `display_label`.
- `capture_id` stays unique per **row** — it is the replay key for one image (ADR-0004). The
  agent generates a fresh one per display.

**One HTTP upload per display**, not a batched request. A three-monitor capture would be a
~1 MB payload where one flaky upload loses all of it; per-display requests give retry
granularity for free, which matters on exactly the connections ADR-0004 exists for.

**Listing returns flat rows**, ordered newest-moment-first and primary-display-first, and the
client groups them. Grouping server-side would make a page of results vary in size depending on
how many monitors somebody happens to own.

Rejected alternatives:

- *Primary display only* — the blind spot above. If it is ever chosen for cost reasons, it has
  to be disclosed to employees and to HR, not left as an implementation detail.
- *Stitch all displays into one wide image* — one file, but unreadable at thumbnail size and
  impossible to tell which screen was which.

## Consequences

- **Storage roughly doubles for dual-monitor users.** At 60 employees, ~64 captures per 8-hour
  shift and ~250 KB per JPEG: about 30 GB for the 31-day window on single monitors, ~60 GB if
  everyone runs two. Trivial on S3 (a couple of dollars a month), significant for the local disk
  driver, and it doubles each employee's daily upload to ~64 MB — which is real load on a home
  connection and makes the offline queue more important, not less.
- Retention needs no change: the purge works per row, so N displays is simply N deletions.
- The agent must **re-enumerate displays on every capture**, never cache the list at startup —
  a monitor plugged in mid-shift would otherwise stay invisible for the rest of the day.
- The agent must set `thumbnailSize` from each display's `size × scaleFactor`. The
  `desktopCapturer` default is 150×150; leaving it produces a blurry thumbnail that is useless
  as evidence, and this is the single most common way this feature is got wrong.
- macOS needs the Screen Recording permission (TCC). One grant covers all displays, but it
  cannot be scripted — the agent has to detect that it is missing and tell the employee, or it
  will silently capture nothing.
- Linux under Wayland needs the PipeWire portal and may prompt per session; X11 is unaffected.

## What this does not solve

- **A second physical machine.** If an employee works on another laptop, no screen capture on
  this one can see it. That is a policy matter, not a technical one, and should not be
  presented to the customer as something the agent handles.
- **ChromeOS.** `chrome.desktopCapture` requires the user to choose a source from a picker each
  time, so silent capture of every display is not possible there. The extension's narrower
  reach is a platform limit, already noted in the original specification, and multi-monitor
  makes the gap wider.
