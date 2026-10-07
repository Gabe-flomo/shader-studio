/**
 * The Do… bar's dialects, picture and edit (docs/playfield-language-plan.md phase 5, §11.1):
 *  1. corpus equivalence: every Do… bar sentence that runs gives the same graph through
 *     sugar → canonical → the bar's executors as it gives itself (the phase 0 goldens);
 *  2. canonical fixpoint: a canonical line prints back as itself;
 *  3. the plan's worked examples (2D and edits) read as written and run;
 *  plus refusals, mistakes with "did you mean", randomness and the dialect choice.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { LANGUAGE_CORPUS } from './corpus';
import { goldenOf, runSentence, type Golden } from './goldens';
import recorded from './goldens/do-bar.json';
import { canonicalOf, parsePicture, printPicture } from '../dialects/picture';
import { detectDialect, gridPlan, readLine } from '../run';
import { runDoPlan } from '../../suggestions/doBar';
import { scratchGraph } from '../../suggestions/doScratch';
import { estimateNodeHeight } from '../../store/graphLayout';
import { compileGraph } from '../../compiler/graphCompiler';
import type { GraphNode } from '../../types/nodeGraph';

const key = (text: string, source: string, selected: string[]) => `${source}${selected.length ? ` [${selected.join(',')}]` : ''} · ${text}`;
/** Sentences the canonical form doesn't cover yet (a colour as the second value of an arithmetic step). */
const NO_CANONICAL = new Set(['multiply the noise by red']);

/** Run a canonical line on a graph, the way the bar does. */
function runCanonical(line: string, nodes: GraphNode[], selected: string[]) {
  const r = readLine(line, { seed: 1 });
  expect(r.errors.map(e => e.message), line).toEqual([]);
  if (r.dialect === 'grid') {
    let k = 0;
    const res = runDoPlan(nodes, gridPlan(r.grid!, selected[0]), () => `t${++k}`, { heightOf: estimateNodeHeight });
    return { ...runSentence('', nodes, selected), nodes: res.nodes, ok: res.ran.length > 0 };
  }
  expect(r.picture?.sentence, `${line}: ${r.picture?.why}`).toBeTruthy();
  return runSentence(r.picture!.sentence!, nodes, selected);
}

