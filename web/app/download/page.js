import Link from 'next/link';
import DownloadChoice from '@/components/DownloadChoice';

export const metadata = { title: 'Download · WorkBuddy' };

const VERSION = 'v0.7.0';

// Each URL can be overridden per deploy; the defaults are the current release builds.
const PLATFORMS = [
  {
    id: 'windows',
    name: 'Windows',
    requirement: 'Windows 10 or later · 64-bit',
    format: '.exe installer',
    url: 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/WorkBuddy%20Setup%200.7.0.exe',
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="#0078d4">
        <path d="M3 5.5l8-1.1v7.1H3zM12 4.3l9-1.3v8.5h-9zM3 12.5h8v7.1l-8-1.1zM12 12.5h9V21l-9-1.3z" />
      </svg>
    ),
  },
  {
    id: 'macos',
    name: 'macOS',
    requirement: 'macOS 12 Monterey or later',
    format: '.dmg installer',
    options: [
      {
        label: 'macOS (Apple silicon) · .dmg',
        url: process.env.AGENT_DOWNLOAD_URL_MAC_ARM || 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/WorkBuddy-0.7.0-arm64.dmg',
      },
      {
        label: 'macOS (Intel) · .dmg',
        url: process.env.AGENT_DOWNLOAD_URL_MAC || 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/WorkBuddy-0.7.0.dmg',
      },
    ],
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="#333">
        <path d="M16.4 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8c-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.700 2.400 2.900 2.300 1.200 0 1.600-.7 3-.7s1.800.7 3 .7c1.300 0 2.100-1.100 2.800-2.300.9-1.300 1.300-2.500 1.300-2.600-.1 0-2.500-1-2.500-3.800zM14.200 5.800c.6-.8 1.100-1.800.9-2.900-.9 0-2 .6-2.700 1.400-.6.700-1.100 1.800-1 2.800 1 .1 2-.5 2.800-1.300z" />
      </svg>
    ),
  },
  {
    id: 'linux',
    name: 'Linux',
    requirement: 'Ubuntu 20.04+ · Debian · Fedora',
    format: '.deb / .AppImage',
    options: [
      {
        label: 'Linux · .deb',
        url: process.env.AGENT_DOWNLOAD_URL_LINUX_DEB || 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/kd-tracker-agent_0.7.0_amd64.deb',
      },
      {
        label: 'Linux · .AppImage',
        url: process.env.AGENT_DOWNLOAD_URL_LINUX || 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/WorkBuddy-0.7.0.AppImage',
      },
    ],
    icon: (
      // Tux, the Linux penguin: black body, white belly and face, yellow beak and feet.
      <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true">
        <ellipse cx="14" cy="53" rx="10" ry="5" fill="#f9b900" transform="rotate(-18 14 53)" />
        <ellipse cx="50" cy="53" rx="10" ry="5" fill="#f9b900" transform="rotate(18 50 53)" />
        <path d="M32 3C21 3 17 12 17 22c0 5-2 8-5 14-3 6-3 13 2 17 4 3 10 3 18 3s14 0 18-3c5-4 5-11 2-17-3-6-5-9-5-14C47 12 43 3 32 3z" fill="#111" />
        <path d="M32 24c-8 0-12 8-12 17 0 8 4 14 12 14s12-6 12-14c0-9-4-17-12-17z" fill="#fff" />
        <ellipse cx="26.500" cy="15" rx="4" ry="4.500" fill="#fff" />
        <ellipse cx="37.500" cy="15" rx="4" ry="4.500" fill="#fff" />
        <circle cx="27.500" cy="15.500" r="2" fill="#111" />
        <circle cx="36.500" cy="15.500" r="2" fill="#111" />
        <path d="M24 21c2-2.500 5-3 8-3s6 .5 8 3c-1 3-4.500 5-8 5s-7-2-8-5z" fill="#f9b900" />
      </svg>
    ),
  },
  {
    id: 'android',
    name: 'Android',
    requirement: 'Android 8.0 or later',
    format: '.apk installer',
    url: process.env.AGENT_DOWNLOAD_URL_APK || 'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/WorkBuddy.apk',
    note: 'Allow “Install unknown apps” for your browser when Android asks.',
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="#3ddc84">
        <path d="M6 9h12v8.500a1.500 1.500 0 0 1-1.500 1.500H15v2.500a1 1 0 0 1-2 0V19h-2v2.500a1 1 0 0 1-2 0V19H7.500A1.500 1.500 0 0 1 6 17.500zM3.500 9.500a1 1 0 0 1 2 0V15a1 1 0 0 1-2 0zM18.500 9.500a1 1 0 0 1 2 0V15a1 1 0 0 1-2 0zM15.800 3.300l1.100-1.600-.5-.3-1.200 1.700A6 6 0 0 0 12 2.500c-1 0-1.900.2-2.800.6L8 1.400l-.5.300 1.100 1.600A5.400 5.400 0 0 0 6 8h12a5.400 5.400 0 0 0-2.200-4.700zM9.500 6.200a.7.7 0 1 1 0-1.400.7.7 0 0 1 0 1.400zm5 0a.7.7 0 1 1 0-1.400.7.7 0 0 1 0 1.400z" />
      </svg>
    ),
  },
];

const STEPS = [
  'Run the installer and follow the prompts.',
  <>
    WorkBuddy starts in the <strong>system tray</strong> (bottom-right, near the clock).
  </>,
  'Sign in to this portal — the agent will ask to connect automatically.',
  <>
    Click <strong>Connect</strong> in the agent popup to link your session.
  </>,
  'Punch in as usual. The agent handles screenshots in the background.',
];

export default function DownloadPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Download</h1>
          <p>Install the WorkBuddy desktop agent on your computer to enable screenshots and activity tracking.</p>
        </div>
      </div>

      <div className="stack">
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {PLATFORMS.map((p) => (
            <div key={p.id} className="card card-pad" style={{ textAlign: 'center' }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  margin: '4px auto 12px',
                  borderRadius: 16,
                  background: 'var(--bg, #f3f4f6)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                {p.icon}
              </div>
              <h2 style={{ margin: '0 0 4px' }}>{p.name}</h2>
              <p className="muted" style={{ margin: '0 0 10px', fontSize: 13 }}>
                {p.requirement}
              </p>
              <p style={{ margin: '0 0 16px', fontSize: 13 }}>
                <span className="pill pill-working">{VERSION}</span>{' '}
                <span className="faint">{p.format}</span>
              </p>
              {p.options ? (
                <DownloadChoice name={p.name} options={p.options} />
              ) : p.url ? (
                <a className="btn btn-primary btn-lg" href={p.url} download style={{ width: '100%' }}>
                  Download for {p.name}
                </a>
              ) : (
                <button type="button" className="btn btn-primary btn-lg" disabled style={{ width: '100%' }}>
                  {p.name} download coming soon
                </button>
              )}
              {p.note && (
                <p className="faint" style={{ margin: '10px 0 0', fontSize: 12 }}>
                  {p.note}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="card card-pad">
          <h2 style={{ margin: '0 0 10px' }}>After installing</h2>
          <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
            {STEPS.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <p className="muted" style={{ margin: '14px 0 0', fontSize: 13 }}>
            Need help? Visit the <Link href="/help#agent-install">Help page</Link> for a detailed walkthrough.
          </p>
        </div>
      </div>
    </>
  );
}
