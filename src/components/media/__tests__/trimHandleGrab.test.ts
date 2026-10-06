import { describe, expect, it } from 'vitest';
import { trimHandleGrab } from '../clipEditorParts';

describe('trim handles', () => {
  it('a mouse keeps the tight grab it had', () => {
    expect(trimHandleGrab(false, 12)).toEqual({ grabIn: 14, outside: 4, slackY: 4 });
  });

  it('a finger gets a wider grab on both sides of the edge, and more height', () => {
    const t = trimHandleGrab(true, 12);
    expect(t.grabIn).toBeGreaterThanOrEqual(22);
    expect(t.outside).toBeGreaterThanOrEqual(16);
    expect(t.grabIn + t.outside).toBeGreaterThanOrEqual(40); // about a fingertip
    expect(t.slackY).toBeGreaterThan(trimHandleGrab(false, 12).slackY);
  });
});
