/**
 * The user's own 50 shaders (a GLSL page export, 2026-09-26), mostly Shadertoy
 * pastes and some code golf. Each either converts to a graph the compiler
 * accepts, the way the Convert page runs it (converted, optimised, compiled),
 * or is refused with its reason. That the pictures match needs a browser: the
 * pixel check over this folder is described in docs/glsl-to-nodes.md; at the
 * time of writing 41 of the 44 that convert give the same picture and the other
 * three differ in a handful of pixels of a sin-hash (26 expression blocks among
 * them, down from 127 before the phase 2 nodes). With the page's fix-ups
 * applied, 45 of the 50 give the same picture as the shader as pasted.
 */
import { describe, it, expect } from 'vitest';
import { glslToGraph } from '..';
import { compileGraph } from '../../compiler/graphCompiler';
import { optimizeGraph } from '../../optimize/optimizeGraph';
import { suggestFixups } from '../fixups';

const files = import.meta.glob('./corpus/user/*.glsl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const corpus = Object.entries(files).map(([p, src]) => [p.split('/').pop()!.replace(/\.glsl$/, ''), src] as const).sort((a, b) => a[0].localeCompare(b[0]));

/** Refused on purpose, with the reason the page shows. */
const REFUSED: Record<string, RegExp> = {
  'Fractal anxiety': /Global palette: a global array/,
  'black hole distortion': /Global pt: a global array/,
  // Golf: a write inside an expression that a later line reads. Code kept as text can't hand it back.
  moire: /U changes inside an expression/,
  oragami: /h changes inside an expression/,
  rosace: /O changes inside an expression/,
  'trippy cells': /uint \/ bit operations/,
};

describe('the user corpus', () => {
  it('has all 50 shaders', () => expect(corpus).toHaveLength(50));

  it.each(corpus.filter(([n]) => !REFUSED[n]))('%s converts, optimises and compiles', (_n, src) => {
    const r = glslToGraph(src);
    expect(r.report.unsupported).toEqual([]);
    expect(r.nodes.filter(n => n.type === 'output' || n.type === 'vec4Output')).toHaveLength(1);
    const c = compileGraph({ nodes: optimizeGraph(r.nodes, { minChain: 3, keepSliders: true }).nodes });
    expect(c.errors ?? []).toEqual([]);
    expect(c.success).toBe(true);
  });

  it.each(corpus.filter(([n]) => REFUSED[n]))('%s is refused with its reason', (n, src) => {
    const r = glslToGraph(src);
    expect(r.nodes).toEqual([]);
    expect(r.report.unsupported.join(' ')).toMatch(REFUSED[n]);
  });

  /** The Convert page's fix-ups each refused one gets, in order, until it converts (black hole distortion's array is filled at run time: none). */
  const FIXED_BY: Record<string, string[]> = { 'Fractal anxiety': ['array-function'], moire: ['hoist-writes'], oragami: ['hoist-writes'], rosace: ['hoist-writes'], 'trippy cells': ['float-hash'], 'black hole distortion': [] };
  it.each(corpus.filter(([n]) => REFUSED[n]))('%s: the fix-ups offered make it convert', (n, src0) => {
    let src = src0; const applied: string[] = [];
    for (let round = 0; round < 4; round++) { const fx = suggestFixups(src); if (!fx.length) break; applied.push(fx[0].id); src = fx[0].code; }
    expect(applied).toEqual(FIXED_BY[n]);
    if (applied.length) {
      const r = glslToGraph(src);
      expect(r.report.unsupported).toEqual([]);
      expect(compileGraph({ nodes: optimizeGraph(r.nodes, { minChain: 3, keepSliders: true }).nodes }).success).toBe(true);
    }
  });

  it('is deterministic', () => {
    for (const [, src] of corpus) expect(JSON.stringify(glslToGraph(src))).toBe(JSON.stringify(glslToGraph(src)));
  }, 30000);
});
