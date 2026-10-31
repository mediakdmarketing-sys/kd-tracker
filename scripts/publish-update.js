'use strict';

// Uploads a build to the Cloudflare R2 bucket that installed apps check for updates.
// Run from your own machine; nothing here uses GitHub Actions.
//
//   node scripts/publish-update.js desktop <bucket>
//       uploads desktop-agent/dist: installers and block maps first, latest*.yml last
//   node scripts/publish-update.js android <bucket> <apk> <versionCode> <versionName>
//       uploads the APK as android/WorkBuddy.apk, then android/version.json
//
// One-time: `npx wrangler login` (opens a browser to sign in to Cloudflare).
// The feed files go last on purpose: the apps read latest*.yml / version.json to learn that a
// build exists, so the files they point at must already be in place.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TYPES = {
  '.exe': 'application/octet-stream',
  '.blockmap': 'application/octet-stream',
  '.dmg': 'application/x-apple-diskimage',
  '.appimage': 'application/octet-stream',
  '.deb': 'application/vnd.debian.binary-package',
  '.yml': 'text/yaml',
  '.json': 'application/json',
  '.apk': 'application/vnd.android.package-archive',
};

function put(bucket, key, file) {
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  console.log(`  ${key}  (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
  // npx is a .cmd file on Windows, so this needs a shell, and a shell splits on spaces: the
  // installer is called "WorkBuddy Setup 0.7.1.exe". Quote every argument.
  const quote = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
  const r = spawnSync(
    'npx',
    ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file,
      '--content-type', type, '--cache-control', 'no-cache', '--remote'].map(quote),
    { stdio: 'inherit', shell: true },
  );
  if (r.status !== 0) {
    console.error(`Upload of ${key} failed; stopping so the feed is not left half-updated.`);
    process.exit(1);
  }
}

const [kind, bucket, ...rest] = process.argv.slice(2);
if (!kind || !bucket) {
  console.error('Usage: see the comment at the top of this file.');
  process.exit(1);
}

if (kind === 'desktop') {
  const dist = path.join(__dirname, '..', 'desktop-agent', 'dist');
  const version = require('../desktop-agent/package.json').version;
  const files = fs.readdirSync(dist).filter((f) => f.includes(version) || f.startsWith('latest'));
  const feeds = files.filter((f) => /^latest.*\.yml$/.test(f));
  const rest2 = files.filter((f) => !feeds.includes(f) && !f.endsWith('.yml'));
  if (!feeds.length) {
    console.error(`No latest*.yml in ${dist}. Run the build first (npm run build:win).`);
    process.exit(1);
  }
  console.log(`Publishing desktop ${version}`);
  for (const f of rest2) put(bucket, `desktop/${f}`, path.join(dist, f));
  for (const f of feeds) put(bucket, `desktop/${f}`, path.join(dist, f));
} else if (kind === 'android') {
  const [apk, versionCode, versionName] = rest;
  if (!apk || !/^\d+$/.test(versionCode || '') || !versionName) {
    console.error('Usage: android <bucket> <apk> <versionCode> <versionName>');
    process.exit(1);
  }
  const tmp = path.join(require('os').tmpdir(), 'workbuddy-version.json');
  fs.writeFileSync(
    tmp,
    JSON.stringify({ versionCode: Number(versionCode), versionName, apk: 'WorkBuddy.apk' }) + '\n',
  );
  console.log(`Publishing android ${versionName} (${versionCode})`);
  put(bucket, 'android/WorkBuddy.apk', apk);
  put(bucket, 'android/version.json', tmp);
} else {
  console.error(`Unknown kind "${kind}" (expected desktop or android).`);
  process.exit(1);
}

console.log('Done.');
