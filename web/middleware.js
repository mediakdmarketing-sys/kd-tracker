import { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  EXPIRY_COOKIE,
  writeSession,
  clearSession,
  parseDuration,
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
 * One session per browser (see lib/session.js) — this is the only place that reads or writes
 * the session cookies, by their fixed names.
 */
export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken) return redirectToLogin(request);

  const accessToken  = request.cookies.get(ACCESS_COOKIE)?.value;
  const expiresAt    = Number(request.cookies.get(EXPIRY_COOKIE)?.value || 0);
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
  const newExpiry = Date.now() + parseDuration(refreshed.expiresIn, 30 * 60 * 1000);

  const headers = new Headers(request.headers);
  headers.set(
    'cookie',
    [
      `${ACCESS_COOKIE}=${refreshed.accessToken}`,
      `${REFRESH_COOKIE}=${refreshed.refreshToken}`,
      `${EXPIRY_COOKIE}=${newExpiry}`,
    ].join('; ')
  );

  const response = NextResponse.next({ request: { headers } });
  writeSession(response.cookies, {
    accessToken:  refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresIn:    refreshed.expiresIn,
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
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|offline.html|icons/|.*\\.(?:svg|png|jpg|ico)$).*)',
  ],
};
