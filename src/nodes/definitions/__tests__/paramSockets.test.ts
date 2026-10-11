/**
 * Sliders you can wire (nodes/definitions/helpers.ts withParamSockets): every slider given a socket of its own key is
 * checked across the library. Unwired, the node reads its slider's live uniform; wired (an LFO into a number, a Color
 * into a vector or colour), it compiles, the LFO's (or Color's) own uniform is read and the slider's isn't (the wire has
 * taken its place). Splat modifiers are checked in the modifier program, where a wire runs once per splat; texture
 * tools with a Pass's texture wired in. Plus: unwired graphs compile to the same code as before, keyframes on a slider
 * still play, older `__param_` wires keep working, and the moving splat nodes count as moving while wired.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { parser } from '@shaderfrog/glsl-parser';
import { NODE_REGISTRY } from '..';
import { PARAM_SOCKETS } from '../helpers';
import { SPLAT_NODE_TYPES } from '../splatModifiers';
import { compileGraph } from '../../../compiler/graphCompiler';
import { modifierMoves } from '../../../lib/splats/engine';
import { n } from '../../../store/graphBuilder';
import { socketVisible } from '../../../lib/socketsOnDemand';
import type { DataType, GraphNode, NodeDefinition } from '../../../types/nodeGraph';

type Result = ReturnType<typeof compileGraph>;

/** The output most likely to wire cleanly into Output's Color (as the registry test picks it). */
function pickOutput(def: NodeDefinition): string {
  const outs = Object.entries(def.outputs ?? {});
  const pref: DataType[] = ['vec3', 'float', 'vec4', 'vec2'];
  for (const t of pref) { const hit = outs.find(([, s]) => s.type === t); if (hit) return hit[0]; }
  return outs[0][0];
}

/** Params that make slider `key` visible (its showWhen gate held). */
function showing(def: NodeDefinition, key: string): Record<string, unknown> {
  const sw = def.paramDefs?.[key]?.showWhen;
  if (!sw) return {};
  const first = (v: string | string[]) => (Array.isArray(v) ? v[0] : v);
  return { [sw.param]: first(sw.value), ...(sw.and ? { [sw.and.param]: first(sw.and.value) } : {}) };
}

/** Texture tools read nothing until a texture is wired: a Pass of a circle. */
const TEXTURE_TYPES = new Set(['displaceTexture', 'edgesTexture', 'sampleTexture', 'textureChange', 'textureFlow', 'textureNeighbours', 'readTexture', 'textureLevels', 'textureMask', 'distanceShape', 'textureFade']);
const picture = (): GraphNode[] => [
  n('uv', 'uv', 0, 0),
  n('circleSDF', 'circ', 0, 0, { radius: 0.4 }, { position: ['uv', 'uv'] }),
  n('floatToVec3', 'rgb', 0, 0, {}, { input: ['circ', 'distance'] }),
  n('pass', 'pa', 0, 0, {}, { color: ['rgb', 'rgb'] }),
];
/** Extra wiring a slider needs before it is read (Read's Flow amount needs a Flow). */
const NEEDS: Record<string, Record<string, [string, string]>> = {
  'readTexture.flowAmount': { flow: ['uv', 'uv'] },
  'displaceTexture.amount': { map: ['pa', 'texture'] },
};

/** The graph: node `n1` of `type`, slider `key` wired from `src` (or not), its output on the picture. */
function graphFor(type: string, key: string, wired: boolean): GraphNode[] {
  const def = NODE_REGISTRY[type];
  const isVec = def.inputs[key].type === 'vec3';
  const src = isVec ? n('colorPicker', 'src', 0, 0, { color: [0.3, 0.6, 0.9] }) : n('lfo', 'src', 0, 0, { amplitude: 0.37 });
  const params = showing(def, key);
  const extra = NEEDS[`${type}.${key}`] ?? {};
  const wire: Record<string, [string, string]> = { ...extra, ...(wired ? { [key]: ['src', isVec ? 'rgb' : 'value'] } : {}) };
  if (SPLAT_NODE_TYPES.has(type)) {
    return [
      src,
      n(type, 'n1', 0, 0, params, wire),
      n('splatScene', 'scan', 0, 0, {}, { modifier: ['n1', 'splat'] }),
      n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] }),
    ];
  }
  const tex = TEXTURE_TYPES.has(type) ? picture() : [];
  const texWire: Record<string, [string, string]> = tex.length && def.inputs.texture ? { texture: ['pa', 'texture'] } : {};
  return [...tex, src, n(type, 'n1', 0, 0, params, { ...texWire, ...wire }), n('output', 'out', 0, 0, {}, { color: ['n1', pickOutput(def)] })];
}

