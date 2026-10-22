'use strict';

// Previously: rebuilt better-sqlite3 for Electron's Node ABI as a postinstall step.
//
// better-sqlite3 has been replaced with sql.js (pure WASM) — see src/core/outbox.js.
// sql.js has no native binary and requires no C++ toolchain on any platform, so this
// script is now a no-op. It is kept so any reference in docs, CI configs, or shell
// history does not cause a confusing "file not found" error.

process.exit(0);
