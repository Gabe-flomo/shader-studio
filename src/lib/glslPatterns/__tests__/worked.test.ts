import { describe, expect, it } from 'vitest';
import { explainLine, workedSteps, workedVars, showValue } from '..';

const line = (src: string) => {
  const ex = explainLine(src, { types: { angle: 'float', wind: 'float', home: 'float' } });
  if (!('steps' in ex)) throw new Error('did not explain');
  return ex;
};

describe('worked examples', () => {
  it('gives every name the line reads a sample value and range', () => {
    const ex = line('float phase = 2.0 * angle - wind * log(home) - 0.12 * t;');
    const vars = workedVars(ex);
    expect(vars.map(v => v.name).sort()).toEqual(['angle', 'home', 't', 'wind']);
    expect(vars.find(v => v.name === 't')!.why).toBe('time in seconds');
  });

  it('evaluates each step at the sample, exactly', () => {
    const ex = line('float phase = 2.0 * angle - wind * log(home) - 0.12 * t;');
    const vars = workedVars(ex).map(v => ({ ...v, value: ({ angle: 0.5, wind: 1.5, home: 420, t: 3.2 } as Record<string, number>)[v.name] }));
    const steps = workedSteps(ex, vars);
    const last = steps[steps.length - 1];
    expect(last.value as number).toBeCloseTo(2 * 0.5 - 1.5 * Math.log(420) - 0.12 * 3.2, 6);
    // 2.0 * angle is a step on its own
    expect(steps.some(s => Math.abs((s.value as number) - 1) < 1e-9)).toBe(true);
  });

  it('spreads a step over its inputs\' ranges', () => {
    const ex = line('float s = sin(x * 6.2832);');
    const steps = workedSteps(ex, workedVars(ex));
    const sinStep = steps[steps.length - 1];
    expect(sinStep.range![0]).toBeLessThan(-0.9);
    expect(sinStep.range![1]).toBeGreaterThan(0.9);
  });

  it('handles vectors, and steps it can\'t compute have no number', () => {
    const ex = line('vec2 q = uv * 3.0 + vec2(t, 0.0);');
    const vars = workedVars(ex);
    expect(vars.find(v => v.name === 'uv')!.type).toBe('vec2');
    const steps = workedSteps(ex, vars);
    expect(showValue(steps[steps.length - 1].value!)).toMatch(/^\(.+, .+\)$/);
    const tex = line('vec3 c = texture(img, uv).rgb * 2.0;');
    expect(workedSteps(tex, workedVars(tex)).some(s => s.value === null)).toBe(true);
  });

  it('formats values for reading', () => {
    expect(showValue(0.123456)).toBe('0.123');
    expect(showValue(12.3456)).toBe('12.35');
    expect(showValue([0.3, 0.2])).toBe('(0.3, 0.2)');
  });
});
