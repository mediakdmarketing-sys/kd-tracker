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

// While the platform owner is viewing as someone, their own session waits in these cookies.
export const OWNER_ACCESS_COOKIE  = 'kd_sa_at';
export const OWNER_REFRESH_COOKIE = 'kd_sa_rt';
export const OWNER_EXPIRY_COOKIE  = 'kd_sa_exp';

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

/** Put the parked owner session back, on a response (used by middleware, which has no cookie jar). */
export function restoreOwnerOnResponse(request, response) {
  const refresh = request.cookies.get(OWNER_REFRESH_COOKIE)?.value;
  if (!refresh) return false;
  const opts = { ...baseOptions, maxAge: 14 * 24 * 60 * 60 };
  response.cookies.set(ACCESS_COOKIE,  request.cookies.get(OWNER_ACCESS_COOKIE)?.value || '', opts);
  response.cookies.set(REFRESH_COOKIE, refresh, opts);
  response.cookies.set(EXPIRY_COOKIE,  request.cookies.get(OWNER_EXPIRY_COOKIE)?.value || '0', opts);
  clearOwnerSession(response.cookies);
  return true;
}

/** Parks the current session in the owner cookies, so a view-as session can take its place. */
export function stashOwnerSession(jar) {
  const refreshMaxAge = 14 * 24 * 60 * 60;
  const opts = { ...baseOptions, maxAge: refreshMaxAge };
  jar.set(OWNER_ACCESS_COOKIE,  jar.get(ACCESS_COOKIE)?.value  || '', opts);
  jar.set(OWNER_REFRESH_COOKIE, jar.get(REFRESH_COOKIE)?.value || '', opts);
  jar.set(OWNER_EXPIRY_COOKIE,  jar.get(EXPIRY_COOKIE)?.value  || '', opts);
}

/** Puts the parked owner session back as the session. Returns false if there was none. */
export function restoreOwnerSession(jar) {
  const refresh = jar.get(OWNER_REFRESH_COOKIE)?.value;
  if (!refresh) return false;
  const refreshMaxAge = 14 * 24 * 60 * 60;
  const opts = { ...baseOptions, maxAge: refreshMaxAge };
  jar.set(ACCESS_COOKIE,  jar.get(OWNER_ACCESS_COOKIE)?.value || '', opts);
  jar.set(REFRESH_COOKIE, refresh, opts);
  jar.set(EXPIRY_COOKIE,  jar.get(OWNER_EXPIRY_COOKIE)?.value || '0', opts);
  clearOwnerSession(jar);
  return true;
}

export function clearOwnerSession(jar) {
  const zero = { ...baseOptions, maxAge: 0 };
  jar.set(OWNER_ACCESS_COOKIE,  '', zero);
  jar.set(OWNER_REFRESH_COOKIE, '', zero);
  jar.set(OWNER_EXPIRY_COOKIE,  '', zero);
}

export function apiUrl(path) {
  const base = process.env.API_BASE_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}${path}`;
}
