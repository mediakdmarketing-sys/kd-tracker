// White-label: a company's own name, colour and logo, and finding the company from the address
// someone signed in on.

const RESERVED = new Set(['www', 'app', 'api', 'admin', 'super', 'mail', 'static', 'cdn', 'login']);

/**
 * "acme.workbuddy.com" -> "acme". With ROOT_DOMAIN set (e.g. "workbuddy.com") only addresses under
 * it count; without it, "acme.localhost" works for trying this on a laptop. Anything else is the
 * main address and gets the default look.
 */
export function slugFromHost(host) {
  const name = String(host || '').split(':')[0].toLowerCase();
  const root = (process.env.ROOT_DOMAIN || '').toLowerCase();
  let label = null;
  if (root && name.endsWith(`.${root}`)) label = name.slice(0, -(root.length + 1));
  else if (name.endsWith('.localhost')) label = name.slice(0, -'.localhost'.length);
  if (!label || label.includes('.') || RESERVED.has(label)) return null;
  return label;
}

// host -> { slug, at }: a company's own domain is looked up at most once a minute.
const hostCache = new Map();

/**
 * Which company an address belongs to: acme.<root domain> / acme.localhost by its first label, or a
 * verified custom domain (track.acme.com) by asking the API. Null for the main address.
 */
export async function resolveSlug(host) {
  const fromName = slugFromHost(host);
  if (fromName) return fromName;

  const name = String(host || '').split(':')[0].toLowerCase();
  if (!name || name === 'localhost' || /^[\d.]+$/.test(name) || name.endsWith('.localhost')) return null;

  const hit = hostCache.get(name);
  if (hit && Date.now() - hit.at < 60_000) return hit.slug;
  let slug = null;
  try {
    const base = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
    const res = await fetch(`${base}/api/public/brand-by-host?host=${encodeURIComponent(name)}`, {
      cache: 'no-store',
      headers: { 'Accept-Encoding': 'identity' },
    });
    if (res.ok) slug = (await res.json()).slug || null;
  } catch {
    slug = null;
  }
  hostCache.set(name, { slug, at: Date.now() });
  return slug;
}

/** Brand shown on the login page for a slug, or null (unknown company, API down). */
export async function fetchBrand(slug) {
  if (!slug) return null;
  try {
    const base = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
    const res = await fetch(`${base}/api/public/brand/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
      headers: { 'Accept-Encoding': 'identity' },
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export function logoUrl(slug, version) {
  return `/bff/api/public/brand/${encodeURIComponent(slug)}/logo?v=${version || 0}`;
}

/** CSS variables that recolour the app from one hex colour. Empty when there is no colour. */
export function brandStyle(color) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color || '')) return undefined;
  return {
    '--accent': color,
    '--accent-2': `color-mix(in srgb, ${color} 78%, black)`,
    '--accent-gradient': `linear-gradient(120deg, ${color}, color-mix(in srgb, ${color} 78%, black))`,
    '--accent-soft': `color-mix(in srgb, ${color} 14%, var(--surface, white))`,
    '--accent-text': `color-mix(in srgb, ${color} 80%, black)`,
  };
}
