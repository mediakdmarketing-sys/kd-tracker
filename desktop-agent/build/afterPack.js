'use strict';

// Runs after electron-builder packs the app, before it is signed or zipped.
//
// Flips Electron "fuses" baked into the packaged executable itself — unlike a file inside
// app.asar, a fuse cannot be patched after the fact without rebuilding, because flipping one
// changes a byte Electron's own startup code checks against a build-time sentinel.
//
//   onlyLoadAppFromAsar + enableEmbeddedAsarIntegrityValidation (must be set together)
//       electron-builder hashes app.asar as it writes it and bakes that hash into the binary; on
//       every start, Electron re-hashes the asar on disk and refuses to start if it does not
//       match. This is what stops the "unpack app.asar, edit one file, repack it" trick: the
//       repacked file is a perfectly valid asar, but its hash is different, so the app will not
//       launch with it. It needs no code signing to work — the check is Electron's own — though
//       signing separately stops the .exe/.app itself being swapped for a modified one.
//   runAsNode: false
//       Removes the ELECTRON_RUN_AS_NODE escape hatch, which would otherwise let someone run this
//       same binary as plain Node and script the API client directly from their own file.
//   enableNodeCliInspectArguments / enableNodeOptionsEnvironmentVariable: false
//       Closes the --inspect / NODE_OPTIONS debugger-attach routes into the running app.
//
// None of this stops a determined, skilled attacker with admin rights on their own laptop — they
// can still intercept the HTTPS traffic and reimplement the client from scratch outside the app
// entirely. What it removes is tampering with the app itself that needs no special tooling.

const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

module.exports = async function afterPack(context) {
  const ext = { darwin: '.app', win32: '.exe', linux: '' }[context.electronPlatformName];
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}${ext}`);

  await flipFuses(exePath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
  });
};
