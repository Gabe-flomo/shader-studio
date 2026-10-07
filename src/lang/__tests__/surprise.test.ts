/**
 * The random statement generator (lang/surprise.ts, §13 "Randomness"): every size and dialect,
 * over many seeds, makes a line that reads with no mistakes and runs to a graph that compiles; a
 * seed repeats its line; sizes differ in length; lines follow the flow's order.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { readSurpriseCommand, surpriseLine, type SurpriseSize } from '../surprise';
import { readLine, sceneNodes } from '../run';
import { runSentence } from './goldens';
import { scratchGraph } from '../../suggestions/doScratch';
import { compileGraph } from '../../compiler/graphCompiler';

const SIZES: SurpriseSize[] = ['small', 'medium', 'large'];

describe('surprise me: the random statement generator', () => {
  it('2D: every line reads and runs to a graph that compiles, on an empty graph and a busy one', () => {
    for (const size of SIZES) for (let seed = 1; seed <= 80; seed++) {
      const { line } = surpriseLine({ seed, size, dialect: '2d' });
      const r = readLine(line, { seed: 1 });
      expect(r.errors.map(e => e.message), line).toEqual([]);
      expect(r.dialect, line).toBe('picture');
      expect(r.picture?.sentence, `${line}: ${r.picture?.why}`).toBeTruthy();
      for (const on of ['empty', 'mixed'] as const) {
        const p = runSentence(r.picture!.sentence!, scratchGraph(on), []);
        expect(p.clauses.filter(c => c.status !== 'ok').map(c => `${c.text}: ${c.message}`), `${line} on ${on}`).toEqual([]);
        const c = compileGraph({ nodes: p.nodes });
        expect(c.errors, `${line}: ${JSON.stringify(c.errors)}`).toBeUndefined();
      }
    }
  });
  it('3D: every line reads as a scene that builds and compiles', () => {
    for (const size of SIZES) for (let seed = 1; seed <= 60; seed++) {
      const { line } = surpriseLine({ seed, size, dialect: '3d' });
      const r = readLine(line, { seed: 1 });
      expect(r.errors.map(e => e.message), line).toEqual([]);
      expect(r.dialect, line).toBe('scene');
      let k = 0;
      const built = sceneNodes(scratchGraph('empty'), r.scene!, () => `s${++k}`);
      const c = compileGraph({ nodes: built.nodes });
      expect(c.errors, `${line}: ${JSON.stringify(c.errors)}`).toBeUndefined();
    }
  });
  it('a seed repeats its line; sizes grow; the flow\'s order holds', () => {
    expect(surpriseLine({ seed: 42 }).line).toBe(surpriseLine({ seed: 42 }).line);
    expect(new Set(Array.from({ length: 10 }, (_, i) => surpriseLine({ seed: i + 1 }).line)).size).toBeGreaterThan(6);
    const clauses = (size: SurpriseSize) => Array.from({ length: 40 }, (_, i) => surpriseLine({ seed: i + 1, size }).line.split(' · ').length).reduce((a, b) => a + b, 0) / 40;
    expect(clauses('small')).toBeLessThan(clauses('medium'));
    expect(clauses('medium')).toBeLessThan(clauses('large'));
    // Shape it before colour, colour before post (docs/structure-hints.md).
    for (let seed = 1; seed <= 60; seed++) {
      const parts = surpriseLine({ seed, size: 'large' }).line.split(' · ').map(p => p.split(' ')[0]);
      const at = (w: string[]) => parts.findIndex(p => w.includes(p));
      const shapeIt = at(['glow', 'rings', 'outline']), colour = at(['colour']), post = at(['tone-map', 'grain', 'brighten']);
      if (shapeIt >= 0 && colour >= 0) expect(shapeIt).toBeLessThan(colour);
      if (colour >= 0 && post >= 0) expect(colour).toBeLessThan(post);
    }
  });
  it('reads the bar\'s command', () => {
    expect(readSurpriseCommand('surprise me')).toEqual({});
    expect(readSurpriseCommand('surprise me large 3d')).toEqual({ size: 'large', dialect: '3d' });
    expect(readSurpriseCommand('surprise me small seed 42')).toEqual({ size: 'small', seed: 42 });
    expect(readSurpriseCommand('circle')).toBeNull();
  });
});
