/**
 * The pass words (docs/playfield-language-plan.md §4.5, phase 6): `pass` puts what came before into
 * a texture (a Pass node) with its settings; `fade <tail>` leaves trails (Fade, feedback); `blur`,
 * `glow`, `edges` and `flow` read a texture. The plan's examples run and compile.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { readLine } from '../run';
import { runSentence } from './goldens';
import { scratchGraph } from '../../suggestions/doScratch';
import { compileGraph } from '../../compiler/graphCompiler';

const run = (line: string, on: Parameters<typeof scratchGraph>[0] = 'empty', sel: string[] = []) => {
  const r = readLine(line, { seed: 1 });
  expect(r.errors.map(e => e.message), line).toEqual([]);
  expect(r.picture?.sentence, r.picture?.why).toBeTruthy();
  const p = runSentence(r.picture!.sentence!, scratchGraph(on), sel);
  expect(p.clauses.filter(c => c.status !== 'ok').map(c => `${c.text}: ${c.message}`), line).toEqual([]);
  expect(compileGraph({ nodes: p.nodes }).errors, line).toBeUndefined();
  return p.nodes;
};

describe('pass words', () => {
  it('pass "label" scale=1/2: a Pass on what came before, named and sized; blur reads it', () => {
    const nodes = run('noise · colour by it · pass "Soft" scale=1/2 · blur 4');
    const pass = nodes.find(n => n.type === 'pass')!;
    expect(pass.params).toMatchObject({ label: 'Soft', scale: '0.5' });
    const blur = nodes.find(n => n.type === 'blurTexture')!;
    expect(blur.params.radius).toBe(4);
    expect(blur.inputs.texture.connection).toMatchObject({ nodeId: pass.id, outputKey: 'texture' });
  });
  it('fade 0.5s: trails with that tail (the plan\'s example 12 and 35)', () => {
    const nodes = run('circle at=top-left · glow · the picture · fade 0.5s');
    expect(nodes.find(n => n.type === 'textureFade')?.params.tail).toBe(0.5);
    run('circle · glow · pass "trails" · fade 0.5s');
  });
  it('glow on a Pass is the texture glow (example 36)', () => {
    const nodes = run('this · glow', 'pass', ['pass']);
    expect(nodes.some(n => n.type === 'glowTexture')).toBe(true);
  });
  it('prints and reads back', () => {
    for (const l of ['noise · pass "Soft" scale=0.5 repeat=2 · blur 4', 'circle · glow · fade 0.5s clean=0.1']) expect(readLine(l).canonical).toBe(l);
  });
});
