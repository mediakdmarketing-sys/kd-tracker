// Session cookie contract, shared by the BFF routes, middleware and server components.
//
// Tokens live in httpOnly cookies, never in localStorage. This portal shows screenshots and
// audio of employees at work; a stored-token XSS would hand that to an attacker permanently.
//
// One session per browser. An earlier version of this file scoped cookie names per employee id
// (kd_at_<uid>, kd_rt_<uid>, ...) plus a shared kd_uid cookie naming which one was "active", to
// let two employees be signed in from the same browser at once. That kd_uid cookie is not
// scoped to a tab — it is one value shared by every tab on the origin — so signing in as a
// second employee in one tab silently redirected every *other* tab's session to that second
// employee too, with no indication anything had changed. A tab showing the admin dashboard
// would start silently acting as whoever most recently signed in anywhere else in the browser,
// including into lower-privileged accounts, which is what a "Requires role: admin" surfacing on
// a page that had been working moments before turned out to mean.
//
// No real deployment needs concurrent multi-employee sessions in one browser — each employee
// has their own machine — so the fix is to remove the shared pointer rather than deepen it.

export const ACCESS_COOKIE  = 'kd_at';
export const REFRESH_COOKIE = 'kd_rt';
export const EXPIRY_COOKIE  = 'kd_exp';

const SECURE = process.env.COOKIE_SECURE === '1' || process.env.NODE_ENV === 'production';

const baseOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: SECURE,
  path: '/',
};

/** "30m" / "14d" -> milliseconds. Mirrors the backend's JWT_EXPIRES_IN format. */
export function parseDuration(spec, fallbackMs) {
  const match = /^(\d+)([smhd])$/.exec(String(spec || ''));
  if (!match) return fallbackMs;
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2]];
  return Number(match[1]) * mult;
}

/**
 * Write the session for this browser.
 * @param {{ set: Function }} jar  a cookies() store or a NextResponse.cookies
 * @param {{ accessToken, refreshToken, expiresIn }} session
 */
export function writeSession(jar, { accessToken, refreshToken, expiresIn }) {
  const accessMs  = parseDuration(expiresIn, 30 * 60 * 1000);
  const expiresAt = Date.now() + accessMs;
  const refreshMaxAge = 14 * 24 * 60 * 60;

  jar.set(ACCESS_COOKIE,  accessToken,      { ...baseOptions, maxAge: Math.floor(accessMs / 1000) });
  jar.set(REFRESH_COOKIE, refreshToken,     { ...baseOptions, maxAge: refreshMaxAge });
  jar.set(EXPIRY_COOKIE,  String(expiresAt),{ ...baseOptions, maxAge: refreshMaxAge });
}

/** Clear the session for this browser. */
export function clearSession(jar) {
  const zero = { ...baseOptions, maxAge: 0 };
  jar.set(ACCESS_COOKIE,  '', zero);
  jar.set(REFRESH_COOKIE, '', zero);
  jar.set(EXPIRY_COOKIE,  '', zero);
}

/**
 * Headers that tell the backend who is really signing in. The backend sees this server's address,
 * not the visitor's, so for sign-in and token refresh the visitor's address and browser go along,
 * with the shared key (BFF_KEY, the same value as on the backend) that proves they come from here.
 * Without the key set, nothing extra is sent and the backend uses what it can see itself.
 *
 * @param {Headers} requestHeaders the incoming request's headers
 */
export function clientHeaders(requestHeaders) {
  const key = process.env.BFF_KEY;
  if (!key) return {};
  const forwarded = requestHeaders.get('x-forwarded-for') || requestHeaders.get('x-real-ip') || '';
  return {
    'X-BFF-Key': key,
    'X-Client-IP': forwarded.split(',')[0].trim(),
    'X-Client-UA': (requestHeaders.get('user-agent') || '').slice(0, 255),
  };
}

export function apiUrl(path) {
  const base = process.env.API_BASE_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}${path}`;
}
