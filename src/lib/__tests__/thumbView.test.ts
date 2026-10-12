/** A thumbnail's view, read from its canvas's dataset (lib/thumbView.ts). */
import { describe, expect, it } from 'vitest';
import { THUMB_FS, bigThumbKey, thumbViewOf } from '../thumbView';
import { getNodeDefinition } from '../../nodes/definitions';

describe('thumbnail view', () => {
  it('defaults to Raw, 0…1, 128 wide, no probe', () => {
    expect(thumbViewOf({})).toEqual({ mode: 'raw', lo: 0, hi: 1, width: 128, probe: null });
  });

  it('reads the mode, range, width and probe', () => {
    expect(thumbViewOf({ view: 'arrows', lo: '-2', hi: '2', w: '768', probe: '0.25,0.75' }))
      .toEqual({ mode: 'arrows', lo: -2, hi: 2, width: 768, probe: [0.25, 0.75] });
  });

  it('ignores what it can not use: an unknown mode, Min = Max, a probe off the picture, a huge width', () => {
    const v = thumbViewOf({ view: 'nope', lo: '3', hi: '3', probe: '1.5,0', w: '99999' });
    expect(v.mode).toBe('raw');
    expect(v.hi).toBe(4);
    expect(v.probe).toBeNull();
    expect(v.width).toBe(1024);
  });

  it('the big view draws under its own key, so the card keeps drawing too', () => {
    expect(bigThumbKey('dt')).toBe('dt#big');
  });

  it('the shader has all four modes', () => {
    expect(THUMB_FS).toContain('uniform float mode, lo, hi;');
    expect(THUMB_FS.match(/mode < /g)?.length).toBe(3);
  });

  it('a Data Texture starts in Raw with a −1…1 view range', () => {
    expect(getNodeDefinition('dataTexture')!.defaultParams).toMatchObject({ previewView: 'raw', previewMin: -1, previewMax: 1 });
  });
});
