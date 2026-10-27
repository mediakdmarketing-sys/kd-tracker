// What the company's plan includes, as set by the platform owner. Pages hide what is off, and
// skip the API calls behind it (which would answer 403 FEATURE_DISABLED).

export const EMPTY_PAGE = { data: [], pagination: { page: 1, limit: 0, total: 0 } };
export const EMPTY_MIC_LOG = { periods: [] };

/** `has('payroll')` -> boolean. Anything the server does not mention counts as on. */
export function featuresOf(user) {
  const features = user?.company?.features || {};
  return (name) => features[name] !== false;
}

/** Runs `load` only if the feature is on; otherwise resolves to `empty` without a request. */
export function when(on, load, empty = EMPTY_PAGE) {
  return on ? load() : Promise.resolve(empty);
}

/** What the platform owner can switch on or off per company. Time tracking itself is always on. */
export const FEATURE_LIST = [
  { key: 'screenCapture', label: 'Screen capture', help: 'Periodic screenshots while the employee is working.' },
  { key: 'audioCapture', label: 'Mic recording', help: 'Short audio samples, mic-muted alerts and the mic log.' },
  { key: 'idleTracking', label: 'Idle time', help: 'Activity pings, idle time and the productivity score.' },
  { key: 'payroll', label: 'Payroll', help: 'Monthly payroll summaries and export.' },
  { key: 'leave', label: 'Leave', help: 'Leave requests, approvals and proof files.' },
];

/** Every IANA zone this browser knows, for a company's time zone picker. */
export function timeZoneNames() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/New_York', 'Asia/Kolkata', 'Asia/Colombo', 'Europe/London'];
  }
}
