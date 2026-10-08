/**
 * "A little inspired by" the graphs that exist (lang/surpriseBias.ts): words are counted per graph,
 * the lists lean toward them without ruling anything out, a seed still repeats its line, and every
 * biased line still reads and compiles.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { countWords, leanWeights, type SurpriseBias } from '../surpriseBias';
import { surpriseLine } from '../surprise';
import { readLine } from '../run';
import { runSentence } from './goldens';
import { scratchGraph } from '../../suggestions/doScratch';
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const node = (type: string, params: Record<string, unknown> = {}): GraphNode => ({ id: `${type}-${Math.random()}`, type, position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params });

describe('surprise bias: counting words in graphs', () => {
  it('counts each graph once per word, by node type and by setting', () => {
    const c = countWords([
      [node('shapeSDF', { shape: 'star' }), node('shapeSDF', { shape: 'star' }), node('swirlSpace'), node('palette', { preset: '5' })],
      [node('circleSDF'), node('shapeSDF', { shape: 'star' }), node('toneMap')],
    ]);
    expect(c['shape:star']).toBe(2);
    expect(c['shape:circle']).toBe(1);
    expect(c['space:swirl']).toBe(1);
    expect(c['post:tone-map']).toBe(1);
    expect(c['palette:fire']).toBe(1);
    expect(c['shape:heart']).toBeUndefined();
  });
});

describe('surprise bias: leaning the lists', () => {
  const list = [['a', 2], ['b', 2], ['c', 2]] as const;
  it('without a bias, or with no counts for the group, the list is untouched', () => {
    expect(leanWeights('shape', list)).toBe(list);
    expect(leanWeights('shape', list, { 'post:grain': 4 })).toBe(list);
  });
  it('a word in more graphs weighs more, and nothing drops to zero', () => {
    const w = Object.fromEntries(leanWeights('g', list, { 'g:a': 10, 'g:b': 5 }));
    expect(w.a).toBeGreaterThan(w.b);
    expect(w.b).toBeGreaterThan(w.c);
    expect(w.c).toBeGreaterThan(0);
    expect(w.a / w.c).toBeLessThan(4);
  });
});

describe('surprise bias: the random line', () => {
  const bias: SurpriseBias = { 'shape:star': 40, 'shape:circle': 2, 'post:grain': 30, 'palette:fire': 30 };
  it('a seed repeats its line, with the same bias', () => {
    for (let seed = 1; seed <= 20; seed++) expect(surpriseLine({ seed, bias }).line).toBe(surpriseLine({ seed, bias }).line);
  });
  it('no bias is exactly the old generator', () => {
    for (let seed = 1; seed <= 20; seed++) expect(surpriseLine({ seed, bias: undefined }).line).toBe(surpriseLine({ seed }).line);
  });
  it('leans toward the shapes the graphs use, and still draws the others', () => {
    const shapes = (b?: SurpriseBias) => {
      const out: Record<string, number> = {};
      for (let seed = 1; seed <= 400; seed++) { const first = surpriseLine({ seed, bias: b, dialect: '2d' }).line.split(' · ')[0].split(' ')[0]; out[first] = (out[first] ?? 0) + 1; }
      return out;
    };
    const plain = shapes(), leaned = shapes(bias);
    expect(leaned.star ?? 0).toBeGreaterThan(plain.star ?? 0);
    expect(Object.keys(leaned).length).toBeGreaterThan(5);
  });
  it('every biased line reads and runs to a graph that compiles', () => {
    for (let seed = 1; seed <= 60; seed++) {
      for (const dialect of ['2d', '3d'] as const) {
        const { line } = surpriseLine({ seed, bias, dialect });
        const r = readLine(line, { seed: 1 });
        expect(r.errors.map(e => e.message), line).toEqual([]);
        if (dialect === '2d') {
          const p = runSentence(r.picture!.sentence!, scratchGraph('empty'), []);
          expect(compileGraph({ nodes: p.nodes }).errors, line).toBeUndefined();
        }
      }
    }
  });
});
