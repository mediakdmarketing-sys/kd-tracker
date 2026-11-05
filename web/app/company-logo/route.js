import { apiUrl } from '@/lib/session';

// The company logo, fetched from the API on the portal's own address so pages can use a plain
// <img src="/company-logo">. The logo is public, so no session is passed along.
export async function GET() {
  let res;
  try {
    res = await fetch(apiUrl('/api/branding/logo'), { cache: 'no-store' });
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!res.ok) return new Response(null, { status: 404 });

  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') || 'image/png',
      // The page asks with ?v=<time of the last change>, so a new logo gets a new address.
      'Cache-Control': 'public, max-age=300',
    },
  });
}
