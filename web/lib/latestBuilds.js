// Finds the newest installers on the update feed (the Cloudflare R2 bucket the agents update
// from), so the Download page never needs editing for a release. Publishing a build with
// scripts/publish-update.js is all it takes: this reads the same latest*.yml / version.json files.
//
// Every lookup can fail (feed not set up yet, a platform not published, R2 down). A failure gives
// null for that platform and the page falls back to its fixed links.

const FEED_BASE = (
  process.env.UPDATE_BASE_URL || 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev'
).replace(/\/$/, '');

// Re-read at most every 5 minutes: a new release shows up quickly without a request per visit.
const REVALIDATE_SECONDS = 300;

async function fetchText(path) {
  try {
    const res = await fetch(`${FEED_BASE}/${path}`, { next: { revalidate: REVALIDATE_SECONDS } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

// electron-builder's feed files are small and regular, so two patterns are enough.
function parseFeed(text) {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
  const files = [...text.matchAll(/^\s*-?\s*url:\s*(.+)$/gm)].map((m) =>
    m[1].trim().replace(/^['"]|['"]$/g, ''),
  );
  return version && files.length ? { version, files } : null;
}

const fileUrl = (dir, name) => `${FEED_BASE}/${dir}/${encodeURIComponent(name)}`;

export async function latestBuilds() {
  const [win, mac, linux, android] = await Promise.all([
    fetchText('desktop/latest.yml'),
    fetchText('desktop/latest-mac.yml'),
    fetchText('desktop/latest-linux.yml'),
    fetchText('android/version.json'),
  ]);

  const out = {};

  const w = win && parseFeed(win);
  const exe = w?.files.find((f) => f.toLowerCase().endsWith('.exe'));
  if (exe) out.windows = { version: w.version, url: fileUrl('desktop', exe) };

  const m = mac && parseFeed(mac);
  const dmgs = m?.files.filter((f) => f.toLowerCase().endsWith('.dmg')) ?? [];
  if (dmgs.length) {
    const arm = dmgs.find((f) => /arm64/i.test(f));
    const intel = dmgs.find((f) => !/arm64/i.test(f));
    out.macos = {
      version: m.version,
      arm: arm && fileUrl('desktop', arm),
      intel: intel && fileUrl('desktop', intel),
    };
  }

  const l = linux && parseFeed(linux);
  const appImage = l?.files.find((f) => f.toLowerCase().endsWith('.appimage'));
  if (appImage) {
    out.linux = {
      version: l.version,
      appImage: fileUrl('desktop', appImage),
      // The feed lists only the AppImage; the .deb is published next to it under its usual name.
      deb: fileUrl('desktop', `kd-tracker-agent_${l.version}_amd64.deb`),
    };
  }

  if (android) {
    try {
      const v = JSON.parse(android);
      if (v.apk) out.android = { version: v.versionName, url: fileUrl('android', v.apk) };
    } catch {
      // Unreadable version.json: keep the fallback link.
    }
  }

  return out;
}
