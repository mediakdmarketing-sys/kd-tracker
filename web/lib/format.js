// Formatting helpers shared by server and client components.
//
// Every function takes an explicit timezone and never reads the machine's local zone, so the
// server render and the browser render produce identical strings — otherwise React would
// report a hydration mismatch on every timestamp on the page.

export const DEFAULT_TZ = 'Asia/Kolkata';

// Module-level regex — compiled once, reused on every call.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Intl.DateTimeFormat instance cache
//
// Constructing a new Intl.DateTimeFormat on every call is expensive. With 50
// audit-log rows × 2 time() calls each that is 100 constructions per render.
// The cache is keyed on a stable string derived from the options so the same
// formatter is reused across every row in a table.
// ---------------------------------------------------------------------------
const _fmtCache = new Map();

function _fmt(locale, options) {
  const key = locale + '|' + JSON.stringify(options);
  if (!_fmtCache.has(key)) _fmtCache.set(key, new Intl.DateTimeFormat(locale, options));
  return _fmtCache.get(key);
}

// ---------------------------------------------------------------------------
// Public formatters
// ---------------------------------------------------------------------------

export function time(iso, tz = DEFAULT_TZ) {
  if (!iso) return '—';
  try {
    const parts = _fmt('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
  } catch {
    return '—';
  }
}

export function dateLabel(value, tz = DEFAULT_TZ) {
  if (!value) return '—';
  const isDate = DATE_RE.test(value);
  const d = isDate ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return _fmt('en-GB', {
    timeZone: isDate ? 'UTC' : tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

export function dayName(value) {
  if (!DATE_RE.test(value || '')) return '';
  return _fmt('en-GB', { timeZone: 'UTC', weekday: 'short' }).format(
    new Date(`${value}T12:00:00Z`)
  );
}

/** 27900 -> "7h 45m", 37 -> "37s" */
export function duration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (!h) return `${m}m`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** 27900 -> "07:45:00", for the live shift clock. */
export function clock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

export function hours(seconds) {
  return (Math.max(0, seconds || 0) / 3600).toFixed(2);
}

/** Today's calendar date in a given zone, as YYYY-MM-DD. */
export function todayIn(tz = DEFAULT_TZ) {
  return _fmt('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function daysAgoDate(days, tz = DEFAULT_TZ) {
  return _fmt('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - days * 86400000));
}

export function currentMonth(tz = DEFAULT_TZ) {
  return todayIn(tz).slice(0, 7);
}

export const isOpenShift = (shift) => Boolean(shift) && shift.status !== 'closed';

/**
 * Worked seconds for a shift, including one that is still running.
 * For an open shift we also deduct any currently-running break so the live
 * display stays accurate between polls.
 */
export function workedSecondsOf(shift, now = Date.now()) {
  if (!shift) return 0;
  if (shift.totalWorkedSeconds !== null && shift.totalWorkedSeconds !== undefined) {
    return shift.totalWorkedSeconds;
  }
  const elapsed = Math.floor((now - new Date(shift.punchIn).getTime()) / 1000);
  const completedBreaks = shift.totalBreakSeconds || 0;
  const liveBreak = (shift.breaks || []).reduce((acc, b) => {
    if (b.end) return acc;
    return acc + Math.max(0, Math.floor((now - new Date(b.start).getTime()) / 1000));
  }, 0);
  return Math.max(0, elapsed - completedBreaks - liveBreak);
}

/**
 * Total break seconds for a shift, including any currently-running break.
 * Use this instead of shift.totalBreakSeconds directly so live breaks count.
 */
export function breakSecondsOf(shift, now = Date.now()) {
  if (!shift) return 0;
  const completed = shift.totalBreakSeconds || 0;
  if (!isOpenShift(shift)) return completed;
  const liveBreak = (shift.breaks || []).reduce((acc, b) => {
    if (b.end) return acc;
    return acc + Math.max(0, Math.floor((now - new Date(b.start).getTime()) / 1000));
  }, 0);
  return completed + liveBreak;
}

export const STATE_LABEL = {
  working: 'Working',
  on_break: 'On break',
  punched_out: 'Punched out',
  not_started: 'Not started',
};

export const STATE_CLASS = {
  working: 'pill-working',
  on_break: 'pill-break',
  punched_out: 'pill-out',
  not_started: 'pill-none',
};
