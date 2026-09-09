import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { sessionCookieNames, apiUrl } from '@/lib/session';

// Proxy for browser-side calls: /bff/api/... -> <API_BASE_URL>/api/...
// Its only job is to attach the access token from the httpOnly cookie. Middleware has already
// refreshed it if needed.
//
// Only /api/* is forwarded, so this cannot be turned into an open proxy to arbitrary paths.

async function forward(request, params) {
  const segments = (await params).path || [];
  if (segments[0] !== 'api') {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Unknown BFF route' } },
      { status: 404 }
    );
  }

  const jar = await cookies();
  const { access } = sessionCookieNames(jar);
  const token = jar.get(access)?.value;
  const search = new URL(request.url).search;
  const target = apiUrl(`/${segments.join('/')}${search}`);

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  let res;
  try {
    res = await fetch(target, {
      method: request.method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(hasBody ? { 'Content-Type': request.headers.get('content-type') || 'application/json' } : {}),
      },
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
    });
  } catch {
    return NextResponse.json(
      { error: { code: 'API_UNREACHABLE', message: 'Cannot reach the server.' } },
      { status: 503 }
    );
  }

  // Pass the body straight through: JSON, images and CSV downloads all work unchanged.
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new NextResponse(res.body, { status: res.status, headers });
}

export async function GET(request, { params }) {
  return forward(request, params);
}
export async function POST(request, { params }) {
  return forward(request, params);
}
export async function PATCH(request, { params }) {
  return forward(request, params);
}
export async function DELETE(request, { params }) {
  return forward(request, params);
}
