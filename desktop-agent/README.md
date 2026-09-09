# KD Tracker — Desktop Agent

Electron tray app for Windows, macOS and Linux: punch controls, randomised screenshot capture
across every display, consent-gated audio sampling, activity counters, and a durable local
queue so an unreliable home connection never loses a shift (see
[docs/adr/0004-offline-contract.md](../docs/adr/0004-offline-contract.md) and
[docs/adr/0005-multi-display-capture.md](../docs/adr/0005-multi-display-capture.md) in the
repo root for the API contract this agent is built against).

## Setup

```bash
npm install
```

`postinstall` tries to rebuild `better-sqlite3` for Electron's bundled Node automatically. If
it can't (no C++ toolchain), install still succeeds — see **Native module** below before
running `npm start`.

```bash
KD_API_URL=http://localhost:4000 npm start
```

## ⚠️ Native module: better-sqlite3 needs a real rebuild for Electron on Windows

**This is not optional on Windows, and it is a known, currently-unresolved gap on the dev
machine this project was built on.** `better-sqlite3`'s bundled prebuilt binary loads fine
under Electron (`require()` succeeds) but **crashes the whole process — uncatchable, no JS
error — the instant a `Database` is opened**. Confirmed reproducible against both Electron 33
and Electron 30 on that machine, and confirmed it is specifically the Windows native binary:
plain Node (used by `npm test` and by the backend) opens the exact same package without any
issue. `npm start` will simply exit with no visible cause unless the module has been rebuilt
for Electron specifically first.

The fix is the standard one for native Node modules under Electron — rebuild it against
Electron's own headers with a C++ toolchain:

```bash
npm run rebuild:native
```

| Platform | Toolchain needed |
|---|---|
| Windows | Visual Studio **Build Tools** ("Desktop development with C++" workload) — a command-line compiler toolchain, *not* the Visual Studio IDE and unrelated to any code editor. `winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--add Microsoft.VisualStudio.Workload.VCTools"` |
| macOS | `xcode-select --install` |
| Linux | `build-essential` (Debian/Ubuntu) or your distro's equivalent |

`postinstall` attempts this automatically and tells you if it couldn't — watch for its output
after `npm install`. **`electron-builder`'s own `npm run build:*` also attempts this
automatically as part of packaging, and fails loudly (not silently) if the toolchain is
missing** — confirmed on this project: it does not produce a broken installer, it exits with
the same "Could not find any Visual Studio installation to use" error before assembling
anything. `npm test` is unaffected either way: the test suite (`src/core/*`, 54 tests) runs
under plain Node, never under Electron, and never touches this path.

**Status on this project as handed over:** no C++ toolchain was installed on the build/dev
machine used for Sprint 7, by the customer's choice — Build Tools is a multi-GB system-wide
install and the decision was to defer it to whichever machine actually does the packaging
(IT's build box, or CI) rather than install it here. Everything else is done and verified:
`src/core/*` (the actual agent logic — punch queueing, upload retry/backoff, capture gating,
scheduling) is unit-tested end-to-end against fakes (54/54 passing) and was additionally
exercised against the real, running backend API (offline-queue-then-drain, multi-display
grouping, replay/idempotency, session-death handling — see the Sprint 7 code review this
session ran, which found and fixed 4 real bugs before this point). What was **not** verified
on this machine: the Electron main-process wiring actually running end-to-end (tray icon,
popup, real screen/mic capture) and a packaged installer actually launching. Both are blocked
purely on this one native-module rebuild — nothing else. Whoever picks this up next should
install a C++ toolchain per the table above, run `npm run rebuild:native`, then `npm start`
and confirm the tray icon appears before trusting a packaged build.

If a toolchain genuinely cannot be installed on any build machine available to this project,
the alternative is dropping `better-sqlite3` from the outbox (`src/core/outbox.js`) in favour
of a pure-JS persistence layer — a real design change, not a one-line fix, since the
durable-queue tests (`tests/outbox.test.js`) are written against its exact semantics (WAL
durability, synchronous writes).

## Scripts

| Command | What |
|---|---|
| `npm start` / `npm run dev` | Run the agent |
| `npm test` | Core logic tests (`src/core/*`) — no Electron, no native module |
| `npm run icon` | Regenerate `build/icon.png` (placeholder — swap in a real logo when one exists) |
| `npm run rebuild:native` | Rebuild `better-sqlite3` for the installed Electron |
| `npm run build:win` / `build:mac` / `build:linux` | Package an installer (see below) |

## Packaging

`electron-builder.yml` builds:

- **Windows** — NSIS installer (`.exe`), per-user install, no desktop shortcut (it's a tray
  app).
- **macOS** — `.dmg`, x64 + arm64. **Unsigned** — no Developer ID is configured
  (`identity: null`). Gatekeeper will warn on first launch; add signing before distributing
  outside the company.
- **Linux** — AppImage and `.deb`.

electron-builder can only reliably produce a *correctly rebuilt* native module for the
platform it's running on — package on Windows for Windows, macOS for macOS, Linux for Linux,
unless you have proper cross-compilation toolchains set up. `npm run rebuild:native` must
succeed on the build machine before `npm run build:*` will produce something that actually
runs.

## Architecture

```
src/
├── core/            # Pure logic — no Electron import anywhere in here. Unit-tested directly.
│   ├── agent.js         orchestrates everything: punches, capture gating, state
│   ├── outbox.js        durable SQLite queue; blobs spooled to disk, not held in the DB
│   ├── apiClient.js     fetch + token refresh with a single-flight lock
│   ├── uploader.js      drains the outbox with backoff; the response-classification rules
│   │                    (ADR-0004) are the most important logic in this app
│   ├── scheduler.js     randomised screenshot timing; non-overlapping audio sampling
│   ├── tokenStore.js    OS-keychain-encrypted session (Electron's safeStorage)
│   └── settings.js      local config; capture cadence itself comes from GET /api/config
├── main/             # Electron wiring: tray, popup window, IPC, screen/mic/input access
└── renderer/         # Tray popup UI (plain DOM) and the hidden audio-recorder page
```

`main/index.js` is intentionally thin — every decision (when to capture, how to classify a
failed upload, when to give up on an item) lives in `core/` where it can be tested without a
window ever opening.
