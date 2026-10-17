'use client';

// Browser-side calls all go through the BFF proxy, which attaches the token server-side.
// There is deliberately no way for client code to read or send the access token itself.

const RELOAD_GUARD_KEY = 'kd_truncated_reload_at';
const RELOAD_GUARD_MS = 15_000;

/** Reloads the page unless it already did so moments ago. Returns whether it reloaded. */
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: reload anyway rather than leave the error on screen.
  }
  window.location.reload();
  return true;
}

export async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/bff${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('json');
  const text = await res.text();

  let payload = text;
  if (isJson) {
    try {
      payload = JSON.parse(text);
    } catch {
      // The reply arrived cut short (a flaky connection or proxy). The server has already acted
      // on the request, so showing "Unterminated string in JSON…" helps nobody; reloading shows
      // the real, current state. Once per few seconds at most, so a persistent fault cannot loop.
      if (reloadOnce()) return new Promise(() => {});
      throw new Error('The connection dropped before the reply arrived. Please try again.');
    }
  }

  // The session is over — either the token is outright invalid (401), or the account was
  // deactivated mid-session, which arrives as 403 ACCOUNT_DEACTIVATED rather than 401 because
  // the access token itself hasn't expired. A component-level error banner would leave the
  // employee stuck on a page where nothing they do will ever work; send them to sign in
  // instead, consistent with what a fresh page load already does (lib/api.js).
  // The sign-in call itself is exempt: there is no session to end, and a 401 there means
  // "wrong password" — redirecting would reload the page and swallow the error message.
  const isLoginCall = path === '/login';
  if (!isLoginCall && (res.status === 401 || (isJson && payload?.error?.code === 'ACCOUNT_DEACTIVATED'))) {
    window.location.href = '/login';
    // Never resolves: the navigation above is about to tear this page down anyway, and
    // nothing calling `call()` should try to render a result for a session that just ended.
    return new Promise(() => {});
  }

  if (!res.ok) {
    const error = new Error(payload?.error?.message || `Request failed (${res.status})`);
    error.status = res.status;
    error.code = payload?.error?.code;
    throw error;
  }
  return payload;
}

export const post = (path, body) => call(path, { method: 'POST', body });
export const patch = (path, body) => call(path, { method: 'PATCH', body });
