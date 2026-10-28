import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { REFRESH_COOKIE, clearSession, restoreOwnerSession, apiUrl } from '@/lib/session';

/** Ends the view-as session and gives the platform owner their own session back. */
export async function POST() {
  const jar = await cookies();
  const viewAsRefresh = jar.get(REFRESH_COOKIE)?.value;

  if (viewAsRefresh) {
    try {
      // Revoked server-side, which also writes the end of the session to the company's audit trail.
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
        body: JSON.stringify({ refreshToken: viewAsRefresh }),
        cache: 'no-store',
      });
    } catch {
      // Still handed back below: a network error must not strand the owner in someone else's session.
    }
  }

  if (!restoreOwnerSession(jar)) {
    clearSession(jar);
    return NextResponse.json({ ok: true, signedOut: true });
  }
  return NextResponse.json({ ok: true });
}
