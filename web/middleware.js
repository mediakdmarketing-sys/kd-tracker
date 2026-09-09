import { NextResponse } from 'next/server';
import {
  sessionCookieNames,
  writeSession,
  clearSession,
  parseDuration,
  UID_COOKIE,
  apiUrl,
} from '@/lib/session';

const PUBLIC_PATHS = ['/login', '/bff/login'];

/**
 * Token refresh happens here rather than in the pages.
 *
 * A React Server Component cannot set a cookie during render, so it has no way to store a
 * rotated refresh token. Middleware can, and it runs before both page renders and BFF calls —
 * so one implementation covers the whole portal.
 *
 * Per-user isolation: reads kd_uid to find the scoped cookie names for the active user.
 * Falls back to legacy names (kd_at / kd_rt / kd_exp) for sessions created before this
 * change so a rolling deploy does not log everyone out.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const names = sessionCookieNames(request.cookies);
  const refreshToken = request.cookies.get(names.refresh)?.value;
  if (!refreshToken) return redirectToLogin(request);

  const accessToken  = request.cookies.get(names.access)?.value;
  const expiresAt    = Number(request.cookies.get(names.expiry)?.value || 0);
  // Refresh a minute early so a request never starts with a token that expires mid-flight.
  const needsRefresh = !accessToken || Date.now() > expiresAt - 60_000;

  if (!needsRefresh) return NextResponse.next();

  let refreshed;
  try {
    const res = await fetch(apiUrl('/api/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (!res.ok) {
      const response = redirectToLogin(request);
      clearSession(response.cookies);
      return response;
    }
    refreshed = await res.json();
  } catch {
    // API unreachable — let the request through; the page shows a real error.
    return NextResponse.next();
  }

  // Patch the in-flight request's cookie header so this same request sees the new token.
  const uid = names.uid ?? refreshed.employee?.id ?? null;
  const newAccessCookie  = uid ? `kd_at_${uid}`  : 'kd_at';
  const newRefreshCookie = uid ? `kd_rt_${uid}`  : 'kd_rt';
  const newExpiryCookie  = uid ? `kd_exp_${uid}` : 'kd_exp';
  const newExpiry = Date.now() + parseDuration(refreshed.expiresIn, 30 * 60 * 1000);

  const headers = new Headers(request.headers);
  const cookieParts = [
    `${newAccessCookie}=${refreshed.accessToken}`,
    `${newRefreshCookie}=${refreshed.refreshToken}`,
    `${newExpiryCookie}=${newExpiry}`,
  ];
  if (uid) cookieParts.push(`${UID_COOKIE}=${uid}`);
  headers.set('cookie', cookieParts.join('; '));

  const response = NextResponse.next({ request: { headers } });
  writeSession(response.cookies, {
    accessToken:  refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresIn:    refreshed.expiresIn,
    employeeId:   uid,
  });
  return response;
}

function redirectToLogin(request) {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = request.nextUrl.pathname === '/' ? '' : `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)'],
};
