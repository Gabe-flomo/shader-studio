import { describe, expect, it } from 'vitest';
import { audioAccept, isAppleTouch, isAudioFile, notAudioMessage } from '../audioAccept';

const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1', maxTouchPoints: 5 };
const ipadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15', maxTouchPoints: 5 };
const mac = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36', maxTouchPoints: 0 };
const android = { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36', maxTouchPoints: 5 };

describe('audio file pickers', () => {
  it('knows Apple touch devices, including an iPad that says it is a Mac', () => {
    expect(isAppleTouch(iphone)).toBe(true);
    expect(isAppleTouch(ipadOS)).toBe(true);
    expect(isAppleTouch(mac)).toBe(false);
    expect(isAppleTouch(android)).toBe(false);
    expect(isAppleTouch(undefined)).toBe(false);
  });

  it('never sends audio/* to iOS (that opens the video picker), only extensions', () => {
    const ios = audioAccept(iphone);
    expect(ios).not.toContain('audio/*');
    expect(ios).not.toContain('/');
    expect(ios).toContain('.wav');
    expect(ios).toContain('.m4a');
    expect(audioAccept(ipadOS)).toBe(ios);
  });

  it('keeps the wildcard plus extensions elsewhere', () => {
    for (const nav of [mac, android]) {
      const a = audioAccept(nav);
      expect(a.startsWith('audio/*,')).toBe(true);
      expect(a).toContain('.wav');
    }
  });

  it('accepts audio by type or by extension when the type is empty', () => {
    expect(isAudioFile({ name: 'kick.wav', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'song', type: 'audio/x-wav' })).toBe(true);
    expect(isAudioFile({ name: 'memo.m4a', type: '' })).toBe(true);
    expect(isAudioFile({ name: 'clip.mov', type: 'video/quicktime' })).toBe(false);
    expect(isAudioFile({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
  });

  it('says what a refused file was', () => {
    expect(notAudioMessage({ name: 'clip.mov', type: 'video/quicktime' })).toMatch(/is a video/);
    expect(notAudioMessage({ name: 'notes.txt', type: '' })).toMatch(/not an audio file/);
  });
});
