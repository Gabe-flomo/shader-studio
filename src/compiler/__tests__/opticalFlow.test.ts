/**
 * Optical Flow (docs/optical-flow.md): opens into a source Pass and a flow Pass (Lucas–Kanade between this frame
 * and the last, blended with the last flow); its sliders are uniforms bound to the node; unwired it is no motion.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../graphCompiler';
import type { CompilationResult } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { expandOpticalFlow, ofIds } from '../opticalFlowExpand';

const node = (id: string, type: string, params: Record<string, unknown> = {}, wires: Record<string, [string, string]> = {}): GraphNode => {
  const def = getNodeDefinition(type)!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label, ...(wires[k] ? { connection: { nodeId: wires[k][0], outputKey: wires[k][1] } } : {}) }]));
  return { id, type, position: { x: 0, y: 0 }, outputs: { ...def.outputs }, params: { ...def.defaultParams, ...params }, inputs } as GraphNode;
};
const out = (from: string, key: string) => ({ id: 'out', type: 'output', position: { x: 0, y: 0 }, outputs: {}, params: {}, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } } }) as unknown as GraphNode;

describe('Optical Flow', () => {
  it('opens into a source Pass and a flow Pass at its Resolution; the node becomes the read', () => {
    const nodes = [node('img', 'textureInput'), node('of', 'opticalFlow', { resolution: '0.125' }, { texture: ['img', 'texture'] }), out('of', 'color')];
    const { nodes: x, bindAs } = expandOpticalFlow(nodes);
    const I = ofIds('of');
    expect(x.find(n => n.id === I.luma)!.params.scale).toBe('0.125');
    expect(x.find(n => n.id === I.pass)!.params.format).toBe('half');
    expect(x.find(n => n.id === 'of')!.type).toBe('opticalFlowRead');
    expect(x.find(n => n.id === I.step)!.inputs.prev.connection).toEqual({ nodeId: I.luma, outputKey: 'previous' });
    expect(x.find(n => n.id === I.step)!.inputs.flowPrev.connection).toEqual({ nodeId: I.pass, outputKey: 'previous' });
    expect(bindAs.get(I.step)).toBe('of');
  });

  it('compiles: Lucas–Kanade in the flow Pass over the Window, sliders bound to the node', () => {
    const r = compileGraph({ nodes: [node('img', 'textureInput'), node('of', 'opticalFlow', { window: '7' }, { texture: ['img', 'texture'] }), out('of', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.passes?.length).toBe(2);
    const step = r.passes!.map(p => p.fragmentShader).find(fs => fs.includes('_det'))!;
    expect(step).toContain('for (int j = -3; j <= 3; j++)');
    expect(step).toMatch(/mix\(\w+_f, texture2D\(\w+, \w+_st\)\.xy, u_p_\w+_smoothing\)/);
    for (const k of ['strength', 'smoothing', 'minSpeed', 'viewGain']) expect(r.paramBindings[`of::${k}`], k).toBeTruthy();
  });

  it('with nothing wired it is no motion, and no Passes', () => {
    const r = compileGraph({ nodes: [node('of', 'opticalFlow'), out('of', 'color')] }) as CompilationResult;
    expect(r.errors ?? []).toEqual([]);
    expect(r.passes ?? []).toHaveLength(0);
  });
});
