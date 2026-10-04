/**
 * Performance changes that must not change results: the goo field's reused
 * arrays, the Granulator view's shared helpers, and the Particles node's
 * shadow of the GL state it puts back (play/kit/gpuParticles.js).
 */
import { describe, expect, it, vi } from 'vitest';
import { createParticles, gooField, seededRandom, type ParticleEnv, type ParticleParams } from '../particle-sim.js';
import { defaultLayer, type ParticlesLayer } from '../../types/play';
import { grGrainOpacity, grGrainRow, grGrainSpan, grIdHash, grMakeEngine } from '../kit/granulator.js';
import { gpStateShadow } from '../kit/gpuParticles.js';

const params = (over: Partial<ParticlesLayer> = {}): ParticleParams =>
  ({ ...(defaultLayer('particles', 'p', 'P') as ParticlesLayer), field: 'none', ...over }) as ParticleParams;
const env = (W: number, H: number) => ({ dt: 1 / 60, time: 0, aspect: W / H, sample: null, sw: 16, sh: 16, attractorPoint: null, spawnPoint: null, W, H }) as unknown as ParticleEnv & { W: number; H: number };

describe('gooField with reused arrays', () => {
  it('matches a fresh field, frame after frame, as the particles move', () => {
    const W = 80, H = 60;
    const st = createParticles(12, seededRandom(3));
    const r = seededRandom(9);
    const p = params({ size: 6, sizeJitter: 0.3, gooBlend: 2 });
    for (let frame = 0; frame < 3; frame++) {
      for (let i = 0; i < st.count; i++) { st.alive[i] = 1; st.x[i] = r(); st.y[i] = r(); }
      const fresh = gooField(st, p, env(W, H), W, H, 1);
      const reused = gooField(st, p, env(W, H), W, H, 1, true);
      expect(Array.from(reused.v)).toEqual(Array.from(fresh.v));
      expect(Array.from(reused.rgb)).toEqual(Array.from(fresh.rgb));
    }
  });

  it('keeps the arrays between frames and makes new ones when the grid size changes', () => {
    const st = createParticles(2, seededRandom(1));
    const p = params();
    const a = gooField(st, p, env(40, 30), 40, 30, 1, true);
    const b = gooField(st, p, env(40, 30), 40, 30, 1, true);
    expect(b.v).toBe(a.v);
    const c = gooField(st, p, env(50, 30), 50, 30, 1, true);
    expect(c.v).not.toBe(a.v);
    expect(c.v.length).toBe(50 * 30);
  });
});

describe('Granulator view helpers', () => {
  it('give what a fresh engine maker gives', () => {
    const e = grMakeEngine();
    for (let id = 0; id < 64; id++) {
      expect(grIdHash(id)).toBe(e.idHash(id));
      expect(grGrainRow(id, (id % 7) / 3 - 1, id % 2 === 0)).toBe(e.grainRow(id, (id % 7) / 3 - 1, id % 2 === 0));
      expect(grGrainSpan(id / 64, 0.1)).toEqual(e.grainSpan(id / 64, 0.1));
      expect(grGrainOpacity(id / 63)).toBe(e.grainOpacity(id / 63));
    }
  });
});

describe('gpStateShadow', () => {
  /** A context stand-in: state set by the setters, getParameter counted. */
  const fakeGl = () => {
    const st: Record<number, unknown> = { 1: 1, 2: 0, 3: 1, 4: 0, 5: 0x8006, 6: 0x8006, 7: new Float32Array([0, 0, 0, 0]), 8: [true, true, true, true] };
    const gl = {
      BLEND_SRC_RGB: 1, BLEND_DST_RGB: 2, BLEND_SRC_ALPHA: 3, BLEND_DST_ALPHA: 4, BLEND_EQUATION_RGB: 5, BLEND_EQUATION_ALPHA: 6, COLOR_CLEAR_VALUE: 7, COLOR_WRITEMASK: 8,
      getParameter: vi.fn((k: number) => st[k]),
      blendFunc(a: number, b: number) { st[1] = st[3] = a; st[2] = st[4] = b; },
      blendFuncSeparate(a: number, b: number, c: number, d: number) { st[1] = a; st[2] = b; st[3] = c; st[4] = d; },
      blendEquation(m: number) { st[5] = st[6] = m; },
      blendEquationSeparate(a: number, b: number) { st[5] = a; st[6] = b; },
      clearColor(r: number, g: number, b: number, a: number) { st[7] = new Float32Array([r, g, b, a]); },
      colorMask(r: boolean, g: boolean, b: boolean, a: boolean) { st[8] = [r, g, b, a]; },
    };
    return { gl, st };
  };
  const real = (gl: ReturnType<typeof fakeGl>['gl']) => ({
    bsrc: gl.getParameter(1), bdst: gl.getParameter(2), basrc: gl.getParameter(3), badst: gl.getParameter(4), beq: gl.getParameter(5), beqa: gl.getParameter(6),
    clear: Array.from(gl.getParameter(7) as Float32Array), mask: [...(gl.getParameter(8) as boolean[])],
  });

  it('reads the context once, then follows its setters without asking it', () => {
    const { gl } = fakeGl();
    const s = gpStateShadow(gl);
    const reads = gl.getParameter.mock.calls.length;
    expect(reads).toBe(8);
    gl.blendFunc(770, 771);
    gl.blendEquationSeparate(0x8006, 0x800b);
    gl.clearColor(0.25, 0.5, 0.75, 1);
    gl.colorMask(true, false, true, false);
    expect(gpStateShadow(gl)).toBe(s);
    expect(gl.getParameter.mock.calls.length).toBe(reads);
    const want = real(gl);
    expect({ bsrc: s.bsrc, bdst: s.bdst, basrc: s.basrc, badst: s.badst, beq: s.beq, beqa: s.beqa, clear: s.clear, mask: s.mask }).toEqual(want);
    gl.blendFuncSeparate(1, 0, 0, 1);
    gl.blendEquation(0x800a);
    expect(s.bsrc).toBe(1); expect(s.bdst).toBe(0); expect(s.basrc).toBe(0); expect(s.badst).toBe(1);
    expect(s.beq).toBe(0x800a); expect(s.beqa).toBe(0x800a);
  });

  it('starts from what was set before it existed', () => {
    const { gl } = fakeGl();
    gl.blendFuncSeparate(770, 771, 1, 771);
    gl.clearColor(0, 0, 0, 1);
    const s = gpStateShadow(gl);
    expect(s.bsrc).toBe(770); expect(s.badst).toBe(771);
    expect(s.clear).toEqual([0, 0, 0, 1]);
  });
});
