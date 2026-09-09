'use strict';

// Agent settings.
//
// Only the API address is configured locally. Capture cadence, the break allowance and the
// retention window all come from `GET /api/config` at runtime, so changing how often
// screenshots are taken is a server-side decision and does not need 60 laptops to install a
// new build.

const fs = require('fs');
const path = require('path');

const DEFAULT_CAPTURE = {
  screenshot: { minIntervalSeconds: 300, maxIntervalSeconds: 600 },
  audio: { enabled: false, sampleDurationSeconds: 300, sampleGapSeconds: 480 },
  shift: { targetSeconds: 32400, breakAllowanceSeconds: 3600, idleThresholdSeconds: 600 },
  retentionDays: 31,
  maxUploadBytes: 5 * 1024 * 1024,
};

function loadSettings(dataDir) {
  const file = path.join(dataDir, 'settings.json');
  let stored = {};

  try {
    stored = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // First run, or a hand-edited file that no longer parses. Defaults apply either way.
  }

  return {
    apiBaseUrl: process.env.KD_API_URL || stored.apiBaseUrl || 'http://localhost:4000',
    // How often to try the queue. Independent of capture cadence: a backlog should drain
    // steadily even while nothing new is being captured.
    drainIntervalMs: stored.drainIntervalMs || 15_000,
    activityIntervalMs: stored.activityIntervalMs || 60_000,
    screenshotQuality: stored.screenshotQuality ?? 70,
    save(patch) {
      const next = { ...stored, ...patch };
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(next, null, 2));
      return next;
    },
  };
}

module.exports = { loadSettings, DEFAULT_CAPTURE };
