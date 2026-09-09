// Session cookie contract, shared by the BFF routes, middleware and server components.
//
// Tokens live in httpOnly cookies, never in localStorage. This portal shows screenshots and
// audio of employees at work; a stored-token XSS would hand that to an attacker permanently.
//
// Per-user isolation: cookie names are scoped with the employee id so two users logged in
// from the same browser (e.g. HR checking employee view, or a shared kiosk) each get their
// own independent session — logging one user out does not affect the other.
//
// Cookie layout per user:
//   kd_at_<uid>   — httpOnly access token
//   kd_rt_<uid>   — httpOnly refresh token
//   kd_exp_<uid>  — httpOnly expiry hint (ms epoch, for proactive refresh)
//   kd_uid        — readable (not httpOnly) — the currently-active uid for this tab/profile.
//                   Set on login, cleared on logout of the last session.

export const UID_COOKIE = 'kd_uid';

export function accessCookie(uid)  { return `kd_at_${uid}`; }
export function refreshCookie(uid) { return `kd_rt_${uid}`; }
export function expiryCookie(uid)  { return `kd_exp_${uid}`; }

// Legacy names kept so existing deployed sessions survive a rolling deploy.
// Middleware falls back to these if no kd_uid cookie is found.
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
 * Write a full session for the given employee id.
 * @param {{ set: Function }} jar  a cookies() store or a NextResponse.cookies
 * @param {{ accessToken, refreshToken, expiresIn, employeeId }} session
 */
export function writeSession(jar, { accessToken, refreshToken, expiresIn, employeeId }) {
  const uid = employeeId;
  const accessMs  = parseDuration(expiresIn, 30 * 60 * 1000);
  const expiresAt = Date.now() + accessMs;
  const refreshMaxAge = 14 * 24 * 60 * 60;

  if (uid) {
    // Scoped cookies — one set per user.
    jar.set(accessCookie(uid),  accessToken,     { ...baseOptions, maxAge: Math.floor(accessMs / 1000) });
    jar.set(refreshCookie(uid), refreshToken,    { ...baseOptions, maxAge: refreshMaxAge });
    jar.set(expiryCookie(uid),  String(expiresAt),{ ...baseOptions, maxAge: refreshMaxAge });
    // kd_uid is readable (not httpOnly) so client-side code can tell which user is active;
    // it does not carry any secret value.
    jar.set(UID_COOKIE, uid, {
      httpOnly: false,
      sameSite: 'lax',
      secure: SECURE,
      path: '/',
      maxAge: refreshMaxAge,
    });
  } else {
    // Fallback: legacy unscoped cookies (backwards compatibility for old tokens that do not
    // carry employee id in the payload).
    jar.set(ACCESS_COOKIE,  accessToken,      { ...baseOptions, maxAge: Math.floor(accessMs / 1000) });
    jar.set(REFRESH_COOKIE, refreshToken,     { ...baseOptions, maxAge: refreshMaxAge });
    jar.set(EXPIRY_COOKIE,  String(expiresAt),{ ...baseOptions, maxAge: refreshMaxAge });
  }
}

/**
 * Resolve which cookie names to use for this request.
 * Reads kd_uid from the jar; falls back to legacy names when absent.
 */
export function sessionCookieNames(jar) {
  const uid = jar.get?.(UID_COOKIE)?.value ?? null;
  if (uid) {
    return {
      uid,
      access:  accessCookie(uid),
      refresh: refreshCookie(uid),
      expiry:  expiryCookie(uid),
    };
  }
  return {
    uid: null,
    access:  ACCESS_COOKIE,
    refresh: REFRESH_COOKIE,
    expiry:  EXPIRY_COOKIE,
  };
}

/**
 * Clear the session for the currently-active user.
 * Clears both scoped and legacy names so a mixed-state browser is fully cleaned up.
 */
export function clearSession(jar) {
  const uid = jar.get?.(UID_COOKIE)?.value ?? null;
  const zero = { ...baseOptions, maxAge: 0 };

  if (uid) {
    jar.set(accessCookie(uid),  '', zero);
    jar.set(refreshCookie(uid), '', zero);
    jar.set(expiryCookie(uid),  '', zero);
  }
  // Always clear legacy names too.
  jar.set(ACCESS_COOKIE,  '', zero);
  jar.set(REFRESH_COOKIE, '', zero);
  jar.set(EXPIRY_COOKIE,  '', zero);
  jar.set(UID_COOKIE, '', { ...zero, httpOnly: false });
}

export function apiUrl(path) {
  const base = process.env.API_BASE_URL || 'http://localhost:4000';
  return `${base.replace(/\/$/, '')}${path}`;
}
