'use strict';

/** True when version `a` is newer than `b`, comparing dotted numbers ("0.7.10" > "0.7.9"). */
function isNewer(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

/** Reads the version out of electron-builder's latest*.yml ("version: 0.7.2"). */
function versionFromFeed(text) {
  return /^version:\s*['"]?([^'"\s]+)/m.exec(text)?.[1] ?? null;
}

module.exports = { isNewer, versionFromFeed };
