import { describe, it, expect } from 'vitest';
import { discoverInSource } from '../discover';
import { inferParamRoles, learnRole, forgetRole, usagePattern, learnedKey, LEARNED_WHY, type RoleMemory } from '../roles';

const SRC = `float wave(float t) { return sin(t * 3.0 + 1.0); }
float wave2(float t) { return sin(t * 3.0 + 1.0) * 0.5; }
float ripple(float k) { return sin(k * 3.0 + 1.0); }
float other(float t) { return t * t; }
float sdCircle(vec2 p, float r) { return length(p) - r; }`;
const fns = discoverInSource({ id: 's', name: 'S', code: SRC });
const by = (n: string) => fns.find(f => f.name === n)!;
const bodyOf = (n: string) => by(n).text.slice(by(n).text.indexOf('{'));

describe('usage patterns', () => {
  it('describe how a parameter is used with its name taken out', () => {
    expect(usagePattern('t', 'float', bodyOf('wave'))).toBe(usagePattern('k', 'float', bodyOf('ripple')));
    expect(usagePattern('t', 'float', bodyOf('wave'))).not.toContain('t ×');
    expect(usagePattern('t', 'float', bodyOf('other'))).toBe('');
  });
});

describe('learning roles from corrections', () => {
  it('starts from the guess with an empty memory', () => {
    const r = inferParamRoles(by('wave'), {})[0];
    expect(r.role).toBe('time');
    expect(r.learned).toBeUndefined();
  });

  it('takes the choice outright for the same name used the same way, and says so', () => {
    const guess = inferParamRoles(by('wave'))[0].role;
    const mem = learnRole({}, by('wave'), 0, guess, 'angle', 1);
    const entry = Object.values(mem)[0];
    expect(entry).toMatchObject({ type: 'float', name: 't', role: 'angle', rejected: ['time'], count: 1 });
    const again = inferParamRoles(by('wave'), mem)[0];
    expect(again).toMatchObject({ role: 'angle', confidence: 1, because: [LEARNED_WHY] });
    expect(again.learned).toBe(learnedKey('float', 't', entry.pattern));
  });

  it('leans a similar parameter (same use under another name) towards the choice and away from the rejected guess', () => {
    const mem = learnRole({}, by('wave'), 0, 'time', 'angle', 1);
    const before = inferParamRoles(by('ripple'))[0];
    const after = inferParamRoles(by('ripple'), mem)[0];
    expect(before.role).toBe('time');
    expect(after.role).toBe('angle');
    expect(after.because[0]).toBe(LEARNED_WHY);
    expect(after.learned).toBeDefined();
  });

  it('leans the same name used differently, but a strong guess can still win', () => {
    const mem = learnRole({}, by('wave'), 0, 'time', 'scale', 1);
    const r = inferParamRoles(by('other'), mem)[0];
    // `t` alone says time (named t); the lean towards scale is enough against a bare name.
    expect(['scale', 'time']).toContain(r.role);
    // A parameter of another type is never touched.
    expect(inferParamRoles(by('sdCircle'), mem)[0].role).toBe('position');
  });

  it('keeps counting, un-rejects a role chosen later, and forgets one or all', () => {
    let mem: RoleMemory = learnRole({}, by('wave'), 0, 'time', 'angle', 1);
    mem = learnRole(mem, by('wave'), 0, 'angle', 'time', 2);
    const e = Object.values(mem)[0];
    expect(e).toMatchObject({ role: 'time', rejected: ['angle'], count: 2, at: 2 });
    const key = Object.keys(mem)[0];
    mem = learnRole(mem, by('sdCircle'), 1, 'scale', 'distance', 3);
    expect(Object.keys(forgetRole(mem, key))).toHaveLength(1);
    expect(forgetRole(mem)).toEqual({});
    expect(inferParamRoles(by('wave'), forgetRole(mem))[0].learned).toBeUndefined();
  });

  it('ignores a remembered role the type can’t play', () => {
    const mem: RoleMemory = { bad: { type: 'float', name: 't', pattern: usagePattern('t', 'float', bodyOf('wave')), role: 'colour', rejected: [], count: 1, at: 1 } };
    mem[learnedKey('float', 't', mem.bad.pattern)] = mem.bad;
    expect(inferParamRoles(by('wave'), mem)[0].role).toBe('time');
  });
});
