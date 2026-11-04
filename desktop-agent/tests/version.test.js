import { describe, it, expect } from 'vitest';

const { isNewer, versionFromFeed } = require('../src/core/version');

describe('isNewer', () => {
  it('compares each part as a number, not as text', () => {
    expect(isNewer('0.7.10', '0.7.9')).toBe(true);
    expect(isNewer('0.8.0', '0.7.99')).toBe(true);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
  });

  it('is false for the same or an older version', () => {
    expect(isNewer('0.7.1', '0.7.1')).toBe(false);
    expect(isNewer('0.7.0', '0.7.1')).toBe(false);
  });

  it('treats a missing part as zero', () => {
    expect(isNewer('0.7', '0.7.0')).toBe(false);
    expect(isNewer('0.7.1', '0.7')).toBe(true);
  });
});

describe('versionFromFeed', () => {
  it('reads the version from a latest-mac.yml', () => {
    const yml = 'version: 0.7.2\nfiles:\n  - url: WorkBuddy-0.7.2.dmg\npath: WorkBuddy-0.7.2.dmg\n';
    expect(versionFromFeed(yml)).toBe('0.7.2');
  });

  it('copes with a quoted version and gives null for nonsense', () => {
    expect(versionFromFeed("version: '0.7.3'\n")).toBe('0.7.3');
    expect(versionFromFeed('<html>not a feed</html>')).toBeNull();
  });
});
