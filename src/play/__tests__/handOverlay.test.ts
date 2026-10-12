/**
 * The hands drawn over the picture (kit/hands.js hdDraw, play/handStyle.ts): the drawing's smoothing filter, the
 * finger splines through the joints, the colours from the theme tokens, and a draw of fake landmarks fed through
 * handFeed → the Play engine, as the tracker's are.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HD_APPEAR_FRAMES, HD_CHAINS, HD_DEFAULT_PALETTE, HD_DRAW_EURO, HD_LEGACY_COLOUR, hdDraw, hdEuroStep, hdPalette, hdSmoothPts, hdSpline, hdTipGlow, type HdRgb } from '../kit/hands.js';
import { handPalette, hexRgb, isThemeColour } from '../handStyle';
import { THEMES } from '../../theme/tokens';
import { handFeed } from '../../lib/handFeed';
import { inputBus } from '../../lib/inputBus';
import { playEngine } from '../../lib/playEngine';
import { DEFAULT_HANDS, emptyPlayRecord, type PlayRecord } from '../../types/play';

// ── The drawing's smoothing ──────────────────────────────────────────────────

describe('the drawing’s One-Euro smoothing', () => {
  it('starts on the first value, then follows a step most of the way within a few frames and all the way soon after', () => {
    const f = {};
    expect(hdSmoothPts(f, [0.5], 0)[0]).toBe(0.5);
    let v = 0;
    for (let i = 1; i <= 3; i++) v = hdSmoothPts(f, [0.7], i * 16)[0];
    expect(v).toBeGreaterThan(0.6); // three frames at 60 fps: past half way (low latency)
    expect(v).toBeLessThan(0.7); // but smoothed, not a jump
    for (let i = 4; i <= 30; i++) v = hdSmoothPts(f, [0.7], i * 16)[0];
    expect(v).toBeCloseTo(0.7, 3);
  });

  it('quiets jitter at rest', () => {
    const f = {};
    const out: number[] = [];
    for (let i = 0; i < 120; i++) out.push(hdSmoothPts(f, [0.5 + (i % 2 ? 0.004 : -0.004)], i * 16)[0]);
    const tail = out.slice(60);
    const spread = Math.max(...tail) - Math.min(...tail);
    expect(spread).toBeLessThan(0.008 * 0.5); // the raw swing is 0.008
  });

  it('lags less on a fast move than a fixed cutoff would (the speed raises the cutoff)', () => {
    const fast = {}, fixed = { x: 0, dx: 0, t: -1 };
    let a = 0, b = 0;
    for (let i = 0; i <= 10; i++) {
      const target = i * 0.03; // about 2 picture widths a second
      a = hdSmoothPts(fast, [target], i * 16)[0];
      b = hdEuroStep(fixed, target, i * 16, HD_DRAW_EURO.minCutoff, 0);
    }
    expect(0.3 - a).toBeLessThan(0.3 - b);
    expect(0.3 - a).toBeLessThan(0.03); // under one frame's movement behind
  });

  it('smooths all 63 channels independently', () => {
    const f = {};
    const pts = Float64Array.from({ length: 63 }, (_, i) => i / 63);
    expect([...hdSmoothPts(f, pts, 0)]).toEqual([...pts]);
  });
});

// ── Splines through the joints ───────────────────────────────────────────────

describe('a finger as a Catmull-Rom spline', () => {
  const joints = [[0, 0, 10], [10, -20, 8], [14, -40, 6], [12, -55, 5]];

  it('passes through every joint, n samples apart, and ends on the tip', () => {
    const n = 6;
    const s = hdSpline(joints, n);
    expect(s).toHaveLength((joints.length - 1) * n + 1);
    joints.forEach((j, k) => j.forEach((v, c) => expect(s[k * n][c]).toBeCloseTo(v, 9)));
  });

  it('curves between joints rather than running straight (a bent finger flexes)', () => {
    const s = hdSpline(joints, 6);
    // Halfway through the middle segment: off the straight line between joints 1 and 2
    const m = s[9], a = joints[1], b = joints[2];
    const mx = (a[0] + b[0]) / 2;
    expect(Math.abs(m[0] - mx)).toBeGreaterThan(0.2);
    // The width channel tapers smoothly, staying inside the joints' range
    for (const p of s) { expect(p[2]).toBeLessThanOrEqual(10.0001); expect(p[2]).toBeGreaterThanOrEqual(4.9999); }
  });

  it('is a straight line for joints on a line, and copes with one or two joints', () => {
    const s = hdSpline([[0, 0], [1, 1], [2, 2]], 4);
    for (const p of s) expect(p[0]).toBeCloseTo(p[1], 9);
    expect(hdSpline([[3, 4]], 4)).toEqual([[3, 4]]);
    expect(hdSpline([[0, 0], [4, 0]], 2)).toEqual([[0, 0], [2, 0], [4, 0]]);
  });

  it('covers every landmark once, a finger to a chain', () => {
    expect(HD_CHAINS.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 21 }, (_, i) => i));
  });
});

describe('fingertips light up on a pinch', () => {
  it('from dark when apart to fully lit when touching', () => {
    expect(hdTipGlow(1)).toBe(0);
    expect(hdTipGlow(0.45)).toBe(0);
    expect(hdTipGlow(0.3)).toBeCloseTo(0.5);
    expect(hdTipGlow(0.1)).toBe(1);
  });
});

// ── Colours from the theme ───────────────────────────────────────────────────

describe('the hands’ colours come from the theme tokens', () => {
  it('right hand in the accent, left in the expression violet, per theme', () => {
    for (const mode of ['light', 'dark'] as const) {
      const p = handPalette(mode, DEFAULT_HANDS.colour);
      expect(p.right).toEqual(hexRgb(THEMES[mode].accent.base));
      expect(p.left).toEqual(hexRgb(THEMES[mode].kind.expr));
      expect(p.left).not.toEqual(p.right);
    }
    expect(handPalette('light')).not.toEqual(handPalette('dark'));
  });

  it('a colour the setup picked wins: right takes it, left a lighter shade', () => {
    const c: HdRgb = [1, 0.2, 0.2];
    expect(isThemeColour(c)).toBe(false);
    const p = handPalette('dark', c);
    expect(p.right).toEqual(c);
    expect(p.left[1]).toBeGreaterThan(c[1]);
  });

  it('the exported runtime (no host palette) uses the dark theme pair for the old default colour', () => {
    expect(hdPalette(HD_LEGACY_COLOUR, null)).toBe(HD_DEFAULT_PALETTE);
    expect(HD_DEFAULT_PALETTE.right.map(v => Math.round(v * 255))).toEqual(hexRgb(THEMES.dark.accent.base).map(v => Math.round(v * 255)));
    expect(HD_DEFAULT_PALETTE.left.map(v => Math.round(v * 255))).toEqual(hexRgb(THEMES.dark.kind.expr).map(v => Math.round(v * 255)));
    // The host's palette wins over everything
    const host = handPalette('light');
    expect(hdPalette([1, 0, 0], host)).toBe(host);
  });
});

// ── Drawing fake landmarks fed like the tracker's ─────────────────────────────

const CAM_W = 640, CAM_H = 480, CAM_ASPECT = CAM_W / CAM_H;

/** An open hand facing the camera (x, y in the image, z from the wrist), its thumb `gap` from the index tip. */
function handLm(cx: number, gap?: number): Float32Array {
  const s = 0.4, pts: [number, number, number][] = new Array(21);
  pts[0] = [0, 0.5, 0];
  const mcps: [number, number][] = [[-0.18, 0], [-0.06, -0.02], [0.06, 0], [0.17, 0.04]];
  for (let f = 0; f < 4; f++) {
    const [mx, my] = mcps[f], len = f === 3 ? 0.14 : 0.18, base = 5 + f * 4;
    pts[base] = [mx, my, 0];
    for (let j = 0; j < 3; j++) pts[base + 1 + j] = [mx + 0.01 * (j + 1), my - len * (j + 1), -0.02 * (j + 1)];
  }
  pts[1] = [-0.2, 0.35, 0]; pts[2] = [-0.3, 0.22, 0]; pts[3] = [-0.42, 0.08, 0]; pts[4] = [-0.52, -0.08, 0];
  if (gap != null) { const t = pts[8]; pts[4] = [t[0] - gap, t[1], t[2]]; }
  const out = new Float32Array(63);
  for (let i = 0; i < 21; i++) {
    out[i * 3] = cx + (pts[i][0] * s) / CAM_ASPECT;
    out[i * 3 + 1] = 0.5 + pts[i][1] * s;
    out[i * 3 + 2] = (pts[i][2] * s) / CAM_ASPECT;
  }
  return out;
}

