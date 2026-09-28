// @vitest-environment jsdom
/**
 * The Layers node's distance field (play/kit/jfa.js, docs/layers-node.md):
 * the jump flood's math on the CPU (the reference the shaders follow) against
 * brute force and against an analytic circle, and the app's fallback to the
 * CPU field where the GPU flood can't run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JF_FAR, jfCreate, jfGridSize, jfReference, jfSeedGrid, jfSteps } from '../kit/jfa.js';

/** An anti-aliased disc (alpha ramps over one texel around the edge), row 0 at the bottom. */
function disc(gw: number, gh: number, cx: number, cy: number, r: number): Float32Array {
  const a = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r;
    a[y * gw + x] = Math.max(0, Math.min(1, 0.5 - d));
  }
  return a;
}

/** Brute force: every texel against every seed, the same metric and sign as the flood. */
function bruteForce(alpha: Float32Array, gw: number, gh: number, aspect: number): Float32Array {
  const seeds = jfSeedGrid(alpha, gw, gh), tx = 2 * aspect / gw, ty = 2 / gh, out = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let best = JF_FAR;
    for (let j = 0; j < gw * gh; j++) {
      if (seeds[j * 4 + 3] < 0.5) continue;
      best = Math.min(best, Math.hypot((x + 0.5 - seeds[j * 4]) * tx, (y + 0.5 - seeds[j * 4 + 1]) * ty) - seeds[j * 4 + 2] * ty);
    }
    const i = y * gw + x;
    out[i] = Math.max(-JF_FAR, Math.min(JF_FAR, alpha[i] >= 0.5 ? -best : best));
  }
  return out;
}

describe('Layers distance field: jump flood math', () => {
  it('floods with steps N/2 … 1, plus one more step of 1', () => {
    expect(jfSteps(24, 17)).toEqual([16, 8, 4, 2, 1, 1]);
    expect(jfSteps(1024, 576)).toEqual([512, 256, 128, 64, 32, 16, 8, 4, 2, 1, 1]);
  });

  it('caps the grid at the long side and never upsamples', () => {
    expect(jfGridSize(2560, 1440, 1024)).toEqual({ gw: 1024, gh: 576 });
    expect(jfGridSize(640, 360, 1024)).toEqual({ gw: 640, gh: 360 });
  });

  it('matches brute-force Euclidean distance to the seeds on a small grid', () => {
    const gw = 40, gh = 24, aspect = gw / gh;
    // Two discs and a bar: several Voronoi regions meeting.
    const a = disc(gw, gh, 10, 12, 5);
    const b = disc(gw, gh, 30, 8, 3.2);
    const alpha = new Float32Array(gw * gh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.max(a[i], b[i]);
    for (let x = 22; x < 38; x++) alpha[19 * gw + x] = alpha[20 * gw + x] = 1;
    const jfa = jfReference(alpha, gw, gh, aspect), ref = bruteForce(alpha, gw, gh, aspect);
    const texel = 2 / gh;
    let worst = 0, off = 0;
    for (let i = 0; i < jfa.length; i++) {
      const e = Math.abs(jfa[i] - ref[i]);
      worst = Math.max(worst, e);
      if (e > 1e-6) off++;
    }
    // JFA+1 is exact here but for the odd texel, and never off by more than a fraction of a texel.
    expect(off / jfa.length).toBeLessThan(0.01);
    expect(worst).toBeLessThan(0.25 * texel);
  });

  it('is a signed Euclidean distance to the edge: a circle within a fraction of a texel', () => {
    const gw = 64, gh = 48, aspect = gw / gh, r = 11, cx = 30.3, cy = 22.7;
    const field = jfReference(disc(gw, gh, cx, cy, r), gw, gh, aspect);
    const texel = 2 / gh;
    let worst = 0;
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const exact = (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) - r) * texel;
      worst = Math.max(worst, Math.abs(field[y * gw + x] - exact));
      if (exact < -texel) expect(field[y * gw + x]).toBeLessThan(0);
      if (exact > texel) expect(field[y * gw + x]).toBeGreaterThan(0);
    }
    // The old CPU chamfer is off by up to ~8% of the distance and a half cell at the edge; this stays within a tenth of a texel or so.
    expect(worst).toBeLessThan(0.15 * texel);
  });

  it('counts a faint dot (a particle smaller than a texel) as a small disc, and nothing as far away', () => {
    const gw = 16, gh = 16, alpha = new Float32Array(gw * gh);
    alpha[8 * gw + 8] = 0.2;
    const f = jfReference(alpha, gw, gh, 1);
    const r = Math.sqrt(0.2 / Math.PI) * (2 / gh);
    expect(f[8 * gw + 8]).toBeCloseTo(-r, 5);
    expect(f[8 * gw + 12]).toBeCloseTo(4 * (2 / gh) - r, 5);
    expect(jfReference(new Float32Array(gw * gh), gw, gh, 1).every(v => v === JF_FAR)).toBe(true);
  });
});

