/**
 * The Do… bar's type-ahead for the language (lang/barAssist.ts, §13 "Autocomplete everywhere"):
 * create lists everything creatable, grouped; connect suggests wires that fit by type, ranked by the
 * usage table; set <node> lists its settings; every head has its signature.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { barAssist, creatable, refFor, wiresHere } from '../barAssist';
import { scratchGraph } from '../../suggestions/doScratch';
import { n } from '../../store/graphBuilder';
import { entriesFor } from '../registry';
import { readLine } from '../run';

const at = (text: string, nodes = scratchGraph('mixed'), rank?: (a: string, b: string, c: string, d: string) => number) => barAssist(text, text.length, { nodes, rank });

describe('the Do… bar type-ahead', () => {
  it('after create: everything creatable, grouped (shapes first, then node categories)', () => {
    const all = creatable();
    expect(all[0].group).toBe('Shapes');
    expect(new Set(all.map(c => c.group)).size).toBeGreaterThan(8);
    expect(all.length).toBeGreaterThan(150);
    const a = at('create ');
    expect(a.items.length).toBe(all.length);
    expect(at('create tone').items[0].label).toBe('tone-map');
    expect(at('create circ').items.map(c => c.label)).toContain('circle');
    // What it offers reads back as a create clause.
    for (const c of all.slice(0, 60)) expect(readLine(`create ${c.insert}`).errors.map(e => e.message), c.insert).toEqual([]);
  });
  it('after connect: wires on this graph that fit by type, best first, ranked by the usage table', () => {
    const nodes = [n('uv', 'u', 0, 0), n('circleSDF', 'c', 420, 0), n('output', 'o', 900, 0)];
    const plain = at('connect ', nodes).items.map(c => c.label);
    expect(plain).toContain('uv → circle.position');
    expect(plain.every(l => / → /.test(l))).toBe(true);
    // The usage table moves a common wire to the top.
    const ranked = at('connect ', nodes, (a, _b, c, d) => (a === 'uv' && c === 'circleSDF' && d === 'position' ? 1 : 0)).items;
    expect(ranked[0].label).toBe('uv → circle.position');
    // After "connect uv →": only inputs uv fits.
    const after = at('connect uv → ', nodes).items.map(c => c.label);
    expect(after).toContain('circle.position');
    expect(after.every(l => !l.includes('→'))).toBe(true);
    // No wire that would make a loop, and none already there.
    const w = wiresHere({ nodes: scratchGraph('glow') });
    expect(w.some(c => c.label.startsWith('glow → circle'))).toBe(false);
    expect(w.some(c => c.label === 'uv → circle.position')).toBe(false);
  });
  it('after set <node>: its settings with their values; after key=: its choices or colours', () => {
    const s = at('set glow ');
    expect(s.items.map(c => c.label)).toContain('falloff');
    expect(s.items.find(c => c.label === 'falloff')!.insert).toBe('falloff=');
    expect(at('set glow tint=').items.map(c => c.label)).toContain('cyan');
    expect(at('set ').items.map(c => c.label)).toEqual(expect.arrayContaining(['circle', 'glow', 'noise']));
  });
  it('a head at the start of a clause; its settings and values after it; a signature for every head', () => {
    expect(at('circle · gl').items[0].label).toBe('glow');
    expect(at('circle · glow ').signature?.head).toBe('glow');
    expect(at('circle · glow fall').items[0].label).toBe('falloff');
    expect(at('circle · glow falloff=').items.map(c => c.label)).toContain('random');
    expect(at('circle · glow color=').items.map(c => c.label)).toContain('teal');
    for (const e of [...entriesFor('picture'), ...entriesFor('edit')]) {
      if (e.id.startsWith('scene:')) continue;
      const head = e.kind === 'combine' ? `${e.words[0]}(` : e.words[0];
      const a = barAssist(`${head} `, head.length + 1, { nodes: scratchGraph('mixed') });
      expect(a.signature, e.id).toBeTruthy();
    }
  });
  it('names nodes the way the language reads them', () => {
    const g = scratchGraph('twoCircles');
    expect(refFor(g.find(x => x.id === 'a')!, g)).toBe('circle#1');
    expect(refFor(g.find(x => x.id === 'b')!, g)).toBe('circle#2');
    expect(refFor(scratchGraph('glow').find(x => x.id === 'g')!, scratchGraph('glow'))).toBe('glow');
  });
});
