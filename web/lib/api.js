import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, apiUrl } from './session';

/**
 * Server-side API call for React Server Components.
 *
 * Refresh is handled by middleware before this ever runs, so a 401 here genuinely means the
 * session is finished. Never called from the browser — the access token stays on the server.
 */
export async function api(path, { method = 'GET', body, cache = 'no-store' } = {}) {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;

  let res;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache,
    });
  } catch {
    throw new ApiUnreachable();
  }

  const payload = res.headers.get('content-type')?.includes('json') ? await res.json() : null;

  // A 401 means the session is over (middleware already tried refreshing before this ran).
  // ACCOUNT_DEACTIVATED is a 403, not a 401 — the access token itself is still cryptographically
  // valid, so middleware's time-based refresh check never fires for it — but it means exactly
  // the same thing for this page: the session cannot continue. Without this, an employee
  // deactivated mid-session (or mid-shift) hit the generic error boundary instead of being
  // routed back to sign-in like every other "you're not signed in anymore" case.
  if (res.status === 401 || payload?.error?.code === 'ACCOUNT_DEACTIVATED') {
    redirect('/login');
  }

  if (!res.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export class ApiUnreachable extends Error {
  constructor() {
    super('The API is not reachable. Is the backend running on ' + (process.env.API_BASE_URL || 'http://localhost:4000') + '?');
    this.name = 'ApiUnreachable';
  }
}

/** The signed-in employee, or a redirect to the login page. */
export async function getSessionUser() {
  return api('/api/auth/me');
}

/**
 * Gate for every signed-in page: no consent, no portal.
 *
 * The consent screen has to be unavoidable rather than a link somebody can skip — the
 * employee sees exactly what is captured before any capture is possible.
 */
export async function requireUser({ adminOnly = false } = {}) {
  const user = await getSessionUser();

  if (user.consent.required) redirect('/consent');
  if (adminOnly && user.role !== 'admin') redirect('/me');

  return user;
}
