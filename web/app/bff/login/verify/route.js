import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeSession, apiUrl, clientHeaders } from '@/lib/session';

/** The code step of a two-step sign-in: the challenge from /bff/login plus a code (or recovery code). */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
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
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', ...clientHeaders(request.headers) },
      body: JSON.stringify({ challengeToken: body.challengeToken, code: body.code, recoveryCode: body.recoveryCode }),
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
  return NextResponse.json({ employee: payload.employee });
}
