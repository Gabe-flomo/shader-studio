import { describe, expect, it } from 'vitest';
import { mobileHidesParam } from '../mobileNodeParams';

describe('the phone node page', () => {
  it('keeps the Grid Rules card params (Speed, Reset, the brush) and leaves the rest to its editor', () => {
    for (const k of ['rate', 'reset', 'brushRadius', 'brushState']) expect(mobileHidesParam('gridRules', k)).toBe(false);
    expect(mobileHidesParam('gridRules', 'ruleType')).toBe(true);
    expect(mobileHidesParam('gridRules', 'born')).toBe(true);
  });

  it('shows every param of other nodes', () => {
    expect(mobileHidesParam('timeCube', 'frames')).toBe(false);
    expect(mobileHidesParam('drawAgents', 'camDistance')).toBe(false);
  });
});
