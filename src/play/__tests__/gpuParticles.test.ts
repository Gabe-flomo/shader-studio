/**
 * The Particles node and its engine's pure parts (play/kit/gpuParticles.js):
 * reading the node's settings, the emission ring, substeps, where the lights
 * go, and finding the nodes in a compiled shader. The GPU passes themselves
 * are checked in the browser.
 */
import { describe, expect, it } from 'vitest';
import {
  GP_DEFAULTS, GP_SUBSTEP, gpBindings, gpEmit, gpEmitterState, gpHueRotate, gpInWindow, gpParams, gpPlace, gpSubsteps, gpTierSide, gpUnitBrightness,
} from '../kit/gpuParticles.js';
import { compileGraph } from '../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { kitScript } from '../exportHtml';
import { gpuParticlesUniform } from '../../nodes/definitions/gpuParticles';

describe('gpParams', () => {
  it('fills every setting with its default', () => {
    expect(gpParams({})).toEqual(GP_DEFAULTS);
    expect(gpParams(null)).toEqual(GP_DEFAULTS);
  });

  it('reads numbers as they are, uniforms through read, and clamps them', () => {
    const p = gpParams({ life: 2, turbulence: 'u_p_parts_turbulence', drag: 999 }, n => (n === 'u_p_parts_turbulence' ? 1.25 : undefined));
    expect(p.life).toBe(2);
    expect(p.turbulence).toBe(1.25);
    expect(p.drag).toBe(20);
  });

  it('falls back to the default for an unreadable number (a keyframe curve, a missing uniform)', () => {
    const p = gpParams({ swirl: 'kf_parts_swirl(u_time)', speed: 'u_missing' }, () => undefined);
    expect(p.swirl).toBe(GP_DEFAULTS.swirl);
    expect(p.speed).toBe(GP_DEFAULTS.speed);
  });

  it('checks choices against their lists', () => {
    const p = gpParams({ count: '1m', emitter: 'teapot', lights: 2 });
    expect(p.count).toBe('1m');
    expect(p.emitter).toBe(GP_DEFAULTS.emitter);
    expect(p.lights).toBe('2');
  });

  it('reads a colour from an array or a three.js-like colour', () => {
    expect(gpParams({ lightColor: 'u_c' }, () => [0.1, 0.2, 0.3]).lightColor).toEqual([0.1, 0.2, 0.3]);
    expect(gpParams({ lightColor: 'u_c' }, () => ({ r: 1, g: 0, b: 0.5 })).lightColor).toEqual([1, 0, 0.5]);
    expect(gpParams({ lightColor: [1, 'x', 0] }).lightColor).toEqual(GP_DEFAULTS.lightColor);
  });
});

describe('emission ring', () => {
  it('turns the pool over once a longest life, never reborning a living particle', () => {
    const n = 1000, life = 2, lifeVar = 0.5, h = 1 / 60;
    const st = gpEmitterState();
    const born = new Map<number, number>();
    let t = 0;
    for (let k = 0; k < 60 * 12; k++) {
      t += h;
      const w = gpEmit(st, 'stream', n, life, lifeVar, h);
      for (let j = 0; j < w.count; j++) {
        const i = (w.start + j) % n;
        const last = born.get(i);
        // The longest a particle lives is life · (1 + lifeVar).
        if (last !== undefined) expect(t - last).toBeGreaterThanOrEqual(life * (1 + lifeVar) - 2 * h);
        born.set(i, t);
      }
    }
    expect(born.size).toBe(n);
  });

  it('windows follow each other round the ring', () => {
    const st = gpEmitterState();
    let expected = 0;
    for (let k = 0; k < 500; k++) {
      const w = gpEmit(st, 'stream', 97, 0.3, 0, 1 / 60);
      expect(w.start).toBe(expected);
      expected = (expected + w.count) % 97;
    }
  });

  it('bursts the whole pool at the start and once every longest life', () => {
    const st = gpEmitterState();
    const bursts: number[] = [];
    for (let k = 0; k < 600; k++) {
      const w = gpEmit(st, 'burst', 500, 1, 0.5, 1 / 60);
      if (w.count) { expect(w).toEqual({ start: 0, count: 500 }); bursts.push(k); }
    }
    expect(bursts).toEqual([0, 90, 180, 270, 360, 450, 540]);
  });

  it('tests membership as the shader does, wrapping past the end', () => {
    expect(gpInWindow(5, 3, 4, 10)).toBe(true);
    expect(gpInWindow(7, 3, 4, 10)).toBe(false);
    expect(gpInWindow(1, 8, 4, 10)).toBe(true);
    expect(gpInWindow(2, 8, 4, 10)).toBe(false);
    expect(gpInWindow(0, 0, 0, 10)).toBe(false);
  });
});

