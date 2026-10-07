/**
 * Agent Rules' Surprise me (docs/surprise.md): repeatable by seed, numbers inside their bands,
 * every walker kind and the second species turn up, every set compiles in 2D and 3D in a rules
 * group, and the walkers move and lay trail.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { makeRng } from '../../lib/surprise';
import { applyRulesToGroup, backToRules } from '../apply';
import { generateRulesInside } from '../generate';
import { describeRule, normalizeRuleSet } from '../spec';
import { rulesTemplateNodes } from '../templates';
import { surpriseAgents } from '../surprise';
import { programOf, simulate, walkersFor } from './cpuSim';

const SEEDS = Array.from({ length: 40 }, (_, i) => 3 + i * 7727);

describe('Agent Rules Surprise me', () => {
  it('the same seed gives the same rule set', () => {
    expect(surpriseAgents(makeRng(11))).toEqual(surpriseAgents(makeRng(11)));
    expect(surpriseAgents(makeRng(11)).set).not.toEqual(surpriseAgents(makeRng(12)).set);
  });

  it('keeps sensors, speed, trail and colours in their bands; every kind and a second species turn up', () => {
    const kinds = new Set<string>();
    let pairs = 0;
    for (const seed of SEEDS) {
      const s = surpriseAgents(makeRng(seed));
      kinds.add(s.kind);
      if (s.relation) { pairs++; expect(s.set.species).toHaveLength(2); }
      expect(s.set.sensor.distance).toBeGreaterThanOrEqual(0.015);
      expect(s.set.sensor.distance).toBeLessThanOrEqual(0.06);
      expect(s.set.sensor.angle).toBeGreaterThanOrEqual(15);
      expect(s.set.sensor.angle).toBeLessThanOrEqual(60);
      for (const sp of s.set.species) { expect(sp.speed).toBeGreaterThan(0.02); expect(sp.speed).toBeLessThanOrEqual(0.55); }
      expect(s.trail.halfLife).toBeGreaterThanOrEqual(0.03);
      expect(s.trail.halfLife).toBeLessThanOrEqual(0.3);
      for (const c of s.palette.flat()) expect(c >= 0 && c <= 1).toBe(true);
      // It survives a save and load, and reads as sentences.
      expect(normalizeRuleSet(JSON.parse(JSON.stringify(s.set)))).toEqual(s.set);
      s.set.species.forEach((sp, i) => sp.rules.forEach(r => expect(describeRule(s.set, i, r)).toMatch(/^When .+ → .+/)));
    }
    expect(kinds).toEqual(new Set(['tracker', 'drifter', 'flocker', 'pulser']));
    expect(pairs).toBeGreaterThan(0);
    const d3 = surpriseAgents(makeRng(5), { d3: true });
    expect(d3.set.sensor.distance).toBeGreaterThanOrEqual(0.1);
    expect(d3.set.species[0].speed).toBeGreaterThanOrEqual(1);
  });

  it('every surprise compiles in a rules group, in 2D and 3D', () => {
    for (const seed of SEEDS) for (const space of ['2d', '3d'] as const) {
      const s = surpriseAgents(makeRng(seed), { d3: space === '3d' });
      const nodes = rulesTemplateNodes('slime', 'sp').map(x => {
        if (x.type !== 'agentsGroup') return x;
        const g = applyRulesToGroup({ ...x, params: { ...x.params, space } }, s.set);
        return space === '3d' ? backToRules(g) : g;
      });
      const r = compileGraph({ nodes });
      expect(r.errors, `${space} seed ${seed}: ${s.summary}`).toBeUndefined();
      expect(r.success).toBe(true);
    }
  });

  it('the walkers move, and trackers, drifters and flockers lay trail', () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const s = surpriseAgents(makeRng(seed));
      const w = simulate(programOf(generateRulesInside(s.set, { groupId: 'g', d3: false })), walkersFor(6), 4);
      expect(w.every(x => x.speed > 0), s.summary).toBe(true);
      if (s.kind !== 'pulser') expect(w.some(x => x.dep.some(v => v > 0)), s.summary).toBe(true);
    }
  });
});
