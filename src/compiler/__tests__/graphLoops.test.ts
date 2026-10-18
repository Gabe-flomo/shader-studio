/**
 * Loops (compiler/graphLoops.ts): found and named in the compile, refused when wiring, and a Pass's
 * Previous still closes a feedback loop. The user's "crashed" graph is the fixture.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import { findLoop, loopIfWired, loopMessage } from '../graphLoops';
import { n } from '../../store/graphBuilder';
import { densityLoopGraph } from './fixtures/densityLoopGraph';
import type { GraphNode } from '../../types/nodeGraph';

/** A Pass fed back through its Previous: Sample(Previous) → Pass, Pass → Output. */
function feedback(): GraphNode[] {
  return [
    n('sampleTexture', 'echo', 0, 0, {}, { texture: ['buf', 'previous'] }),
    n('pass', 'buf', 400, 0, {}, { color: ['echo', 'color'] }),
    n('output', 'out', 800, 0, {}, { color: ['buf', 'color'] }),
  ];
}

describe('loops in the compile', () => {
  it('names the Draw Agents → Stops Palette loop, without a Pass, with a tip, and does not throw', () => {
    const nodes = densityLoopGraph();
    let r: ReturnType<typeof compileGraph> | undefined;
    expect(() => { r = compileGraph({ nodes }); }).not.toThrow();
    expect(r!.success).toBe(false);
    expect(r!.errors).toHaveLength(1);
    const msg = r!.errors![0];
    expect(msg).toContain('Draw Agents → Stops Palette → Draw Agents');
    expect(msg).not.toMatch(/Pass/);
    expect(msg).toContain('Palette by density');
    expect(r!.loop).toMatchObject({
      nodeIds: ['node_13', 'node_12', 'node_13'],
      closing: { fromNodeId: 'node_12', fromOutputKey: 'color', toNodeId: 'node_13', toInputKey: 'over' },
      throughPass: false,
    });
  });

  it('compiles the same graph once the closing wire is gone', () => {
    const r = compileGraph({ nodes: densityLoopGraph({ loop: false }) });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
  });

  it('Draw agents · Background: Palette by density colours the background from its own Density, no loop', () => {
    const nodes = densityLoopGraph({ loop: false }).map(x => x.id === 'node_13' ? { ...x, params: { ...x.params, background: 'density', bgPalette: 'gold' } } : x);
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/vec3 \w+_bg = /);
    // Colour A → B and Rainbow compile too.
    for (const bgPalette of ['ab', 'rainbow']) {
      const rr = compileGraph({ nodes: nodes.map(x => x.id === 'node_13' ? { ...x, params: { ...x.params, bgPalette } } : x) });
      expect(rr.success).toBe(true);
    }
  });

  it('a loop in a plain graph is named; one through a Pass says so', () => {
    const plain = [
      n('uv', 'uv', 0, 0),
      n('length', 'len', 0, 0, {}, { input: ['uv', 'uv'] }),
      n('palette', 'pal', 0, 0, {}, { value: ['len', 'output'] }),
      n('luminance', 'lum', 0, 0, {}, { color: ['pal', 'color'] }),
      n('output', 'out', 0, 0, {}, { color: ['pal', 'color'] }),
    ];
    // Palette · Value ← Luminance ← Palette: a loop.
    const looped = plain.map(x => x.id === 'pal' ? { ...x, inputs: { ...x.inputs, value: { ...x.inputs.value, connection: { nodeId: 'lum', outputKey: 'result' } } } } : x);
    const r = compileGraph({ nodes: looped });
    expect(r.success).toBe(false);
    expect(r.errors![0]).toMatch(/This graph has a loop: (Palette → Luminance → Palette|Luminance → Palette → Luminance)\./);
    expect(r.errors![0]).not.toMatch(/Pass/);

    // Pass · Color fed from its own Color (not Previous): a loop through a Pass.
    const viaPass = feedback().map(x => x.id === 'echo' ? { ...x, inputs: { ...x.inputs, texture: { ...x.inputs.texture, connection: { nodeId: 'buf', outputKey: 'texture' } } } } : x);
    const rp = compileGraph({ nodes: viaPass });
    expect(rp.success).toBe(false);
    expect(rp.errors![0]).toContain('Pass');
    expect(rp.errors![0]).toContain('Previous');
    expect(rp.loop?.throughPass).toBe(true);
  });

  it('a Pass fed back through its Previous is not a loop', () => {
    const nodes = feedback();
    expect(findLoop(nodes)).toBeNull();
    const r = compileGraph({ nodes });
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
  });
});

describe('loops when wiring', () => {
  it('refuses Stops Palette → Draw Agents · Over when the palette reads its Density', () => {
    const nodes = densityLoopGraph({ loop: false });
    const loop = loopIfWired(nodes, 'node_12', 'color', 'node_13', 'over');
    expect(loop).not.toBeNull();
    expect(loop!.nodeIds).toEqual(['node_13', 'node_12', 'node_13']);
    expect(loopMessage(nodes, loop!)).toContain('Draw Agents → Stops Palette → Draw Agents');
    // A wire out of the Agents group is the engine's side of the step: never a loop.
    expect(loopIfWired(nodes, 'node_1', 'agents', 'node_13', 'agents')).toBeNull();
  });

  it('allows a Pass\'s Previous to close a loop, refuses its Color, and refuses a node into itself', () => {
    const nodes = feedback().map(x => x.id === 'buf' ? { ...x, inputs: { ...x.inputs, color: { type: 'vec3' as const, label: 'Color' } } } : x);
    expect(loopIfWired(nodes, 'echo', 'color', 'buf', 'color')).toBeNull(); // echo reads buf's Previous
    const unfed = nodes.map(x => x.id === 'echo' ? { ...x, inputs: { ...x.inputs, texture: { type: 'texture' as const, label: 'Texture' } } } : x)
      .map(x => x.id === 'buf' ? { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: 'echo', outputKey: 'color' } } } } : x);
    expect(loopIfWired(unfed, 'buf', 'previous', 'echo', 'texture')).toBeNull();
    expect(loopIfWired(unfed, 'buf', 'texture', 'echo', 'texture')?.throughPass).toBe(true);
    const lum = [n('luminance', 'lum', 0, 0)];
    expect(loopIfWired(lum, 'lum', 'result', 'lum', 'color')?.nodeIds).toEqual(['lum', 'lum']);
  });
});