describe('substeps and sizes', () => {
  it('splits a frame into equal steps of at most 1/60 s', () => {
    expect(gpSubsteps(0)).toEqual({ n: 0, h: 0 });
    expect(gpSubsteps(1 / 120)).toEqual({ n: 1, h: 1 / 120 });
    expect(gpSubsteps(1 / 60).n).toBe(1);
    const s = gpSubsteps(1 / 30);
    expect(s.n).toBe(2);
    expect(s.h).toBeCloseTo(GP_SUBSTEP);
    // A big pool takes longer steps, not more.
    expect(gpSubsteps(1 / 20, 1)).toEqual({ n: 1, h: 1 / 20 });
    // A stall is clamped: the particles don't fly off.
    expect(gpSubsteps(5).n * gpSubsteps(5).h).toBeCloseTo(0.1);
  });

  it('maps count tiers to state textures', () => {
    expect(gpTierSide('64k') ** 2).toBe(65536);
    expect(gpTierSide('256k') ** 2).toBe(262144);
    expect(gpTierSide('4m') ** 2).toBe(4194304);
    expect(gpTierSide('nope')).toBe(512);
  });

  it('dims each particle as the count grows, so the cloud keeps its brightness', () => {
    const a = gpUnitBrightness(65536, 2), b = gpUnitBrightness(1048576, 2);
    // 16 times the particles, each between a quarter and a sixteenth as bright.
    expect(a / b).toBeGreaterThan(4);
    expect(a / b).toBeLessThan(16);
    expect(gpUnitBrightness(262144, 4)).toBeLessThan(gpUnitBrightness(262144, 2));
  });
});

describe('placement', () => {
  const p = { ...GP_DEFAULTS, lightColor: [1, 0.5, 0.2] as [number, number, number] };

  it('puts the lights round the emitter, each a different hue', () => {
    const pl = gpPlace(p, 1.5, null, 16 / 9);
    expect(pl.lights).toHaveLength(4);
    expect(pl.emitAt).toEqual([0, 0]);
    for (const l of pl.lights) expect(Math.hypot(l.x, l.y)).toBeLessThan(1.5);
    expect(pl.lights[0].colour).not.toEqual(pl.lights[1].colour);
  });

  it('lets the mouse move the emitter, the attractor or a light', () => {
    const m: [number, number] = [0.75, 0.5];
    expect(gpPlace({ ...p, follow: 'emitter' }, 0, m, 2).emitAt).toEqual([1, 0]);
    expect(gpPlace({ ...p, follow: 'attractor' }, 0, m, 2).attractAt).toEqual([1, 0]);
    const l = gpPlace({ ...p, follow: 'lights' }, 0, m, 2).lights[0];
    expect([l.x, l.y]).toEqual([1, 0]);
    expect(gpPlace({ ...p, follow: 'emitter' }, 0, null, 2).emitAt).toEqual([0, 0]);
  });

  it('has no lights when they are off', () => {
    expect(gpPlace({ ...p, lights: '0' }, 0, null, 1).lights).toEqual([]);
  });

  it('keeps luma when turning a colour round the wheel', () => {
    const c = [0.8, 0.4, 0.2], r = gpHueRotate(c, 0.3);
    const luma = (x: number[]) => 0.299 * x[0] + 0.587 * x[1] + 0.114 * x[2];
    expect(luma(r)).toBeCloseTo(luma(c), 1);
    expect(gpHueRotate(c, 0)).toEqual(c.map(v => expect.closeTo(v, 2)));
  });
});

describe('the Particles node in a compiled shader', () => {
  const r = compileGraph({ nodes: EXAMPLE_GRAPHS.particleGalaxy.nodes });

  it('declares its sampler with its settings, and the hosts find it', () => {
    expect(r.errors ?? []).toEqual([]);
    const b = gpBindings(r.fragmentShader);
    expect(b).toHaveLength(1);
    expect(b[0].uniform).toMatch(/^u_gpup_\w+$/);
    expect(r.fragmentShader).toContain(`uniform sampler2D ${b[0].uniform};`);
    expect(b[0].params.emitter).toBe('ring');
    expect(b[0].params.count).toBe('256k');
  });

  it('keeps its sliders as uniforms, so moving one never recompiles', () => {
    const b = gpBindings(r.fragmentShader)[0];
    const turb = b.params.turbulence as string;
    expect(turb).toMatch(/^u_p_\w+_turbulence$/);
    expect(r.paramUniforms[turb]).toBe(0.25);
    expect(r.paramBindings['parts::turbulence']).toBe(turb);
    const col = b.params.lightColor as string;
    expect(r.paramUniforms[col]).toEqual([1, 0.7, 0.4]);
    // What the engine reads for this frame.
    expect(gpParams(b.params, n => r.paramUniforms[n]).turbulence).toBe(0.25);
  });

  it('adds the particles to its picture', () => {
    expect(r.fragmentShader).toMatch(/vec3 \w+_color = \w+_color \+ \w+_particles;/);
  });

  it('declares one sampler per node', () => {
    const nodes = EXAMPLE_GRAPHS.particleGalaxy.nodes;
    const second = { ...nodes.find(n => n.id === 'parts')!, id: 'parts2' };
    const r2 = compileGraph({ nodes: [...nodes, second] });
    const b = gpBindings(r2.fragmentShader);
    expect(new Set(b.map(x => x.uniform)).size).toBe(b.length);
  });

  it('names its sampler without double underscores', () => {
    expect(gpuParticlesUniform('parts_2')).toBe('u_gpup_partsx2');
  });

  it('is part of the kit the web runtime gets', () => {
    const SSKit = new Function(`${kitScript()}\nreturn SSKit;`)() as { gpuParticles: { host: (gl: unknown) => { unsupported: string | null; bind: (fs: string) => unknown[] } } };
    const host = SSKit.gpuParticles.host(null);
    expect(host.unsupported).toMatch(/WebGL2/);
    expect(host.bind(r.fragmentShader)).toHaveLength(1);
  });
});