/** Every program the graph compiles into, without its uniform declarations. */
function body(r: Result): string {
  return [r.fragmentShader, ...(r.passes ?? []).map(p => p.fragmentShader), ...(r.splats ?? []).flatMap(s => [s.fragmentShader, s.modifier?.fragmentShader ?? ''])]
    .join('\n').replace(/^\s*uniform\s+\w+\s+\w+\s*;\s*$/gm, '');
}
const reads = (src: string, name: string) => new RegExp(`\\b${name}\\b`).test(src);

const entries = [...PARAM_SOCKETS.entries()].filter(([type]) => NODE_REGISTRY[type]);

describe('Sliders you can wire', () => {
  it('a good share of the library has them, and every one is a socket of its slider\'s key', () => {
    const count = entries.reduce((s, [, keys]) => s + keys.length, 0);
    console.log(`${count} wireable sliders on ${entries.length} node types`);
    expect(count).toBeGreaterThan(400);
    for (const [type, keys] of entries) {
      const def = NODE_REGISTRY[type];
      for (const k of keys) {
        expect(def.inputs[k], `${type}.${k}`).toBeTruthy();
        expect(def.inputs[k].type).toBe(def.paramDefs![k].type === 'float' ? 'float' : 'vec3');
      }
    }
  });

  it('unwired, each reads its slider; wired, the wire takes the slider\'s place', () => {
    const problems: string[] = [];
    for (const [type, keys] of entries) {
      for (const key of keys) {
        const label = `${type}.${key}`;
        const plain = compileGraph({ nodes: graphFor(type, key, false) });
        if (!plain.success) { problems.push(`${label}: unwired did not compile: ${(plain.errors ?? []).join('; ')}`); continue; }
        const u = plain.paramBindings[`n1::${key}`];
        if (!u) { problems.push(`${label}: no live uniform`); continue; }
        if (!reads(body(plain), u)) { problems.push(`${label}: unwired, the slider isn't read`); continue; }
        const wired = compileGraph({ nodes: graphFor(type, key, true) });
        if (!wired.success) { problems.push(`${label}: wired did not compile: ${(wired.errors ?? []).join('; ')}`); continue; }
        const b = body(wired);
        if (reads(b, u)) problems.push(`${label}: wired, the slider is still read`);
        const srcU = wired.paramBindings[NODE_REGISTRY[type].inputs[key].type === 'vec3' ? 'src::color' : 'src::amplitude'];
        if (!srcU || !reads(b, srcU)) problems.push(`${label}: wired, the source isn't read`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('wired programs parse (a sample across the library and every splat modifier)', () => {
    const prefix = '#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n';
    for (const [type, keys] of entries) {
      const splat = SPLAT_NODE_TYPES.has(type);
      if (!splat && !['lfo', 'fbm', 'circleSDF', 'boxFrameSDF3D', 'gravitationalLens', 'palette', 'chladni', 'cubicBezierShaper', 'glass3d', 'readTexture'].includes(type)) continue;
      // Every splat modifier slider; one number and one vector or colour of the others.
      const sample = splat ? keys : [keys.find(k => NODE_REGISTRY[type].inputs[k].type === 'float'), keys.find(k => NODE_REGISTRY[type].inputs[k].type === 'vec3')].filter((k): k is string => !!k);
      for (const key of sample) {
        const r = compileGraph({ nodes: graphFor(type, key, true) });
        const fs = splat ? r.splats![0].modifier!.fragmentShader : r.fragmentShader;
        expect(() => parser.parse(prefix + fs, { quiet: true }), `${type}.${key}`).not.toThrow();
      }
    }
  }, 60_000);

  it('unwired, a node compiles to exactly the code it did without the sockets', () => {
    for (const [type, keys] of entries) {
      if (SPLAT_NODE_TYPES.has(type) || TEXTURE_TYPES.has(type)) continue;
      const def = NODE_REGISTRY[type];
      const out = pickOutput(def);
      const now = compileGraph({ nodes: [n(type, 'n1', 0, 0), n('output', 'out', 0, 0, {}, { color: ['n1', out] })] });
      // The same node with the new sockets taken off: what a graph saved before them had.
      const bare = n(type, 'n1', 0, 0);
      for (const k of keys) delete bare.inputs[k];
      const before = compileGraph({ nodes: [bare, n('output', 'out', 0, 0, {}, { color: ['n1', out] })] });
      expect(now.fragmentShader, type).toBe(before.fragmentShader);
    }
  });

  it('the sockets come out on demand (or show, on the splat modifiers\' headline sliders), and always while wired', () => {
    const fbm = NODE_REGISTRY.fbm;
    const node = n('fbm', 'f', 0, 0);
    expect(socketVisible(node, fbm, 'gain')).toBe(false);
    expect(socketVisible({ ...node, params: { ...node.params, __sockets: ['gain'] } }, fbm, 'gain')).toBe(true);
    expect(socketVisible(n('lfo', 'l', 0, 0), NODE_REGISTRY.lfo, 'freq')).toBe(false);
    expect(socketVisible(n('fbm', 'f', 0, 0, {}, { gain: ['l', 'value'] }), fbm, 'gain')).toBe(true);
    // Splat Wave: Amplitude, Frequency and Speed all on the card; Dissolve's Amount on it, its Glow on demand.
    for (const k of ['amplitude', 'frequency', 'speed']) expect(socketVisible(n('splatWave', 'w', 0, 0), NODE_REGISTRY.splatWave, k)).toBe(true);
    expect(socketVisible(n('splatDissolve', 'd', 0, 0), NODE_REGISTRY.splatDissolve, 'amount')).toBe(true);
    expect(socketVisible(n('splatDissolve', 'd', 0, 0), NODE_REGISTRY.splatDissolve, 'glow')).toBe(false);
  });

  it('keyframes on a slider that is now a socket still play (through the socket)', () => {
    const kf = [{ t: 0, v: 0.1 }, { t: 2, v: 0.9 }];
    const r = compileGraph({ nodes: [n('fbm', 'f', 0, 0, { __keyframes_gain: kf }), n('output', 'out', 0, 0, {}, { color: ['f', 'value'] })] });
    expect(r.success).toBe(true);
    expect(r.fragmentShader).toMatch(/fbm\([^;]*kf_\w*gain\(/);
  });
});

describe('Sliders you can wire: splat modifiers', () => {
  const scan = (chain: GraphNode[], last: string): GraphNode[] => [
    ...chain,
    n('splatScene', 'scan', 0, 0, {}, { modifier: [last, 'splat'] }),
    n('output', 'out', 0, 0, {}, { color: ['scan', 'color'] }),
  ];
  const mod = (r: Result) => r.splats![0].modifier!;

  it('every number, vector and colour slider of the seven recipes (and Set Splat\'s Amount) is wireable', () => {
    const pd = (t: string) => NODE_REGISTRY[t].paramDefs ?? {};
    for (const t of ['splatDissolve', 'splatExplode', 'splatWave', 'splatColor', 'splatCrop', 'splatLook', 'splatPoints', 'splatSet']) {
      for (const [k, d] of Object.entries(pd(t))) {
        if (d.type !== 'float' && d.type !== 'vec3' && d.type !== 'vec3color') continue;
        expect(NODE_REGISTRY[t].inputs[k], `${t}.${k}`).toBeTruthy();
      }
    }
  });

  it('an LFO into Wave\'s Amplitude, Noise into Dissolve\'s Amount and Time into Wave\'s Speed run per splat', () => {
    const r = compileGraph({ nodes: scan([
      n('lfo', 'lfo', 0, 0, { freq: 0.5, amplitude: 0.1, offset: 0.1 }),
      n('time', 'clock', 0, 0),
      n('noiseFloat', 'nz', 0, 0),
      n('splatDissolve', 'dis', 0, 0, {}, { amount: ['nz', 'value'] }),
      n('splatWave', 'wv', 0, 0, {}, { splat: ['dis', 'splat'], amplitude: ['lfo', 'value'], speed: ['clock', 'time'] }),
    ], 'wv') });
    expect(r.errors ?? []).toEqual([]);
    const fs = mod(r).fragmentShader;
    // The LFO and the noise are computed in the modifier program, and feed the nodes.
    const lfoVar = fs.match(/float (\w+_value) = sin\(/)![1];
    expect(fs).toContain(`${lfoVar} * `);
    expect(fs).toMatch(/clamp\(\w+_value, 0\.0, 1\.0\)/);
    // Time into Speed: the wave's phase is the clock × the Time node.
    const timeVar = fs.match(/float (\w+_time) = u_time;/)![1];
    expect(fs).toContain(`(u_time * ${timeVar})`);
    // The noise, read at the splat's fixed point, still moves with time: one Amount for every splat, changing.
    expect(fs).toMatch(/float \w+_value\s*= mix\(/);
    // Their sliders aren't read there (the wires took their place), but the other sliders are.
    const b = fs.replace(/^\s*uniform\s+\w+\s+\w+\s*;\s*$/gm, '');
    expect(reads(b, r.paramBindings['wv::amplitude'])).toBe(false);
    expect(reads(b, r.paramBindings['wv::speed'])).toBe(false);
    expect(reads(b, r.paramBindings['dis::amount'])).toBe(false);
    expect(reads(b, r.paramBindings['wv::frequency'])).toBe(true);
    // The LFO's own sliders are live uniforms of the picture's table too, so Play can drive them.
    expect(mod(r).paramUniforms[r.paramBindings['lfo::amplitude']]).toBe(0.1);
    parser.parse('#version 300 es\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n' + fs, { quiet: true });
  });

  it('the sort gate follows a wired move: Wave\'s Amplitude, Explode\'s Amount, Dissolve\'s Drift, wired or keyframed', () => {
    const moves = (chain: GraphNode[], last: string, zero: string[]) => {
      const r = compileGraph({ nodes: scan(chain, last) });
      const m = mod(r);
      const u = Object.fromEntries(Object.entries(r.paramUniforms).map(([k, v]) => [k, { value: v }]));
      for (const z of zero) if (r.paramBindings[z]) u[r.paramBindings[z]] = { value: 0 };
      return modifierMoves(m, u);
    };
    // The slider at 0 says still; a wire into it moves them anyway.
    expect(moves([n('splatWave', 'w', 0, 0, { amplitude: 0 })], 'w', [])).toBe(false);
    expect(moves([n('lfo', 'l', 0, 0), n('splatWave', 'w', 0, 0, { amplitude: 0 }, { amplitude: ['l', 'value'] })], 'w', [])).toBe(true);
    expect(moves([n('lfo', 'l', 0, 0), n('splatExplode', 'e', 0, 0, { amount: 0 }, { amount: ['l', 'value'] })], 'e', ['e::amount'])).toBe(true);
    expect(moves([n('lfo', 'l', 0, 0), n('splatDissolve', 'd', 0, 0, { drift: 0 }, { drift: ['l', 'value'] })], 'd', [])).toBe(true);
    // A wire into a slider that doesn't move them (Dissolve's Amount) leaves the gate on Drift.
    expect(moves([n('lfo', 'l', 0, 0), n('splatDissolve', 'd', 0, 0, { drift: 0 }, { amount: ['l', 'value'] })], 'd', [])).toBe(false);
    // An older `__param_` wire (the Splat builder's) counts too.
    const old = n('splatWave', 'w', 0, 0, { amplitude: 0 });
    old.inputs.__param_amplitude = { type: 'float', label: 'Amplitude', connection: { nodeId: 'l', outputKey: 'value' } };
    expect(moves([n('lfo', 'l', 0, 0), old], 'w', [])).toBe(true);
    // Keyframes on Amplitude.
    const kf = [{ t: 0, v: 0 }, { t: 1, v: 0.2 }];
    expect(moves([n('splatWave', 'w', 0, 0, { amplitude: 0, __keyframes_amplitude: kf })], 'w', [])).toBe(true);
  });

  it('an older `__param_` wire still drives its slider, and a socket wire wins over the slider', () => {
    const old = n('splatExplode', 'e', 0, 0);
    old.inputs.__param_amount = { type: 'float', label: 'Amount', connection: { nodeId: 'l', outputKey: 'value' } };
    const r = compileGraph({ nodes: scan([n('lfo', 'l', 0, 0), old], 'e') });
    expect(r.errors ?? []).toEqual([]);
    expect(mod(r).fragmentShader).toMatch(/clamp\(clamp\(\w+_value, 0\.0, 1\.0\) \* \(1\.0 \+/);
  });
});
