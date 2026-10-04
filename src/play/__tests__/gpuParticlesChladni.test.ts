/**
 * Chladni plates on the Particles node (Pattern): the plate's modes (their nodal lines are zeros),
 * how the sound picks modes (band → mode, weights, symmetry, gliding), and the settings and
 * bindings that carry it. The GPU side (sand sliding to the lines) is checked in the browser.
 */
import { describe, expect, it } from 'vitest';
import {
  GP_BESSEL_W, GP_BESSEL_X, GP_PLATE_BANDS, GP_PLATE_HOLD, GP_PLATE_MAX, GP_PRESETS, GP_SOCKET_FLOATS,
  gpBessel, gpBesselTable, gpBesselZero, gpBindings, gpChladniCircle, gpChladniSquare, gpParams, gpPlateBands,
  gpPlateListen, gpPlateSmooth, gpPlateState, gpPlateTable, gpPlateTargets, gpPlateUniforms, gpPlateWave, gpPreset,
} from '../kit/gpuParticles.js';
import { compileGraph } from '../../compiler/graphCompiler';
import { EXAMPLE_GRAPHS } from '../../store/exampleGraphs';
import { GpuParticlesNode } from '../../nodes/definitions/gpuParticles';

const P = (over: Record<string, unknown> = {}) => gpParams({ pattern: 'square', ...over });

describe('the plate\'s modes', () => {
  it('computes Bessel functions and their zeros', () => {
    expect(gpBessel(0, 0)).toBeCloseTo(1, 6);
    expect(gpBessel(3, 0)).toBeCloseTo(0, 6);
    // Known zeros: j0,1 = 2.4048, j1,1 = 3.8317, j2,3 = 11.6198, j5,2 = 12.3386.
    expect(gpBesselZero(0, 1)).toBeCloseTo(2.4048, 3);
    expect(gpBesselZero(1, 1)).toBeCloseTo(3.8317, 3);
    expect(gpBesselZero(2, 3)).toBeCloseTo(11.6198, 3);
    expect(gpBesselZero(5, 2)).toBeCloseTo(12.3386, 3);
    // The table the shader reads is the same function.
    const t = gpBesselTable();
    const i = 300, x = i / (GP_BESSEL_W - 1) * GP_BESSEL_X;
    expect(t[4 * GP_BESSEL_W + i]).toBeCloseTo(gpBessel(4, x), 5);
  });

  it('has nodal lines on a square plate where the formula is zero', () => {
    // Minus: the diagonals are always still lines (the two terms swap there).
    for (const [n, m] of [[1, 3], [2, 4], [3, 5], [1, 7]]) {
      for (const s of [-0.9, -0.3, 0.2, 0.75]) {
        expect(gpChladniSquare(n, m, -1, s, s)).toBeCloseTo(0, 9);
        expect(gpChladniSquare(n, m, -1, s, -s)).toBeCloseTo(0, 9);
      }
    }
    // (0, 2), minus: cos(2πY) − cos(2πX) is still where |x| = |y| and nowhere off them.
    expect(gpChladniSquare(0, 2, -1, 0.5, 0)).not.toBeCloseTo(0, 2);
    // Plus: the anti-symmetric partner, still where cos(nX)cos(mY) = −cos(mX)cos(nY); (1, 3) at the centre lines.
    expect(gpChladniSquare(1, 3, 1, 0, 0.37)).toBeCloseTo(0, 9);
    // n = m always adds (minus would be zero everywhere).
    expect(gpChladniSquare(3, 3, -1, 0.1, 0.4)).toBeCloseTo(2 * Math.cos(3 * 0.55 * Math.PI) * Math.cos(3 * 0.7 * Math.PI), 9);
  });

  it('has rings and spokes on a round plate where the mode is zero, and a free rim', () => {
    for (const [n, m] of [[0, 3], [2, 2], [4, 3], [6, 1], [3, 0]]) {
      const k = gpPlateWave(n, m);
      // m still rings inside the rim, at J_n's first m zeros; none further out.
      for (let j = 1; j <= m; j++) expect(gpChladniCircle(n, m, gpBesselZero(n, j) / k, 0)).toBeCloseTo(0, 6);
      expect(gpBesselZero(n, m + 1)).toBeGreaterThan(k);
      // The rim is free: the plate's slope across it is flat there (J_n′(k) = 0), so it moves and sheds its sand.
      const e = 1e-4;
      expect((gpChladniCircle(n, m, 1 + e, 0) - gpChladniCircle(n, m, 1 - e, 0)) / (2 * e)).toBeCloseTo(0, 3);
      // n spokes: still along θ = π / 2n (+ kπ / n).
      if (n > 0) {
        const a = Math.PI / (2 * n) + Math.PI / n;
        expect(gpChladniCircle(n, m, 0.43 * Math.cos(a), 0.43 * Math.sin(a))).toBeCloseTo(0, 9);
      }
    }
  });

  it('orders the modes by pitch, keeping the square\'s symmetric ones', () => {
    const sq = gpPlateTable('square');
    for (let i = 1; i < sq.length; i++) expect(sq[i].f).toBeGreaterThanOrEqual(sq[i - 1].f);
    for (const e of sq) { expect(e.n).toBeLessThan(e.m); expect((e.n + e.m) % 2).toBe(0); }
    const rd = gpPlateTable('circle');
    for (let i = 1; i < rd.length; i++) expect(rd[i].f).toBeGreaterThanOrEqual(rd[i - 1].f);
    // The lowest round figure is two spokes (a cross), as on a real disc.
    expect(rd[0]).toMatchObject({ n: 2, m: 0 });
  });
});

