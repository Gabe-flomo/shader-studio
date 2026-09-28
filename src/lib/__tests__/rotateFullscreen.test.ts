/** Rotate to full screen (lib/rotateFullscreen.ts): the rule and the setting's cycle. */
import { describe, expect, it } from 'vitest';
import { nextRotateFullscreen, rotateShowsFullscreen } from '../rotateFullscreen';

describe('rotateShowsFullscreen', () => {
  const sideways = { phone: true, landscape: true };
  it('Play only (the default): Play sideways, nowhere else', () => {
    expect(rotateShowsFullscreen({ setting: 'play', page: 'play', ...sideways })).toBe(true);
    expect(rotateShowsFullscreen({ setting: 'play', page: 'studio', ...sideways })).toBe(false);
    expect(rotateShowsFullscreen({ setting: 'play', page: 'present', ...sideways })).toBe(false);
  });
  it('always: Play and the Studio', () => {
    expect(rotateShowsFullscreen({ setting: 'always', page: 'studio', ...sideways })).toBe(true);
    expect(rotateShowsFullscreen({ setting: 'always', page: 'play', ...sideways })).toBe(true);
    expect(rotateShowsFullscreen({ setting: 'always', page: 'files', ...sideways })).toBe(false);
  });
  it('off: never', () => {
    expect(rotateShowsFullscreen({ setting: 'off', page: 'play', ...sideways })).toBe(false);
  });
  it('only a phone held sideways, and not after leaving it this time round', () => {
    expect(rotateShowsFullscreen({ setting: 'play', page: 'play', phone: true, landscape: false })).toBe(false);
    expect(rotateShowsFullscreen({ setting: 'play', page: 'play', phone: false, landscape: true })).toBe(false);
    expect(rotateShowsFullscreen({ setting: 'play', page: 'play', ...sideways, dismissed: true })).toBe(false);
  });
});

describe('nextRotateFullscreen', () => {
  it('cycles Off → Play only → Always → Off', () => {
    expect(nextRotateFullscreen('off')).toBe('play');
    expect(nextRotateFullscreen('play')).toBe('always');
    expect(nextRotateFullscreen('always')).toBe('off');
  });
});
