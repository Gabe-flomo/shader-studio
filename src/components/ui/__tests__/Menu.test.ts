/** Menus open as bottom sheets on phone-width screens, so a long one never runs off the bottom. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { MENU_SHEET_BELOW, menuAsSheet } from '../menuSheet';

describe('menu as a sheet', () => {
  it('is a sheet below the phone breakpoint and a popover above it', () => {
    expect(menuAsSheet(375)).toBe(true);
    expect(menuAsSheet(MENU_SHEET_BELOW - 1)).toBe(true);
    expect(menuAsSheet(MENU_SHEET_BELOW)).toBe(false);
    expect(menuAsSheet(1440)).toBe(false);
  });
  it('can be forced either way', () => {
    expect(menuAsSheet(1440, true)).toBe(true);
    expect(menuAsSheet(375, false)).toBe(false);
  });
});
