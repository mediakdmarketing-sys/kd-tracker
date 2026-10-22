import Link from 'next/link';

export const metadata = { title: 'Download · WorkBuddy' };

const VERSION = 'v0.7.0';

// Each URL can be overridden per deploy; the defaults are the current release builds.
const PLATFORMS = [
  {
    id: 'windows',
    name: 'Windows',
    requirement: 'Windows 10 or later · 64-bit',
    format: '.exe installer',
    url:
      process.env.AGENT_DOWNLOAD_URL_WINDOWS ||
      process.env.AGENT_DOWNLOAD_URL ||
      'https://pub-71e396a00e5740aea9a398af6cd25b69.r2.dev/WorkBuddy%20Setup%200.7.0.exe',
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
    url:
      process.env.AGENT_DOWNLOAD_URL_MAC ||
      'https://github.com/mediakdmarketing-sys/kd-tracker/actions/runs/39793908149/artifacts/12431933638',
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
    format: '.AppImage / .deb',
    url:
      process.env.AGENT_DOWNLOAD_URL_LINUX ||
      'https://github.com/mediakdmarketing-sys/kd-tracker/actions/runs/39795415880/artifacts/12432703255',
    icon: (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="#222">
        <ellipse cx="12" cy="14" rx="6" ry="7.500" />
        <ellipse cx="12" cy="15.500" rx="3.500" ry="5" fill="#fff" />
        <circle cx="10" cy="8" r="1" fill="#fff" />
        <circle cx="14" cy="8" r="1" fill="#fff" />
        <path d="M10.500 10l1.500 1 1.500-1z" fill="#f5a623" />
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
              <a className="btn btn-primary btn-lg" href={p.url} download style={{ width: '100%' }}>
                Download for {p.name}
              </a>
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
