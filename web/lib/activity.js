// Activity-level scoring — a display transform of the keystroke/mouse counts the desktop
// agent already sends (backend/src/modules/capture/capture.routes.js's activityEntrySchema).
// Nothing new is captured; this only turns existing counts into the 0-100% "how busy was this
// minute" figure Hubstaff calls an activity level.
//
// The agent samples in ACTIVITY_WINDOW_SECONDS = 60s windows (desktop-agent/src/main/index.js).
// 40 combined key/mouse events in one such window is treated as "fully active" (100%) — a
// realistic ceiling for continuous work, not a literal max-possible-events count.
const EVENTS_PER_FULL_MINUTE = 40;

/** One activity_logs row -> 0-100. */
export function activityPercent(entry) {
  const events = (entry?.keystrokeCount || 0) + (entry?.mouseCount || 0);
  return Math.max(0, Math.min(100, Math.round((events / EVENTS_PER_FULL_MINUTE) * 100)));
}

/**
 * Average across a list of entries. Returns null (not 0) when there is nothing to average,
 * so callers can show "no activity data" instead of a misleading 0%.
 *
 * Caveat worth surfacing to whoever reads this: counts are only ever non-zero when the agent's
 * optional uiohook-napi module is installed (see desktop-agent/src/main/activity.js). Without
 * it every row's counts are legitimately 0 even during a fully active shift — the row still
 * gets sent (via the OS idle timer), just with no count data in it. A 0% average here can mean
 * "genuinely idle" or "counts unavailable" and this function cannot tell those apart; it is a
 * gap in what the agent reports, not a bug in the average.
 */
export function averageActivity(entries) {
  if (!entries?.length) return null;
  const total = entries.reduce((sum, e) => sum + activityPercent(e), 0);
  return Math.round(total / entries.length);
}
