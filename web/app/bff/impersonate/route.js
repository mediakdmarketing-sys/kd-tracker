import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ACCESS_COOKIE,
  OWNER_REFRESH_COOKIE,
  writeSession,
  stashOwnerSession,
  apiUrl,
} from '@/lib/session';

/**
 * Platform owner steps into a company as one of its people. Their own session is parked in
 * separate cookies and the view-as session takes its place until they exit (or it ends).
 */
export async function POST(request) {
  const jar = await cookies();
  if (jar.get(OWNER_REFRESH_COOKIE)?.value) {
    return NextResponse.json(
      { error: { code: 'CONFLICT', message: 'You are already viewing as someone. Exit first.' } },
      { status: 409 }
    );
  }

  let employeeId;
  try {
    ({ employeeId } = await request.json());
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } },
      { status: 400 }
    );
  }

  const token = jar.get(ACCESS_COOKIE)?.value;
  let res;
  try {
    res = await fetch(apiUrl('/api/super/impersonate'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ employeeId }),
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

  stashOwnerSession(jar);
  writeSession(jar, {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresIn: payload.expiresIn,
  });
  return NextResponse.json({ role: payload.employee.role });
}
