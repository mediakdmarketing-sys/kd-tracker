import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE, clearSession, apiUrl } from '@/lib/session';

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;

  if (refreshToken) {
    try {
      // Revoke server-side too, so the token is dead even if the cookie survives somewhere.
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
    } catch {
      // The cookie still gets cleared below — a network failure must not trap the user in a
      // session they asked to end.
    }
  }

  clearSession(jar);
  return NextResponse.json({ ok: true });
}
