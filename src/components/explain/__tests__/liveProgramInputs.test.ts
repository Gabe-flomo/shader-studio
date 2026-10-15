/**
 * The explain view's live picture reads what the graph reads (liveRender.ts): a block downstream of a memory node
 * (or any Pass) carries those Passes for the canvas to draw first, and its samplers are named for binding from the
 * store, so `halo = … * e` (e an Envelope) isn't 0 everywhere.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { liveProgram } from '../liveRender';
import { buildMemoryExamples } from '../../../store/memoryExamples';
import { buildTextureToolExamples } from '../../../store/textureToolExamples';

describe('Explain: the live picture reads Passes and textures', () => {
  it('a block fed by an Envelope carries the memory Pass', () => {
    const nodes = buildMemoryExamples().memBeat.nodes;
    const look = nodes.find(n => n.id === 'look')!;
    const p = liveProgram(look, nodes, 2, [{ key: 'result', expr: 'halo', type: 'float' }], [])!;
    expect(p).toBeTruthy();
    expect(p.passes.length).toBe(1);
    expect(p.passes[0].fragmentShader).toContain('gl_FragCoord.x');
    expect(p.fs).toMatch(/texelFetch\(u_pass_\w+, ivec2\(\d, 0\), 0\)/);
  });

  it('a block reading a video names its sampler for the store', () => {
    const nodes = buildTextureToolExamples().ttAnalyze.nodes;
    const look = nodes.find(n => n.id === 'look')!;
    const p = liveProgram(look, nodes, 'return', [{ key: 'result', expr: 'video', type: 'vec3' }], [])!;
    expect(p).toBeTruthy();
    expect(Object.values(p.textures).concat(Object.values(p.videos))).toContain('vid');
  });
});
