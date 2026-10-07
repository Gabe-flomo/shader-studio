/**
 * Good defaults (§13 "Additions"): a line with no numbers looks good. `circle · glow · colour by
 * length` and its kin, run on an empty graph exactly as the Do… bar runs them, must give a picture
 * that is neither blown out (too much clipped to white) nor invisible (nearly all black), nor flat.
 *
 * The pictures are drawn by the GPU, so the numbers come from a headless render:
 *   1. DEFAULTS_OUT=<dir> npx vitest run src/lang/__tests__/defaults.test.ts   (writes the shaders)
 *   2. node tools/lang-defaults-render.mjs <dir>/lang-defaults.json src/lang/__tests__/goldens/defaults-stats.json
 * Step 2 renders each in headless Chrome and records the same frame stats the node preview's notes
 * use (black, clipped, flat). This test then checks every sample line against them, and that each
 * line still compiles to the shader that was measured (so a change to a default needs a new render).
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { readLine } from '../run';
import { runSentence, hash } from './goldens';
import { scratchGraph } from '../../suggestions/doScratch';
import { compileGraph } from '../../compiler/graphCompiler';
import stats from './goldens/defaults-stats.json';

const SHAPES = ['circle', 'ring', 'box', 'star', 'hexagon', 'heart', 'triangle', 'moon'];
/** The sample: every shape with each shape-it step, coloured and not, plus fields and bends. */
export const DEFAULT_LINES: string[] = [
  ...SHAPES.flatMap(s => [`${s} · glow`, `${s} · glow · colour by length`, `${s} · rings`, `${s} · outline`, `${s} · glow · colour by angle`]),
  'circle · rings · colour by length', 'circle · glow · tone-map', 'circle · glow · colour by length · tone-map', 'circle · glow · colour by time',
  'star · polar-repeat · glow · colour by length', 'circle · twist · glow', 'circle · swirl · rings', 'box · repeat · glow', 'hexagon · mirror · outline',
  'circle · onion · glow', 'circle · warp · glow · colour by length', 'circle · glow · grain', 'circle · glow · brighten',
  'noise · colour by it', 'noise · warp · colour by it', 'voronoi · colour by it',
];

/** The shader a line makes on an empty graph (as the bar runs it). */
function shaderOf(line: string): { frag: string; vert: string; uniforms: Record<string, number | number[]> } {
  const r = readLine(line, { seed: 1 });
  expect(r.errors.map(e => e.message), line).toEqual([]);
  const p = runSentence(r.picture!.sentence!, scratchGraph('empty'), []);
  expect(p.ok, `${line}: ${p.clauses.map(c => c.message).filter(Boolean).join(' / ')}`).toBe(true);
  const c = compileGraph({ nodes: p.nodes });
  expect(c.errors, line).toBeUndefined();
  return { frag: c.fragmentShader, vert: c.vertexShader, uniforms: c.paramUniforms };
}

const out = (import.meta.env as Record<string, unknown>).DEFAULTS_OUT as string | undefined;

/** Not blown out (clipped share, mean), not invisible (black share, lit share: a thin bright outline is fine), not flat. */
export const LIMITS = { clipped: 0.35, black: 0.996, minLit: 0.003, maxMean: 0.6, minSpread: 0.02 };

describe('good defaults', () => {
  it('writes the shaders to render when asked', async () => {
    if (!out) return;
    const list = DEFAULT_LINES.map(line => ({ line, ...shaderOf(line) }));
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync: (f: string, s: string) => void };
    fs.writeFileSync(`${out}/lang-defaults.json`, JSON.stringify(list.map(x => ({ ...x, hash: hash(x.frag + JSON.stringify(x.uniforms)) }))));
  });

  it('every sample line without numbers looks good: not blown out, not invisible, not flat', () => {
    if (out) return;
    const recorded = stats as Record<string, { hash: string; black: number; clipped: number; lit: number; mean: number; spread: number }>;
    const problems: string[] = [];
    for (const line of DEFAULT_LINES) {
      const s = recorded[line];
      if (!s) { problems.push(`${line}: not rendered (run tools/lang-defaults-render.mjs)`); continue; }
      const sh = shaderOf(line);
      if (hash(sh.frag + JSON.stringify(sh.uniforms)) !== s.hash) { problems.push(`${line}: the shader changed since it was rendered (render again)`); continue; }
      if (s.clipped > LIMITS.clipped) problems.push(`${line}: blown out (${Math.round(s.clipped * 100)}% clipped)`);
      if (s.black > LIMITS.black || s.lit < LIMITS.minLit) problems.push(`${line}: nearly invisible (${Math.round(s.black * 100)}% black, ${(s.lit * 100).toFixed(2)}% lit)`);
      if (s.mean > LIMITS.maxMean) problems.push(`${line}: too bright (mean ${s.mean.toFixed(3)})`);
      if (s.spread < LIMITS.minSpread) problems.push(`${line}: flat`);
    }
    expect(problems).toEqual([]);
  });
});
