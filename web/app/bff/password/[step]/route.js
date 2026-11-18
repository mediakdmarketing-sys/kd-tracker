import { NextResponse } from 'next/server';
import { apiUrl, clientHeaders } from '@/lib/session';

// "Forgot password", before anyone is signed in: asking for the link, checking it, and using it.
// Only these three fixed steps are forwarded, nothing else.
const STEPS = {
  forgot: '/api/auth/forgot-password',
  check: '/api/auth/reset-password/check',
  reset: '/api/auth/reset-password',
};

export async function POST(request, { params }) {
  const { step } = await params;
  const path = STEPS[step];
  if (!path) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } }, { status: 400 });
  }

  const allowed = step === 'forgot' ? { email: body.email } : step === 'check' ? { token: body.token } : { token: body.token, newPassword: body.newPassword };
  try {
    const res = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', ...clientHeaders(request.headers) },
      body: JSON.stringify(allowed),
      cache: 'no-store',
    });
    return NextResponse.json(await res.json(), { status: res.status });
  } catch {
    return NextResponse.json({ error: { code: 'API_UNREACHABLE', message: 'Cannot reach the server. Please try again.' } }, { status: 503 });
  }
}
