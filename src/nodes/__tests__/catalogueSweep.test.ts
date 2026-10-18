/**
 * The 2026-10-17 catalogue sweep (docs/node-retirements.md, "The catalogue sweep"): the node library after the
 * effects sweep — old transforms, duplicate shapes and helpers retired, shapers and Chladni merged, search
 * aliases, categories and labels. Like effectSweep.test.ts: a retired type still loads (merged ones migrate with
 * the same maths, run on the CPU with glslEval.ts; hidden ones stay registered) and no example uses one.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); }, key: () => null, length: 0, clear: () => mem.clear() };
});

import { readFileSync } from 'fs';
import type { GraphNode } from '../../types/nodeGraph';
import { emptyPlayRecord, type PlayRecord } from '../../types/play';
import { getNodeDefinition, getOfferedDefinitions, NODE_REGISTRY } from '../definitions';
import { NODE_ALIASES } from '../definitions/aliases';
import { RETIRED_TYPES } from '../notOffered';
import { HIDDEN_NODES } from '../../components/NodeGraph/libraryRows';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { migrateLoadedNodes, migrateLoadedPlay, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { compileGraph } from '../../compiler/graphCompiler';
import { gpBindings } from '../../play/kit/gpuParticles.js';

/** Every node type an example uses, at any depth. */
function typesOf(nodes: GraphNode[], out: string[] = []): string[] {
  for (const nd of nodes) {
    out.push(nd.type);
    const sg = nd.params?.subgraph as { nodes?: GraphNode[] } | undefined;
    if (sg?.nodes) typesOf(sg.nodes, out);
  }
  return out;
}

/** A saved node as an old graph holds it. */
export function saved(type: string, id: string, params: Record<string, unknown>, inputs: Record<string, [string, string] | null>, outputs: string[]): GraphNode {
  const def = getNodeDefinition(type);
  return {
    id, type, position: { x: 0, y: 0 }, params,
    inputs: Object.fromEntries(Object.entries(inputs).map(([k, w]) => [k, { type: def?.inputs[k]?.type ?? 'float', label: k, ...(w ? { connection: { nodeId: w[0], outputKey: w[1] } } : {}) }])),
    outputs: Object.fromEntries(outputs.map(k => [k, { type: def?.outputs[k]?.type ?? 'float', label: k }])),
  } as GraphNode;
}

describe('T6: examples use current node types', () => {
  it('no example uses an old (aliased) type name or the retired Audio Input', () => {
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) {
      const old = typesOf(g.nodes).filter(t => NODE_ALIASES[t] || t === 'audioInput');
      expect(old, k).toEqual([]);
    }
  });

  it('the Chladni sand examples hear an Audio Source\'s six bands', () => {
    for (const key of ['particleChladniSand', 'particleCymatics3d']) {
      const r = compileGraph({ nodes: migrateLoadedNodes(EXAMPLE_GRAPHS[key].nodes) });
      expect(r.errors ?? [], key).toEqual([]);
      const [b] = gpBindings(r.fragmentShader!);
      expect(b.audio, key).toMatch(/^u_aud_\w+_level$/);
      expect(b.audioBands, key).toHaveLength(6);
      expect(b.audioBands[0], key).toMatch(/_b1_v$/);
    }
  });

  it('an Audio Input still wins over an Audio Source (old graphs hear what they heard)', () => {
    const fs = ['uniform float u_aud_src_level;', 'uniform float u_aud_src_time;', 'uniform float u_audio_old_0;', 'uniform sampler2D u_gpup_p; // gpu-particles {"p":{}}'].join('\n');
    expect(gpBindings(fs)[0].audio).toBe('u_audio_old_0');
  });

  it('a Band level alone is not taken for a source (it has no Time)', () => {
    const fs = ['uniform float u_aud_bass_level;', 'uniform float u_aud_bass_peak;', 'uniform sampler2D u_gpup_p; // gpu-particles {"p":{}}'].join('\n');
    expect(gpBindings(fs)[0].audio).toBeNull();
  });

  it('replaceGraph runs the load migrations (aliases, then params)', () => {
    useNodeGraphStore.getState().replaceGraph([
      saved('palettePreset', 'p', { preset: '3' }, { t: null }, ['color']),
      saved('smoothMin', 's', { k: 0.25 }, { a: null, b: null }, ['result']),
    ]);
    const [p, s] = useNodeGraphStore.getState().nodes;
    expect(p.type).toBe('palette');
    expect(p.inputs.value).toBeTruthy();
    expect(s.type).toBe('sdfUnion');
    // A Smooth Min saved with k (not smoothness) keeps it.
    expect(s.params.k).toBe(0.25);
  });

  it('Add (vec3) keeps its B when the three sliders agree', () => {
    const [n] = migrateLoadedNodes([saved('addVec3', 'a', { bx: 0.5, by: 0.5, bz: 0.5 }, { a: null, b: null }, ['result'])]);
    expect(n.type).toBe('add');
    expect(n.params.b).toBe(0.5);
    expect(n.params.bx).toBeUndefined();
  });
});

