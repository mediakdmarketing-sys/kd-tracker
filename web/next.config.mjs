// Headers every page and API response from the portal carries. The portal shows employees'
// screenshots and audio, so it must not be framed by another site, sniffed into another type,
// or leak the page address to sites it links to.
//
// No script-src in the Content-Security-Policy on purpose: Next.js injects inline scripts and a
// strict script policy needs a per-request nonce. These directives still stop framing, plugins,
// <base> tag tricks and forms posting to other sites, without breaking anything.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