describe('the sound picks the modes', () => {
  it('maps the loudest band to the main mode, higher bands to higher modes', () => {
    const table = gpPlateTable('square');
    const at = (md: { n: number; m: number }) => table.findIndex(e => e.n === md.n && e.m === md.m);
    let last = -1;
    for (let b = 0; b < GP_PLATE_BANDS; b++) {
      const bands = new Array(GP_PLATE_BANDS).fill(0);
      bands[b] = 0.8;
      const t = gpPlateTargets(P(), 'square', bands)!;
      expect(t[0].w).toBe(1);
      expect(at(t[0])).toBeGreaterThan(last);
      last = at(t[0]);
    }
    // Frequency reaches further up.
    const bands = [0, 0, 0, 0.9, 0, 0, 0, 0];
    expect(at(gpPlateTargets(P({ plateFreq: 2.5 }), 'square', bands)![0])).toBeGreaterThan(at(gpPlateTargets(P(), 'square', bands)![0]));
  });

  it('adds the quieter bands as weaker modes, as many as Modes, keeping the symmetry', () => {
    const bands = [0.2, 0.9, 0, 0.6, 0, 0.4, 0.3, 0];
    const t = gpPlateTargets(P({ modes: 3, plateWeights: 0.8 }), 'square', bands)!;
    expect(t.length).toBe(3);
    expect(t[0].w).toBe(1);
    expect(t[1].w).toBeLessThan(1);
    expect(t[2].w).toBeLessThanOrEqual(t[1].w);
    for (const md of t) expect(md.n % 2).toBe(t[0].n % 2);
    // Weights 0: only the loudest.
    expect(gpPlateTargets(P({ modes: 5, plateWeights: 0 }), 'square', bands)!.length).toBe(1);
    // Round: every spoke count a multiple of the figure's (or rings alone).
    const r = gpPlateTargets(P({ pattern: 'circle', modes: 5, plateWeights: 1 }), 'circle', bands)!;
    const g = Math.min(...r.filter(x => x.n > 0).map(x => x.n));
    for (const md of r) expect(md.n === 0 || md.n % g === 0).toBe(true);
    expect(r.length).toBeLessThanOrEqual(GP_PLATE_MAX);
  });

  it('holds the figure in silence, and Manual takes N and M', () => {
    expect(gpPlateTargets(P(), 'square', new Array(GP_PLATE_BANDS).fill(0))).toBeNull();
    const t = gpPlateTargets(P({ modeFrom: 'manual', modeN: 3, modeM: 5, modes: 3, plateWeights: 0.5 }), 'square', [1, 0, 0, 0, 0, 0, 0, 0])!;
    expect(t[0]).toEqual({ n: 3, m: 5, w: 1 });
    expect(t.length).toBe(3);
    expect(t[1].w).toBeCloseTo(0.5);
    // Frequency multiplies N and M; equal ones move apart (the minus figure would vanish).
    expect(gpPlateTargets(P({ modeFrom: 'manual', modeN: 2, modeM: 3, modes: 1, plateFreq: 2 }), 'square', null)![0]).toMatchObject({ n: 4, m: 6 });
    expect(gpPlateTargets(P({ modeFrom: 'manual', modeN: 4, modeM: 4, modes: 1 }), 'square', null)![0]).toMatchObject({ n: 4, m: 5 });
    // Round: M 0 is spokes only, but rings alone (N 0) need at least one.
    expect(gpPlateTargets(P({ modeFrom: 'manual', modeN: 4, modeM: 0, modes: 1 }), 'circle', null)![0]).toMatchObject({ n: 4, m: 0 });
    expect(gpPlateTargets(P({ modeFrom: 'manual', modeN: 0, modeM: 0, modes: 1 }), 'circle', null)![0]).toMatchObject({ n: 0, m: 1 });
  });

  it('hears a tone in the band it falls in', () => {
    const freq = new Float32Array(2048).fill(-100), sr = 48000, bin = sr / 2 / 2048;
    for (let i = Math.floor(950 / bin); i < 1050 / bin; i++) freq[i] = -12;
    const bands = gpPlateBands({ freq, sampleRate: sr });
    const loud = bands.indexOf(Math.max(...bands));
    // Bands are log-spaced 80 Hz…5 kHz: 1 kHz is in band 4 of 8.
    const lo = 80 * Math.pow(5000 / 80, loud / GP_PLATE_BANDS), hi = 80 * Math.pow(5000 / 80, (loud + 1) / GP_PLATE_BANDS);
    expect(lo).toBeLessThan(1000);
    expect(hi).toBeGreaterThan(1000);
    expect(gpPlateBands(null).every(v => v === 0)).toBe(true);
  });

  it('listens to the graph\'s Audio Input bands, or steps the figure on each hit with only a level', () => {
    const st = gpPlateState();
    for (let i = 0; i < 30; i++) gpPlateListen(st, { graphBands: [0, 0, 0.9, 0, 0, 0], dt: 1 / 60 });
    // Six graph bands spread over the eight: band 2 of 6 lands in band 2 of 8.
    expect(st.bands.indexOf(Math.max(...st.bands))).toBe(2);
    // Silent graph bands give way to the level (the stand-in beat): each hit moves the loudest band.
    const lv = gpPlateState();
    gpPlateListen(lv, { graphBands: [0, 0, 0, 0, 0, 0], level: 0.5, hit: false, dt: 1 });
    const before = lv.bands.indexOf(Math.max(...lv.bands));
    gpPlateListen(lv, { level: 0.5, hit: true, dt: 1 });
    expect(lv.step).toBe(1);
    expect(lv.bands.indexOf(Math.max(...lv.bands))).not.toBe(before);
  });

  it('holds a figure long enough for the sand to settle', () => {
    // Hits closer than GP_PLATE_HOLD don't step the figure on.
    const st = gpPlateState();
    let steps = 0;
    for (let i = 0; i < 240; i++) {
      const before = st.step;
      gpPlateListen(st, { level: 0.6, hit: i % 30 === 0, dt: 1 / 60 }); // a hit every half second, for 4 s
      steps += st.step - before;
    }
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(steps).toBeLessThanOrEqual(Math.ceil(4 / GP_PLATE_HOLD));
    // Two near-equal bands: the one that led keeps leading until the other is clearly louder.
    const sp = gpPlateState();
    for (let i = 0; i < 60; i++) gpPlateListen(sp, { graphBands: [0, 0.6, 0, 0, 0, 0.55, 0, 0], dt: 1 / 60 });
    const lead = sp.lead;
    let out: number[] = [];
    for (let i = 0; i < 60; i++) out = gpPlateListen(sp, { graphBands: [0, 0.55, 0, 0, 0, 0.6, 0, 0], dt: 1 / 60 });
    expect(sp.lead).toBe(lead);
    expect(out.indexOf(Math.max(...out))).toBe(lead);
    for (let i = 0; i < 120; i++) gpPlateListen(sp, { graphBands: [0, 0.2, 0, 0, 0, 0.9, 0, 0], dt: 1 / 60 });
    expect(sp.lead).not.toBe(lead);
  });

  it('glides from one figure to the next instead of jumping', () => {
    const st = gpPlateState();
    gpPlateSmooth(st, [{ n: 1, m: 3, w: 1 }], 1 / 60);
    expect(st.modes).toEqual([{ n: 1, m: 3, w: 1 }]);
    gpPlateSmooth(st, [{ n: 3, m: 5, w: 1 }], 1 / 60);
    const old = st.modes.find(x => x.n === 1)!, neu = st.modes.find(x => x.n === 3)!;
    expect(old.w).toBeGreaterThan(0.9);
    expect(neu.w).toBeGreaterThan(0);
    expect(neu.w).toBeLessThan(0.1);
    for (let i = 0; i < 240; i++) gpPlateSmooth(st, [{ n: 3, m: 5, w: 1 }], 1 / 60);
    expect(st.modes).toEqual([{ n: 3, m: 5, w: expect.closeTo(1, 3) }]);
    // Silence (null) holds it; snap jumps.
    gpPlateSmooth(st, null, 1 / 60);
    expect(st.modes.length).toBe(1);
    gpPlateSmooth(st, [{ n: 0, m: 4, w: 1 }], 1 / 60, true);
    expect(st.modes).toEqual([{ n: 0, m: 4, w: 1 }]);
  });

  it('hands the shader weights that sum to a swing of about ±1', () => {
    const sq = gpPlateUniforms([{ n: 1, m: 3, w: 1 }, { n: 3, m: 5, w: 0.5 }], 'square');
    expect(sq.count).toBe(2);
    // Each square mode swings ±2, so the weights are halved: Σ|w| · 2 = 1.
    expect((Math.abs(sq.values[3]) + Math.abs(sq.values[7])) * 2).toBeCloseTo(1, 6);
    const rd = gpPlateUniforms([{ n: 2, m: 2, w: 1 }], 'circle');
    expect(rd.values[2]).toBeCloseTo(gpPlateWave(2, 2), 5);
    expect(rd.values.length).toBe(GP_PLATE_MAX * 4);
  });
});

