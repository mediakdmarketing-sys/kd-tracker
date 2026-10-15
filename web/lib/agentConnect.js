'use client';

import { post } from '@/lib/client';

// Everything here talks to the WorkBuddy desktop agent through workbuddy:// links, which the OS
// routes to the agent if it is installed and running. If it is not, a link does nothing — so none
// of this can fail or slow down the portal, and every error is swallowed on purpose.

function openAgentLink(url) {
  // Not window.location: a custom-scheme navigation handled by an external app leaves the page
  // alone, but if nothing handles it some browsers would replace the page with an error. A
  // hidden iframe takes the hit instead.
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = url;
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 3000);
}

/**
 * Signs the desktop agent in as the employee who just signed in here.
 *
 * Asks the backend for a one-time code (60 seconds, single use) and hands it to the agent.
 */
export async function connectDesktopAgent() {
  try {
    const { code } = await post('/api/auth/agent-code');
    if (!code) return false;
    openAgentLink(`workbuddy://connect?code=${encodeURIComponent(code)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tells the agent to look at the server now. Call after punching in, taking a break or punching
 * out here, so capture starts and stops straight away instead of at the agent's next poll. The
 * link carries nothing, and the agent still asks the server what the state really is.
 */
export function syncDesktopAgent() {
  try {
    openAgentLink('workbuddy://sync');
  } catch {
    /* best effort */
  }
}
