'use strict';

// Website tracking. When a browser is in the foreground only the *host* (e.g. "youtube.com") is
// kept - never the path, query string or page title. macOS gets the URL from active-win; on
// Windows the address bar is read through UI Automation. Other platforms report no domain.

const { execFile } = require('child_process');

const BROWSERS = /^(chrome|google chrome|msedge|microsoft edge|edge|firefox|brave|brave browser|opera|vivaldi|safari|arc)(\.exe)?$/i;
const LOOKUP_TIMEOUT_MS = 4000;

let last = { key: null, domain: null };

/** "https://www.YouTube.com/watch?v=1" / "youtube.com/x" -> "youtube.com". Search text -> null. */
function hostOf(raw) {
  const text = String(raw || '').trim();
  if (!text || /\s/.test(text)) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol)) return null;
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return host.includes('.') || host === 'localhost' ? host.slice(0, 120) : null;
  } catch {
    return null;
  }
}

const READ_ADDRESS_BAR = `
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]::new([int64]$env:WB_HWND))
$edits = $root.FindAll('Descendants', (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
$best = $null
foreach ($e in $edits) {
  if ($e.Current.Name -match 'address|url|search') { $best = $e; break }
  if (-not $best) { $best = $e }
}
if ($best) {
  $p = $null
  if ($best.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) { $p.Current.Value }
}
`;

function windowsAddressBar(hwnd) {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', READ_ADDRESS_BAR],
      { windowsHide: true, timeout: LOOKUP_TIMEOUT_MS, env: { ...process.env, WB_HWND: String(hwnd) } },
      (err, stdout) => resolve(err ? null : String(stdout).trim().split(/\r?\n/)[0] || null)
    );
  });
}

/** The host open in `win` (an active-win result), or null when it is not a browser / unknown. */
async function domainOf(win) {
  if (!BROWSERS.test(win?.owner?.name || '')) return null;
  if (win.url) return hostOf(win.url);
  if (process.platform !== 'win32' || !win.id) return null;

  // Starting PowerShell is costly; the window id + title only changes when the tab does.
  const key = `${win.id}|${win.title}`;
  if (last.key === key) return last.domain;
  const domain = hostOf(await windowsAddressBar(win.id));
  last = { key, domain };
  return domain;
}

module.exports = { domainOf, hostOf };
