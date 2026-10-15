'use strict';

// The workbuddy://connect?code=... link the web portal opens after an employee signs in.
//
// Pure parsing, no Electron: the OS hands the link to the app in different places per platform
// (argv on Windows/Linux, an event on macOS), and all of them funnel through here so the rules
// about what counts as a valid link live in one testable place.

const SCHEME = 'workbuddy';

// What the backend issues is 32 random bytes, base64url: 43 characters. The bounds are loose on
// purpose (a longer token later should not need an agent release) but still reject anything that
// is obviously not a code, so junk in a link never reaches the network.
const CODE_PATTERN = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * @param {string|string[]} input  a URL, or a process argv to search for one
 * @returns {string|null} the one-time code, or null if there is no valid connect link
 */
function parseConnectLink(input) {
  const candidates = Array.isArray(input) ? input : [input];

  for (const item of candidates) {
    if (typeof item !== 'string' || !item.toLowerCase().startsWith(`${SCHEME}://`)) continue;

    let url;
    try {
      url = new URL(item);
    } catch {
      continue;
    }

    // `workbuddy://connect?code=...` parses with host "connect"; tolerate a trailing slash.
    if (url.hostname !== 'connect') continue;

    const code = url.searchParams.get('code');
    if (code && CODE_PATTERN.test(code)) return code;
  }
  return null;
}

/**
 * `workbuddy://sync` — the portal's way of saying "something changed, look now" after the
 * employee punches in, goes on a break or punches out there. It carries no data and grants
 * nothing: the agent only re-asks the server for the current state, so any page triggering it is
 * harmless (the worst case is one extra status request).
 *
 * @param {string|string[]} input  a URL, or a process argv to search for one
 * @returns {boolean}
 */
function parseSyncLink(input) {
  const candidates = Array.isArray(input) ? input : [input];
  return candidates.some((item) => {
    if (typeof item !== 'string' || !item.toLowerCase().startsWith(`${SCHEME}://`)) return false;
    try {
      return new URL(item).hostname === 'sync';
    } catch {
      return false;
    }
  });
}

module.exports = { parseConnectLink, parseSyncLink, SCHEME };
