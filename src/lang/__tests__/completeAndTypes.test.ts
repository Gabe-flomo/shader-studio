/**
 * Type-ahead (lang/complete.ts) and type checks (lang/typeCheck.ts): ranking, parameter hints,
 * refusals with their fixes, and that the wire rule is the graph's own (typesCompatible).
 */
import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });

import { doBarAssist, matchScore, pickerAssist, rankCompletions, recipeAssist } from '../complete';
import { checkExprType, checkWire, inferType } from '../typeCheck';
import { typesCompatible } from '../../lib/typesCompatible';
import { CONDITION_KINDS } from '../../agentRules/spec';

const labels = (xs: Array<{ label: string }>) => xs.map(x => x.label);

describe('ranking', () => {
  it('exact, then prefix, then a word inside, then letters in order, then a typo', () => {
    expect(matchScore('circle', 'circle')).toBeGreaterThan(matchScore('circ', 'circle'));
    expect(matchScore('circ', 'circle')).toBeGreaterThan(matchScore('union', 'smooth-union'));
    expect(matchScore('union', 'smooth-union')).toBeGreaterThan(matchScore('circ', 'cylinder'));
    expect(matchScore('circ', 'cylinder')).toBeGreaterThan(0);
    expect(matchScore('glwo', 'glow')).toBeGreaterThan(0);
    expect(matchScore('zzz', 'circle')).toBe(0);
    expect(labels(rankCompletions('cy', [{ label: 'capsule' }, { label: 'cylinder' }, { label: 'cone' }]))).toEqual(['cylinder']);
  });

  it('the Do… bar: "circ" offers circle → Circle SDF first, and cylinder', () => {
    const a = doBarAssist('circ');
    expect(a.items[0].label).toBe('circle');
    expect(a.items[0].detail).toMatch(/Circle SDF/);
    expect(labels(a.items)).toContain('cylinder');
    expect(a.from).toBe(0);
  });

  it('the Do… bar: an action shows its settings, and output phrases are offered', () => {
    expect(doBarAssist('circle with a glow ').signature?.params.map(p => p.key)).toEqual(['falloff', 'colour']);
    const phrase = doBarAssist('output the dep').items.find(c => c.label === 'output the depth');
    expect(phrase?.replaceAll).toBe(true);
    expect(labels(doBarAssist('circ').items)).not.toContain('colour it by distance with a palette');
  });

  it('pickers: typing finds a condition by its words', () => {
    const items = CONDITION_KINDS.map(k => ({ ...k, words: [k.kind] }));
    expect(pickerAssist('chan', items)[0].kind).toBe('chance');
    expect(pickerAssist('', items).length).toBe(items.length);
  });
});

describe('recipe type-ahead and parameter hints', () => {
  it('at a clause start offers shapes, warps, combines and settings with one-line descriptions and signatures', () => {
    const a = recipeAssist('sph', 3);
    expect(a.items[0].label).toBe('sphere');
    expect(a.items[0].signature).toMatch(/^sphere r=0.5 at=\(x,y,z\)/);
    expect(a.items[0].detail).toMatch(/Sphere/);
    expect(labels(recipeAssist('surface · cyl', 13).items)).toContain('cylinder');
    expect(labels(recipeAssist('outp', 4).items)[0]).toBe('output');
  });

  it('after a keyword: its settings, and the signature marks the next one', () => {
    const text = 'sphere r=1 ';
    const a = recipeAssist(text, text.length);
    expect(a.signature?.head).toBe('sphere');
    expect(a.signature?.params[a.signature.active].key).toBe('at');
    expect(labels(a.items)).not.toContain('r');
    expect(labels(a.items)).toContain('at');
    const torus = recipeAssist('torus R', 7);
    expect(torus.signature?.params[torus.signature.active].key).toBe('R');
  });

  it('inside a combine, after @, and after output / palette / color=', () => {
    expect(labels(recipeAssist('union(sph', 9).items)[0]).toBe('sphere');
    expect(recipeAssist('union(sphere r', 14).signature?.head).toBe('sphere');
    expect(recipeAssist('box @tw', 7).items[0].insert).toBe('twist(');
    expect(labels(recipeAssist('sphere · output de', 18).items)[0]).toBe('depth');
    expect(labels(recipeAssist('sphere · colour by depth palette su', 35).items)[0]).toBe('sunset');
    expect(labels(recipeAssist('sphere color=te', 15).items)).toContain('teal');
  });
});

describe('type checks', () => {
  it('reuses the graph\'s wire rule', () => {
    for (const [a, b] of [['float', 'vec3'], ['vec3', 'float'], ['vec2', 'vec3'], ['vec3', 'vec4'], ['vec4', 'vec2'], ['texture', 'vec3']]) {
      expect(checkWire(a, b).ok, `${a} → ${b}`).toBe(typesCompatible(a, b));
    }
  });

  it('refuses a vec3 colour into a float with Luminance and .x as the fixes', () => {
    const r = checkWire('vec3', 'float', { from: 'Palette · Color', to: 'Remap · Value' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/Palette · Color is three numbers \(vec3\), Remap · Value takes a number \(float\)/);
    expect(r.fixes.map(f => f.id)).toEqual(['luminance', 'take-x']);
    expect(r.fixes[1].rewrite!('c')).toBe('(c).x');
  });

  it('infers expression types: constructors, swizzles, built-ins, broadcasting', () => {
    expect(inferType('u + 0.2 * lap_u')).toEqual({ type: 'float' });
    expect(inferType('vec3(u, v, 0.0)')).toEqual({ type: 'vec3' });
    expect(inferType('vec3(u).xy')).toEqual({ type: 'vec2' });
    expect(inferType('length(vec2(u, v))')).toEqual({ type: 'float' });
    expect(inferType('mix(vec3(u), vec3(v), 0.5) * 2.0')).toEqual({ type: 'vec3' });
    expect(inferType('u > 0.5 ? 1.0 : 0.0')).toEqual({ type: 'float' });
    expect('error' in inferType('vec2(u) + vec3(v)')).toBe(true);
  });

  it('refuses an update that makes a vec3 where a number goes, with the rewrite', () => {
    const p = checkExprType('vec3(u, v, 0.0)', 'float');
    expect(p?.message).toMatch(/is a number \(float\), but this makes three numbers \(vec3\).*take \.x.*\(vec3\(u, v, 0\.0\)\)\.x/);
    expect(checkExprType('u * 2.0', 'float')).toBeNull();
  });
});
