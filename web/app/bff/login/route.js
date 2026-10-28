import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { writeSession, clearOwnerSession, apiUrl } from '@/lib/session';
import { resolveSlug } from '@/lib/brand';

/**
 * Exchanges credentials for a session. Tokens are written into httpOnly cookies scoped to
 * this employee's id — two users logged in from the same browser get independent sessions.
 */
export async function POST(request) {
  let email;
  let password;
  let companySlug;
  try {
    ({ email, password, companySlug } = await request.json());
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
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
      // Signing in on a company's own address is limited to that company; the address itself
      // wins over anything the page sent.
      body: JSON.stringify({
        email,
        password,
        client: 'web',
        companySlug: (await resolveSlug(request.headers.get('host'))) || companySlug || undefined,
      }),
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

  // Right password, but a platform account with two-factor on still owes a code.
  if (payload.twoFactorRequired) {
    return NextResponse.json({ twoFactorRequired: true, challenge: payload.challenge });
  }

  const jar = await cookies();
  // A fresh sign-in never inherits a parked view-as session.
  clearOwnerSession(jar);
  writeSession(jar, {
    accessToken:  payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresIn:    payload.expiresIn,
  });

  // Only the profile crosses back to the browser.
  return NextResponse.json({ employee: payload.employee });
}
