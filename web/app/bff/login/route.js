import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeSession, apiUrl, clientHeaders } from '@/lib/session';

/**
 * Exchanges credentials for a session. Tokens are written into httpOnly cookies, one session per
 * browser (see lib/session.js).
 *
 * When the account uses two-step sign-in, the password alone does not give a session: the reply is
 * { twoFactorRequired, challengeToken }, and the code step (/bff/login/verify) finishes the sign-in.
 */
export async function POST(request) {
  let email;
  let password;
  try {
    ({ email, password } = await request.json());
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  let res;
  try {
    res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', ...clientHeaders(request.headers) },
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

  // Password right, code still to come: nothing is stored yet.
  if (payload.twoFactorRequired) {
    return NextResponse.json({ twoFactorRequired: true, challengeToken: payload.challengeToken });
  }

  writeSession(await cookies(), {
    accessToken:  payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresIn:    payload.expiresIn,
  });

  // Only the profile crosses back to the browser.
  return NextResponse.json({ employee: payload.employee });
}
