import { cookies } from 'next/headers';
import { ACCESS_COOKIE, apiUrl } from '@/lib/session';

/**
 * GET /bff/sse
 *
 * Streams the backend's SSE endpoint through to the browser. The browser cannot hold a
 * direct SSE connection to the backend because the access token lives in an httpOnly cookie
 * that JavaScript cannot read — the BFF must inject it, exactly as it does for every other
 * API call.
 *
 * This is a pure pass-through: bytes from the backend are piped straight to the browser.
 * Next.js will not cache a streaming response, so no `cache: 'no-store'` dance is needed.
 *
 * Keep-alive pings from the backend ": ping\n\n" are forwarded unchanged — the browser
 * EventSource ignores comment lines.
 */
export async function GET(request) {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;

  if (!token) {
    return new Response('Unauthorized', { status: 401 });
  }

  let upstream;
  try {
    upstream = await fetch(apiUrl('/api/sse'), {
      headers: {
        Authorization: `Bearer ${token}`,
        // Prevent any CDN / proxy between Next.js and the backend from buffering the stream.
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Accept-Encoding': 'identity',
      },
      // The body is a ReadableStream; do not set cache here.
      cache: 'no-store',
    });
  } catch {
    return new Response('Could not connect to event stream', { status: 503 });
  }

  if (!upstream.ok) {
    return new Response(upstream.statusText, { status: upstream.status });
  }

  // Stream the response body directly to the browser with the correct SSE headers.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