/** A 2D context that records what it was asked to do. */
function recordingCtx() {
  const fills: string[] = [], shadows: number[] = [];
  let fillStyle = '';
  const noop = () => {};
  const ctx = {
    save: noop, restore: noop, setTransform: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    quadraticCurveTo: noop, stroke: noop, fillText: noop,
    fill: () => { fills.push(fillStyle); },
    set fillStyle(v: string) { fillStyle = v; }, get fillStyle() { return fillStyle; },
    set shadowBlur(v: number) { shadows.push(v); }, get shadowBlur() { return 0; },
    globalAlpha: 1, globalCompositeOperation: '', lineJoin: '', lineCap: '', lineWidth: 1, strokeStyle: '', shadowColor: '', font: '', textAlign: '', textBaseline: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, shadows };
}

const rgba = (c: HdRgb) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},`;

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); });

describe('drawing hands fed through handFeed', () => {
  it('draws both hands in their theme colours, with glow, and lights a pinching tip', () => {
    const record: PlayRecord = { ...emptyPlayRecord(), hands: { ...DEFAULT_HANDS, smoothing: 0 },
      mappings: [{ id: 'm', controlId: 'c', source: { kind: 'hand', side: 'right', read: 'open', point: 8, axis: 'x', gesture: 'fist' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }] };
    playEngine.setAspect(16 / 9);
    playEngine.setRecord(record);
    let clock = performance.now();
    for (let i = 0; i < HD_APPEAR_FRAMES + 1; i++) {
      clock += 33;
      handFeed.push({ t: clock, w: CAM_W, h: CAM_H, hands: [{ side: 'right', score: 0.9, lm: handLm(0.3) }, { side: 'left', score: 0.9, lm: handLm(0.7, 0.01) }] });
      inputBus.tick(1 / 60, i / 60);
    }
    const st = playEngine.handState();
    expect(st.live).toBe(true);
    expect(st.left.present && st.right.present).toBe(true);
    const pal = handPalette('light');
    const { ctx, fills, shadows } = recordingCtx();
    hdDraw(ctx, st, 1280, 720, 1, DEFAULT_HANDS.colour, pal);
    expect(fills.some(f => f.startsWith(rgba(pal.right)))).toBe(true);
    expect(fills.some(f => f.startsWith(rgba(pal.left)))).toBe(true);
    // A soft palm, the fingers, joints and tips: several fills per hand
    expect(fills.length).toBeGreaterThanOrEqual(2 * (3 + 5 + 1));
    expect(shadows.some(b => b > 0)).toBe(true);
    // The pinching hand (left: thumb at the index tip) lights a tip white
    expect(fills).toContain('rgba(255,255,255,1)');
  });

  it('draws nothing with no hands live', () => {
    const { ctx, fills } = recordingCtx();
    hdDraw(ctx, { live: false } as never, 100, 100, 1);
    expect(fills).toHaveLength(0);
  });
});
