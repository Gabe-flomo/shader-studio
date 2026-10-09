/**
 * Lighting idioms and concepts carried across lines: recognised by pattern and data flow (graph
 * wiring, normalize on an earlier line), not by what the variables are called.
 */
import { describe, expect, it } from 'vitest';
import { explainLine, lineConcepts, type ExplainContext } from '../explain';
import { roleOfSourceNode } from '../roles';
import { literalColour } from '../../../components/explain/ExplainText';

const lead = (text: string, ctx: ExplainContext) => { const r = explainLine(text, ctx); return 'lead' in r ? r.lead : ''; };
const block = (types: Record<string, string>, roles: Record<string, string>, lines: string[][]) => {
  const ls = lines.map(([lhs, rhs]) => ({ lhs, rhs }));
  const ctxs = lineConcepts(ls, { types, roles } as ExplainContext);
  return ls.map((l, i) => lead(`${l.lhs} = ${l.rhs};`, { types, ...ctxs[i] } as ExplainContext));
};

describe('lighting by pattern', () => {
  it('reads a shading block wired from a March Loop, whatever the names', () => {
    const out = block({ q: 'vec3', w: 'vec3', h: 'float' }, { q: 'direction', w: 'space' }, [
      ['float a', 'step(0.95, q.y) * step(w.y, -0.98)'],
      ['vec3 base', 'mix(0.55 + 0.45 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))), vec3(0.18, 0.2, 0.26), a)'],
      ['float b', 'max(dot(q, normalize(vec3(0.5, 0.8, 0.35))), 0.0)'],
      ['float c', '0.5 + 0.5 * q.y'],
      ['float r', 'pow(1.0 - abs(q.y), 3.0) * (1.0 - a)'],
    ]);
    expect(out[0]).toMatch(/on the floor/);
    expect(out[1]).toMatch(/for the floor/);
    expect(out[1]).toMatch(/palette colour everywhere else/);
    expect(out[2]).toMatch(/sunlight.*coming from above and the right/);
    expect(out[3]).toMatch(/light from the sky/);
    expect(out[4]).toMatch(/faces sideways, except the floor/);
  });

  it('carries a direction made by normalize to later lines', () => {
    const out = block({ g: 'vec3', lp: 'vec3' }, {}, [
      ['vec3 k', 'normalize(g)'],
      ['float sh', 'clamp(dot(k, lp), 0.0, 1.0)'],
    ]);
    expect(out[1]).toMatch(/sunlight/);
  });

  it('does not call an ordinary remap or dot product lighting', () => {
    expect(lead('float x = 0.5 + 0.5 * uv.y;', { types: { uv: 'vec2' } } as ExplainContext)).not.toMatch(/sky/);
    expect(lead('float x = max(dot(a, b), 0.0);', { types: { a: 'vec3', b: 'vec3' } } as ExplainContext)).not.toMatch(/sunlight/);
  });

  it('graph outputs give roles by their key', () => {
    expect(roleOfSourceNode('marchLoopGroup', 'vec3', 'normal')).toBe('direction');
    expect(roleOfSourceNode('marchLoopGroup', 'vec3', 'pos')).toBe('space');
    expect(roleOfSourceNode('anything', 'float', 'hit')).toBe('mask');
  });

  it('colour literals get a swatch', () => {
    expect(literalColour('vec3(0.18, 0.2, 0.26)')).toBe('rgb(46, 51, 66)');
    expect(literalColour('vec3(1.0)')).toBe('rgb(255, 255, 255)');
    expect(literalColour('vec3(3.0, 0.0, 0.0)')).toBeNull();
    expect(literalColour('vec3(a, b, c)')).toBeNull();
  });
});
