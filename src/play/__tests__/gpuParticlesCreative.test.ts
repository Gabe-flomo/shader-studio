/**
 * The Particles node's creative controls (play/kit/gpuParticles.js): presets,
 * triggers, the sound's history and listening, the 3D cameras (its own orbit
 * and a raymarched scene's, rebuilt from its rays), and the probe that brings
 * wired sockets back to the engine. The GPU passes are checked in the browser.
 */
import { describe, expect, it } from 'vitest';
import {
  GP_DEFAULTS, GP_LEVELS, GP_PRESETS, GP_SOCKET_FLOATS, gpApplyProbe, gpBindings, gpCamera, gpLevelsPush, gpLevelsState, gpParams,
  gpPreset, gpProbeField, gpProbeSlots, gpProbeSpec, gpProject, gpRising, gpSceneCamera, gpSoundState, gpSoundStep, gpUnitInk,
} from '../kit/gpuParticles.js';
import { compileGraph } from '../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { GpuParticlesNode } from '../../nodes/definitions/gpuParticles';
import { GP_VOL, gpVolPoint } from '../kit/gpuParticles.js';
import { showSocketPatch, socketVisible, socketsForParam } from '../../lib/socketsOnDemand';

describe('presets', () => {
  it('give every setting, so a preset always looks the same', () => {
    for (const name of Object.keys(GP_PRESETS)) {
      const p = gpPreset(name)!;
      for (const k of Object.keys(GP_DEFAULTS)) {
        if (['handX', 'handY', 'hand2X', 'hand2Y', 'sound'].includes(k)) expect(p[k]).toBeUndefined();
        else if (k === 'soundFrom' && name !== 'launch') expect(p[k]).toBeUndefined();
        else expect(p[k]).toBeDefined();
      }
      // Every value is one the engine accepts as it is.
      const read = gpParams(p);
      for (const k of Object.keys(p)) expect(read[k as keyof typeof read]).toEqual(p[k]);
    }
    expect(gpPreset('nope')).toBeNull();
  });

  it('set the ink look in 3D for Ink in water, and the picture for Image dissolve', () => {
    expect(gpPreset('ink')).toMatchObject({ look: 'ink', space: '3d', count: '1m' });
    expect(gpPreset('dissolve')).toMatchObject({ emitter: 'image', release: 0 });
    expect(gpPreset('launch')).toMatchObject({ soundFrom: 'master' });
  });

  it('are offered on the node card for each paramDef they set', () => {
    for (const name of Object.keys(GP_PRESETS)) for (const k of Object.keys(GP_PRESETS[name].set)) expect(GpuParticlesNode.paramDefs![k]).toBeDefined();
  });
});

