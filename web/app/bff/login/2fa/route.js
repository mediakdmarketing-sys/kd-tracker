import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeSession, clearOwnerSession, apiUrl } from '@/lib/session';

/** Second step of sign-in for a platform account: trades the challenge and a code for a session. */
export async function POST(request) {
  let challenge;
  let code;
  try {
    ({ challenge, code } = await request.json());
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  let res;
  try {
    res = await fetch(apiUrl('/api/auth/2fa/verify'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
      body: JSON.stringify({ challenge, code, client: 'web' }),
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

  const jar = await cookies();
  clearOwnerSession(jar);
  writeSession(jar, {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresIn: payload.expiresIn,
  });
  return NextResponse.json({ employee: payload.employee });
}
