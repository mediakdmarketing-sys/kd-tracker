import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE, OWNER_REFRESH_COOKIE, clearSession, clearOwnerSession, apiUrl } from '@/lib/session';

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      // Revoke server-side too, so the token is dead even if the cookie survives somewhere.
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
    } catch {
      // The cookie still gets cleared below — a network failure must not trap the user in a
      // session they asked to end.
    }
  }

  // Signing out while viewing as someone ends the owner's parked session too.
  const parked = jar.get(OWNER_REFRESH_COOKIE)?.value;
  if (parked) {
    try {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
        body: JSON.stringify({ refreshToken: parked }),
        cache: 'no-store',
      });
    } catch {
      // Cleared below regardless.
    }
  }
  clearOwnerSession(jar);
  clearSession(jar);
  return NextResponse.json({ ok: true });
}