describe('picture and edit dialects: the corpus (sugar ⇄ canonical)', () => {
  const golden = recorded as Record<string, Golden>;
  it('every sentence that runs has a canonical line that runs to the same graph, and prints back as itself', () => {
    let covered = 0;
    const failures: string[] = [];
    for (const e of LANGUAGE_CORPUS) {
      const want = golden[key(e.text, e.source, e.selected)];
      if (!want?.ok) continue;
      const g = e.graph();
      const canon = canonicalOf(e.text, { nodes: g, selected: e.selected });
      if (!canon) { if (!NO_CANONICAL.has(e.text)) failures.push(`no canonical line: ${e.text}`); continue; }
      const r = readLine(canon, { seed: 1 });
      if (r.canonical !== canon) failures.push(`not a fixpoint: ${canon} → ${r.canonical}`);
      const got = goldenOf(runCanonical(canon, e.graph(), e.selected) as never, g);
      got.reads = want.reads;
      if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${e.text}  ⇒  ${canon}\n   want ${JSON.stringify(want)}\n   got  ${JSON.stringify(got)}`);
      covered++;
    }
    expect(failures).toEqual([]);
    expect(covered).toBeGreaterThan(340);
  });
});

describe('picture and edit dialects: the plan\'s worked examples', () => {
  const examples: Array<[string, Parameters<typeof scratchGraph>[0], string[]]> = [
    ['circle r=0.3 · glow falloff=8 · colour by length', 'empty', []],
    ['circle · glow falloff=8', 'empty', []],
    ['heart at=top-left · rings', 'empty', []],
    ['star · glow falloff=4 · polar-repeat 6', 'empty', []],
    ['circle · rings 12 · swirl 2', 'empty', []],
    ['hexagon · outline width=0.01 color=pink · the hexagon · glow falloff=12 color=pink · the picture · tone-map', 'empty', []],
    ['noise · warp 0.6 · colour by it · output', 'empty', []],
    ['twist 0.5', 'circle', ['c']],
    ['these · mix', 'mixed', ['p', 'g']],
    ['these · smooth-union', 'twoShapes', ['a', 'b']],
    ['circle at=top-left · glow · the picture · fade', 'empty', []],
    ['ring · glow falloff=0.3 · colour by length · it * circle · output', 'circle', []],
    ['disconnect picture · noise + it · output', 'mixed', []],
    ['connect noise → glow.tint', 'mixed', []],
    ['insert tone-map between palette and output', 'noise', []],
    ['duplicate glow · set it falloff=3', 'glow', []],
    ['set circle size/=1.1 · rename it "Dot" · group(circle, glow) name="Neon"', 'glow', []],
    ['mix(palette, glow) by=0.3', 'mixed', []],
    ['union(circle, box)', 'twoShapes', []],
    ['circle · glow · colour by length palette=fire', 'empty', []],
  ];
  for (const [line, on, sel] of examples) {
    it(line, () => {
      const p = runCanonical(line, scratchGraph(on), sel);
      expect(p.clauses.map(c => `${c.verb}:${c.status}:${c.message ?? ''}`).filter(s => !s.includes(':ok:'))).toEqual([]);
      expect(p.ok).toBe(true);
      expect(compileGraph({ nodes: p.nodes }).errors).toBeUndefined();
      expect(printPicture(parsePicture(line).clauses)).toBe(line);
    });
  }
});

describe('picture and edit dialects: choosing, refusing, mistakes, randomness', () => {
  it('chooses the dialect by the header or the words (§4.0)', () => {
    expect(detectDialect('circle · glow').dialect).toBe('picture');
    expect(detectDialect('sphere r=1 @move(0,1,0) · smooth-union(box, torus) k=0.5 · output depth').dialect).toBe('scene');
    expect(detectDialect('surface · sphere').dialect).toBe('scene');
    expect(detectDialect('cone · fog 0.3').dialect).toBe('scene');
    expect(detectDialect('grid swirl').dialect).toBe('grid');
    expect(detectDialect('life walls board=480').dialect).toBe('grid');
    expect(detectDialect('species Ants: always do wander 7deg').dialect).toBe('agents');
    expect(detectDialect('output depth').dialect).toBe('picture');
  });
  it('refuses a line that mixes a 3D scene and a 2D picture (§13 decision 8)', () => {
    const r = readLine('cone · heart · glow');
    expect(r.errors[0].message).toMatch(/mixes a 3D scene \(“cone”\) and a 2D picture \(“heart”\)/);
  });
  it('mistakes at their place, with "did you mean"', () => {
    const r = readLine('circle · glwo falloff=8');
    expect(r.errors[0]).toMatchObject({ col: 10 });
    expect(r.errors[0].message).toContain('“glow”');
    expect(readLine('circle · glow fallof=8').errors[0].message).toContain('“falloff”');
    expect(readLine('connect noise glow').errors.length).toBeGreaterThan(0);
  });
  it('edit verbs leave "the" out (§13 decision 2); a reference clause keeps it', () => {
    expect(canonicalOf('set the glow falloff to 8', { nodes: scratchGraph('glow'), selected: [] })).toBe('set glow falloff=8');
    expect(canonicalOf('connect the noise to the tint of the glow', { nodes: scratchGraph('mixed'), selected: [] })).toBe('connect noise → glow.tint');
    expect(canonicalOf('glow the circle', { nodes: scratchGraph('mixed'), selected: [] })).toBe('the circle · glow');
    expect(canonicalOf('disconnect the current output, add it to the noise, and output the result', { nodes: scratchGraph('mixed'), selected: [] })).toBe('disconnect picture · noise + it · output');
  });
  it('random values, a leading random, and a seed that repeats them', () => {
    const a = readLine('circle · glow falloff=random · seed=7'), b = readLine('circle · glow falloff=random · seed=7');
    expect(a.canonical).toBe(b.canonical);
    expect(a.resolved[0]).toMatchObject({ key: 'glow.falloff', from: 'random' });
    const f = Number(/falloff=([\d.]+)/.exec(a.canonical!)![1]);
    expect(f).toBeGreaterThanOrEqual(4);
    expect(f).toBeLessThanOrEqual(20);
    const r = readLine('random circle · glow · colour by length', { seed: 3 });
    expect(r.errors).toEqual([]);
    expect(r.resolved.map(x => x.key)).toEqual(expect.arrayContaining(['circle.r', 'glow.falloff', 'colour.palette']));
    expect(r.canonical).not.toContain('random');
    const runs = new Set(Array.from({ length: 6 }, () => readLine('circle · glow falloff=random').canonical));
    expect(runs.size).toBeGreaterThan(1);
    expect(readLine('circle · glow color=random(red, teal)', { seed: 2 }).canonical).toMatch(/color=(red|teal)/);
  });
});
