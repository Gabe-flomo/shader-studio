/** The Record dialog's phone rules: which resolution it opens on, and which choice rows wrap. */
import { describe, expect, it } from 'vitest';
import { USEFUL_PREVIEW_SHORT_SIDE, choiceRowWraps, defaultResolutionId, previewTiny } from '../recordDialog';
import { PHONE_DIALOG_BELOW, phoneDialog } from '../../components/ui/phoneDialog';

describe('default resolution', () => {
  it('opens on the preview when it is a useful size', () => {
    expect(defaultResolutionId(960, 540)).toBe('preview');
    expect(defaultResolutionId(USEFUL_PREVIEW_SHORT_SIDE, 1200)).toBe('preview');
    expect(previewTiny(1280, 720)).toBe(false);
  });
  it('opens on 720p when a phone-sized preview would be tiny', () => {
    expect(defaultResolutionId(159, 283)).toBe('720');
    expect(defaultResolutionId(800, USEFUL_PREVIEW_SHORT_SIDE - 1)).toBe('720');
    expect(previewTiny(159, 283)).toBe(true);
  });
});

describe('choice rows', () => {
  it('wrap on a phone, and always for 7 or more options', () => {
    expect(choiceRowWraps(3, false)).toBe(false);
    expect(choiceRowWraps(5, false)).toBe(false);
    expect(choiceRowWraps(8, false)).toBe(true);
    expect(choiceRowWraps(3, true)).toBe(true);
  });
});

describe('phone dialog', () => {
  it('fills the screen below the phone breakpoint only', () => {
    expect(phoneDialog(375)).toBe(true);
    expect(phoneDialog(PHONE_DIALOG_BELOW - 1)).toBe(true);
    expect(phoneDialog(PHONE_DIALOG_BELOW)).toBe(false);
    expect(phoneDialog(1440)).toBe(false);
  });
});
