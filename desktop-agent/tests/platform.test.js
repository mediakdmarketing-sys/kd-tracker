'use strict';

const { isWaylandSession, autostartEntry } = require('../src/core/platform');

describe('Wayland detection', () => {
  it('is false on every platform but Linux', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }, 'win32')).toBe(false);
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }, 'darwin')).toBe(false);
  });

  it('reads XDG_SESSION_TYPE on Linux', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' }, 'linux')).toBe(true);
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'Wayland' }, 'linux')).toBe(true);
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11' }, 'linux')).toBe(false);
  });

  it('falls back to WAYLAND_DISPLAY, but trusts an explicit x11 session', () => {
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(true);
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'x11' }, 'linux')).toBe(false);
    expect(isWaylandSession({}, 'linux')).toBe(false);
  });
});

describe('autostart entry', () => {
  it('is a valid desktop entry that launches the given path', () => {
    const text = autostartEntry({ exec: '/opt/WorkBuddy/workbuddy' });
    expect(text.startsWith('[Desktop Entry]\n')).toBe(true);
    expect(text).toContain('Type=Application');
    expect(text).toContain('Name=WorkBuddy');
    expect(text).toContain('Exec="/opt/WorkBuddy/workbuddy"');
    expect(text).toContain('Terminal=false');
  });

  it('quotes a path with spaces and escapes special characters', () => {
    const text = autostartEntry({ exec: '/home/a b/Work"Buddy.AppImage' });
    expect(text).toContain('Exec="/home/a b/Work\\"Buddy.AppImage"');
  });
});
