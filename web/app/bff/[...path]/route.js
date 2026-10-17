import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, apiUrl } from '@/lib/session';

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
  const token = jar.get(ACCESS_COOKIE)?.value;
  const search = new URL(request.url).search;
  const target = apiUrl(`/${segments.join('/')}${search}`);

  const hasBody = !['GET', 'HEAD'].includes(request.method);

  // Forwarded through unmodified so the backend's 206 partial-content responses work: without
  // it every request looks like a fresh whole-file GET, and an <audio> element's attempt to
  // seek forward just replays from the start instead of jumping to the dragged position.
  const range = request.headers.get('range');

  let res;
  try {
    res = await fetch(target, {
      method: request.method,
      headers: {
        // The CDN in front of the API compresses and can leave a content-length that does not
        // match the decoded body; asking for the plain body removes that whole class of bug.
        'Accept-Encoding': 'identity',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(hasBody ? { 'Content-Type': request.headers.get('content-type') || 'application/json' } : {}),
        ...(range ? { Range: range } : {}),
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
  // The Range trio (accept-ranges/content-range/content-length) has to come along too, or the
  // backend's 206 response reaches the browser looking like a malformed 200.
  //
  // fetch() decompresses a gzip/br upstream body but leaves its headers as they were (a CDN in
  // front of the API compresses even tiny JSON), so content-length can describe the compressed
  // bytes. Forwarding it makes the browser cut the longer decoded body short and fail to parse
  // it. It is only passed on for a 206, where it must match the range and the API never
  // compresses it; everything else is streamed with its length left to the platform.
  const keepLength = res.status === 206 && !res.headers.get('content-encoding');
  const headers = new Headers();
  for (const name of [
    'content-type',
    'content-disposition',
    'cache-control',
    'accept-ranges',
    'content-range',
    ...(keepLength ? ['content-length'] : []),
  ]) {
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
