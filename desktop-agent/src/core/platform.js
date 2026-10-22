'use strict';

// Linux desktop helpers. Pure functions with no Electron import so they can be unit-tested.
//
// Linux is supported on X11 sessions. Wayland is the default on current Ubuntu and Fedora, and
// there the OS deliberately stops one app watching another: screenshots go through a
// permission portal, and global keyboard/mouse counts and the foreground app name are not
// available. Idle detection still works (it uses the desktop's own idle timer), so attendance
// stays correct; only the richer capture degrades.

/**
 * True when the current Linux session is Wayland.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} platform
 */
function isWaylandSession(env = process.env, platform = process.platform) {
  if (platform !== 'linux') return false;
  if (String(env.XDG_SESSION_TYPE || '').toLowerCase() === 'wayland') return true;
  // Some launchers do not set XDG_SESSION_TYPE but always set WAYLAND_DISPLAY.
  return Boolean(env.WAYLAND_DISPLAY) && String(env.XDG_SESSION_TYPE || '').toLowerCase() !== 'x11';
}

/**
 * Contents of a freedesktop autostart entry, so the agent starts at login. Electron's own
 * login-item API does nothing on Linux.
 * @param {{exec: string, name?: string}} opts  `exec` is the full path of the launcher
 */
function autostartEntry({ exec, name = 'WorkBuddy' }) {
  // A path with spaces must be quoted in the Exec key; backslashes and quotes are escaped.
  const quoted = `"${String(exec).replace(/(["\\`$])/g, '\\$1')}"`;
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    'Comment=WorkBuddy desktop agent',
    `Exec=${quoted}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    'NoDisplay=false',
    '',
  ].join('\n');
}

module.exports = { isWaylandSession, autostartEntry };