describe('settings, presets, bindings and examples', () => {
  it('parses the plate settings, falling back to Off and clamping numbers', () => {
    expect(gpParams({}).pattern).toBe('off');
    expect(gpParams({ pattern: 'triangle' }).pattern).toBe('off');
    const p = gpParams({ pattern: 'circle', modeFrom: 'manual', symmetry: 'plus', modes: 40, modeN: -3, shake: 99 });
    expect(p).toMatchObject({ pattern: 'circle', modeFrom: 'manual', symmetry: 'plus', modes: 8, modeN: 0, shake: 10 });
    for (const k of ['modeN', 'modeM', 'plateFreq', 'plateWeights', 'settle', 'shake']) expect(GP_SOCKET_FLOATS).toContain(k);
  });

  it('offers three plate presets', () => {
    expect(gpPreset('chladni')).toMatchObject({ pattern: 'square', modeFrom: 'sound', emitter: 'box' });
    expect(gpPreset('singing')).toMatchObject({ pattern: 'circle', emitter: 'disk' });
    expect(gpPreset('cymatics')).toMatchObject({ pattern: 'circle', modes: 5 });
    expect(Object.keys(GP_PRESETS)).toEqual(expect.arrayContaining(['chladni', 'singing', 'cymatics']));
    for (const k of ['pattern', 'modeFrom', 'modes', 'modeN', 'modeM', 'plateFreq', 'plateWeights', 'settle', 'shake', 'symmetry']) {
      expect(GpuParticlesNode.paramDefs![k]?.section).toBe('Pattern');
    }
  });

  it('finds every band of the graph\'s Audio Input, low to high', () => {
    const fs = [
      'uniform float u_audio_audio_1;', 'uniform float u_audio_audio_0;', 'uniform float u_audio_audio_2;', 'uniform float u_audio_other_0;',
      'uniform sampler2D u_gpup_parts; // gpu-particles {"p":{}}',
    ].join('\n');
    const [b] = gpBindings(fs);
    expect(b.audio).toBe('u_audio_audio_1');
    expect(b.audioBands).toEqual(['u_audio_audio_0', 'u_audio_audio_1', 'u_audio_audio_2']);
  });

  it('ships commented examples that compile', () => {
    for (const key of ['particleChladniSand', 'particleStarOutline', 'particleFlowIntoShape', 'particleCymatics3d']) {
      const ex = EXAMPLE_GRAPHS[key];
      expect(ex, key).toBeDefined();
      const r = compileGraph({ nodes: ex.nodes });
      expect(r.errors ?? [], key).toEqual([]);
      for (const n of ex.nodes) if (n.type !== 'output') expect(typeof n.params.__comment === 'string' && n.params.__comment.length > 20, `${key}: ${n.id}`).toBe(true);
      // An expression explains each named line in its comment (// would break the line).
      for (const n of ex.nodes) {
        if (n.type !== 'exprNode') continue;
        for (const l of (n.params.lines as { lhs: string; rhs: string }[])) {
          expect(l.rhs).not.toContain('//');
          expect(n.params.__comment as string, `${key}: ${n.id} ${l.lhs}`).toContain(l.lhs.split(' ').pop()!);
        }
      }
    }
    const sand = compileGraph({ nodes: EXAMPLE_GRAPHS.particleChladniSand.nodes });
    const [b] = gpBindings(sand.fragmentShader!);
    expect(b.params.pattern).toBe('square');
    expect(b.audioBands.length).toBe(6);
  });
});