describe('triggers and the sound', () => {
  it('fires Burst once each time it rises past a half', () => {
    const st: Record<string, number> = {};
    const fired = [0, 0.3, 0.6, 0.9, 1, 0.2, 0.7, 0.7].map(v => gpRising(st, 'burst', v));
    expect(fired).toEqual([false, false, true, false, false, false, true, false]);
  });

  it('keeps 60 levels a second, newest first, carrying part samples over', () => {
    const st = gpLevelsState();
    expect(gpLevelsPush(st, 0.5, 1 / 120)).toBe(0);
    expect(gpLevelsPush(st, 0.8, 1 / 120)).toBe(1);
    expect(st.levels[0]).toBeCloseTo(0.8);
    gpLevelsPush(st, 0.2, 3 / 60);
    expect(Array.from(st.levels.slice(0, 4)).map(v => +v.toFixed(2))).toEqual([0.2, 0.2, 0.2, 0.8]);
    gpLevelsPush(st, 1, 100);
    expect(st.levels.length).toBe(GP_LEVELS);
    expect(st.levels[GP_LEVELS - 1]).toBe(1);
  });

  it('hears bands in a spectrum and hits on a jump in the bass', () => {
    const freq = new Float32Array(1024).fill(-100);
    const sr = 48000, bin = sr / 2 / 1024;
    const st = gpSoundState();
    for (let i = 0; i < 30; i++) gpSoundStep(st, { freq, sampleRate: sr }, 1 / 60);
    expect(st.bass).toBeLessThan(0.01);
    // A kick: loud below 150 Hz.
    for (let i = Math.floor(25 / bin); i < 150 / bin; i++) freq[i] = -15;
    gpSoundStep(st, { freq, sampleRate: sr }, 1 / 60);
    expect(st.hit).toBe(1);
    expect(st.bass).toBeGreaterThan(0.3);
    expect(st.treble).toBeLessThan(0.05);
    // Held, it doesn't hit again.
    gpSoundStep(st, { freq, sampleRate: sr }, 1 / 60);
    expect(st.hit).toBe(0);
  });

  it('takes a plain level as every band', () => {
    const st = gpSoundState();
    for (let i = 0; i < 20; i++) gpSoundStep(st, { level: 0.6 }, 1 / 60);
    expect(st.level).toBeCloseTo(0.6, 2);
    expect(st.bass).toBeCloseTo(0.6, 2);
    gpSoundStep(st, null, 1 / 60);
    expect(st.level).toBeLessThan(0.6);
  });

  it('lays as much ink at every count', () => {
    expect(gpUnitInk(65536, 1) / gpUnitInk(1048576, 1)).toBeGreaterThan(4);
    expect(gpUnitInk(262144, 4)).toBeLessThan(gpUnitInk(262144, 1));
  });
});

describe('3D cameras', () => {
  const P = { ...GP_DEFAULTS, lightColor: [1, 1, 1] as [number, number, number] };

  it('orbit the emitter and look at it', () => {
    const cam = gpCamera({ ...P, camAngle: 40, camTilt: 20, drift: 0 }, 0, 1.5);
    const c = gpProject(cam, [0, 0, 0], 1.5);
    expect(c.x).toBeCloseTo(0, 5);
    expect(c.y).toBeCloseTo(0, 5);
    expect(c.depth).toBeCloseTo(P.camDistance, 5);
    // Something above the emitter is higher in the picture.
    expect(gpProject(cam, [0, 0.5, 0], 1.5).y).toBeGreaterThan(0);
    expect(cam.focus).toBeCloseTo(P.focus * P.camDistance, 5);
  });

  it('rebuild a raymarched scene\'s pinhole camera from three of its rays', () => {
    const n = (v: number[]) => { const l = Math.hypot(...v); return v.map(x => x / l); };
    const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    // As the March Camera node builds them.
    const ro = [2.6 * Math.sin(0.5) * Math.cos(0.25), 2.6 * Math.sin(0.25), 2.6 * Math.cos(0.5) * Math.cos(0.25)];
    const fwd = n(ro.map(x => -x)), rgt = n(cross([0, 1, 0], fwd)), up = cross(fwd, rgt);
    const fov = 1.5, aspect = 0.75;
    const rd = (x: number, y: number) => n([0, 1, 2].map(i => x * rgt[i] + y * up[i] + fov * fwd[i]));
    const cam = gpSceneCamera(ro, [rd(0, 0), rd(0.5 * aspect, 0), rd(0, 0.5)], aspect, [0, 0, 0], 1)!;
    for (const pt of [[0, 0, 0], [0.85, 0, 0], [-0.85, 0.2, 0], [0, 0.85, 0.3]]) {
      const d = pt.map((v, i) => v - ro[i]);
      const got = gpProject(cam, pt, aspect);
      expect(got.x).toBeCloseTo(dot(d, rgt) * fov / dot(d, fwd), 5);
      expect(got.y).toBeCloseTo(dot(d, up) * fov / dot(d, fwd), 5);
    }
    expect(gpSceneCamera(ro, [rd(0, 0), rd(0, 0), rd(0, 0)], aspect, [0, 0, 0], 1)).toBeNull();
  });
});

