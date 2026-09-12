import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeSession, apiUrl } from '@/lib/session';

/**
 * Exchanges credentials for a session. Tokens are written into httpOnly cookies scoped to
 * this employee's id — two users logged in from the same browser get independent sessions.
 */
export async function POST(request) {
  const { email, password } = await request.json();

  let res;
  try {
    res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, client: 'web' }),
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_UNREACHABLE', message: 'Cannot reach the server. Please try again.' } },
      { status: 503 }
    );
  }

  const payload = await res.json();
  if (!res.ok) return NextResponse.json(payload, { status: res.status });

  writeSession(await cookies(), {
    accessToken:  payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresIn:    payload.expiresIn,
  });

  // Only the profile crosses back to the browser.
  return NextResponse.json({ employee: payload.employee });
}