describe('Layers distance field: fallback', () => {
  it('jfCreate declines contexts it cannot run on', () => {
    expect(jfCreate(null)).toBeNull();
    // jsdom has no WebGL at all; a WebGL1-like object is not a WebGL2 context either.
    expect(jfCreate({ getExtension: () => null } as unknown as WebGLRenderingContext)).toBeNull();
  });
});

type Tap = { color: HTMLCanvasElement; layers: HTMLCanvasElement; sig: number; field: Uint8Array; gw: number; gh: number };

describe('Layers distance field: the app picks GPU or CPU', () => {
  let tapFn: ((tap: Tap) => void) | null = null;
  beforeEach(() => {
    vi.resetModules();
    tapFn = null;
    vi.doMock('../overlay', () => ({ playOverlay: { setShaderTap: (fn: typeof tapFn) => { tapFn = fn; } } }));
  });

  const makeTap = (sig: number) => {
    const color = document.createElement('canvas'), layers = document.createElement('canvas');
    layers.width = 320; layers.height = 180;
    let reads = 0;
    const tap = {
      color, layers, sig, gw: 32, gh: 18,
      get field() { reads++; return new Uint8Array(32 * 18 * 4); },
    };
    return { tap, reads: () => reads };
  };

  it('uses the CPU field without a WebGL2 renderer, and renders again only when the layers change', async () => {
    vi.doMock('../kit/jfa.js', async orig => ({ ...(await orig<object>()), jfCreate: () => null }));
    const lt = await import('../layersTexture');
    const renderer = { getContext: () => ({}), resetState: vi.fn() };
    lt.setLayersRenderer(renderer as never);
    const rr = vi.fn();
    lt.setLayersTap(true, rr);
    const { tap, reads } = makeTap(7);
    tapFn!(tap);
    expect(lt.layersFieldMode()).toBe('cpu');
    expect(lt.layersUniforms.u_layersFieldLinear.value).toBe(0);
    expect(lt.layersUniforms.u_layersFieldSize.value.toArray()).toEqual([32, 18]);
    expect(reads()).toBe(1);
    tapFn!(tap);
    expect(rr).toHaveBeenCalledTimes(1);
    tapFn!(makeTap(8).tap);
    expect(rr).toHaveBeenCalledTimes(2);
    lt.setLayersTap(false, rr);
    expect(lt.layersFieldMode()).toBe('off');
  });

  it('uses the GPU field when the flood runs, without computing the CPU one', async () => {
    const fake = { run: vi.fn(() => ({ texture: {} as WebGLTexture, width: 1024, height: 576 })), dispose: vi.fn(), maxRes: 1024 };
    vi.doMock('../kit/jfa.js', async orig => ({ ...(await orig<object>()), jfCreate: () => fake }));
    const lt = await import('../layersTexture');
    const renderer = { getContext: () => ({}), resetState: vi.fn() };
    lt.setLayersRenderer(renderer as never);
    lt.setLayersTap(true, () => {});
    const { tap, reads } = makeTap(1);
    tapFn!(tap);
    expect(lt.layersFieldMode()).toBe('gpu');
    expect(lt.layersUniforms.u_layersFieldLinear.value).toBe(1);
    expect(lt.layersUniforms.u_layersFieldSize.value.toArray()).toEqual([1024, 576]);
    expect(fake.run).toHaveBeenCalledWith({ canvas: tap.layers, width: 320, height: 180 });
    expect(renderer.resetState).toHaveBeenCalled();
    expect(reads()).toBe(0);
    // A frame the flood can't build (a tainted canvas) falls back to the CPU field for that frame.
    fake.run.mockReturnValueOnce(null as never);
    tapFn!(tap);
    expect(lt.layersFieldMode()).toBe('cpu');
    expect(reads()).toBe(1);
    // The renderer going away drops the GPU field.
    tapFn!(tap);
    lt.releaseLayersRenderer(renderer as never);
    expect(fake.dispose).toHaveBeenCalled();
    expect(lt.layersUniforms.u_layersFieldLinear.value).toBe(0);
  });
});
