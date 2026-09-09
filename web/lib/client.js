'use client';

// Browser-side calls all go through the BFF proxy, which attaches the token server-side.
// There is deliberately no way for client code to read or send the access token itself.

export async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/bff${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isJson = res.headers.get('content-type')?.includes('json');
  const payload = isJson ? await res.json() : await res.text();

  // The session is over — either the token is outright invalid (401), or the account was
  // deactivated mid-session, which arrives as 403 ACCOUNT_DEACTIVATED rather than 401 because
  // the access token itself hasn't expired. A component-level error banner would leave the
  // employee stuck on a page where nothing they do will ever work; send them to sign in
  // instead, consistent with what a fresh page load already does (lib/api.js).
  if (res.status === 401 || (isJson && payload?.error?.code === 'ACCOUNT_DEACTIVATED')) {
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
