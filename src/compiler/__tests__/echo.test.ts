import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../types/nodeGraph';
import { migrateNodeParams } from '../../types/nodeGraph';
import { compileGraph } from '../graphCompiler';
import { getNodeDefinition } from '../../nodes/definitions';
import { n } from '../../store/graphBuilder';
import { echoBlendCPU, isLegacyEcho, type EchoBlend } from '../../nodes/definitions/echo';
import { OfflineHistory, type HistoryGpu } from '../../lib/offlineHistory';

/** The new Echo: a colour in, the colour with its echoes out. */
const graph = (copies: number, delay: number, blend = 'max') => [
  n('colorPicker', 'c', 0, 0, { color: [0.8, 0.4, 0.2] }),
  n('echo', 'e', 300, 0, { copies, delay, decay: 0.7, blend }, { color: ['c', 'rgb'] }),
  n('output', 'out', 600, 0, {}, { color: ['e', 'color'] }),
];

/** An Echo as saved before it took a colour: UV in, Echoes / Coverage out, no schema version. */
const savedLegacy = (blend = 'max'): GraphNode => ({
  id: 'e', type: 'echo', position: { x: 0, y: 0 },
  inputs: { uv: { type: 'vec2', label: 'UV' } },
  outputs: { color: { type: 'vec3', label: 'Echoes' }, alpha: { type: 'float', label: 'Coverage' } },
  params: { copies: 3, delay: 8, decay: 0.7, blend },
});
const outOf = (from: string, key = 'color'): GraphNode => ({
  id: 'out', type: 'output', position: { x: 0, y: 0 },
  inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: from, outputKey: key } } }, outputs: {}, params: {},
});

describe('echo node', () => {
  it('takes a colour and gives it back with its echoes; the capture draw writes the input', () => {
    const r = compileGraph({ nodes: graph(3, 8) });
    expect(r.success, r.errors?.join()).toBe(true);
    expect(r.echo).toEqual({ copies: 3, delay: 8 });
    expect(r.fragmentShader).toContain('uniform sampler2D u_echo0;');
    expect(r.fragmentShader).toContain('uniform sampler2D u_echo2;');
    expect(r.fragmentShader).not.toContain('u_echo3');
    expect(r.fragmentShader).toContain('uniform float u_echoCap;');
    expect(r.fragmentShader).toMatch(/g_echoIn = \w+_in;/);
    // The override comes after the Output wrote the picture.
    const body = r.fragmentShader.slice(r.fragmentShader.indexOf('void main()'));
    expect(body.indexOf('if (u_echoCap > 0.5) gl_FragColor = vec4(g_echoIn, 1.0);')).toBeGreaterThan(body.indexOf('gl_FragColor = vec4('));
    // decay is a live slider, copies/delay are baked
    expect(Object.keys(r.paramUniforms).some(u => u.endsWith('_decay'))).toBe(true);
    expect(Object.keys(r.paramUniforms).some(u => u.endsWith('_copies') || u.endsWith('_delay'))).toBe(false);
  });

  it('Copies changes the shader and the ring the preview keeps', () => {
    const three = compileGraph({ nodes: graph(3, 6) });
    const six = compileGraph({ nodes: graph(6, 6) });
    expect(three.echo).toEqual({ copies: 3, delay: 6 });
    expect(six.echo).toEqual({ copies: 6, delay: 6 });
    expect(six.fragmentShader).toContain('texture2D(u_echo5,');
    expect(three.fragmentShader).not.toContain('u_echo5');
    expect(compileGraph({ nodes: graph(3, 12) }).echo).toEqual({ copies: 3, delay: 12 });
  });

  it('clamps copies and compiles every blend', () => {
    for (const blend of ['max', 'add', 'screen']) {
      const r = compileGraph({ nodes: graph(50, 2, blend) });
      expect(r.success, `${blend}: ${r.errors?.join()}`).toBe(true);
      expect(r.echo).toEqual({ copies: 6, delay: 2 });
    }
  });

  it('a saved Echo from before migrates to legacy, keeps its sockets and still compiles', () => {
    const m = migrateNodeParams(savedLegacy('add'), getNodeDefinition);
    expect(isLegacyEcho(m)).toBe(true);
    expect(Object.keys(m.inputs)).not.toContain('color');
    expect(Object.keys(m.inputs)).toContain('uv');
    expect(m.outputs.color.label).toBe('Echoes');
    const r = compileGraph({ nodes: [m, outOf('e')] });
    expect(r.success, r.errors?.join()).toBe(true);
    expect(r.echo).toEqual({ copies: 3, delay: 8 });
    // Its echoes are of the whole picture, left out of the capture draw; no input override.
    expect(r.fragmentShader).toContain('*= 1.0 - u_echoCap;');
    expect(r.fragmentShader).not.toContain('g_echoIn');
    // Migrating again changes nothing.
    expect(migrateNodeParams(m, getNodeDefinition)).toEqual(m);
  });

  it('a new Echo is not taken for a legacy one on reload', () => {
    const e = graph(3, 6)[1];
    const m = migrateNodeParams(e, getNodeDefinition);
    expect(isLegacyEcho(m)).toBe(false);
    expect(Object.keys(m.inputs)).toContain('color');
  });

  it('reports no ring without an echo node', () => {
    const plain: GraphNode = { id: 'u', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: { uv: { type: 'vec2', label: 'UV' } }, params: {} };
    const o: GraphNode = { ...outOf('u', 'uv') };
    const r = compileGraph({ nodes: [plain, o] });
    expect(r.echo).toBeNull();
    expect(r.fragmentShader).not.toContain('u_echoCap');
  });
});