describe('the probe (wired sockets)', () => {
  const spec = gpProbeSpec({ m: 'gpp_m_x', s: 'gpp_s_x', f: ['turbulence', 'wind', 'size', 'drag', 'sound', 'bogus'], v2: ['hand'], cam: true, field: { obstacle: true } });

  it('packs floats four to a pixel, then points, then the camera\'s origin and rays', () => {
    expect(spec.f).toEqual(['turbulence', 'wind', 'size', 'drag', 'sound']);
    const slots = gpProbeSlots(spec);
    expect(slots.map(s => s.kind)).toEqual(['f', 'f', 'v2', 'ro', 'rd', 'rd', 'rd']);
    expect(slots[1].keys).toEqual(['sound']);
    expect(slots.slice(4).map(s => [s.dx, s.dy])).toEqual([[0, 0], [1, 0], [0, 1]]);
    expect(gpProbeField(spec)).toBe(true);
    expect(gpProbeField(gpProbeSpec({ m: 'a', s: 'b' }))).toBe(false);
  });

  it('puts the values read back over the sliders, clamped, and a hand turns Hands on', () => {
    const v = new Float32Array(7 * 4);
    v.set([2, -0.5, 99, 1.5], 0);
    v.set([0.7], 4);
    v.set([0.75, 0.5], 8);
    v.set([0, 0, 3], 12);
    v.set([0, 0, -1], 16); v.set([0.3, 0, -0.95], 20); v.set([0, 0.4, -0.9], 24);
    const r = gpApplyProbe(gpParams({}), spec, v, 1.5);
    expect(r.params).toMatchObject({ turbulence: 2, wind: -0.5, size: 32, drag: 1.5, hands: '1' });
    expect(r.params.sound).toBeCloseTo(0.7);
    expect(r.params.handX).toBeCloseTo((0.75 / 1.5 + 1) / 2);
    expect(r.params.handY).toBeCloseTo(0.75);
    expect(r.cam!.ro).toEqual([0, 0, 3]);
    expect(r.cam!.rays).toHaveLength(3);
    // Before the first read the sliders stand.
    expect(gpApplyProbe(gpParams({}), spec, null, 1).params.turbulence).toBe(GP_DEFAULTS.turbulence);
  });

  it('is declared only for the wired sockets, and drawn only in the hosts\' probe copy', () => {
    const plain = compileGraph({ nodes: EXAMPLE_GRAPHS.inkInWater.nodes });
    expect(plain.fragmentShader).not.toContain('GPP_PROBE');
    expect(gpBindings(plain.fragmentShader)[0].probe).toBeNull();

    const r = compileGraph({ nodes: EXAMPLE_GRAPHS.particlesRoundShape.nodes });
    expect(r.errors ?? []).toEqual([]);
    const b = gpBindings(r.fragmentShader)[0];
    expect(b.probe).toMatchObject({ f: [], cam: false, field: { obstacle: true, flow: true, depth: false } });
    expect(r.fragmentShader).toContain(`uniform float ${b.probe!.m};`);
    expect(r.fragmentShader).toMatch(/#ifdef GPP_PROBE[\s\S]*gl_FragColor = gpp_v;\s*return;[\s\S]*#endif/);
    // The sliders are still uniforms, so Play keeps them.
    expect(b.params.wind).toMatch(/^u_p_\w+_wind$/);

    const s = compileGraph({ nodes: EXAMPLE_GRAPHS.particlesIn3dScene.nodes });
    expect(s.errors ?? []).toEqual([]);
    expect(gpBindings(s.fragmentShader)[0].probe).toMatchObject({ cam: true, field: { depth: true } });
  });

  it('has a socket for every wireable setting', () => {
    for (const k of GP_SOCKET_FLOATS) {
      expect(GpuParticlesNode.inputs[k]?.type).toBe('float');
      expect(GpuParticlesNode.paramDefs![k]).toBeDefined();
    }
  });
});

describe('the node card', () => {
  it('folds every setting into a section and explains each one', () => {
    for (const [k, d] of Object.entries(GpuParticlesNode.paramDefs!)) {
      expect(d.section, k).toBeTruthy();
      expect(d.help, k).toBeTruthy();
      // No showWhen: a hidden param would leave the shader and its Play mapping.
      expect(d.showWhen, k).toBeUndefined();
    }
    expect(GpuParticlesNode.brief!.start.length).toBeGreaterThan(0);
  });

  it('migrates an older node by filling the new settings with their defaults', () => {
    const old = { count: '1m', turbulence: 2 };
    const m = GpuParticlesNode.migrateParams!({ ...old }, 1);
    expect(m.turbulence).toBe(2);
    expect(m.look).toBe('light');
    expect(m.space).toBe('2d');
  });

  it('lays ink over the paper (or Over) in the Ink look', () => {
    const r = compileGraph({ nodes: EXAMPLE_GRAPHS.inkInWater.nodes });
    expect(r.errors ?? []).toEqual([]);
    expect(r.fragmentShader).toMatch(/vec3 \w+_color = \(u_p_\w+_paper\) \* \(1\.0 - \w+_density\) \+ max\(\w+_s\.rgb, vec3\(0\.0\)\);/);
  });
});

describe('inputs on demand and the scene', () => {
  it('hides a setting\'s socket until it is asked for or wired', () => {
    const base = EXAMPLE_GRAPHS.inkInWater.nodes[0];
    const node = { ...base, params: { ...base.params }, inputs: { wind: { type: 'float' as const, label: 'Wind' }, over: { type: 'vec3' as const, label: 'Over' } } };
    expect(socketVisible(node, GpuParticlesNode, 'over')).toBe(true);
    expect(socketVisible(node, GpuParticlesNode, 'wind')).toBe(false);
    expect(socketVisible(node, GpuParticlesNode, 'obstacle')).toBe(true);
    expect(socketsForParam(GpuParticlesNode, 'wind')).toEqual(['wind']);
    expect(socketsForParam(GpuParticlesNode, 'flowForce')).toEqual(['flowForce', 'flow']);
    expect(socketsForParam(GpuParticlesNode, 'handY')).toEqual(['hand']);
    node.params = { ...node.params, ...showSocketPatch(node, 'wind', true) };
    expect(socketVisible(node, GpuParticlesNode, 'wind')).toBe(true);
    node.params = { ...node.params, ...showSocketPatch(node, 'wind', false) };
    expect(socketVisible(node, GpuParticlesNode, 'wind')).toBe(false);
    // A saved wire keeps its socket.
    const wired = { ...node, inputs: { wind: { type: 'float' as const, label: 'Wind', connection: { nodeId: 'x', outputKey: 'y' } } } };
    expect(socketVisible(wired, GpuParticlesNode, 'wind')).toBe(true);
  });

  it('samples a wired Scene on a grid round the centre for the simulation', () => {
    expect(gpVolPoint([0, 0, 0], [0, 0, 0], 2)[0]).toBeCloseTo(-2 + 2 / GP_VOL);
    expect(gpVolPoint([GP_VOL - 1, 0, 0], [1, 0, 0], 2)[0]).toBeCloseTo(3 - 2 / GP_VOL);
    const s = compileGraph({ nodes: EXAMPLE_GRAPHS.particlesIn3dScene.nodes });
    const b = gpBindings(s.fragmentShader)[0];
    expect(b.probe).toMatchObject({ field: { scene: true } });
    expect(b.probe!.c).toMatch(/^gpp_c_\w+$/);
    expect(s.fragmentShader).toContain(`uniform vec4 ${b.probe!.c};`);
    // Mode 3 calls the scene's own distance function.
    expect(s.fragmentShader).toMatch(/gpp_v = vec4\(mapScene_\w+\(gpp_c_\w+\.xyz/);
  });
});