describe('T4: the old transforms are retired; a saved one becomes a Transform on load where exact', () => {
  const OLD = ['place2D', 'uvTransform2d', 'rotate2d', 'translate3D', 'rotate3D', 'scale3d', 'translate4D', 'rotate4D', 'scale4D'];

  it('they stay registered, offered nowhere, and no example uses them', () => {
    const offered = new Set(getOfferedDefinitions().filter(d => !HIDDEN_NODES.has(d.type)).map(d => d.type));
    for (const t of OLD) {
      expect(NODE_REGISTRY[t], t).toBeTruthy();
      expect(RETIRED_TYPES, t).toContain(t);
      expect(offered.has(t), t).toBe(false);
    }
    for (const [k, g] of Object.entries(EXAMPLE_GRAPHS)) expect(typesOf(g.nodes).filter(t => OLD.includes(t)), k).toEqual([]);
  });

  it('Translate 3D, Rotate 4D (with Spin) and Rotate 2D (Angle wired) switch; a Rotate 3D with an angle in radians stays', () => {
    const nodes = migrateLoadedNodes([
      saved('scenePos', 'sp', {}, {}, ['pos']),
      saved('translate3D', 'mv', { tx: 0.5, ty: -0.25, tz: 1 }, { pos: ['sp', 'pos'] }, ['pos']),
      saved('sphereSDF3D', 'ball', { radius: 0.5 }, { pos: ['mv', 'pos'] }, ['dist']),
      saved('lift4D', 'lift', {}, { pos: ['sp', 'pos'] }, ['p4']),
      saved('rotate4D', 'r4', { plane: 'yw', angle: 30, spin: 12 }, { p4: ['lift', 'p4'] }, ['p4']),
      saved('hypersphereSDF', 'hs', {}, { p4: ['r4', 'p4'] }, ['dist']),
      saved('rotate3D', 'r3', { axis: 'y', angle: 0.7 }, { pos: ['sp', 'pos'] }, ['pos']),
      saved('uv', 'uv', {}, {}, ['uv']),
      saved('time', 't', {}, {}, ['time']),
      saved('rotate2d', 'r2', {}, { input: ['uv', 'uv'], angle: ['t', 'time'] }, ['output']),
      saved('circleSDF', 'c', {}, { position: ['r2', 'output'] }, ['distance']),
    ]);
    const by = Object.fromEntries(nodes.map(n => [n.id, n]));
    expect(by.mv.type).toBe('transform');
    expect(by.mv.params).toMatchObject({ dim: '3', x: 0.5, y: -0.25, z: 1 });
    expect(by.ball.inputs.pos.connection).toEqual({ nodeId: 'mv', outputKey: 'p' });
    expect(by.r4.type).toBe('transform');
    expect(by.r4.params).toMatchObject({ dim: '4', ryw: 30, spin: 12, spinPlane: 'yw' });
    expect(by.hs.inputs.p4.connection).toEqual({ nodeId: 'r4', outputKey: 'p' });
    expect(by.r3.type).toBe('rotate3D');
    expect(by.r2.type).toBe('transform');
    expect(by.r2.params).toMatchObject({ dim: '2', mode: 'space', rotate: 0 });
    expect(by.r2.inputs.turn.connection).toEqual({ nodeId: 't', outputKey: 'time' });
    expect(by.c.inputs.position.connection).toEqual({ nodeId: 'r2', outputKey: 'p' });
  });

  it('a Play control on a switched setting follows it (Translate 3D X → Move X)', () => {
    const raw = [saved('scenePos', 'sp', {}, {}, ['pos']), saved('translate3D', 'mv', { tx: 0.5 }, { pos: ['sp', 'pos'] }, ['pos'])];
    const play = { ...emptyPlayRecord(), controls: [{ id: 'c1', kind: 'float', label: 'X', target: 'mv::tx', min: -1, max: 1, value: 0.5 }] } as unknown as PlayRecord;
    expect(migrateLoadedPlay(play, raw).controls[0].target).toBe('mv::x');
  });

  it('the 4D builder turns a spinning shape with a Transform', () => {
    expect(readFileSync(new URL('../../sceneBuilder/build.ts', import.meta.url), 'utf8')).not.toContain("'rotate4D'");
  });
});