describe('echo blend maths (what the GLSL does)', () => {
  const blends: EchoBlend[] = ['max', 'add', 'screen'];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

  it('never passes 1 for any blend, with any number of copies, even at decay 1', () => {
    for (const blend of blends) for (const decay of [0.5, 0.9, 1]) for (let k = 0; k < 200; k++) {
      const copies = Array.from({ length: 6 }, () => rnd());
      const r = echoBlendCPU(rnd(), copies, decay, blend);
      expect(r.color).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.echoes).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.color).toBeGreaterThanOrEqual(0);
    }
  });

  it('a still white picture stays white, not more; a still grey one stays put in Ghosts and Add', () => {
    for (const blend of blends) expect(echoBlendCPU(1, [1, 1, 1, 1, 1, 1], 1, blend).color).toBeCloseTo(1, 9);
    expect(echoBlendCPU(0.5, Array(6).fill(0.5), 1, 'max').color).toBeCloseTo(0.5, 9);
    expect(echoBlendCPU(0.5, Array(6).fill(0.5), 1, 'add').color).toBeCloseTo(0.5, 9);
    // Screen lightens a still picture a little, as screening does, and stays below 1.
    const s = echoBlendCPU(0.5, Array(6).fill(0.5), 1, 'screen').color;
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThan(0.9);
  });

  it('the live picture keeps its full strength, and more copies leave more trail', () => {
    for (const blend of blends) expect(echoBlendCPU(1, Array(6).fill(0), 0.8, blend).color).toBeCloseTo(1, 9);
    // A trail pixel: dark now, lit in the oldest copy only. With 1 copy it isn't there; with 6 it is.
    for (const blend of blends) {
      expect(echoBlendCPU(0, [0], 0.8, blend).color).toBe(0);
      expect(echoBlendCPU(0, [0, 0, 0, 0, 0, 1], 0.8, blend).color).toBeGreaterThan(0);
    }
  });
});

describe('offline echo history', () => {
  it('fills the ring with the capture draw (the Echo input), not a copy of the picture', () => {
    const calls: string[] = [];
    const gpu: HistoryGpu<{ v: number }> = {
      create: () => ({ v: 0 }),
      dispose: () => {},
      draw: (_t, into) => { into.v = 1; calls.push('draw'); },
      copy: () => { calls.push('copy'); },
      capture: into => { into.v = 2; calls.push('capture'); },
    };
    const h = new OfflineHistory(gpu);
    h.frame(0, { dt: 1 / 60, first: true, feedback: false, echo: { copies: 2, delay: 1 } });
    h.frame(1 / 60, { dt: 1 / 60, first: false, feedback: false, echo: { copies: 2, delay: 1 } });
    expect(calls).toContain('capture');
    expect(calls).not.toContain('copy');
  });
});
