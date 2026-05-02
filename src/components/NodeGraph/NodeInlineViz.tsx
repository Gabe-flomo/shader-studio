import React, { useRef, useEffect, useCallback } from 'react';
import type { GraphNode, SubgraphData, DataType } from '../../types/nodeGraph';
import { PALETTE_PRESETS } from '../../nodes/definitions/color';
import { scopeValueRegistry, floatValueRegistry, vectorValueRegistry } from '../../lib/scopeRegistry';

// ─── Shared container ─────────────────────────────────────────────────────────

const VIZ_CONTAINER: React.CSSProperties = {
  borderBottom: '1px solid #313244',
  overflow: 'hidden',
};

// ─── Viz 1 — Tone Curve (toneMap) ────────────────────────────────────────────

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const TONE_FNS: Record<string, (x: number) => number> = {
  aces:      x => Math.max(0, Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14))),
  hable:     x => { x *= 16; const A=0.15,B=0.5,C=0.1,D=0.2,E=0.02,F=0.3; return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F; },
  unreal:    x => Math.max(0, Math.min(1, x / (x + 0.155) * 1.019)),
  tanh:      x => Math.tanh(Math.max(-40, Math.min(40, x))),
  reinhard2: x => { const Lw = 4; return (x * (1 + x / (Lw * Lw))) / (1 + x); },
  lottes:    x => {
    if (x <= 0) return 0;
    const a=1.6, d=0.977, hm=8, mi=0.18, mo=0.267;
    const b = (-Math.pow(mi,a) + Math.pow(hm,a)*mo) / ((Math.pow(hm,a) - Math.pow(mi,a)) * mo);
    const c2 = (Math.pow(hm,a*d)*(-Math.pow(mi,a)) + Math.pow(hm,a)*Math.pow(mi,a*d)*mo) /
               ((Math.pow(hm,a*d) - Math.pow(mi,a*d)) * mo);
    return Math.max(0, Math.min(1, Math.pow(x,a) / (Math.pow(x,a*d)*b + c2)));
  },
  uchimura:  x => {
    const P=1, a=1, m=0.22, l=0.4, c=1.33, b=0;
    const l0 = ((P-m)*l)/a, S0 = m+l0, S1 = m+a*l0, C2 = (a*P)/(P-S1), CP = -C2/P;
    const w0 = 1 - smoothstep(0, m, x);
    const w2 = x >= m + l0 ? 1 : 0;
    const w1 = 1 - w0 - w2;
    const T = m * Math.pow(Math.max(x/m, 0.0001), c) + b;
    const S = P - (P-S1) * Math.exp(CP * (x-S0));
    const L = m + a * (x - m);
    return Math.max(0, Math.min(1, T*w0 + L*w1 + S*w2));
  },
  agx: x => {
    x = Math.max(0, x);
    const v = Math.max(0, Math.min(1,
      (Math.log2(Math.max(x * 0.84248, 0.000061)) - Math.log2(0.000061)) /
      (Math.log2(256) - Math.log2(0.000061))
    ));
    return Math.max(0, Math.min(1, v * (v * (v * (1.67 * v - 4) + 4.33))));
  },
};

export function ToneCurveViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mode = (node.params.mode as string) ?? 'aces';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }

    // Identity diagonal
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W * 0.5, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Tone curve — sample input 0→2
    const fn = TONE_FNS[mode] ?? TONE_FNS.aces;
    ctx.strokeStyle = '#a6e3a1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = (i / W) * 2;
      const y = Math.max(0, Math.min(1, fn(x)));
      const py = H - y * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Mode label
    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText(mode, 4, H - 4);
  }, [mode]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={64}
        style={{ display: 'block', width: '100%', height: '64px' }}
      />
    </div>
  );
}

// ─── Viz 2 — Gradient Strip (palette, palettePreset, gradient) ────────────────

function drawCosinePalette(
  ctx: CanvasRenderingContext2D, W: number, H: number,
  offset: number[], amplitude: number[], freq: number[], phase: number[],
) {
  for (let i = 0; i < W; i++) {
    const t = i / W;
    const r = offset[0] + amplitude[0] * Math.cos(6.28318 * (freq[0] * t + phase[0]));
    const g = offset[1] + amplitude[1] * Math.cos(6.28318 * (freq[1] * t + phase[1]));
    const b = offset[2] + amplitude[2] * Math.cos(6.28318 * (freq[2] * t + phase[2]));
    ctx.fillStyle = `rgb(${Math.round(Math.max(0,Math.min(1,r))*255)},${Math.round(Math.max(0,Math.min(1,g))*255)},${Math.round(Math.max(0,Math.min(1,b))*255)})`;
    ctx.fillRect(i, 0, 1, H);
  }
}

export function GradientStripViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    if (node.type === 'gradient') {
      const aV = Array.isArray(node.params.color_a) ? node.params.color_a as number[] : [1,0.2,0.2];
      const bV = Array.isArray(node.params.color_b) ? node.params.color_b as number[] : [0.2,0.2,1];
      const grad = ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, `rgb(${aV.map(c => Math.round(c*255)).join(',')})`);
      grad.addColorStop(1, `rgb(${bV.map(c => Math.round(c*255)).join(',')})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    } else if (node.type === 'palettePreset') {
      const idx = parseInt((node.params.preset as string) ?? '1', 10);
      const preset = PALETTE_PRESETS[Math.min(idx, PALETTE_PRESETS.length - 1)] ?? PALETTE_PRESETS[1];
      drawCosinePalette(ctx, W, H, [...preset.offset], [...preset.amplitude], [...preset.freq], [...preset.phase]);
    } else {
      // palette
      const o  = Array.isArray(node.params.offset)    ? node.params.offset    as number[] : [0.5,0.5,0.5];
      const a  = Array.isArray(node.params.amplitude) ? node.params.amplitude as number[] : [0.5,0.5,0.5];
      const fr = Array.isArray(node.params.freq)      ? node.params.freq      as number[] : [1,1,1];
      const ph = Array.isArray(node.params.phase)     ? node.params.phase     as number[] : [0,0.33,0.67];
      drawCosinePalette(ctx, W, H, o, a, fr, ph);
    }
  }, [node.type, node.params]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={20}
        style={{ display: 'block', width: '100%', height: '20px' }}
      />
    </div>
  );
}

// ─── Viz 3 — Hue Ring (hueRange) ─────────────────────────────────────────────

export function HueRingViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hueCtr = typeof node.params.hue_center === 'number' ? node.params.hue_center : 0;
  const hueW   = typeof node.params.hue_width  === 'number' ? node.params.hue_width  : 0.1;
  const boost  = typeof node.params.boost      === 'number' ? node.params.boost      : 2.0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(cx, cy) - 4;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Draw hue ring (64 segments), dim outside selection
    const SEG = 64;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2 - Math.PI / 2;
      const hue = i / SEG;
      // Is this segment within the selected band?
      const diff = Math.abs(((hue - hueCtr + 1.5) % 1) - 0.5);
      const inBand = diff <= hueW;
      ctx.beginPath();
      ctx.moveTo(cx + (R - 9) * Math.cos(a0), cy + (R - 9) * Math.sin(a0));
      ctx.arc(cx, cy, R, a0, a1);
      ctx.arc(cx, cy, R - 9, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = inBand
        ? `hsl(${Math.round(hue * 360)},85%,58%)`
        : `hsl(${Math.round(hue * 360)},30%,25%)`;
      ctx.fill();
    }

    // White highlight arc for selected range
    const a0sel = (hueCtr - hueW) * Math.PI * 2 - Math.PI / 2;
    const a1sel = (hueCtr + hueW) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx + (R - 9) * Math.cos(a0sel), cy + (R - 9) * Math.sin(a0sel));
    ctx.arc(cx, cy, R, a0sel, a1sel);
    ctx.arc(cx, cy, R - 9, a1sel, a0sel, true);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Center tick at hue_center
    const ca = hueCtr * Math.PI * 2 - Math.PI / 2;
    const dotX = cx + (R - 4.5) * Math.cos(ca);
    const dotY = cy + (R - 4.5) * Math.sin(ca);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }, [hueCtr, hueW]);

  const boostColor = boost > 1.05 ? '#a6e3a1' : boost < 0.95 ? '#f38ba8' : '#6c7086';
  const centerDeg  = Math.round(hueCtr * 360);
  const widthDeg   = Math.round(hueW   * 360);

  return (
    <div style={{ ...VIZ_CONTAINER, display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px 6px 8px' }}>
      <canvas
        ref={canvasRef}
        width={64}
        height={64}
        style={{ flexShrink: 0, width: '64px', height: '64px' }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <div style={{ fontSize: '9px', color: '#6c7086', fontFamily: 'monospace' }}>
          {centerDeg}° ± {widthDeg}°
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
          <span style={{ fontSize: '9px', color: '#6c7086', width: '28px' }}>boost</span>
          <div style={{ flex: 1, height: '5px', background: '#1e1e2e', borderRadius: '3px', position: 'relative' }}>
            {/* Bar from center: right = boost >1, left = boost <1 */}
            <div style={{
              position: 'absolute',
              left:  boost >= 1 ? '50%'                         : `${((boost / 2)) * 100}%`,
              width: boost >= 1 ? `${((boost - 1) / 7) * 50}%` : `${((1 - boost) / 1) * 50}%`,
              height: '100%',
              background: boostColor,
              borderRadius: '3px',
            }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: '#45475a' }} />
          </div>
          <span style={{ fontSize: '9px', color: boostColor, width: '32px', textAlign: 'right', fontFamily: 'monospace' }}>
            ×{boost.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Viz 4 — Step Curve (posterize) ──────────────────────────────────────────

export function StepCurveViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levels = typeof node.params.levels === 'number' ? Math.max(2, Math.round(node.params.levels)) : 8;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
    }

    // Identity diagonal reference
    ctx.strokeStyle = '#313244';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Staircase
    ctx.strokeStyle = '#f9e2af';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const y = Math.floor(x * levels) / Math.max(levels - 1, 1);
      const py = H - Math.min(1, y) * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText(`${levels} levels`, 4, H - 4);
  }, [levels]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={48}
        style={{ display: 'block', width: '100%', height: '48px' }}
      />
    </div>
  );
}

// ─── Viz 5 — Noise Patch (grain, lumaGrain, temporalGrain) ───────────────────

export function NoisePatchViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const amount = typeof node.params.amount === 'number' ? node.params.amount : 0.05;
  const scale  = typeof node.params.scale  === 'number' ? node.params.scale  : 1.0;
  const mode   = (node.params.mode as string) ?? 'basic';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const img = ctx.createImageData(W, H);

    for (let i = 0; i < W * H; i++) {
      // Apply scale: scale > 1 = finer grain, scale < 1 = coarser blobs
      const px = (i % W) * scale;
      const py = Math.floor(i / W) * scale;
      const h = Math.sin(px * 12.9898 + py * 4.1414) * 43758.5453;
      const n = (h - Math.floor(h)) - 0.5;
      // Luma mode: weight noise toward zero (simulates shadow-only grain)
      const w = mode === 'luma' ? 0.4 : 1.0;
      const val = Math.max(0, Math.min(1, 0.5 + n * amount * 2 * w));
      const pv = Math.round(val * 255);
      img.data[i * 4]     = pv;
      img.data[i * 4 + 1] = pv;
      img.data[i * 4 + 2] = pv;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    // Bottom bar — left: amount, right: scale readout
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, H - 12, W, 12);
    ctx.fillStyle = '#a6e3a1';
    ctx.fillRect(0, H - 12, Math.round(Math.min(1, amount / 0.5) * (W * 0.6)), 12);
    ctx.fillStyle = '#6c7086';
    ctx.font = '8px monospace';
    ctx.fillText(`amt ${amount.toFixed(3)}`, 3, H - 2);
    ctx.fillStyle = '#89b4fa';
    ctx.fillText(`×${scale.toFixed(2)}`, W - 36, H - 2);
  }, [amount, scale, mode]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={48}
        style={{ display: 'block', width: '100%', height: '48px', imageRendering: 'pixelated' }}
      />
    </div>
  );
}

// ─── Viz 6 — Desaturate Bar (desaturate) ─────────────────────────────────────

export function DesaturateBarViz({ node }: { node: GraphNode }) {
  const amount = typeof node.params.amount === 'number' ? node.params.amount : 1.0;
  return (
    <div style={{ ...VIZ_CONTAINER, padding: '5px 10px 6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: '9px', color: '#6c7086', width: '28px', flexShrink: 0 }}>desat</span>
      <div style={{ flex: 1, height: '6px', background: '#11111b', borderRadius: '3px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, #89b4fa, #6c7086)', borderRadius: '3px' }} />
        <div style={{
          position: 'absolute', top: 0, left: `${amount * 100}%`, right: 0,
          height: '100%', background: '#11111b', borderRadius: '0 3px 3px 0',
        }} />
      </div>
      <span style={{ fontSize: '9px', color: '#6c7086', width: '28px', textAlign: 'right' }}>
        {Math.round(amount * 100)}%
      </span>
    </div>
  );
}

// ─── Viz N — Audio Freq Range (audioInput) ────────────────────────────────────

export function AudioFreqRangeViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rawBands  = node.params._bands;
  const bands: number[] = Array.isArray(rawBands) ? rawBands as number[] : [200];
  const freqRange = typeof node.params.freq_range === 'number' ? node.params.freq_range : 200;
  const mode      = (node.params.mode as string) ?? 'band';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const toX = (hz: number) =>
      Math.round(((Math.log10(Math.max(20, Math.min(20000, hz))) - logMin) / (logMax - logMin)) * W);

    // Background gradient
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0.0,  '#1a2a3a');
    grad.addColorStop(0.25, '#1a3a2a');
    grad.addColorStop(0.6,  '#2a2a1a');
    grad.addColorStop(1.0,  '#2a1a1a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    if (mode === 'full') {
      // Full spectrum — highlight entire range
      ctx.fillStyle = 'rgba(137, 220, 235, 0.25)';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(137, 220, 235, 0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, W, H);
    } else {
      // Draw each band
      const BAND_COLORS = ['#89dceb', '#a6e3a1', '#fab387', '#f38ba8', '#cba6f7', '#f9e2af'];
      for (let i = 0; i < bands.length; i++) {
        const center = bands[i];
        const lo = Math.max(20, center - freqRange);
        const hi = Math.min(20000, center + freqRange);
        const loX = toX(lo);
        const hiX = toX(hi);
        const col = BAND_COLORS[i % BAND_COLORS.length];

        ctx.fillStyle = `${col}33`; // 20% opacity
        ctx.fillRect(loX, 0, hiX - loX, H);
        ctx.strokeStyle = `${col}bb`;
        ctx.lineWidth = 1;
        ctx.strokeRect(loX, 0.5, hiX - loX, H - 1);

        // Center tick
        const cx = toX(center);
        ctx.strokeStyle = col;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, H - 10);
        ctx.stroke();

        // Label
        ctx.fillStyle = col;
        ctx.font = '8px monospace';
        const label = center >= 1000 ? `${(center/1000).toFixed(1)}k` : `${Math.round(center)}`;
        ctx.fillText(label, Math.min(cx + 2, W - 28), 9 + i * 9);
      }
    }

    // Axis labels
    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    const ticks: [number, string][] = [[100, '100'], [1000, '1k'], [5000, '5k'], [10000, '10k']];
    for (const [hz, lbl] of ticks) {
      const x = toX(hz);
      ctx.fillText(lbl, Math.max(1, x - 5), H - 2);
    }
  }, [bands, freqRange, mode]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={40}
        style={{ display: 'block', width: '100%', height: '40px' }}
      />
    </div>
  );
}

// ─── Viz N — SDF Shape Preview ───────────────────────────────────────────────
// TypeScript port of IQ's 2D SDF library.  Used only for canvas preview.

const _len  = (x: number, y: number) => Math.sqrt(x * x + y * y);
const _dot  = (ax: number, ay: number, bx: number, by: number) => ax * bx + ay * by;
const _clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const _sign  = (x: number) => (x < 0 ? -1 : x > 0 ? 1 : 0);
// (mix available for future use)
// const _mix = (a: number, b: number, t: number) => a + (b - a) * t;

function evalSDF(px: number, py: number, type: string, params: Record<string, unknown>): number {
  const n = (k: string, def: number) => (typeof params[k] === 'number' ? (params[k] as number) : def);

  // ── Legacy nodes ─────────────────────────────────────────────────────────
  if (type === 'circleSDF') {
    const ox = n('posX', 0), oy = n('posY', 0), r = n('radius', 0.3);
    return _len(px - ox, py - oy) - r;
  }
  if (type === 'ringSDF') {
    const ox = n('posX', 0), oy = n('posY', 0), r = n('radius', 0.3);
    return Math.abs(_len(px - ox, py - oy) - r);
  }
  if (type === 'boxSDF') {
    const ox = n('posX', 0), oy = n('posY', 0);
    const bx = n('width', 0.3) / 2, by = n('height', 0.3) / 2;
    const qx = Math.abs(px - ox) - bx, qy = Math.abs(py - oy) - by;
    return _len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  if (type === 'sdBox') {
    const bx = n('rx', 0.3), by = n('ry', 0.3);
    const qx = Math.abs(px) - bx, qy = Math.abs(py) - by;
    return _len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
  }
  if (type === 'sdEllipse') {
    const ab0 = n('rx', 0.3), ab1 = n('ry', 0.2);
    return _len(px / ab0, py / ab1) - 1.0; // approximate but visually correct
  }

  // ── shapeSDF ─────────────────────────────────────────────────────────────
  const shape = (params.shape as string) ?? 'circle';
  const r   = n('r',   0.3);
  const r2  = n('r2',  0.15);
  const rx  = n('rx',  0.3);
  const ry  = n('ry',  0.3);
  const rnd = n('roundness', 0.05);
  const chf = n('chamfer', 0.05);
  const rf  = n('rf',  0.5);
  const th  = n('th',  0.05);
  const nx_ = n('nx',  0.0);
  const ny_ = n('ny',  1.0);
  const cx_ = n('cx',  0.866);
  const cy_ = n('cy',  0.5);
  const he  = n('he',  0.3);
  const sk  = n('sk',  0.2);
  const k   = n('k',   2.0);
  const d_  = n('d',   0.3);
  const tb  = n('tb',  0.5);
  const npts = n('n_pts', 5);
  const mpts = n('m_pts', 2);

  switch (shape) {
    case 'circle': return _len(px, py) - r;

    case 'box': {
      const qx = Math.abs(px) - rx, qy = Math.abs(py) - ry;
      return _len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
    }
    case 'roundedBox': {
      const qx = Math.abs(px) - rx + rnd, qy = Math.abs(py) - ry + rnd;
      return _len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rnd;
    }
    case 'chamferBox': {
      const qx = Math.abs(px) - rx + chf, qy = Math.abs(py) - ry + chf;
      return _len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - chf;
    }
    case 'cross': {
      // union of two rounded rects
      const arm = Math.min(rx, ry) * 0.4;
      const d1x = Math.abs(px) - rx, d1y = Math.abs(py) - arm;
      const d2x = Math.abs(px) - arm, d2y = Math.abs(py) - ry;
      const s1 = _len(Math.max(d1x, 0), Math.max(d1y, 0)) + Math.min(Math.max(d1x, d1y), 0);
      const s2 = _len(Math.max(d2x, 0), Math.max(d2y, 0)) + Math.min(Math.max(d2x, d2y), 0);
      return Math.min(s1, s2) - rnd;
    }
    case 'roundedX': {
      const ax = Math.abs(px), ay = Math.abs(py);
      const qx = (ax + ay - rx) * Math.SQRT1_2;
      const qy = Math.abs(ay - ax) * Math.SQRT1_2 - rx * Math.SQRT1_2;
      return _len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rnd;
    }

    case 'hexagon': {
      const kx = -0.866025, ky = 0.5, kz = 0.577350;
      let qx = Math.abs(px), qy = Math.abs(py);
      const dh = _dot(kx, ky, qx, qy);
      qx -= 2 * Math.min(dh, 0) * kx; qy -= 2 * Math.min(dh, 0) * ky;
      qx -= _clamp(qx, -kz * r, kz * r); qy -= r;
      return _len(qx, qy) * _sign(qy);
    }
    case 'triangle': {
      const k2 = Math.sqrt(3);
      let qx = Math.abs(px) - r, qy = py + r / k2;
      if (qx + k2 * qy > 0) { const nx2 = (qx - k2 * qy) / 2, ny2 = (-k2 * qx - qy) / 2; qx = nx2; qy = ny2; }
      qx -= _clamp(qx, -2 * r, 0);
      return -_len(qx, qy) * _sign(qy);
    }
    case 'isoTriangle': {
      const qx = Math.abs(px), qy = py;
      const qx2 = qx - rx, qy2 = qy + he;
      const dh = Math.max(_dot(rx, -he, qx2, qy2) / (rx * rx + he * he), 0);
      const cx2 = qx - rx * dh, cy2 = qy + he * dh;
      const w = _sign(qy2 * rx - qx2 * (-he));
      return _len(cx2, cy2) * w;
    }
    case 'pentagon': {
      const kx = 0.809016994, ky = 0.587785252, kz = 0.726542528;
      let qx = Math.abs(px), qy = -py;
      const d1 = _dot(-kx, ky, qx, qy);
      qx -= 2 * Math.min(d1, 0) * (-kx); qy -= 2 * Math.min(d1, 0) * ky;
      const d2 = _dot(kx, ky, qx, qy);
      qx -= 2 * Math.min(d2, 0) * kx; qy -= 2 * Math.min(d2, 0) * ky;
      qx -= _clamp(qx, -r * kz, r * kz); qy -= r;
      return _len(qx, qy) * _sign(qy);
    }
    case 'octagon': {
      const kx = -0.9238795, ky = 0.3826834, kz = 0.4142135;
      let qx = Math.abs(px), qy = Math.abs(py);
      const d1 = _dot(kx, ky, qx, qy);
      qx -= 2 * Math.min(d1, 0) * kx; qy -= 2 * Math.min(d1, 0) * ky;
      const d2 = _dot(-kx, ky, qx, qy);
      qx -= 2 * Math.min(d2, 0) * (-kx); qy -= 2 * Math.min(d2, 0) * ky;
      qx -= _clamp(qx, -kz * r, kz * r); qy -= r;
      return _len(qx, qy) * _sign(qy);
    }
    case 'hexagram': {
      const kx = -0.5, ky = 0.8660254, kz = 0.5773502, kw = 1.7320508;
      let qx = Math.abs(px), qy = Math.abs(py);
      const d1 = _dot(kx, ky, qx, qy);
      qx -= 2 * Math.min(d1, 0) * kx; qy -= 2 * Math.min(d1, 0) * ky;
      const d2 = _dot(ky, kx, qx, qy);
      qx -= 2 * Math.min(d2, 0) * ky; qy -= 2 * Math.min(d2, 0) * kx;
      qx -= _clamp(qx, r * kz, r * kw); qy -= r;
      return _len(qx, qy) * _sign(qy);
    }
    case 'pentagram':
    case 'star5': {
      const k1x = 0.809016994375, k1y = -0.587785252190;
      const k2x = -k1x, k2y = k1y;
      let qx = Math.abs(px), qy = py;
      const d1 = _dot(k1x, k1y, qx, qy);
      const m1 = 2 * Math.max(d1, 0);
      qx -= m1 * k1x; qy -= m1 * k1y;
      const d2 = _dot(k2x, k2y, qx, qy);
      const m2 = 2 * Math.max(d2, 0);
      qx -= m2 * k2x; qy -= m2 * k2y;
      qx = Math.abs(qx); qy -= r;
      const bax = rf * (-k1y), bay = rf * k1x - 1;
      const hv = _clamp(_dot(qx, qy, bax, bay) / _dot(bax, bay, bax, bay), 0, r);
      return _len(qx - bax * hv, qy - bay * hv) * _sign(qy * bax - qx * bay);
    }
    case 'starN': {
      const an = Math.PI / npts;
      const bn = Math.atan2(py, px) % (2 * an);
      const bn2 = Math.abs(bn - an);
      const outerR = r, innerR = r * mpts / npts;
      const cp = Math.cos(bn2), sp = Math.sin(bn2);
      const hv = _clamp(_dot(cp, sp, outerR, 0) / outerR, innerR / outerR, 1.0) * outerR;
      return _len(cp * outerR - cp * hv, sp * outerR - sp * hv) * _sign(sp * outerR - sp * hv);
    }
    case 'rhombus': {
      const ax = Math.abs(px), ay = Math.abs(py);
      const h = _clamp((-2 * _dot(rx, ry, ax - rx, ay - ry) + ry * ry - rx * rx) / (rx * rx + ry * ry), -1, 1);
      const fx = ax - rx * (1 - h) * 0.5 - rx * (1 + h) * 0.5;
      const fy = ay - ry * (1 - h) * 0.5 + ry * (1 + h) * 0.5;
      const s = _sign(ax * ry + ay * rx - rx * ry);
      return _len(fx, fy) * s;
    }
    case 'ellipse': return _len(px / rx, py / ry) - 1.0;

    case 'ring': {
      // sdRing2(p, n, r, th)
      const lx = _dot(px, py, ny_, -nx_), ly = _dot(px, py, nx_, ny_);
      return Math.abs(_len(lx - _clamp(lx, -r, r), ly) - r) - th;
    }
    case 'arc': {
      // sdArc(p, c, r, th) — c = [cx_, cy_] = [cos(angle), sin(angle)]
      const qx2 = Math.abs(px), qy2 = py;
      const dt = _dot(qx2, qy2, cx_, cy_) > _dot(cx_, cy_, cx_, cy_) * r
        ? _len(qx2 - cx_ * r, qy2 - cy_ * r)
        : Math.abs(_len(qx2, qy2) - r);
      return dt - th;
    }
    case 'pie': {
      // sdPie(p, c, r) — c=[cos,sin] of half-angle
      const qx2 = Math.abs(px), qy2 = py;
      const l = _len(qx2, qy2) - r;
      const m = _len(qx2 - cx_ * _clamp(_dot(qx2, qy2, cx_, cy_), 0, r), qy2 - cy_ * _clamp(_dot(qx2, qy2, cx_, cy_), 0, r));
      return Math.max(l, m * _sign(cy_ * qx2 - cx_ * qy2));
    }
    case 'segment': {
      // sdSegment from (-0.5,0) to (0.5,0)
      const ax2 = -0.5, ay2 = 0, bx2 = 0.5, by2 = 0;
      const pax = px - ax2, pay = py - ay2;
      const abx = bx2 - ax2, aby = by2 - ay2;
      const hv = _clamp(_dot(pax, pay, abx, aby) / _dot(abx, aby, abx, aby), 0, 1);
      return _len(pax - abx * hv, pay - aby * hv);
    }
    case 'unevenCapsule': {
      // sdUnevenCapsule(p, r1, r2, h)
      const qx2 = Math.abs(px), qy2 = py;
      const b2 = (r - r2) / he;
      const c2 = Math.sqrt(Math.max(1 - b2 * b2, 0));
      const k = _dot(qx2, qy2, -c2, b2);
      if (k < 0) return _len(qx2, qy2) - r;
      if (k > c2 * he) return _len(qx2, qy2 - he) - r2;
      return _dot(qx2, qy2, b2, c2) - r;
    }
    case 'cutDisk': {
      const w = Math.sqrt(Math.max(r * r - he * he, 0));
      const qx2 = Math.abs(px), qy2 = py;
      const s = Math.max((_dot(qy2 - he, qx2, 0, 1) < 0 ? 1 : -1) * (qy2 - he < 0 ? -1 : 1), 1);
      return s * Math.min(_len(qx2, qy2) - r, _len(qx2 - _clamp(qx2, -w, w), qy2 - he));
    }
    case 'moon': {
      const qy2 = py;
      const d1 = _len(px, qy2) - r;
      const d2 = _len(px - d_, qy2) - r2;
      return Math.max(d1, -d2);
    }
    case 'vesica': {
      const d1 = _len(px, Math.abs(py) - he);
      const d2 = _len(px + rx, Math.abs(py));
      return Math.min(d1, d2) - r * 0.5;
    }
    case 'trapezoid': {
      const qx2 = Math.abs(px), qy2 = py;
      const ba2x = r - ry, ba2y = -2 * he;
      const hv = _clamp(_dot(qx2 - ry, qy2 + he, ba2x, ba2y) / _dot(ba2x, ba2y, ba2x, ba2y), 0, 1);
      const dx = qx2 - ry - ba2x * hv, dy = qy2 + he - ba2y * hv;
      return _len(dx, dy) * _sign(Math.max(dx * ba2y - dy * ba2x, qy2 - he));
    }
    case 'parallelogram': {
      const e = sk * he / rx;
      let qx2 = Math.abs(px + py * e) - rx, qy2 = Math.abs(py) - he;
      if (qx2 > 0 && qy2 > 0) return _len(qx2, qy2);
      return Math.max(qx2, qy2);
    }
    case 'parabola': return Math.abs(_len(px, py - 1 / (4 * k)) - py - 1 / (4 * k));
    case 'parabolaSeg': {
      const wi = rx * rx / (2 * he);
      const qx2 = Math.abs(px), qy2 = py - he;
      const s = _sign(qy2 + he);
      return _len(qx2, qy2) * s - wi;
    }
    case 'hyperbola': {
      const qx2 = Math.abs(px), qy2 = Math.abs(py) - k;
      return Math.abs(_len(qx2, qy2 - he) - _len(qx2, qy2 + he)) / 2 - he;
    }
    case 'circleWave': return Math.abs(_len(px, py) - r * (1 + tb * Math.sin(Math.atan2(py, px) * 8)));
    case 'horseshoe': {
      const lx = _dot(px, py, cx_, -cy_), ly = _dot(px, py, cy_, cx_);
      const q1x = Math.abs(lx) - r, q1y = ly;
      const q2x = _len(Math.max(q1x, 0), Math.max(q1y - r * 0.5, 0));
      return q2x - rx;
    }
    case 'tunnel': {
      const qx2 = Math.abs(px) - rx, qy2 = Math.abs(-py - ry);
      if (py > 0) { const qy3 = py - ry; return Math.min(qx2, qy3); }
      return _len(Math.max(qx2, 0), Math.max(qy2, 0)) + Math.min(Math.max(qx2, qy2), 0);
    }
    case 'stairs': {
      const s = npts;
      const sz = (rx + ry) / s;
      const id = Math.floor(_clamp((px - py + sz) / (2 * sz) * s, 0, s - 1));
      const cx2 = px - (id * 2 + 1) * sz / s;
      const cy2 = py - (id * 2 - 1) * sz / s;
      const qx2 = Math.abs(cx2) - sz / s, qy2 = Math.abs(cy2) - sz / s;
      return _len(Math.max(qx2, 0), Math.max(qy2, 0)) + Math.min(Math.max(qx2, qy2), 0);
    }
    case 'heart': {
      const qx2 = Math.abs(px), qy2 = py;
      if ((qy2 + qx2) > 0) return _len(qx2 - 0.25 * r, qy2 - 0.75 * r) - r * 0.354;
      return -(_len(qx2, qy2 + r) / 2 - r * 0.5);
    }
    case 'roundedCross': {
      const s2 = 0.5 - he;
      const qx2 = Math.abs(px), qy2 = Math.abs(py);
      return Math.min(_len(qx2 - s2, qy2 - s2) - he, qy2 < s2 ? qx2 - s2 : (qx2 > 0 ? _len(qx2 - s2, qy2 - s2) - he : qy2 - s2));
    }
    case 'blobbyCross': {
      let qx2 = Math.abs(px), qy2 = Math.abs(py);
      if (qy2 < qx2) { const t = qx2; qx2 = qy2; qy2 = t; }
      const th2 = Math.atan2(qy2, qx2);
      const rr = (0.5 * he + (1 - he) * Math.pow(Math.cos(th2), 2)) * 0.5;
      return _len(qx2, qy2) - rr;
    }
    case 'quadCircle': return _len(Math.abs(px) ** (2/3) + Math.abs(py) ** (2/3), 0) - r;
    case 'coolS': return Math.abs(_len(px, py) - r * 0.5) - r * 0.1; // simplified
    default: return _len(px, py) - r;
  }
}

// Render the SDF to an ImageData
function renderSDF(
  imageData: ImageData,
  type: string,
  params: Record<string, unknown>,
  uvScale = 0.85,
) {
  const W = imageData.width, H = imageData.height;
  const data = imageData.data;
  const aspect = W / H;

  for (let yi = 0; yi < H; yi++) {
    for (let xi = 0; xi < W; xi++) {
      const ux = ((xi + 0.5) / W * 2 - 1) * uvScale;
      // Correct for display aspect ratio so circles render as circles
      const uy = ((1 - (yi + 0.5) / H) * 2 - 1) * uvScale / aspect;
      const d = evalSDF(ux, uy, type, params);

      // Visualization
      const edge    = Math.max(0, 1 - Math.abs(d) / (0.018 * uvScale));
      const fill    = d < 0 ? 0.18 : 0;
      const contour = d > 0 ? Math.max(0, 0.06 * (0.5 + 0.5 * Math.sin(d / uvScale * 28))) : 0;
      const bright  = Math.min(1, edge * 0.85 + fill + contour);

      const idx = (yi * W + xi) * 4;
      // Interior: blue-purple tint; exterior: cooler
      data[idx]     = Math.round((d < 0 ? 0.35 : 0.12) * bright * 255 + (edge > 0.1 ? 210 * edge : 0));
      data[idx + 1] = Math.round((d < 0 ? 0.45 : 0.15) * bright * 255 + (edge > 0.1 ? 220 * edge : 0));
      data[idx + 2] = Math.round((d < 0 ? 0.90 : 0.25) * bright * 255 + (edge > 0.1 ? 240 * edge : 0));
      data[idx + 3] = 255;
    }
  }
}

const SDF_TYPES = new Set(['circleSDF', 'boxSDF', 'ringSDF', 'shapeSDF', 'sdBox', 'sdEllipse']);

export function SdfPreviewViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Re-render whenever any param changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(canvas.width, canvas.height);
    renderSDF(img, node.type, node.params);
    ctx.putImageData(img, 0, 0);
  });

  return (
    <div style={{ ...VIZ_CONTAINER, background: '#0d0d14' }}>
      <canvas
        ref={canvasRef}
        width={160}
        height={160}
        style={{ display: 'block', width: '100%', height: '120px', imageRendering: 'pixelated' }}
      />
    </div>
  );
}

export { SDF_TYPES };

// ─── Viz N+1 — Color Ramp Strip (colorRamp) ───────────────────────────────────

export function ColorRampViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stops = Array.isArray(node.params.stops) ? node.params.stops as { t: number; r: number; g: number; b: number }[] : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    if (stops.length === 0) {
      ctx.fillStyle = '#11111b';
      ctx.fillRect(0, 0, W, H);
      return;
    }

    const sorted = [...stops].sort((a, b) => a.t - b.t);

    for (let i = 0; i < W; i++) {
      const t = i / (W - 1);
      let r = sorted[0].r, g = sorted[0].g, b = sorted[0].b;

      if (sorted.length === 1) {
        r = sorted[0].r; g = sorted[0].g; b = sorted[0].b;
      } else if (t <= sorted[0].t) {
        r = sorted[0].r; g = sorted[0].g; b = sorted[0].b;
      } else if (t >= sorted[sorted.length - 1].t) {
        const last = sorted[sorted.length - 1];
        r = last.r; g = last.g; b = last.b;
      } else {
        for (let s = 0; s < sorted.length - 1; s++) {
          const s0 = sorted[s], s1 = sorted[s + 1];
          if (t >= s0.t && t <= s1.t) {
            const span = s1.t - s0.t;
            const f = span < 1e-6 ? 0 : (t - s0.t) / span;
            r = s0.r + (s1.r - s0.r) * f;
            g = s0.g + (s1.g - s0.g) * f;
            b = s0.b + (s1.b - s0.b) * f;
            break;
          }
        }
      }

      ctx.fillStyle = `rgb(${Math.round(Math.max(0,Math.min(1,r))*255)},${Math.round(Math.max(0,Math.min(1,g))*255)},${Math.round(Math.max(0,Math.min(1,b))*255)})`;
      ctx.fillRect(i, 0, 1, H);
    }
  }, [stops]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={160}
        height={40}
        style={{ display: 'block', width: '100%', height: '32px' }}
      />
    </div>
  );
}

// ─── Viz N+2 — Blackbody Temperature Strip (blackbody) ────────────────────────

function blackbodyJS(k: number): [number, number, number] {
  const r = k < 6600 ? 1.0 : Math.pow(k / 100 - 60, -0.1332) * 1.2926;
  const g = k < 6600
    ? (Math.log(Math.max(k / 100, 1)) * 0.3913 - 0.6319)
    : Math.pow(k / 100 - 60, -0.0755) * 1.1298;
  const b = k >= 6600 ? 1.0 : k < 1900 ? 0.0 : (Math.log(k / 100 - 10) * 0.5433 - 1.9628);
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

export function BlackbodyViz(_props: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    const K_MIN = 1000, K_MAX = 12000;
    for (let i = 0; i < W; i++) {
      const k = K_MIN + (i / (W - 1)) * (K_MAX - K_MIN);
      const [r, g, b] = blackbodyJS(k);
      ctx.fillStyle = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
      ctx.fillRect(i, 0, 1, H);
    }
  }, []);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={160}
        height={32}
        style={{ display: 'block', width: '100%', height: '32px' }}
      />
    </div>
  );
}

// ─── Viz N+3 — Brightness/Contrast Curve (brightnessContrast) ─────────────────

export function BrightnessContrastViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const brightness = typeof node.params.brightness === 'number' ? node.params.brightness : 0;
  const contrast   = typeof node.params.contrast   === 'number' ? node.params.contrast   : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }

    // Identity diagonal (dashed, dim)
    ctx.strokeStyle = '#45475a';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Actual curve: y = (x - 0.5) * contrast + 0.5 + brightness, clamped [0,1]
    ctx.strokeStyle = '#fab387';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const y = Math.max(0, Math.min(1, (x - 0.5) * contrast + 0.5 + brightness));
      const py = H - y * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();
  }, [brightness, contrast]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={80}
        height={80}
        style={{ display: 'block', width: '80px', height: '80px' }}
      />
    </div>
  );
}

// ─── Viz N+4 — Grid Preview (grid) ───────────────────────────────────────────

export function GridViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale     = typeof node.params.scale     === 'number' ? node.params.scale     : 4;
  const lineWidth = typeof node.params.lineWidth === 'number' ? node.params.lineWidth : 0.05;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    const cells = Math.max(1, Math.min(Math.round(scale), 12));
    const cellW = W / cells;
    const cellH = H / cells;
    const lw = Math.max(0.5, lineWidth * cellW);

    // Draw white cell interiors
    ctx.fillStyle = '#2a2a3a';
    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        const x = col * cellW + lw / 2;
        const y = row * cellH + lw / 2;
        const cw = cellW - lw;
        const ch = cellH - lw;
        if (cw > 0 && ch > 0) ctx.fillRect(x, y, cw, ch);
      }
    }

    // Grid lines
    ctx.strokeStyle = '#585b70';
    ctx.lineWidth = lw;
    for (let i = 0; i <= cells; i++) {
      const x = i * cellW;
      const y = i * cellH;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
  }, [scale, lineWidth]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={80}
        height={80}
        style={{ display: 'block', width: '80px', height: '80px', imageRendering: 'pixelated' }}
      />
    </div>
  );
}

// ─── Viz N+5 — Wave Texture Preview (waveTexture) ─────────────────────────────

export function WaveTextureViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mode  = (node.params.mode as string) ?? 'bands';
  const scale = typeof node.params.scale === 'number' ? node.params.scale : 4;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;

    if (mode === 'rings') {
      // Concentric circles
      const cx = W / 2, cy = H / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);
      const step = maxR / (scale * 1.5);
      for (let r = step / 2; r < maxR; r += step) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // Oscillating horizontal lines
      const numLines = Math.max(2, Math.round(scale));
      for (let l = 0; l < numLines; l++) {
        const baseY = ((l + 0.5) / numLines) * H;
        const amp = H / numLines / 2.5;
        ctx.beginPath();
        for (let i = 0; i <= W; i++) {
          const x = i / W;
          let offset = 0;
          if (mode === 'x' || mode === 'bands') {
            offset = Math.sin(x * Math.PI * 2 * scale) * amp;
          } else if (mode === 'y') {
            offset = Math.sin(baseY / H * Math.PI * 2 * scale) * amp;
          } else if (mode === 'diagonal') {
            offset = Math.sin((x + baseY / H) * Math.PI * 2 * scale) * amp;
          }
          const py = baseY + offset;
          i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
        }
        ctx.stroke();
      }
    }
  }, [mode, scale]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={160}
        height={60}
        style={{ display: 'block', width: '100%', height: '60px' }}
      />
    </div>
  );
}

// ─── Math Node Vizzes ─────────────────────────────────────────────────────────

// Shared helper: draw a minimal curve plot
function drawCurveGrid(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#11111b';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
  }
}

// ── Smoothstep ────────────────────────────────────────────────────────────────
export function SmoothstepViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const edge0 = typeof node.params.edge0 === 'number' ? node.params.edge0 : 0.1;
  const edge1 = typeof node.params.edge1 === 'number' ? node.params.edge1 : 0.9;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawCurveGrid(ctx, W, H);

    // Identity line
    ctx.strokeStyle = '#313244';
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Smoothstep curve (X range: -0.1 to 1.1)
    const xLo = -0.1, xHi = 1.1;
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= W; px++) {
      const x = xLo + (px / W) * (xHi - xLo);
      const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(edge1 - edge0, 0.0001)));
      const y = t * t * (3 - 2 * t);
      const py = H - y * H;
      px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Edge markers
    const toScreenX = (v: number) => ((v - xLo) / (xHi - xLo)) * W;
    ctx.strokeStyle = '#585b70';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    [edge0, edge1].forEach(e => {
      const ex = toScreenX(e);
      if (ex >= 0 && ex <= W) {
        ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, H); ctx.stroke();
      }
    });
    ctx.setLineDash([]);

    // Labels
    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    ctx.fillText(`e0=${edge0.toFixed(2)}`, 3, H - 3);
    ctx.fillText(`e1=${edge1.toFixed(2)}`, W - 60, 9);
  }, [edge0, edge1]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={52} style={{ display: 'block', width: '100%', height: '52px' }} />
    </div>
  );
}

// ── Clamp ─────────────────────────────────────────────────────────────────────
export function ClampViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lo = typeof node.params.lo === 'number' ? node.params.lo : 0;
  const hi = typeof node.params.hi === 'number' ? node.params.hi : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawCurveGrid(ctx, W, H);

    // Display range: lo-0.2 to hi+0.2, clamped sensibly
    const margin = Math.max(0.2, (hi - lo) * 0.2);
    const xLo = lo - margin, xHi = hi + margin;
    const yLo = Math.min(lo, lo - margin * 0.5), yHi = Math.max(hi, hi + margin * 0.5);
    const range = Math.max(yHi - yLo, 0.001);
    const toX = (v: number) => ((v - xLo) / (xHi - xLo)) * W;
    const toY = (v: number) => H - ((v - yLo) / range) * H;

    // Identity diagonal (behind)
    ctx.strokeStyle = '#313244';
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(toX(xLo), toY(xLo)); ctx.lineTo(toX(xHi), toY(xHi)); ctx.stroke();
    ctx.setLineDash([]);

    // Clamp curve: flat at lo, ramp, flat at hi
    ctx.strokeStyle = '#a6e3a1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= W; px++) {
      const x = xLo + (px / W) * (xHi - xLo);
      const y = Math.max(lo, Math.min(hi, x));
      const py = toY(y);
      px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Min/max tick lines
    ctx.strokeStyle = '#585b70';
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    const loX = toX(lo), hiX = toX(hi);
    if (loX >= 0 && loX <= W) { ctx.beginPath(); ctx.moveTo(loX, 0); ctx.lineTo(loX, H); ctx.stroke(); }
    if (hiX >= 0 && hiX <= W) { ctx.beginPath(); ctx.moveTo(hiX, 0); ctx.lineTo(hiX, H); ctx.stroke(); }
    ctx.setLineDash([]);

    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    ctx.fillText(`min=${lo.toFixed(2)}`, 3, H - 3);
    ctx.fillText(`max=${hi.toFixed(2)}`, W - 56, 9);
  }, [lo, hi]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={52} style={{ display: 'block', width: '100%', height: '52px' }} />
    </div>
  );
}

// ── Mix (float) ───────────────────────────────────────────────────────────────
export function MixViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t = typeof node.params.t === 'number' ? node.params.t : 0.5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Gradient bar: dark (A) to bright (B)
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#313244');
    grad.addColorStop(1, '#cdd6f4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 4, W, H - 12);

    // Tick line at t
    const tx = t * W;
    ctx.strokeStyle = '#f9e2af';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx, 0); ctx.lineTo(tx, H); ctx.stroke();

    // Output value dot
    const outV = Math.round(t * 255);
    ctx.fillStyle = `rgb(${outV},${outV},${outV})`;
    ctx.beginPath(); ctx.arc(tx, H / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#f9e2af';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    ctx.fillText('A', 4, H - 2);
    ctx.fillText('B', W - 11, H - 2);
    ctx.fillStyle = '#f9e2af';
    ctx.fillText(`t=${t.toFixed(2)}`, tx > W * 0.7 ? tx - 38 : tx + 4, 9);
  }, [t]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={36} style={{ display: 'block', width: '100%', height: '36px' }} />
    </div>
  );
}

// ── Mix Vec3 (color) ───────────────────────────────────────────────────────────
export function MixVec3Viz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fac = typeof node.params.fac === 'number' ? node.params.fac : 0.5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Gradient bar using default A=black(0,0,0), B=white(1,1,1) as placeholders
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#313244');
    grad.addColorStop(1, '#cdd6f4');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 4, W, H - 12);

    // Tick at fac
    const fx = fac * W;
    ctx.strokeStyle = '#cba6f7';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, 0); ctx.lineTo(fx, H); ctx.stroke();

    const outV = Math.round(fac * 255);
    ctx.fillStyle = `rgb(${outV},${outV},${outV})`;
    ctx.beginPath(); ctx.arc(fx, H / 2, 4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#cba6f7';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    ctx.fillText('A', 4, H - 2);
    ctx.fillText('B', W - 11, H - 2);
    ctx.fillStyle = '#cba6f7';
    ctx.fillText(`fac=${fac.toFixed(2)}`, fx > W * 0.7 ? fx - 44 : fx + 4, 9);
  }, [fac]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={36} style={{ display: 'block', width: '100%', height: '36px' }} />
    </div>
  );
}

// ── Map Range ─────────────────────────────────────────────────────────────────
export function MapRangeViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inMin  = typeof node.params.inMin  === 'number' ? node.params.inMin  : 0;
  const inMax  = typeof node.params.inMax  === 'number' ? node.params.inMax  : 1;
  const outMin = typeof node.params.outMin === 'number' ? node.params.outMin : 0;
  const outMax = typeof node.params.outMax === 'number' ? node.params.outMax : 1;
  const smooth = (node.params.smooth as string) === 'smoothstep';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawCurveGrid(ctx, W, H);

    const inRange  = Math.max(inMax  - inMin,  0.0001);
    const outRange = Math.max(outMax - outMin, 0.0001);

    // Display range adds 15% margin each side
    const xMargin = inRange  * 0.2;
    const yMargin = outRange * 0.2;
    const xLo = inMin  - xMargin, xHi = inMax  + xMargin;
    const yLo = Math.min(outMin, outMax) - yMargin;
    const yHi = Math.max(outMin, outMax) + yMargin;
    const ySpan = Math.max(yHi - yLo, 0.001);
    const toY = (v: number) => H - ((v - yLo) / ySpan) * H;

    // Curve
    ctx.strokeStyle = smooth ? '#cba6f7' : '#f9e2af';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= W; px++) {
      const x = xLo + (px / W) * (xHi - xLo);
      let t = Math.max(0, Math.min(1, (x - inMin) / inRange));
      if (smooth) t = t * t * (3 - 2 * t);
      const y = outMin + t * (outMax - outMin);
      const py = toY(y);
      px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // In range markers
    ctx.strokeStyle = '#45475a';
    ctx.setLineDash([2, 2]);
    ctx.lineWidth = 1;
    const toX = (v: number) => ((v - xLo) / (xHi - xLo)) * W;
    [inMin, inMax].forEach(v => {
      const ex = toX(v);
      if (ex >= 0 && ex <= W) { ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, H); ctx.stroke(); }
    });
    ctx.setLineDash([]);

    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    ctx.fillText(`[${inMin.toFixed(1)},${inMax.toFixed(1)}]→[${outMin.toFixed(1)},${outMax.toFixed(1)}]`, 3, H - 3);
  }, [inMin, inMax, outMin, outMax, smooth]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={52} style={{ display: 'block', width: '100%', height: '52px' }} />
    </div>
  );
}

// ─── Viz — Scale Color (multiplyVec3) ─────────────────────────────────────────
export function ScaleColorViz({ node }: { node: GraphNode }) {
  const scale = typeof node.params.scale === 'number' ? node.params.scale : 1.0;
  const MAX = 4;
  const norm = Math.max(0, Math.min(1, scale / MAX));
  const brightness = Math.round(20 + norm * 60);

  return (
    <div style={{ ...VIZ_CONTAINER, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '9px', color: '#6c7086', width: '30px', flexShrink: 0, fontFamily: 'monospace' }}>scale</span>
      <div style={{ flex: 1, height: '8px', background: `linear-gradient(to right, #11111b, hsl(225,40%,${brightness}%))`, borderRadius: '4px', position: 'relative', overflow: 'visible' }}>
        <div style={{
          position: 'absolute',
          top: '-3px',
          left: `${Math.min(100, norm * 100)}%`,
          width: '2px',
          height: '14px',
          background: '#f9e2af',
          borderRadius: '1px',
          transform: 'translateX(-50%)',
        }} />
      </div>
      <span style={{ fontSize: '9px', color: '#f9e2af', width: '36px', textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
        ×{scale.toFixed(2)}
      </span>
    </div>
  );
}

// ─── Viz — Add Colors (addVec3, addColor) ─────────────────────────────────────
export function AddColorsViz({ node }: { node: GraphNode }) {
  const nodeRef   = useRef(node);
  nodeRef.current = node;
  const rafRef    = useRef(0);
  const aRef      = useRef<HTMLDivElement>(null);
  const bRef      = useRef<HTMLDivElement>(null);
  const rRef      = useRef<HTMLDivElement>(null);
  const rLabelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const toRgb = (v: number[]) => {
      const r = Math.round(Math.max(0, Math.min(1, v[0])) * 255);
      const g = Math.round(Math.max(0, Math.min(1, v[1])) * 255);
      const b = Math.round(Math.max(0, Math.min(1, v[2])) * 255);
      return `rgb(${r},${g},${b})`;
    };
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const n = nodeRef.current;
      const aConn = n.inputs.a?.connection;
      const bConn = n.inputs.b?.connection;
      const aVec = aConn ? (vectorValueRegistry.get(`__preview__${aConn.nodeId}:${aConn.outputKey}`) ?? [0,0,0]) : [0,0,0];
      const bVec = bConn ? (vectorValueRegistry.get(`__preview__${bConn.nodeId}:${bConn.outputKey}`) ?? [0,0,0]) : [0,0,0];
      const rVec = [aVec[0]+bVec[0], aVec[1]+bVec[1], aVec[2]+bVec[2]];
      if (aRef.current) aRef.current.style.background = toRgb(aVec);
      if (bRef.current) bRef.current.style.background = toRgb(bVec);
      if (rRef.current) rRef.current.style.background = toRgb(rVec);
      if (rLabelRef.current) rLabelRef.current.textContent =
        `(${rVec[0].toFixed(2)}, ${rVec[1].toFixed(2)}, ${rVec[2].toFixed(2)})`;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const scale = typeof node.params.scale === 'number' ? node.params.scale : null;
  const sw: React.CSSProperties = { width: 22, height: 22, borderRadius: 3, border: '1px solid #45475a', flexShrink: 0, background: '#111' };

  return (
    <div style={{ ...VIZ_CONTAINER, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '5px', fontFamily: 'monospace' }}>
      <div ref={aRef} style={sw} />
      <span style={{ fontSize: '9px', color: '#585b70' }}>A</span>
      <span style={{ fontSize: '12px', color: '#6c7086' }}>+</span>
      <div ref={bRef} style={sw} />
      <span style={{ fontSize: '9px', color: '#585b70' }}>B</span>
      {scale !== null && <span style={{ fontSize: '9px', color: '#f9e2af' }}>×{scale.toFixed(2)}</span>}
      <span style={{ fontSize: '12px', color: '#6c7086' }}>=</span>
      <div ref={rRef} style={sw} />
      <span ref={rLabelRef} style={{ fontSize: '9px', color: '#6c7086', marginLeft: 2 }} />
    </div>
  );
}

// ─── Viz — Particle Emitter ───────────────────────────────────────────────────

export function ParticleEmitterViz({ node }: { node: GraphNode }) {
  const count    = Number(node.params.max_particles ?? 50);
  const lifetime = Number(node.params.lifetime ?? 2.0);
  const angleDir = Number(node.params.angle_dir ?? 90);
  const spread   = Number(node.params.angle_spread ?? 1.0);
  const flowMode = (node.params.flow_mode as string) ?? 'linear';
  const rate     = Math.round(count / Math.max(0.1, lifetime));

  // Simple hash for dot placement (JS-side, deterministic)
  const jHash = (n: number, s: number) => {
    const x = Math.abs(Math.sin(n * 127.1 + s * 311.7)) * 43758.5453;
    return x - Math.floor(x);
  };

  const cx = 24, cy = 28;
  const dots = Array.from({ length: 12 }, (_, i) => {
    if (flowMode === 'noise') {
      // Curving trails — dots scattered in swirling pattern
      const angle = jHash(i * 0.17, 1) * Math.PI * 2;
      const r     = 4 + jHash(i * 0.37, 2) * 18;
      const curl  = angle + r * 0.08;
      return {
        x: cx + Math.cos(curl) * r * 0.7,
        y: cy + Math.sin(curl) * r * 0.5,
        alpha: 0.35 + jHash(i, 3) * 0.65,
        size: 1.5 + jHash(i * 0.5, 4) * 2,
      };
    } else if (flowMode === 'gravity') {
      // Distributed across canvas, pulled toward center
      return {
        x: jHash(i * 0.17, 1) * 48,
        y: jHash(i * 0.23, 1) * 48,
        alpha: 0.35 + jHash(i, 2) * 0.65,
        size: 1.5 + jHash(i * 0.5, 3) * 2,
      };
    } else {
      // linear: fan out from center based on angle/spread
      const base = (angleDir * Math.PI / 180);
      const rand = jHash(i * 0.31, 0) * Math.PI * 2;
      const a    = rand + (base - rand) * (1 - spread);
      const d    = 4 + (i / 11) * 18;
      return {
        x: cx + Math.cos(a) * d,
        y: cy - Math.sin(a) * d, // flip for screen coords
        alpha: 0.3 + (1 - i / 11) * 0.7,
        size: 1.5 + (1 - i / 11) * 2,
      };
    }
  });

  const modeLabel = flowMode === 'noise' ? 'noise flow' : flowMode === 'gravity' ? 'gravity field' : `${count} pts • ${lifetime.toFixed(1)}s`;

  return (
    <div style={{ ...VIZ_CONTAINER, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <svg width={48} height={48} style={{ flexShrink: 0, overflow: 'visible' }}>
        {flowMode === 'linear' && (
          <circle cx={cx} cy={cy} r={3} fill="#cba6f7" opacity={0.9} />
        )}
        {dots.map((d, i) => (
          <circle
            key={i}
            cx={d.x} cy={d.y} r={d.size / 2}
            fill="#cba6f7"
            opacity={d.alpha}
          />
        ))}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: '12px', color: '#cba6f7', fontFamily: 'monospace', fontWeight: 600 }}>
          ~{rate} / sec
        </span>
        <span style={{ fontSize: '9px', color: '#6c7086', lineHeight: 1.3 }}>
          {modeLabel}
        </span>
      </div>
    </div>
  );
}

// ─── Shaper Curve Viz ─────────────────────────────────────────────────────────

function evalShaper(type: string, params: Record<string, unknown>): (x: number) => number {
  const n = (k: string, def: number) => (typeof params[k] === 'number' ? params[k] as number : def);
  let fn: (x: number) => number;
  switch (type) {
    case 'expEase': {
      const a = Math.max(1e-5, Math.min(0.99999, n('a', 0.5)));
      fn = x => a < 0.5 ? Math.pow(Math.max(0, x), 2 * a) : Math.pow(Math.max(0, x), 1 / (1 - 2 * (a - 0.5)));
      break;
    }
    case 'doubleExpSeat': {
      const a = Math.max(1e-5, Math.min(0.99999, n('a', 0.5)));
      fn = x => x <= 0.5 ? Math.pow(2 * x, 1 - a) / 2 : 1 - Math.pow(2 * (1 - x), 1 - a) / 2;
      break;
    }
    case 'doubleExpSigmoid': {
      const a = 1 - Math.max(1e-5, Math.min(0.99999, n('a', 0.5)));
      fn = x => x <= 0.5 ? Math.pow(2 * x, 1 / a) / 2 : 1 - Math.pow(2 * (1 - x), 1 / a) / 2;
      break;
    }
    case 'logisticSigmoid': {
      const ac = Math.max(1e-4, Math.min(0.9999, n('a', 0.7)));
      const k = 1 / (1 - ac) - 1;
      const B = 1 / (1 + Math.exp(k)), C = 1 / (1 + Math.exp(-k));
      fn = x => Math.max(0, Math.min(1, (1 / (1 + Math.exp(-(x - 0.5) * k * 2)) - B) / (C - B)));
      break;
    }
    case 'circularEaseIn':
      fn = x => 1 - Math.sqrt(Math.max(0, 1 - x * x));
      break;
    case 'circularEaseOut':
      fn = x => Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x)));
      break;
    case 'doubleCircleSeat': {
      const a = Math.max(0, Math.min(1, n('a', 0.5)));
      fn = x => x <= a
        ? Math.sqrt(Math.max(0, a * a - (x - a) * (x - a)))
        : 1 - Math.sqrt(Math.max(0, (1-a)*(1-a) - (x - a)*(x - a)));
      break;
    }
    case 'doubleCircleSigmoid': {
      const a = Math.max(0, Math.min(1, n('a', 0.5)));
      fn = x => x <= a
        ? a - Math.sqrt(Math.max(0, a * a - x * x))
        : a + Math.sqrt(Math.max(0, (1-a)*(1-a) - (x-1)*(x-1)));
      break;
    }
    case 'doubleEllipticSigmoid': {
      const a = Math.max(1e-5, Math.min(0.99999, n('a', 0.5)));
      const b = Math.max(0, Math.min(1, n('b', 0.5)));
      fn = x => x <= a
        ? b * (1 - Math.sqrt(Math.max(0, a*a - x*x)) / a)
        : b + (1 - b) / (1 - a) * Math.sqrt(Math.max(0, (1-a)*(1-a) - (x-1)*(x-1)));
      break;
    }
    case 'quadBezierShaper': {
      const a = Math.max(0, Math.min(1, n('a', 0.5)));
      const b = Math.max(0, Math.min(1, n('b', 0.5)));
      fn = x => {
        let ac = a; if (Math.abs(ac - 0.5) < 1e-5) ac += 1e-5;
        const om2a = 1 - 2 * ac;
        const t = (Math.sqrt(Math.max(0, ac*ac + om2a*x)) - ac) / om2a;
        return Math.max(0, Math.min(1, (1 - 2*b)*t*t + 2*b*t));
      };
      break;
    }
    case 'cubicBezierShaper': {
      const x1 = n('a', 0.25), y1 = n('b', 0.1), x2 = n('c', 0.25), y2 = n('d', 1.0);
      const A=1-3*x2+3*x1, B=3*x2-6*x1, C=3*x1;
      const E=1-3*y2+3*y1, F=3*y2-6*y1, G=3*y1;
      fn = x => {
        let t = x;
        for (let i = 0; i < 6; i++) {
          const cx = A*t*t*t + B*t*t + C*t;
          const sl = 1 / Math.max(1e-6, 3*A*t*t + 2*B*t + C);
          t -= (cx - x) * sl;
          t = Math.max(0, Math.min(1, t));
        }
        return Math.max(0, Math.min(1, E*t*t*t + F*t*t + G*t));
      };
      break;
    }
    default: fn = x => x;
  }
  // Bipolar odd extension: f_bip(x) = sign(x) * f(|x|)
  if (params.bipolar === true) {
    const inner = fn;
    return (x: number) => (x < 0 ? -1 : 1) * inner(Math.abs(x));
  }
  return fn;
}

export function ShaperCurveViz({ node }: { node: GraphNode }) {
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const nodeRef         = useRef(node);
  const rafRef          = useRef<number>(0);
  const showCrosshairRef = useRef(true);  // click canvas to toggle
  nodeRef.current  = node;

  const drawFrame = useCallback((liveY?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const n = nodeRef.current;
    const W = canvas.width, H = canvas.height;

    drawCurveGrid(ctx, W, H);

    // Identity diagonal
    ctx.strokeStyle = '#2a2a3a';
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Control point guides for bezier nodes
    if (n.type === 'quadBezierShaper') {
      const ax = typeof n.params.a === 'number' ? n.params.a : 0.5;
      const ay = typeof n.params.b === 'number' ? n.params.b : 0.5;
      ctx.strokeStyle = '#f38ba840';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(ax*W, H - ay*H); ctx.lineTo(W, 0); ctx.stroke();
      ctx.fillStyle = '#f38ba8';
      ctx.beginPath(); ctx.arc(ax*W, H - ay*H, 3, 0, Math.PI*2); ctx.fill();
    }
    if (n.type === 'cubicBezierShaper') {
      const ax = typeof n.params.a === 'number' ? n.params.a : 0.25;
      const ay = typeof n.params.b === 'number' ? n.params.b : 0.1;
      const bx = typeof n.params.c === 'number' ? n.params.c : 0.25;
      const by = typeof n.params.d === 'number' ? n.params.d : 1.0;
      ctx.strokeStyle = '#f38ba840';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(ax*W, H - ay*H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(W, 0); ctx.lineTo(bx*W, H - by*H); ctx.stroke();
      ctx.fillStyle = '#f38ba8';
      [[ax, ay], [bx, by]].forEach(([px, py]) => {
        ctx.beginPath(); ctx.arc(px*W, H - py*H, 3, 0, Math.PI*2); ctx.fill();
      });
    }

    // Curve
    const fn = evalShaper(n.type, n.params);
    const isBipolar = n.params.bipolar === true;
    // Map pixel x → domain value and domain y → canvas y
    const xFromPx = (px: number) => isBipolar ? (px / W) * 2 - 1 : px / W;
    const yToPy   = (y: number)  => isBipolar ? H / 2 - y * (H / 2) : H - y * H;
    ctx.strokeStyle = '#89b4fa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = 0; px <= W; px++) {
      const y = fn(xFromPx(px));
      px === 0 ? ctx.moveTo(px, yToPy(y)) : ctx.lineTo(px, yToPy(y));
    }
    ctx.stroke();

    // Live position dot — find nearest x on curve to the current y output
    if (liveY !== undefined) {
      let bestX = 0, bestDist = Infinity;
      for (let i = 0; i <= W; i++) {
        const xi = xFromPx(i);
        const d = Math.abs(fn(xi) - liveY);
        if (d < bestDist) { bestDist = d; bestX = xi; }
      }
      // Map bestX back to canvas pixel: inverse of xFromPx
      const dotPx = isBipolar ? (bestX + 1) / 2 * W : bestX * W;
      const dotPy = yToPy(liveY);
      // Crosshair lines (toggleable)
      if (showCrosshairRef.current) {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(dotPx, 0); ctx.lineTo(dotPx, H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, dotPy); ctx.lineTo(W, dotPy); ctx.stroke();
        ctx.setLineDash([]);
      }
      // Dot
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#11111b';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(dotPx, dotPy, 4, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
  }, []); // stable — reads nodeRef.current each call

  // Static draw on mount and param/type changes
  const paramsKey = JSON.stringify(node.params);
  useEffect(() => { drawFrame(); }, [node.type, paramsKey, drawFrame]);

  // rAF loop: keep dot live while the component is mounted
  useEffect(() => {
    const probeKey = `__preview__${node.id}`;
    const loop = () => {
      const rawNorm = scopeValueRegistry.get(probeKey);
      if (rawNorm !== undefined) {
        // Probe range is [-1, 1]: decode y = rawNorm * 2 - 1
        // Don't clamp — bipolar shapers output [-1, 1]
        const liveY = rawNorm * 2 - 1;
        drawFrame(liveY);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id, drawFrame]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={80}
        title="Click to toggle crosshair"
        onClick={() => { showCrosshairRef.current = !showCrosshairRef.current; }}
        style={{ display: 'block', width: '100%', height: '80px', cursor: 'pointer' }}
      />
    </div>
  );
}

// ─── Viz — Subgraph mini-map (group, sceneGroup, marchLoopGroup, spaceWarpGroup) ─

const TYPE_COLORS: Record<DataType, string> = {
  float:       '#ff00aa',
  vec2:        '#00aaff',
  vec3:        '#00ffaa',
  vec4:        '#ffaa00',
  mat2:        '#f5c842',
  mat3:        '#e8a020',
  scene3d:     '#cc88aa',
  spacewarp3d: '#aa88cc',
};

export function SubgraphMiniViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const subgraph = node.params.subgraph as SubgraphData | undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !subgraph) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    const nodes       = subgraph.nodes       ?? [];
    const inputPorts  = subgraph.inputPorts  ?? [];
    const outputPorts = subgraph.outputPorts ?? [];

    if (nodes.length === 0) return;

    const getNodeColor = (n: GraphNode): string => {
      const firstOutput = Object.values(n.outputs)[0];
      return firstOutput ? (TYPE_COLORS[firstOutput.type as DataType] ?? '#6c7086') : '#6c7086';
    };

    // Build edges from input connections
    type Edge = { fromId: string; toId: string };
    const edges: Edge[] = [];
    for (const n of nodes) {
      for (const sock of Object.values(n.inputs)) {
        if (sock.connection) edges.push({ fromId: sock.connection.nodeId, toId: n.id });
      }
    }

    // Use actual node positions from the subgraph, normalized to canvas bounds.
    // Pad left/right to leave room for input/output port markers.
    const PAD_X = 14, PAD_Y = 8;
    const nodePositions = nodes.map(n => n.position);
    const minX = Math.min(...nodePositions.map(p => p.x));
    const maxX = Math.max(...nodePositions.map(p => p.x));
    const minY = Math.min(...nodePositions.map(p => p.y));
    const maxY = Math.max(...nodePositions.map(p => p.y));
    const rangeX = Math.max(1, maxX - minX);
    const rangeY = Math.max(1, maxY - minY);

    const toCanvasX = (wx: number) => PAD_X + ((wx - minX) / rangeX) * (W - PAD_X * 2);
    const toCanvasY = (wy: number) => PAD_Y + ((wy - minY) / rangeY) * (H - PAD_Y * 2);

    const positions = new Map<string, { x: number; y: number }>(
      nodes.map(n => [n.id, { x: toCanvasX(n.position.x), y: toCanvasY(n.position.y) }])
    );

    // Input ports: placed at x=4, y derived from the target node's canvas Y
    const inputPosArr = inputPorts.map(p => {
      const target = positions.get(p.toNodeId);
      return { p, x: 4, y: target?.y ?? H / 2 };
    });

    // Output ports: placed at x=W-4, y derived from the source node's canvas Y
    const outputPosArr = outputPorts.map(p => {
      const source = positions.get(p.fromNodeId);
      return { p, x: W - 4, y: source?.y ?? H / 2 };
    });

    const drawEdge = (x1: number, y1: number, x2: number, y2: number, color: string) => {
      const dx = (x2 - x1) * 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(x1 + dx, y1, x2 - dx, y2, x2, y2);
      ctx.stroke();
    };

    // Internal edges
    for (const e of edges) {
      const from = positions.get(e.fromId);
      const to   = positions.get(e.toId);
      if (from && to) drawEdge(from.x, from.y, to.x, to.y, '#2a2a3e');
    }

    // Group input → internal node edges
    for (const ip of inputPosArr) {
      const target = positions.get(ip.p.toNodeId);
      if (target) drawEdge(ip.x, ip.y, target.x, target.y, (TYPE_COLORS[ip.p.type] ?? '#45475a') + '66');
    }

    // Internal node → group output edges
    for (const op of outputPosArr) {
      const source = positions.get(op.p.fromNodeId);
      if (source) drawEdge(source.x, source.y, op.x, op.y, (TYPE_COLORS[op.p.type] ?? '#45475a') + '66');
    }

    // Internal node dots — circles for regular nodes, diamonds for nested groups
    const DOT_R = 3;
    const GROUP_TYPES = new Set(['group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup']);
    for (const n of nodes) {
      const pos = positions.get(n.id);
      if (!pos) continue;
      const color = getNodeColor(n);
      const isGroup = GROUP_TYPES.has(n.type);
      ctx.fillStyle = color + '30';
      if (isGroup) {
        const s = DOT_R + 2;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - s); ctx.lineTo(pos.x + s, pos.y);
        ctx.lineTo(pos.x, pos.y + s); ctx.lineTo(pos.x - s, pos.y);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = color;
        const r = DOT_R;
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y - r); ctx.lineTo(pos.x + r, pos.y);
        ctx.lineTo(pos.x, pos.y + r); ctx.lineTo(pos.x - r, pos.y);
        ctx.closePath(); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(pos.x, pos.y, DOT_R + 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, DOT_R, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Group input triangles (pointing right)
    for (const ip of inputPosArr) {
      const color = TYPE_COLORS[ip.p.type as DataType] ?? '#6c7086';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ip.x - 4, ip.y - 3); ctx.lineTo(ip.x + 3, ip.y); ctx.lineTo(ip.x - 4, ip.y + 3);
      ctx.closePath(); ctx.fill();
    }

    // Group output squares
    for (const op of outputPosArr) {
      const color = TYPE_COLORS[op.p.type as DataType] ?? '#6c7086';
      ctx.fillStyle = color;
      ctx.fillRect(op.x - 3, op.y - 3, 6, 6);
    }

    // Node count label
    ctx.fillStyle = '#45475a';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${nodes.length}n`, W - 3, H - 3);
    ctx.textAlign = 'left';
  }, [subgraph]);

  if (!subgraph) return null;

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={72}
        style={{ display: 'block', width: '100%', height: '72px' }}
      />
    </div>
  );
}

// ─── Viz — 3D SDF param grid (sphereSDF3D, boxSDF3D, etc.) ───────────────────

const SDF_SKIP_PARAMS = new Set(['_bands', 'mode', 'preset', 'subgraph', 'surfacedParams']);

export function SDF3DParamViz({ node }: { node: GraphNode }) {
  const entries = Object.entries(node.params).filter(([k]) => !SDF_SKIP_PARAMS.has(k));

  const fmtVal = (v: unknown): string => {
    if (Array.isArray(v)) return `[${(v as number[]).map(x => (Math.round(x * 100) / 100).toString()).join(', ')}]`;
    if (typeof v === 'number') return (Math.round(v * 1000) / 1000).toString();
    if (typeof v === 'boolean') return v ? 'on' : 'off';
    return String(v).slice(0, 12);
  };

  if (entries.length === 0) return null;

  return (
    <div style={{
      ...VIZ_CONTAINER,
      padding: '5px 8px 6px',
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '2px 8px',
    }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: '4px', alignItems: 'baseline', minWidth: 0 }}>
          <span style={{ fontSize: '8px', color: '#6c7086', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{k}</span>
          <span style={{ fontSize: '9px', color: '#cdd6f4', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtVal(v)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Viz — Scalar function curves (exp, pow, sqrt, ceil, floor, negate, sign, fract) ─

type ScalarFn = (x: number, params: Record<string, unknown>) => number;

const SCALAR_FNS: Record<string, ScalarFn> = {
  exp:      (x, p) => Math.exp(x * (typeof p.scale === 'number' ? p.scale : 1)),
  pow:      (x, p) => Math.pow(Math.max(0, x), typeof p.exponent === 'number' ? p.exponent : 1.2),
  sqrt:     (x)    => Math.sqrt(Math.max(0, x)),
  ceil:     (x)    => Math.ceil(x * 4) / 4,
  floor:    (x)    => Math.floor(x * 4) / 4,
  negate:   (x)    => -x,
  sign:     (x)    => Math.sign(x),
  fractRaw: (x)    => x - Math.floor(x),
  abs:      (x)    => Math.abs(x),
  mod:      (x, p) => { const period = typeof p.period === 'number' ? p.period : 1; return ((x % period) + period) % period; },
  tanh:     (x)    => Math.tanh(x),
  round:    (x)    => Math.round(x * 4) / 4,
  step:     (x, p) => x >= (typeof p.edge === 'number' ? p.edge : 0) ? 1 : -1,
  atan2:    (x)    => Math.atan2(x, 0.5) / Math.PI,
};

const SCALAR_COLORS: Record<string, string> = {
  exp: '#fab387', pow: '#f9e2af', sqrt: '#a6e3a1',
  ceil: '#89dceb', floor: '#89b4fa', negate: '#f38ba8',
  sign: '#cba6f7', fractRaw: '#f9e2af', mod: '#f9e2af',
  abs: '#a6e3a1',
  tanh: '#cba6f7', round: '#89dceb', step: '#f9e2af', atan2: '#a6e3a1',
};

export function ScalarFnViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fn = SCALAR_FNS[node.type];
  const color = SCALAR_COLORS[node.type] ?? '#cdd6f4';

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !fn) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }
    // Axes
    ctx.strokeStyle = '#45475a';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Sample first pass to find Y range, then auto-scale
    const ys: number[] = [];
    for (let i = 0; i <= W; i++) {
      const x = (i / W) * 2 - 1;
      ys.push(fn(x, node.params));
    }
    const rawMax = Math.max(...ys.map(Math.abs).filter(isFinite));
    const yRange = Math.min(4, Math.max(0.5, rawMax * 1.1));

    const samples: { px: number; py: number }[] = [];
    for (let i = 0; i <= W; i++) {
      const y = ys[i];
      const px = i;
      const py = H / 2 - Math.max(-yRange, Math.min(yRange, y)) / yRange * (H / 2 - 4);
      samples.push({ px, py });
    }

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    samples.forEach(({ px, py }, i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
    ctx.stroke();

    // Label
    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText(node.type, 4, H - 4);
  }, [fn, color, node.type, node.params]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={56}
        style={{ display: 'block', width: '100%', height: '56px' }} />
    </div>
  );
}

// ─── Viz — Arithmetic op display (add, subtract, multiply, divide) ────────────

const OP_SYMBOLS: Record<string, string> = {
  add: '+', subtract: '−', multiply: '×', divide: '÷',
};
const OP_COLORS: Record<string, string> = {
  add: '#a6e3a1', subtract: '#f38ba8', multiply: '#89b4fa', divide: '#f9e2af',
};

export function ArithmeticOpViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const n = nodeRef.current;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    const op    = OP_SYMBOLS[n.type] ?? '?';
    const color = OP_COLORS[n.type]  ?? '#cdd6f4';

    const fmt = (v: number) => {
      const s = (Math.round(v * 1000) / 1000).toString();
      return s.length > 7 ? v.toFixed(3) : s;
    };

    const getScope = (conn: { nodeId: string; outputKey: string }): number | null =>
      floatValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`) ?? null;

    const aConn = n.inputs.a?.connection;
    const bConn = n.inputs.b?.connection;
    const aVal  = aConn ? getScope(aConn) : null;
    const bVal  = bConn ? getScope(bConn) : (typeof n.params.b === 'number' ? n.params.b : null);

    ctx.textBaseline = 'middle';
    const cy = H / 2;
    let x = 12;

    // A
    if (aVal !== null) {
      ctx.font = '12px monospace'; ctx.fillStyle = '#cdd6f4'; ctx.textAlign = 'left';
      const s = fmt(aVal); ctx.fillText(s, x, cy); x += ctx.measureText(s).width + 8;
    } else {
      ctx.font = '11px monospace'; ctx.fillStyle = '#585b70'; ctx.textAlign = 'left';
      ctx.fillText('a', x, cy); x += 16;
    }

    // Op symbol
    ctx.font = '15px monospace'; ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(op, x, cy); x += ctx.measureText(op).width + 8;

    // B
    if (bVal !== null) {
      ctx.font = '12px monospace'; ctx.fillStyle = '#cdd6f4'; ctx.textAlign = 'left';
      ctx.fillText(fmt(bVal), x, cy);
    } else {
      ctx.font = '11px monospace'; ctx.fillStyle = '#585b70'; ctx.textAlign = 'left';
      ctx.fillText('b', x, cy);
    }

    // Result label
    ctx.font = '9px monospace'; ctx.fillStyle = '#45475a'; ctx.textAlign = 'right';
    ctx.fillText('→ result', W - 8, cy);
  }, []);

  useEffect(() => {
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={36}
        style={{ display: 'block', width: '100%', height: '36px' }} />
    </div>
  );
}

// ─── Viz — Vec2 arrow on grid (length, angleToVec2, vec2Angle) ────────────────

function drawGrid2D(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#11111b';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1e1e2e';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
  }
  ctx.strokeStyle = '#313244';
  ctx.setLineDash([2, 2]);
  ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);
}

function drawArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, vx: number, vy: number, color: string, scale = 1) {
  const len = Math.sqrt(vx * vx + vy * vy);
  if (len < 0.001) return;
  const nx = vx / len, ny = vy / len;
  const ex = cx + vx * scale, ey = cy - vy * scale; // flip Y for screen coords
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
  // Arrowhead
  const hs = 5;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - hs * nx + hs * 0.5 * ny, ey + hs * ny + hs * 0.5 * nx);
  ctx.lineTo(ex - hs * nx - hs * 0.5 * ny, ey + hs * ny - hs * 0.5 * nx);
  ctx.closePath(); ctx.fill();
}

export function LengthViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;

  const draw = useCallback((val?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#11111b'; ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const mg = 20;
    const axisW = W - mg * 2;

    // Axis line
    ctx.strokeStyle = '#313244'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mg, cy); ctx.lineTo(W - mg, cy); ctx.stroke();
    // Centre tick
    ctx.beginPath(); ctx.moveTo(cx, cy - 4); ctx.lineTo(cx, cy + 4); ctx.stroke();
    // End ticks
    ctx.beginPath(); ctx.moveTo(mg, cy - 3); ctx.lineTo(mg, cy + 3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W - mg, cy - 3); ctx.lineTo(W - mg, cy + 3); ctx.stroke();

    const v = val ?? 0;
    const range = niceGridScale(Math.max(Math.abs(v) * 1.2, 1));
    const toX = (d: number) => cx + (d / range) * (axisW / 2);

    // Filled bar from 0 → v
    const barX = Math.min(cx, toX(v));
    const barW = Math.abs(toX(v) - cx);
    const isNeg = v < 0;
    ctx.fillStyle = isNeg ? '#f38ba844' : '#00ffaa44';
    ctx.fillRect(barX, cy - 6, barW, 12);

    // Arrow pointing right (+) or left (-)
    const tipX = toX(v);
    ctx.strokeStyle = isNeg ? '#f38ba8' : '#00ffaa'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tipX, cy); ctx.stroke();
    // arrowhead
    const dir = isNeg ? -1 : 1;
    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(tipX - dir * 6, cy - 4);
    ctx.lineTo(tipX - dir * 6, cy + 4);
    ctx.closePath(); ctx.fillStyle = isNeg ? '#f38ba8' : '#00ffaa'; ctx.fill();

    // Scale labels
    ctx.fillStyle = '#45475a'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    ctx.fillText(`-${range}`, mg, cy - 7);
    ctx.fillText(`${range}`, W - mg, cy - 7);
    ctx.fillText('0', cx, cy - 7);

    // Value
    ctx.font = '10px monospace';
    ctx.fillStyle = val !== undefined ? (isNeg ? '#f38ba8' : '#00ffaa') : '#6c7086';
    ctx.textAlign = 'left';
    ctx.fillText(val !== undefined ? `|v| = ${val.toFixed(3)}` : '|v|', 4, H - 4);
    ctx.textAlign = 'left';
  }, []);

  useEffect(() => {
    const loop = () => {
      const decoded = floatValueRegistry.get(`__preview__${nodeRef.current.id}`);
      const raw = decoded !== undefined ? undefined : scopeValueRegistry.get(`__preview__${nodeRef.current.id}`);
      draw(decoded !== undefined ? decoded : raw !== undefined ? raw * 2 - 1 : undefined);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id, draw]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={48}
        style={{ display: 'block', width: '100%', height: '48px' }} />
    </div>
  );
}

// ─── Viz — MakeVec2: dot on adaptive-scale 2D grid ───────────────────────────

function niceGridScale(maxVal: number): number {
  if (maxVal <= 1) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(maxVal)));
  return Math.ceil(maxVal / mag) * mag;
}

export function MakeVec2Viz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;

  const draw = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawGrid2D(ctx, W, H);
    const cx = W / 2, cy = H / 2;
    const margin = 10;
    const axisR = cx - margin;

    const maxVal = Math.max(Math.abs(x), Math.abs(y), 0.001);
    const scale = niceGridScale(maxVal);
    const toSX = (v: number) => cx + (v / scale) * axisR;
    const toSY = (v: number) => cy - (v / scale) * axisR;

    ctx.fillStyle = '#45475a'; ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${scale}`, toSX(scale), cy - 3);
    ctx.fillText(`-${scale}`, toSX(-scale), cy - 3);
    ctx.textAlign = 'left';
    ctx.fillText(`${scale}`, cx + 2, toSY(scale));
    ctx.fillText(`-${scale}`, cx + 2, toSY(-scale));

    const px = toSX(x), py = toSY(y);
    ctx.strokeStyle = '#313244'; ctx.setLineDash([2, 3]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, cy); ctx.lineTo(px, py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, py); ctx.lineTo(px, py); ctx.stroke();
    ctx.setLineDash([]);

    drawArrow(ctx, cx, cy, x / scale, y / scale, '#00aaff', axisR);
    ctx.fillStyle = '#00aaff';
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = '#6c7086'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
    ctx.fillText(`(${x.toFixed(2)}, ${y.toFixed(2)})`, 4, H - 4);
  }, []);

  useEffect(() => {
    const loop = () => {
      const n = nodeRef.current;
      let lx = typeof n.params.x === 'number' ? n.params.x : 0;
      let ly = typeof n.params.y === 'number' ? n.params.y : 0;
      if (n.inputs.x?.connection) {
        const c = n.inputs.x.connection;
        const v = floatValueRegistry.get(`__preview__${c.nodeId}:${c.outputKey}`);
        if (v !== undefined) lx = v;
      }
      if (n.inputs.y?.connection) {
        const c = n.inputs.y.connection;
        const v = floatValueRegistry.get(`__preview__${c.nodeId}:${c.outputKey}`);
        if (v !== undefined) ly = v;
      }
      draw(lx, ly);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id, draw]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={80}
        style={{ display: 'block', width: '100%', height: '80px' }} />
    </div>
  );
}

export function AngleToVec2Viz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angle = typeof node.params.angle === 'number' ? node.params.angle : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawGrid2D(ctx, W, H);
    const cx = W / 2, cy = H / 2;
    const r = Math.min(cx, cy) * 0.75;

    // Draw the angle arc
    ctx.strokeStyle = '#f9e2af44';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.35, 0, -angle, angle < 0); ctx.stroke();

    // Draw the direction arrow
    const vx = Math.cos(angle), vy = Math.sin(angle);
    drawArrow(ctx, cx, cy, vx, vy, '#00ffaa', r);

    // Angle label
    const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360;
    ctx.fillStyle = '#f9e2af';
    ctx.font = '9px monospace';
    ctx.fillText(`${deg.toFixed(0)}°`, 4, H - 4);
    ctx.fillStyle = '#6c7086';
    ctx.textAlign = 'right';
    ctx.fillText(`(${vx.toFixed(2)}, ${vy.toFixed(2)})`, W - 4, H - 4);
    ctx.textAlign = 'left';
  }, [angle]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={64}
        style={{ display: 'block', width: '100%', height: '64px' }} />
    </div>
  );
}

export function Vec2AngleViz({ node: _node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawGrid2D(ctx, W, H);
    const cx = W / 2, cy = H / 2;
    const r = Math.min(cx, cy) * 0.75;

    // Draw a sample arrow (we don't know the live input, show a representative one)
    const angle = Math.PI / 4; // 45° example
    const vx = Math.cos(angle), vy = Math.sin(angle);
    drawArrow(ctx, cx, cy, vx, vy, '#00aaff', r);

    // Angle arc
    ctx.strokeStyle = '#f9e2af88';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.35, 0, -angle, false); ctx.stroke();

    // Labels
    ctx.fillStyle = '#00aaff';
    ctx.font = '9px monospace';
    ctx.fillText('v →', 4, H - 4);
    ctx.fillStyle = '#f9e2af';
    ctx.textAlign = 'right';
    ctx.fillText('atan2(y,x)', W - 4, H - 4);
    ctx.textAlign = 'left';
  }, []);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={64}
        style={{ display: 'block', width: '100%', height: '64px' }} />
    </div>
  );
}

// ─── Viz — Extract X / Extract Y component bracket notation ──────────────────

// ─── Viz — Split Vec (shows all component labels, highlights none) ────────────
export function SplitVecViz({ node }: { node: GraphNode }) {
  const is3 = node.type === 'splitVec3';
  const is4 = node.type === 'splitVec4';
  const comps = is4 ? ['x','y','z','w'] : is3 ? ['x','y','z'] : ['x','y'];
  const colors: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa', w: '#cba6f7' };
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const rafRef  = useRef(0);
  const rowRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const n = nodeRef.current;
      const conn = n.inputs.v?.connection ?? n.inputs.vec?.connection;
      if (!conn) return;
      const vec = vectorValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`);
      comps.forEach((_, i) => {
        const el = rowRefs.current[i];
        if (el) el.textContent = vec ? vec[i]?.toFixed(3) : '—';
      });
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div style={{ ...VIZ_CONTAINER, padding: '4px 12px', fontFamily: 'monospace' }}>
      {comps.map((c, i) => (
        <div key={c} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '1px 0' }}>
          <span style={{ fontSize: '10px', color: colors[c], width: '10px' }}>{c}</span>
          <span ref={el => { rowRefs.current[i] = el; }} style={{ fontSize: '11px', color: '#cdd6f4' }}>—</span>
        </div>
      ))}
    </div>
  );
}

export function ExtractComponentViz({ node }: { node: GraphNode }) {
  const isX = node.type === 'extractX';
  const nodeRef  = useRef(node);
  nodeRef.current = node;
  const rafRef   = useRef(0);
  const valRef   = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const n = nodeRef.current;
      // Own output float value
      const own = floatValueRegistry.get(`__preview__${n.id}`);
      if (valRef.current) valRef.current.textContent = own != null ? own.toFixed(3) : '—';
      // Input vec2 for context
      const conn = n.inputs.v?.connection;
      if (conn && inputRef.current) {
        const vec = vectorValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`);
        if (vec) {
          inputRef.current.textContent = `[${vec[0]?.toFixed(3)}, ${vec[1]?.toFixed(3)}]`;
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div style={{ ...VIZ_CONTAINER, padding: '5px 12px', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: isX ? '#f38ba8' : '#a6e3a1' }}>{isX ? 'x' : 'y'}</span>
        <span ref={valRef} style={{ fontSize: '12px', color: '#cdd6f4', fontWeight: 500 }}>—</span>
        <span ref={inputRef} style={{ fontSize: '9px', color: '#45475a', marginLeft: 'auto' }}></span>
      </div>
    </div>
  );
}

// ─── Viz — Combiner curve (min, max, smoothMin, smoothMax, sdfSubtract …) ────

function _smin(a: number, b: number, k: number) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * h * k / 6;
}
function _smax(a: number, b: number, k: number) { return -_smin(-a, -b, k); }
function _ssub(a: number, b: number, k: number) { return _smax(a, -b, k); }

type CombinerFn = (a: number, b: number, k: number) => number;

const COMBINER_FNS: Record<string, CombinerFn> = {
  smoothMin:         _smin,
  smoothMax:         _smax,
  smoothSubtract:    _ssub,
  sdfSmoothUnion:    _smin,
  sdfSmoothSubtract: _ssub,
  sdfSmoothIntersect:(a, b, k) => _smax(a, b, k),
  min:               (a, b) => Math.min(a, b),
  minMath:           (a, b) => Math.min(a, b),
  max:               (a, b) => Math.max(a, b),
  sdfMax:            (a, b) => Math.max(a, b),
  sdfSubtract:       (a, b) => Math.max(a, -b),
  sdfUnion:          (a, b) => Math.min(a, b),
  sdfIntersect:      (a, b) => Math.max(a, b),
};

const COMBINER_COLORS: Record<string, string> = {
  smoothMin: '#a6e3a1', smoothMax: '#f38ba8', smoothSubtract: '#89b4fa',
  sdfSmoothUnion: '#a6e3a1', sdfSmoothSubtract: '#89b4fa', sdfSmoothIntersect: '#f38ba8',
  min: '#a6e3a1', minMath: '#a6e3a1', max: '#f38ba8',
  sdfMax: '#f38ba8', sdfSubtract: '#89b4fa', sdfUnion: '#a6e3a1', sdfIntersect: '#f38ba8',
};

const SMOOTH_COMBINER_TYPES = new Set([
  'smoothMin','smoothMax','smoothSubtract',
  'sdfSmoothUnion','sdfSmoothSubtract','sdfSmoothIntersect',
]);

export function CombinerCurveViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const k = typeof node.params.smoothness === 'number' ? node.params.smoothness : 0.3;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const fn = COMBINER_FNS[node.type];
    if (!fn) return;

    const color = COMBINER_COLORS[node.type] ?? '#cdd6f4';
    const isSmooth = SMOOTH_COMBINER_TYPES.has(node.type);

    // Fixed B value — for subtract variants, offset so the cutoff is visible
    const isSubtract = node.type.includes('Subtract') || node.type === 'sdfSubtract';
    const fixedB = isSubtract ? -0.25 : 0;

    // World space: a ∈ [-0.85, 0.85], result ∈ same
    const RANGE = 0.82;
    const PAD = 6;
    const usableH = H - PAD * 2;
    const toX = (a: number) => ((a + RANGE) / (2 * RANGE)) * W;
    const toY = (v: number) => PAD + (1 - (v + RANGE) / (2 * RANGE)) * usableH;

    // Sharp reference function for smooth types
    const sharpFn = isSmooth ? (a: number): number => {
      if (node.type.includes('Min') || node.type === 'sdfSmoothUnion') return Math.min(a, fixedB);
      if (node.type.includes('Subtract') || node.type === 'sdfSmoothSubtract') return Math.max(a, -fixedB);
      return Math.max(a, fixedB); // intersect / max
    } : null;

    // Parse color for fills
    const hex = color.replace('#', '');
    const cr = parseInt(hex.slice(0, 2), 16);
    const cg = parseInt(hex.slice(2, 4), 16);
    const cb = parseInt(hex.slice(4, 6), 16);

    // Background
    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Subtle axis grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, toY(0)); ctx.lineTo(W, toY(0)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(toX(0), 0); ctx.lineTo(toX(0), H); ctx.stroke();

    // Input A — diagonal (a=result)
    ctx.strokeStyle = '#2d2f4a';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(toX(-RANGE), toY(-RANGE));
    ctx.lineTo(toX(RANGE), toY(RANGE));
    ctx.stroke();

    // Input B — horizontal at fixedB
    ctx.strokeStyle = '#2d2f4a';
    ctx.beginPath();
    ctx.moveTo(toX(-RANGE), toY(fixedB));
    ctx.lineTo(toX(RANGE), toY(fixedB));
    ctx.stroke();

    // Smooth blend fill zone (between sharp and smooth curves)
    if (isSmooth && sharpFn) {
      ctx.fillStyle = `rgba(${cr},${cg},${cb},0.10)`;
      ctx.beginPath();
      // Forward: smooth result curve
      let first = true;
      for (let px = 0; px <= W; px++) {
        const a = (px / W) * 2 * RANGE - RANGE;
        const v = Math.max(-RANGE, Math.min(RANGE, fn(a, fixedB, k)));
        if (first) { ctx.moveTo(px, toY(v)); first = false; }
        else ctx.lineTo(px, toY(v));
      }
      // Backward: sharp reference curve
      for (let px = W; px >= 0; px--) {
        const a = (px / W) * 2 * RANGE - RANGE;
        const v = Math.max(-RANGE, Math.min(RANGE, sharpFn(a)));
        ctx.lineTo(px, toY(v));
      }
      ctx.closePath();
      ctx.fill();

      // Sharp dashed reference
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.22)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      first = true;
      for (let px = 0; px <= W; px++) {
        const a = (px / W) * 2 * RANGE - RANGE;
        const v = Math.max(-RANGE, Math.min(RANGE, sharpFn(a)));
        if (first) { ctx.moveTo(px, toY(v)); first = false; }
        else ctx.lineTo(px, toY(v));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Result curve (main)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let first = true;
    for (let px = 0; px <= W; px++) {
      const a = (px / W) * 2 * RANGE - RANGE;
      const v = Math.max(-RANGE, Math.min(RANGE, fn(a, fixedB, k)));
      if (first) { ctx.moveTo(px, toY(v)); first = false; }
      else ctx.lineTo(px, toY(v));
    }
    ctx.stroke();

    // Corner labels
    ctx.font = '9px monospace';
    ctx.fillStyle = '#45475a';
    ctx.textAlign = 'left';
    ctx.fillText('A', 3, toY(RANGE * 0.78) - 2);
    ctx.fillText('B', 3, toY(fixedB) - 3);
    if (isSmooth) {
      ctx.textAlign = 'right';
      ctx.fillText(`k=${k.toFixed(2)}`, W - 3, H - 3);
    }
    ctx.textAlign = 'left';
  }, [node.type, k]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={80}
        style={{ display: 'block', width: '100%', height: '80px' }} />
    </div>
  );
}

// ─── Viz — Vec2 vizzes (normalizeVec2, dot, addVec2, multiplyVec2) ────────────

export function NormalizeVec2Viz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;

  const draw = useCallback((vx: number, vy: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawGrid2D(ctx, W, H);
    const cx = W / 2, cy = H / 2;
    const r = Math.min(cx, cy) * 0.72;

    ctx.strokeStyle = '#00aaff44'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();

    const len = Math.sqrt(vx * vx + vy * vy);
    const scale = niceGridScale(Math.max(len, 0.01));
    const pixPerUnit = r / scale;

    // Input arrow (dim)
    ctx.strokeStyle = '#45475a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + vx * pixPerUnit, cy - vy * pixPerUnit); ctx.stroke();

    // Normalized arrow (bright)
    if (len > 0.001) {
      drawArrow(ctx, cx, cy, vx / len, vy / len, '#00aaff', r);
    }

    ctx.fillStyle = '#6c7086'; ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`|v|=${len.toFixed(2)} → unit`, 4, H - 4);
  }, []);

  useEffect(() => {
    const loop = () => {
      const n = nodeRef.current;
      const vc = n.inputs.v?.connection;
      const v = vc
        ? vectorValueRegistry.get(`__preview__${vc.nodeId}:${vc.outputKey}`)
        : undefined;
      draw(v?.[0] ?? 0.8, v?.[1] ?? 0.5);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id, draw]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={68}
        style={{ display: 'block', width: '100%', height: '68px' }} />
    </div>
  );
}

export function DotProductViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;

  const draw = useCallback((aVec: number[], bVec: number[], dotVal?: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    drawGrid2D(ctx, W, H);
    const cx = W / 2, cy = H / 2;

    // Scale so both vectors fit
    const maxComp = Math.max(Math.abs(aVec[0]), Math.abs(aVec[1]), Math.abs(bVec[0]), Math.abs(bVec[1]), 0.01);
    const scale = niceGridScale(maxComp);
    const r = (Math.min(cx, cy) - 6) / scale;

    drawArrow(ctx, cx, cy, aVec[0], aVec[1], '#00aaff', r);
    drawArrow(ctx, cx, cy, bVec[0], bVec[1], '#00ffaa', r);

    ctx.font = '11px monospace'; ctx.textBaseline = 'middle';
    if (dotVal !== undefined) {
      ctx.fillStyle = '#f9e2af'; ctx.textAlign = 'right';
      ctx.fillText(`A·B = ${dotVal.toFixed(3)}`, W - 6, 12);
    } else {
      ctx.fillStyle = '#6c7086'; ctx.textAlign = 'left';
      ctx.fillText('A · B', 6, 12);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }, []);

  useEffect(() => {
    const loop = () => {
      const n = nodeRef.current;
      const ac = n.inputs.a?.connection, bc = n.inputs.b?.connection;
      const aVec = (ac ? vectorValueRegistry.get(`__preview__${ac.nodeId}:${ac.outputKey}`) : undefined) ?? [0.8, 0.5];
      const bVec = (bc ? vectorValueRegistry.get(`__preview__${bc.nodeId}:${bc.outputKey}`) : undefined) ?? [0.5, -0.8];
      const dotVal = floatValueRegistry.get(`__preview__${n.id}`) ?? undefined;
      draw(aVec, bVec, dotVal);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id, draw]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={68}
        style={{ display: 'block', width: '100%', height: '68px' }} />
    </div>
  );
}

export function Vec2OpViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;

  useEffect(() => {
    const loop = () => {
      const n = nodeRef.current;
      const canvas = canvasRef.current;
      if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }
      const W = canvas.width, H = canvas.height;
      const cx = W / 2, cy = H / 2;

      const getVec = (key: string) => {
        const conn = n.inputs[key]?.connection;
        if (conn) return vectorValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`) ?? [0, 0];
        const dv = n.inputs[key]?.defaultValue;
        if (Array.isArray(dv)) return dv as number[];
        // Palette preview fallbacks — show something meaningful
        if (key === 'a') return [0.6, 0.2];
        if (key === 'b') return [0.1, 0.5];
        if (key === 'v') return [0.65, 0.35];
        return [0.5, 0.3];
      };
      const getFloat = (key: string): number => {
        const conn = n.inputs[key]?.connection;
        if (conn) {
          const v = floatValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`);
          if (v !== undefined) return v;
        }
        return typeof n.params[key] === 'number' ? n.params[key] as number : 1;
      };

      drawGrid2D(ctx, W, H);

      if (n.type === 'multiplyVec2') {
        const v = getVec('v'), s = getFloat('scale');
        const out = [v[0] * s, v[1] * s];
        const maxComp = Math.max(Math.abs(v[0]), Math.abs(v[1]), Math.abs(out[0]), Math.abs(out[1]), 0.01);
        const sc = niceGridScale(maxComp), r = (Math.min(cx, cy) - 6) / sc;
        drawArrow(ctx, cx, cy, v[0], v[1], '#585b70', r);
        drawArrow(ctx, cx, cy, out[0], out[1], '#00aaff', r);
        ctx.fillStyle = '#45475a'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
        ctx.fillText(`× ${s.toFixed(2)}`, 4, H - 4);
        ctx.fillStyle = '#6c7086'; ctx.textAlign = 'right';
        ctx.fillText(`(${out[0].toFixed(2)}, ${out[1].toFixed(2)})`, W - 4, H - 4);
      } else {
        // addVec2: triangle viz — B starts from tip of A, result is the diagonal
        const a = getVec('a'), b = getVec('b');
        const out = [a[0] + b[0], a[1] + b[1]];
        const maxComp = Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(b[0]), Math.abs(b[1]), Math.abs(out[0]), Math.abs(out[1]), 0.01);
        const sc = niceGridScale(maxComp), r = (Math.min(cx, cy) - 8) / sc;
        // A from origin (blue)
        drawArrow(ctx, cx, cy, a[0], a[1], '#89b4fa', r);
        // B from tip of A (green) — tail-to-tip chaining
        drawArrow(ctx, cx + a[0] * r, cy - a[1] * r, b[0], b[1], '#a6e3a1', r);
        // Result from origin (white, dashed-style using lighter color)
        drawArrow(ctx, cx, cy, out[0], out[1], '#cdd6f4', r);
        ctx.fillStyle = '#45475a'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
        ctx.fillText('a + b', 4, H - 4);
        ctx.fillStyle = '#6c7086'; ctx.textAlign = 'right';
        ctx.fillText(`(${out[0].toFixed(2)}, ${out[1].toFixed(2)})`, W - 4, H - 4);
      }
      ctx.textAlign = 'left';
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={80}
        style={{ display: 'block', width: '100%', height: '80px' }} />
    </div>
  );
}

// ─── Viz — Matrix × Vector (mat2MulVec, mat3MulVec) ──────────────────────────

export function MatMulVecViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);
  const nodeRef   = useRef(node);
  nodeRef.current = node;
  const isMat3    = node.type === 'mat3MulVec';

  useEffect(() => {
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const n = nodeRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width, H = canvas.height;

      if (!isMat3) {
        // mat2MulVec: same bar layout as mat3 but with x/y only
        ctx.fillStyle = '#11111b'; ctx.fillRect(0, 0, W, H);
        const vecConn = n.inputs.vec?.connection;
        const inVec = vecConn
          ? (vectorValueRegistry.get(`__preview__${vecConn.nodeId}:${vecConn.outputKey}`) ?? [0, 0])
          : [0, 0];
        const outVec = vectorValueRegistry.get(`__preview__${n.id}:output`) ?? null;

        const comps2 = ['x', 'y'];
        const colors2 = ['#f38ba8', '#a6e3a1'];
        const barW2 = W - 70;

        for (let i = 0; i < 2; i++) {
          const rowY = 14 + i * 22;
          const inV = inVec[i] ?? 0;
          const outV = outVec?.[i] ?? null;

          ctx.fillStyle = colors2[i] + '88';
          ctx.font = '9px monospace'; ctx.textAlign = 'left';
          ctx.fillText(comps2[i], 6, rowY + 10);

          const inNorm = Math.max(-1, Math.min(1, inV));
          const bx = 18, bh = 8;
          ctx.fillStyle = '#1e1e2e'; ctx.fillRect(bx, rowY + 2, barW2 / 2 - 2, bh);
          ctx.fillStyle = colors2[i] + '66';
          const fw = Math.abs(inNorm) * (barW2 / 2 - 2) / 2;
          const fx = inNorm >= 0 ? bx + (barW2 / 4 - 1) : bx + (barW2 / 4 - 1) - fw;
          ctx.fillRect(fx, rowY + 2, fw, bh);
          ctx.fillStyle = '#45475a'; ctx.textAlign = 'right';
          ctx.fillText(inV.toFixed(2), bx + barW2 / 2 - 4, rowY + 10);

          if (outV !== null) {
            const bx2 = bx + barW2 / 2 + 4;
            const outNorm = Math.max(-1, Math.min(1, outV));
            ctx.fillStyle = '#1e1e2e'; ctx.fillRect(bx2, rowY + 2, barW2 / 2 - 2, bh);
            ctx.fillStyle = colors2[i];
            const fw2 = Math.abs(outNorm) * (barW2 / 2 - 2) / 2;
            const fx2 = outNorm >= 0 ? bx2 + (barW2 / 4 - 1) : bx2 + (barW2 / 4 - 1) - fw2;
            ctx.fillRect(fx2, rowY + 2, fw2, bh);
            ctx.fillStyle = '#cdd6f4'; ctx.textAlign = 'right';
            ctx.fillText(outV.toFixed(2), bx2 + barW2 / 2 - 4, rowY + 10);
          }
        }

        ctx.fillStyle = '#45475a'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
        ctx.fillText('in', 18, H - 4);
        if (outVec) { ctx.fillStyle = '#6c7086'; ctx.fillText('out', 18 + barW2 / 2 + 4, H - 4); }
      } else {
        // mat3MulVec: show input and output as component bars
        ctx.fillStyle = '#11111b'; ctx.fillRect(0, 0, W, H);
        const vecConn = n.inputs.vec?.connection;
        const inVec  = vecConn
          ? (vectorValueRegistry.get(`__preview__${vecConn.nodeId}:${vecConn.outputKey}`) ?? [0, 0, 0])
          : [0, 0, 0];
        const outVec = vectorValueRegistry.get(`__preview__${n.id}:output`) ?? null;

        const comps = ['x', 'y', 'z'];
        const colors = ['#f38ba8', '#a6e3a1', '#89b4fa'];
        const barW = W - 70;

        for (let i = 0; i < 3; i++) {
          const rowY = 10 + i * 22;
          const inV = inVec[i] ?? 0;
          const outV = outVec?.[i] ?? null;

          ctx.fillStyle = colors[i] + '88';
          ctx.font = '9px monospace'; ctx.textAlign = 'left';
          ctx.fillText(comps[i], 6, rowY + 10);

          // Input bar
          const inNorm = Math.max(-1, Math.min(1, inV));
          const bx = 18, bh = 8;
          ctx.fillStyle = '#1e1e2e'; ctx.fillRect(bx, rowY + 2, barW / 2 - 2, bh);
          ctx.fillStyle = colors[i] + '66';
          const fw = Math.abs(inNorm) * (barW / 2 - 2) / 2;
          const fx = inNorm >= 0 ? bx + (barW / 4 - 1) : bx + (barW / 4 - 1) - fw;
          ctx.fillRect(fx, rowY + 2, fw, bh);
          ctx.fillStyle = '#45475a'; ctx.textAlign = 'right';
          ctx.fillText(inV.toFixed(2), bx + barW / 2 - 4, rowY + 10);

          // Output bar
          if (outV !== null) {
            const bx2 = bx + barW / 2 + 4;
            const outNorm = Math.max(-1, Math.min(1, outV));
            ctx.fillStyle = '#1e1e2e'; ctx.fillRect(bx2, rowY + 2, barW / 2 - 2, bh);
            ctx.fillStyle = colors[i];
            const fw2 = Math.abs(outNorm) * (barW / 2 - 2) / 2;
            const fx2 = outNorm >= 0 ? bx2 + (barW / 4 - 1) : bx2 + (barW / 4 - 1) - fw2;
            ctx.fillRect(fx2, rowY + 2, fw2, bh);
            ctx.fillStyle = '#cdd6f4'; ctx.textAlign = 'right';
            ctx.fillText(outV.toFixed(2), bx2 + barW / 2 - 4, rowY + 10);
          }
        }

        ctx.fillStyle = '#45475a'; ctx.font = '9px monospace'; ctx.textAlign = 'left';
        ctx.fillText('in', 18, H - 4);
        if (outVec) { ctx.fillStyle = '#6c7086'; ctx.fillText('out', 18 + barW / 2 + 4, H - 4); }
        ctx.textAlign = 'left';
      }
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [node.id, isMat3]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={isMat3 ? 84 : 80}
        style={{ display: 'block', width: '100%', height: `${isMat3 ? 84 : 80}px` }} />
    </div>
  );
}

// ─── Viz — Sin/Cos Waveform (sin, cos) ───────────────────────────────────────

export function SinCosWaveViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isCos = node.type === 'cos';
  const freq  = typeof node.params.freq === 'number' ? node.params.freq : 1;
  const amp   = typeof node.params.amp  === 'number' ? node.params.amp  : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
    }

    // Zero line
    ctx.strokeStyle = '#45475a';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);

    // Waveform — fixed display range of 2; wave is proportionally shorter when amp < 2
    const DISP = 2;
    const color = isCos ? '#89b4fa' : '#a6e3a1';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const t = (i / W) * Math.PI * 2 * freq;
      const y = amp * (isCos ? Math.cos(t) : Math.sin(t));
      const py = H / 2 - Math.max(-DISP, Math.min(DISP, y)) / DISP * (H / 2 - 4);
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Phase dot at t=0
    const y0 = amp * (isCos ? 1 : 0);
    const py0 = H / 2 - Math.max(-DISP, Math.min(DISP, y0)) / DISP * (H / 2 - 4);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(2, py0, 3, 0, Math.PI * 2); ctx.fill();

    // Label
    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText(`${isCos ? 'cos' : 'sin'}  freq:${freq.toFixed(2)}  amp:${amp.toFixed(2)}`, 4, H - 4);
  }, [isCos, freq, amp]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={56}
        style={{ display: 'block', width: '100%', height: '56px' }}
      />
    </div>
  );
}

// ─── Viz — Tone Curve Node (toneCurve) ───────────────────────────────────────

export function ToneCurveNodeViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blacks   = typeof node.params.blacks   === 'number' ? node.params.blacks   : 0;
  const whites   = typeof node.params.whites   === 'number' ? node.params.whites   : 1;
  const strength = typeof node.params.strength === 'number' ? node.params.strength : 0.5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }

    // Identity diagonal
    ctx.strokeStyle = '#45475a';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Tone curve: remap [blacks,whites]→[0,1], apply S-curve blended with linear
    const range = Math.max(0.001, whites - blacks);
    ctx.strokeStyle = '#cba6f7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const t = Math.max(0, Math.min(1, (x - blacks) / range));
      const curved = t * t * (3 - 2 * t);
      const y = t + (curved - t) * strength;
      const py = H - Math.max(0, Math.min(1, y)) * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Black/white point markers
    const bx = Math.round(blacks * W);
    const wx = Math.round(whites * W);
    ctx.fillStyle = '#45475a';
    ctx.fillRect(bx - 1, 0, 2, H);
    ctx.fillRect(wx - 1, 0, 2, H);

    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText(`str ${strength.toFixed(2)}`, 4, H - 4);
  }, [blacks, whites, strength]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={64}
        style={{ display: 'block', width: '100%', height: '64px' }}
      />
    </div>
  );
}

// ─── Viz — Shadows / Highlights (shadowsHighlights) ──────────────────────────

export function ShadowsHighlightsViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const shadows    = typeof node.params.shadows    === 'number' ? node.params.shadows    : 0;
  const highlights = typeof node.params.highlights === 'number' ? node.params.highlights : 0;
  const pivot      = typeof node.params.pivot      === 'number' ? node.params.pivot      : 0.5;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }

    // Identity
    ctx.strokeStyle = '#45475a';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    // Transfer curve: luma + shadowMask*shadows + highlightMask*highlights
    const sm = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
    ctx.strokeStyle = '#cba6f7';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const shadowMask    = 1 - sm(x / Math.max(0.001, pivot * 1.5));
      const highlightMask = sm((x - pivot * 0.5) / Math.max(0.001, 1 - pivot * 0.5));
      const y = Math.max(0, Math.min(1, x + shadowMask * shadows + highlightMask * highlights));
      const py = H - y * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Shadow mask (blue tint)
    ctx.strokeStyle = '#89b4fa88';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const t = Math.max(0, Math.min(1, x)); const t2 = t * t * (3 - 2 * t); void t2;
      const y = Math.max(0, Math.min(1, 1 - sm(x / Math.max(0.001, pivot * 1.5))));
      const py = H - y * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Highlight mask (orange tint)
    ctx.strokeStyle = '#fab38788';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= W; i++) {
      const x = i / W;
      const y = sm((x - pivot * 0.5) / Math.max(0.001, 1 - pivot * 0.5));
      const py = H - Math.max(0, Math.min(1, y)) * H;
      i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
    }
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#89b4fa';
    ctx.font = '9px monospace';
    ctx.fillText(`shd ${shadows > 0 ? '+' : ''}${shadows.toFixed(2)}`, 4, H - 4);
    ctx.fillStyle = '#fab387';
    ctx.fillText(`hi ${highlights > 0 ? '+' : ''}${highlights.toFixed(2)}`, W - 70, H - 4);
  }, [shadows, highlights, pivot]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={64}
        style={{ display: 'block', width: '100%', height: '64px' }}
      />
    </div>
  );
}

// ─── Viz — Lift / Gamma / Gain (liftGammaGain) ───────────────────────────────

export function LiftGammaGainViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lift  = Array.isArray(node.params.lift)  ? node.params.lift  as number[] : [0, 0, 0];
  const gamma = Array.isArray(node.params.gamma) ? node.params.gamma as number[] : [1, 1, 1];
  const gain  = Array.isArray(node.params.gain)  ? node.params.gain  as number[] : [1, 1, 1];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }

    ctx.strokeStyle = '#45475a';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);

    const COLORS = ['#f38ba8', '#a6e3a1', '#89b4fa'];
    for (let ch = 0; ch < 3; ch++) {
      const l = lift[ch]  ?? 0;
      const g = Math.max(0.001, gamma[ch] ?? 1);
      const gn = gain[ch] ?? 1;
      ctx.strokeStyle = COLORS[ch];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i <= W; i++) {
        const x = i / W;
        const lifted = Math.max(0, x * gn + l);
        const y = Math.max(0, Math.min(1, Math.pow(lifted, 1 / g)));
        const py = H - y * H;
        i === 0 ? ctx.moveTo(i, py) : ctx.lineTo(i, py);
      }
      ctx.stroke();
    }

    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText('R  G  B', 4, H - 4);
  }, [lift, gamma, gain]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={64}
        style={{ display: 'block', width: '100%', height: '64px' }}
      />
    </div>
  );
}

// ─── Viz — Hue Rotate (hueRotate) ────────────────────────────────────────────

export function HueRotateViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angle = typeof node.params.angle === 'number' ? node.params.angle : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const R = Math.min(cx, cy) - 6;
    const SEG = 72;

    // Hue ring
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / SEG) * Math.PI * 2 - Math.PI / 2;
      const hue = (i / SEG) * 360;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = `hsl(${hue}, 80%, 55%)`;
      ctx.fill();
    }

    // Inner circle (dark)
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#11111b';
    ctx.fill();

    // Arrow at angle (angle in radians, 0=red, clockwise)
    const arrowAngle = angle - Math.PI / 2;
    const ax = cx + Math.cos(arrowAngle) * R * 0.75;
    const ay = cy + Math.sin(arrowAngle) * R * 0.75;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, ay);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(ax, ay, 3, 0, Math.PI * 2); ctx.fill();

    // Angle label
    const deg = ((angle * 180 / Math.PI) % 360 + 360) % 360;
    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${deg.toFixed(0)}°`, cx, cy + 4);
    ctx.textAlign = 'left';
  }, [angle]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={64}
        style={{ display: 'block', width: '100%', height: '64px' }}
      />
    </div>
  );
}

// ─── Viz — Saturation (colorSaturation) ──────────────────────────────────────

export function SaturationViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const amount = typeof node.params.amount === 'number' ? node.params.amount : 1.0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Gradient strip: sample a rainbow desaturated → saturated by `amount`
    const barH = 24;
    const barY = (H - barH) / 2;
    for (let i = 0; i < W; i++) {
      const hue = (i / W) * 360;
      const sat = Math.max(0, Math.min(100, amount * 80));
      ctx.fillStyle = `hsl(${hue}, ${sat}%, 55%)`;
      ctx.fillRect(i, barY, 1, barH);
    }

    // Border
    ctx.strokeStyle = '#313244';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, barY, W, barH);

    // Amount marker line
    const markerX = Math.round(Math.max(0, Math.min(1, amount / 2)) * W);
    ctx.strokeStyle = '#ffffff88';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(markerX, barY - 3); ctx.lineTo(markerX, barY + barH + 3); ctx.stroke();

    // Labels
    ctx.fillStyle = '#6c7086';
    ctx.font = '9px monospace';
    ctx.fillText(`sat ×${amount.toFixed(2)}`, 4, H - 4);
  }, [amount]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={48}
        style={{ display: 'block', width: '100%', height: '48px' }}
      />
    </div>
  );
}

// ─── Viz — Matrix Grid (mat2Construct, mat2Inspect, mat3Construct, mat3Inspect) ─

export function MatrixGridViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeRef   = useRef(node);
  nodeRef.current = node;
  const rafRef    = useRef(0);
  const size      = node.type.startsWith('mat2') ? 2 : 3;
  const isInspect = node.type.endsWith('Inspect');

  useEffect(() => {
    const COL_COLORS = ['#89b4fa', '#a6e3a1', '#fab387'];
    const cellW = 52, cellH = 22;

    const tick = () => {
      rafRef.current = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const W = canvas.width, H = canvas.height;
      const n = nodeRef.current;
      const mode = (n.params.mode as string) ?? 'cols';

      // Collect input/output vectors
      // For construct: read upstream input vec2/vec3 connections
      // For inspect: read own output vec2/vec3 keyed as `__preview__${nodeId}:vec0` etc.
      const vecs: (number[] | null)[] = Array(size).fill(null);
      if (!isInspect) {
        const inputKeys = size === 2 ? ['v0', 'v1'] : ['v0', 'v1', 'v2'];
        for (let i = 0; i < size; i++) {
          const conn = n.inputs[inputKeys[i]]?.connection;
          if (conn) vecs[i] = vectorValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`) ?? null;
        }
      } else {
        const outKeys = size === 2 ? ['vec0', 'vec1'] : ['vec0', 'vec1', 'vec2'];
        for (let i = 0; i < size; i++) {
          vecs[i] = vectorValueRegistry.get(`__preview__${n.id}:${outKeys[i]}`) ?? null;
        }
      }

      ctx.fillStyle = '#11111b';
      ctx.fillRect(0, 0, W, H);

      const totalW = size * cellW;
      const totalH = size * cellH;
      const startX = (W - totalW) / 2;
      const startY = (H - totalH) / 2 + 4;

      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
          const x = startX + col * cellW;
          const y = startY + row * cellH;
          const groupIdx = mode === 'rows' ? row : col;
          const baseColor = COL_COLORS[groupIdx % COL_COLORS.length];

          ctx.fillStyle = `${baseColor}14`;
          ctx.fillRect(x, y, cellW, cellH);
          ctx.strokeStyle = `${baseColor}44`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, cellW - 1, cellH - 1);

          // Value: in GLSL column-major mat2(v0,v1), cell [col][row] = v_col[row]
          let val: number | null = null;
          if (mode === 'cols') {
            val = vecs[col]?.[row] ?? null;
          } else {
            // rows mode: transpose, so displayed [row][col] = v_row[col]
            val = vecs[row]?.[col] ?? null;
          }

          ctx.fillStyle = val !== null ? `${baseColor}ee` : `${baseColor}44`;
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          ctx.fillText(val !== null ? val.toFixed(2) : `[${col}][${row}]`, x + cellW / 2, y + cellH / 2 + 3);
        }
      }
      ctx.textAlign = 'left';

      ctx.fillStyle = '#45475a';
      ctx.font = '9px monospace';
      ctx.fillText(`mat${size}  ${mode}`, 4, H - 4);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [size, isInspect]);

  const H = size === 2 ? 76 : 100;
  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={H}
        style={{ display: 'block', width: '100%', height: `${H}px` }} />
    </div>
  );
}

// ─── Color Swatch Viz (makeVec3 / floatToVec3) ───────────────────────────────

function ColorSwatchViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodeRef = useRef(node);
  nodeRef.current = node;

  useEffect(() => {
    let rafId = 0;

    const draw = () => {
      const canvas = canvasRef.current;
      const n = nodeRef.current;
      if (!canvas) { rafId = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d');
      if (!ctx) { rafId = requestAnimationFrame(draw); return; }

      const W = canvas.width, H = canvas.height;
      const isFloat = n.type === 'floatToVec3';

      let r = 0, g = 0, b = 0;

      if (isFloat) {
        // Single float input → grayscale: read from floatValueRegistry or scopeValueRegistry
        const conn = n.inputs.input?.connection;
        const raw = conn
          ? (floatValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`) ?? 0)
          : (Number(n.params.value) || 0);
        const v = Math.max(0, Math.min(1, raw));
        r = g = b = v;
      } else {
        // makeVec3: r/g/b float inputs
        const connR = n.inputs.r?.connection;
        const connG = n.inputs.g?.connection;
        const connB = n.inputs.b?.connection;
        const readFloat = (conn: { nodeId: string; outputKey: string } | undefined, paramKey: string) => {
          if (conn) {
            const v = floatValueRegistry.get(`__preview__${conn.nodeId}:${conn.outputKey}`);
            if (v !== undefined) return v;
          }
          return Number(n.params[paramKey]) || 0;
        };
        r = Math.max(0, Math.min(1, readFloat(connR, 'r')));
        g = Math.max(0, Math.min(1, readFloat(connG, 'g')));
        b = Math.max(0, Math.min(1, readFloat(connB, 'b')));
      }

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#11111b';
      ctx.fillRect(0, 0, W, H);

      // Color swatch bar
      const swatchH = 28;
      const barY = (H - swatchH) / 2 - 6;
      const rHex = Math.round(r * 255).toString(16).padStart(2, '0');
      const gHex = Math.round(g * 255).toString(16).padStart(2, '0');
      const bHex = Math.round(b * 255).toString(16).padStart(2, '0');
      ctx.fillStyle = `#${rHex}${gHex}${bHex}`;
      ctx.fillRect(8, barY, W - 16, swatchH);
      ctx.strokeStyle = '#313244';
      ctx.lineWidth = 1;
      ctx.strokeRect(8.5, barY + 0.5, W - 17, swatchH - 1);

      // Component labels below
      const labelY = barY + swatchH + 12;
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      if (isFloat) {
        const v = r;
        ctx.fillStyle = '#89b4fa';
        ctx.fillText(`${v.toFixed(3)}  →  (${v.toFixed(2)}, ${v.toFixed(2)}, ${v.toFixed(2)})`, W / 2, labelY);
      } else {
        const labels = [
          { text: `r:${r.toFixed(2)}`, color: '#f38ba8', x: W / 4 },
          { text: `g:${g.toFixed(2)}`, color: '#a6e3a1', x: W / 2 },
          { text: `b:${b.toFixed(2)}`, color: '#89b4fa', x: (3 * W) / 4 },
        ];
        for (const { text, color, x } of labels) {
          ctx.fillStyle = color;
          ctx.fillText(text, x, labelY);
        }
      }

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas
        ref={canvasRef}
        width={240}
        height={64}
        style={{ display: 'block', width: '100%', height: '64px' }}
      />
    </div>
  );
}

// ─── LFO Waveform Viz ─────────────────────────────────────────────────────────

function LFOWaveViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const freq      = typeof node.params.freq      === 'number' ? node.params.freq      : 1.0;
  const phase     = typeof node.params.phase     === 'number' ? node.params.phase     : 0.0;
  const amplitude = typeof node.params.amplitude === 'number' ? node.params.amplitude : 1.0;
  const offset    = typeof node.params.offset    === 'number' ? node.params.offset    : 0.0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const mg = 4;

    ctx.fillStyle = '#11111b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * W / 4, 0); ctx.lineTo(i * W / 4, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * H / 4); ctx.lineTo(W, i * H / 4); ctx.stroke();
    }
    // Zero line
    ctx.strokeStyle = '#313244';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.setLineDash([]);

    const COLORS: Record<string, string> = {
      sineLFO: '#89b4fa', squareLFO: '#cba6f7', sawtoothLFO: '#f9e2af',
      triangleLFO: '#a6e3a1', bpmSync: '#fab387',
    };
    ctx.strokeStyle = COLORS[node.type] ?? '#cdd6f4';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const TWO_PI = 6.2831853;
    // Show 2 cycles
    for (let px = 0; px <= W; px++) {
      const t = (px / W) * 2; // 0..2 cycles
      const phase_t = t * freq * TWO_PI + phase;
      let y = 0;
      if (node.type === 'sineLFO') {
        y = Math.sin(phase_t) * amplitude + offset;
      } else if (node.type === 'squareLFO') {
        y = Math.sign(Math.sin(phase_t)) * amplitude + offset;
      } else if (node.type === 'sawtoothLFO') {
        y = ((t * freq + phase / TWO_PI) % 1 + 1) % 1 * 2 - 1;
        y = y * amplitude + offset;
      } else if (node.type === 'triangleLFO') {
        const ph = ((t * freq + phase / TWO_PI) % 1 + 1) % 1;
        y = (Math.abs(ph * 2 - 1) * 2 - 1) * amplitude + offset;
      } else {
        // bpmSync: 0-1 sawtooth
        y = ((t * freq) % 1 + 1) % 1;
      }
      const yRange = Math.max(Math.abs(amplitude) + Math.abs(offset) + 0.1, 1.1);
      const py = mg + (1 - (y + yRange) / (2 * yRange)) * (H - 2 * mg);
      px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    ctx.fillStyle = '#585b70';
    ctx.font = '8px monospace';
    ctx.fillText(`f=${freq.toFixed(2)} a=${amplitude.toFixed(2)}`, 3, H - 3);
  }, [node.type, freq, phase, amplitude, offset]);

  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={52}
        style={{ display: 'block', width: '100%', height: '52px' }} />
    </div>
  );
}

// ─── UV Gradient Viz (uv, pixelUV) ───────────────────────────────────────────

function UVGradientViz(_props: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        img.data[i]     = Math.round((x / W) * 255);
        img.data[i + 1] = Math.round(((H - 1 - y) / H) * 255);
        img.data[i + 2] = 0;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, H - 13, W, 13);
    ctx.font = '8px monospace';
    ctx.fillStyle = '#f38ba8'; ctx.fillText('U', 4, H - 3);
    ctx.fillStyle = '#a6e3a1'; ctx.fillText('V', 14, H - 3);
  }, []);
  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={48}
        style={{ display: 'block', width: '100%', height: '48px' }} />
    </div>
  );
}

// ─── Time Badge Viz (time) ────────────────────────────────────────────────────

function TimeBadgeViz(_props: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#11111b'; ctx.fillRect(0, 0, W, H);
    // sine preview
    ctx.strokeStyle = '#cba6f7'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const t = x / W;
      const y = H / 2 - Math.sin(t * Math.PI * 4) * (H * 0.3);
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.font = 'bold 10px monospace'; ctx.fillStyle = '#cba6f7';
    ctx.textAlign = 'center';
    ctx.fillText('u_time', W / 2, H - 4);
  }, []);
  return (
    <div style={VIZ_CONTAINER}>
      <canvas ref={canvasRef} width={240} height={44}
        style={{ display: 'block', width: '100%', height: '44px' }} />
    </div>
  );
}

// ─── Mouse Badge Viz (mouse) ──────────────────────────────────────────────────

function MouseBadgeViz(_props: { node: GraphNode }) {
  return (
    <div style={{ ...VIZ_CONTAINER, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '18px', lineHeight: 1 }}>⊕</span>
      <div>
        <div style={{ fontSize: '9px', color: '#6c7086', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mouse position</div>
        <div style={{ fontSize: '9px', color: '#cdd6f4', fontFamily: 'monospace' }}>u_mouse · vec2(0..1)</div>
      </div>
    </div>
  );
}

// ─── Texture Badge Viz (prevFrame, textureInput) ──────────────────────────────

function TextureBadgeViz({ node }: { node: GraphNode }) {
  const isPrev = node.type === 'prevFrame';
  return (
    <div style={{ ...VIZ_CONTAINER, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ fontSize: '18px', lineHeight: 1, color: '#89b4fa' }}>{isPrev ? '⊡' : '⊞'}</span>
      <div>
        <div style={{ fontSize: '9px', color: '#6c7086', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {isPrev ? 'Previous frame' : 'Texture input'}
        </div>
        <div style={{ fontSize: '9px', color: '#cdd6f4', fontFamily: 'monospace' }}>sampler2D</div>
      </div>
    </div>
  );
}

// ─── Vec2 Const Viz ───────────────────────────────────────────────────────────

function Vec2ConstViz({ node }: { node: GraphNode }) {
  const x = typeof node.params.x === 'number' ? node.params.x : 0;
  const y = typeof node.params.y === 'number' ? node.params.y : 0;
  const toBar = (v: number) => Math.max(0, Math.min(1, (v + 1) / 2));
  return (
    <div style={{ ...VIZ_CONTAINER, padding: '5px 10px 6px' }}>
      {([['x', x, '#f38ba8'], ['y', y, '#a6e3a1']] as [string, number, string][]).map(([label, val, col]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
          <span style={{ fontSize: '9px', color: col, fontFamily: 'monospace', width: '8px' }}>{label}</span>
          <div style={{ flex: 1, height: '6px', background: '#1e1e2e', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${toBar(val) * 100}%`, height: '100%', background: col, opacity: 0.7, borderRadius: '3px' }} />
          </div>
          <span style={{ fontSize: '9px', color: '#cdd6f4', fontFamily: 'monospace', width: '40px', textAlign: 'right' }}>{val.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Vec3 Const Viz ───────────────────────────────────────────────────────────

function Vec3ConstViz({ node }: { node: GraphNode }) {
  const x = Math.max(0, Math.min(1, typeof node.params.x === 'number' ? node.params.x : 0));
  const y = Math.max(0, Math.min(1, typeof node.params.y === 'number' ? node.params.y : 0));
  const z = Math.max(0, Math.min(1, typeof node.params.z === 'number' ? node.params.z : 0));
  const hex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return (
    <div style={{ ...VIZ_CONTAINER, padding: '5px 10px 6px' }}>
      <div style={{ height: '20px', background: `#${hex(x)}${hex(y)}${hex(z)}`, borderRadius: '3px', marginBottom: '4px', border: '1px solid #313244' }} />
      {([['x', x, '#f38ba8'], ['y', y, '#a6e3a1'], ['z', z, '#89b4fa']] as [string, number, string][]).map(([label, val, col]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
          <span style={{ fontSize: '9px', color: col, fontFamily: 'monospace', width: '8px' }}>{label}</span>
          <div style={{ flex: 1, height: '5px', background: '#1e1e2e', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ width: `${val * 100}%`, height: '100%', background: col, opacity: 0.7, borderRadius: '3px' }} />
          </div>
          <span style={{ fontSize: '9px', color: '#cdd6f4', fontFamily: 'monospace', width: '40px', textAlign: 'right' }}>{val.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Expr / Custom Fn Badge ───────────────────────────────────────────────────

function ExprBadgeViz({ node }: { node: GraphNode }) {
  const isCustom = node.type === 'customFn';
  const body = typeof node.params.body === 'string' ? node.params.body.trim() : '';
  const label = isCustom
    ? (typeof node.params.label === 'string' ? node.params.label : 'Custom Fn')
    : (typeof node.params.label === 'string' ? node.params.label : 'Expr');
  const snippet = body.split('\n')[0].slice(0, 48) || (isCustom ? 'no body yet' : 'no expression');
  return (
    <div style={{ ...VIZ_CONTAINER, padding: '5px 10px 6px' }}>
      <div style={{ fontSize: '9px', color: '#cba6f7', fontFamily: 'monospace', fontWeight: 700, marginBottom: '2px' }}>
        {isCustom ? 'ƒ' : '∑'} {label}
      </div>
      <div style={{ fontSize: '9px', color: '#6c7086', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {snippet}
      </div>
    </div>
  );
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export function NodeInlineViz({ node }: { node: GraphNode }) {
  switch (node.type) {
    case 'toneMap':        return <ToneCurveViz          node={node} />;
    case 'palette':
    case 'palettePreset':
    case 'gradient':       return <GradientStripViz      node={node} />;
    case 'hueRange':       return <HueRingViz             node={node} />;
    case 'posterize':      return <StepCurveViz           node={node} />;
    case 'grain':
    case 'lumaGrain':
    case 'temporalGrain':  return <NoisePatchViz          node={node} />;
    case 'desaturate':     return <DesaturateBarViz       node={node} />;
    case 'audioInput':     return <AudioFreqRangeViz      node={node} />;
    case 'colorRamp':      return <ColorRampViz           node={node} />;
    case 'blackbody':      return <BlackbodyViz           node={node} />;
    case 'brightnessContrast': return <BrightnessContrastViz node={node} />;
    case 'grid':           return <GridViz                node={node} />;
    case 'waveTexture':    return <WaveTextureViz         node={node} />;
    case 'smoothstep':     return <SmoothstepViz          node={node} />;
    case 'clamp':          return <ClampViz               node={node} />;
    case 'mix':            return <MixViz                 node={node} />;
    case 'mixVec3':        return <MixVec3Viz             node={node} />;
    case 'mapRange':       return <MapRangeViz            node={node} />;
    case 'multiplyVec3':   return <ScaleColorViz          node={node} />;
    case 'addVec3':
    case 'addColor':       return <AddColorsViz           node={node} />;
    case 'particleEmitter': return <ParticleEmitterViz   node={node} />;
    case 'expEase':
    case 'doubleExpSeat':
    case 'doubleExpSigmoid':
    case 'logisticSigmoid':
    case 'circularEaseIn':
    case 'circularEaseOut':
    case 'doubleCircleSeat':
    case 'doubleCircleSigmoid':
    case 'doubleEllipticSigmoid':
    case 'quadBezierShaper':
    case 'cubicBezierShaper':  return <ShaperCurveViz    node={node} />;
    case 'sin':
    case 'cos':            return <SinCosWaveViz          node={node} />;
    case 'sineLFO':
    case 'squareLFO':
    case 'sawtoothLFO':
    case 'triangleLFO':
    case 'bpmSync':        return <LFOWaveViz             node={node} />;
    case 'toneCurve':      return <ToneCurveNodeViz       node={node} />;
    case 'shadowsHighlights': return <ShadowsHighlightsViz node={node} />;
    case 'liftGammaGain':  return <LiftGammaGainViz       node={node} />;
    case 'hueRotate':      return <HueRotateViz           node={node} />;
    case 'colorSaturation': return <SaturationViz         node={node} />;
    case 'mat2Construct':
    case 'mat2Inspect':
    case 'mat3Construct':
    case 'mat3Inspect':    return <MatrixGridViz          node={node} />;
    case 'mat2MulVec':
    case 'mat3MulVec':     return <MatMulVecViz           node={node} />;
    case 'group':
    case 'sceneGroup':
    case 'spaceWarpGroup':
    case 'marchLoopGroup': return <SubgraphMiniViz         node={node} />;
    case 'sphereSDF3D':
    case 'boxSDF3D':
    case 'torusSDF3D':
    case 'capsuleSDF3D':
    case 'cylinderSDF3D':
    case 'coneSDF3D':
    case 'octahedronSDF3D':
    case 'planeSDF3D':
    case 'translate3D':
    case 'rotate3D':
    case 'repeat3D':
    case 'twist3D':
    case 'fold3D':
    // Additional 3D primitives
    case 'roundedBoxSDF3D':
    case 'boxFrameSDF3D':
    case 'ellipsoidSDF3D':
    case 'cappedTorusSDF3D':
    case 'linkSDF3D':
    case 'pyramidSDF3D':
    case 'hexPrismSDF3D':
    case 'triPrismSDF3D':
    case 'cappedConeSDF3D':
    case 'roundedCylinderSDF3D':
    case 'solidAngleSDF3D':
    case 'verticalCapsuleSDF3D':
    // Additional 3D transforms
    case 'scale3d':
    case 'rotateAxis3D':
    case 'sinWarp3D':
    case 'bend3D':
    case 'limitedRepeat3D':
    case 'polarRepeat3D':
    case 'displace3D':
    // 3D boolean ops (param display only)
    case 'sdfRound':
    case 'sdfOnion':
    // Effects / post-process nodes — show params instead of blank preview
    case 'vignette':
    case 'scanlines':
    case 'sobel':
    case 'chromaticAberrationAuto':
    case 'gaussianBlur':
    case 'radialBlur':
    case 'tiltShiftBlur':
    case 'lensBlur':
    case 'depthOfField':
    case 'motionBlur':
    case 'chromaShift':
    case 'gravitationalLens':
    case 'floatWarp':        return <SDF3DParamViz           node={node} />;
    // Scalar function curves
    case 'exp':
    case 'pow':
    case 'sqrt':
    case 'ceil':
    case 'floor':
    case 'negate':
    case 'sign':
    case 'fractRaw':
    case 'abs':
    case 'mod':
    case 'tanh':
    case 'round':
    case 'step':
    case 'atan2':            return <ScalarFnViz             node={node} />;
    // Float arithmetic
    case 'multiply':
    case 'add':
    case 'subtract':
    case 'divide':           return <ArithmeticOpViz         node={node} />;
    // Range mapping
    case 'remap':            return <MapRangeViz             node={node} />;
    // Color combiners
    case 'combineRGB':       return <ColorSwatchViz          node={node} />;
    case 'blend':
    case 'screenBlend':      return <AddColorsViz            node={node} />;
    // Param display
    case 'constant':
    case 'weightedAverage':  return <SDF3DParamViz           node={node} />;
    // Combiners
    case 'smoothMin':
    case 'smoothMax':
    case 'smoothSubtract':
    case 'sdfSmoothUnion':
    case 'sdfSmoothSubtract':
    case 'sdfSmoothIntersect':
    case 'min':
    case 'minMath':
    case 'max':
    case 'sdfMax':
    case 'sdfSubtract':
    case 'sdfUnion':
    case 'sdfIntersect':     return <CombinerCurveViz        node={node} />;
    // Vec2
    case 'length':           return <LengthViz               node={node} />;
    case 'angleToVec2':      return <AngleToVec2Viz          node={node} />;
    case 'vec2Angle':        return <Vec2AngleViz            node={node} />;
    case 'extractX':
    case 'extractY':         return <ExtractComponentViz     node={node} />;
    case 'splitVec2':
    case 'splitVec3':
    case 'splitVec4':        return <SplitVecViz             node={node} />;
    case 'makeVec2':         return <MakeVec2Viz             node={node} />;
    case 'normalizeVec2':    return <NormalizeVec2Viz        node={node} />;
    case 'dot':              return <DotProductViz           node={node} />;
    case 'addVec2':
    case 'multiplyVec2':     return <Vec2OpViz               node={node} />;
    case 'makeVec3':
    case 'floatToVec3':      return <ColorSwatchViz          node={node} />;
    // 2D SDF
    case 'circleSDF':
    case 'boxSDF':
    case 'ringSDF':
    case 'shapeSDF':
    case 'sdBox':
    case 'sdEllipse':        return <SdfPreviewViz           node={node} />;

    // ── Sources ──────────────────────────────────────────────────────────────
    case 'uv':
    case 'pixelUV':          return <UVGradientViz           node={node} />;
    case 'time':             return <TimeBadgeViz            node={node} />;
    case 'mouse':            return <MouseBadgeViz           node={node} />;
    case 'prevFrame':
    case 'textureInput':     return <TextureBadgeViz         node={node} />;
    case 'vec2Const':        return <Vec2ConstViz            node={node} />;
    case 'vec3Const':        return <Vec3ConstViz            node={node} />;
    case 'matConst':         return <MatrixGridViz           node={node} />;

    // ── Expr / custom fn ─────────────────────────────────────────────────────
    case 'exprNode':
    case 'customFn':         return <ExprBadgeViz            node={node} />;

    // ── Noise ─────────────────────────────────────────────────────────────────
    case 'fbm':
    case 'voronoi':
    case 'noiseFloat':       return <NoisePatchViz           node={node} />;

    // ── Space / UV warps → param display ─────────────────────────────────────
    case 'fract':
    case 'rotate2d':
    case 'uvWarp':
    case 'smoothWarp':
    case 'curlWarp':
    case 'swirlWarp':
    case 'displace':
    case 'domainWarp':
    case 'flowField':
    case 'polarSpace':
    case 'logPolarSpace':
    case 'hyperbolicSpace':
    case 'inversionSpace':
    case 'mobiusSpace':
    case 'swirlSpace':
    case 'kaleidoSpace':
    case 'sphericalSpace':
    case 'rippleSpace':
    case 'infiniteRepeatSpace':
    case 'shear':
    case 'perspective2d':
    case 'mirroredRepeat2D':
    case 'limitedRepeat2D':
    case 'angularRepeat2D':  return <SDF3DParamViz           node={node} />;

    // ── Color ops → param display ─────────────────────────────────────────────
    case 'hsv':
    case 'invert':
    case 'blendModes':
    case 'lumaKey':
    case 'sdfColorize':
    case 'sdfOutline':
    case 'mask':
    case 'glowLayer':
    case 'alphaBlend':
    case 'chromaticAberration': return <SDF3DParamViz        node={node} />;

    // ── Math → param display ──────────────────────────────────────────────────
    case 'luminance':
    case 'compare':
    case 'select':
    case 'reflect':
    case 'crossProduct':
    case 'complexMul':
    case 'complexPow':       return <SDF3DParamViz           node={node} />;

    // ── 2D SDF missing ────────────────────────────────────────────────────────
    case 'sdSegment':
    case 'opRepeat':
    case 'opRepeatPolar':
    case 'simpleSDF':        return <SDF3DParamViz           node={node} />;

    // ── 3D SDF missing ────────────────────────────────────────────────────────
    case 'sdCross3D':
    case 'mengerSponge':
    case 'mandelboxDE':
    case 'kifsTetra':
    case 'mandelbulb':       return <SDF3DParamViz           node={node} />;

    // ── 3D transforms missing ─────────────────────────────────────────────────
    case 'mirroredRepeat3D':
    case 'spiralWarp3D':     return <SDF3DParamViz           node={node} />;

    // ── Lighting ──────────────────────────────────────────────────────────────
    case 'makeLight':
    case 'light':
    case 'light2d':
    case 'multiLight':
    case 'fresnel3d':
    case 'sdfAo':
    case 'softShadow':       return <SDF3DParamViz           node={node} />;

    // ── 2D Fractals / Patterns / Physics → param display ─────────────────────
    case 'mandelbrot':
    case 'ifs':
    case 'newtonFractal':
    case 'lyapunov':
    case 'apollonian':
    case 'truchet':
    case 'metaballs':
    case 'lissajous':
    case 'chladni':
    case 'chladni3d':
    case 'chladni3dParticles': return <SDF3DParamViz         node={node} />;

    // ── Loop / Effect nodes → param display ───────────────────────────────────
    case 'fractalLoop':
    case 'rotatingLinesLoop':
    case 'accumulateLoop':
    case 'forLoop':
    case 'loopStart':
    case 'loopCarry':
    case 'loopDomainFold':   return <SDF3DParamViz           node={node} />;

    // ── Volumetrics / complex effects → param display ─────────────────────────
    case 'fakeSSS':
    case 'volumeClouds':
    case 'volumetricFog':
    case 'glass3d':
    case 'glassDistortion':
    case 'orbitalVolume3d':
    case 'radianceCascadesApprox': return <SDF3DParamViz     node={node} />;

    // ── Particle fields ───────────────────────────────────────────────────────
    case 'vectorField':
    case 'gravityField':
    case 'spiralField':      return <SDF3DParamViz           node={node} />;

    // ── 3D Scene nodes → param display ────────────────────────────────────────
    case 'scenePos':
    case 'rayMarch':
    case 'marchOutput':
    case 'marchCamera':
    case 'forwardCamera':
    case 'marchLoopInputs':
    case 'marchLoopOutput':  return <SDF3DParamViz           node={node} />;

    default:                 return null;
  }
}

// Nodes whose inline viz fully replaces the shader thumbnail
export const INLINE_VIZ_TYPES = new Set([
  'toneMap', 'palette', 'palettePreset', 'gradient',
  'posterize', 'desaturate', 'grain', 'lumaGrain', 'temporalGrain',
  'hueRange', 'audioInput',
  'colorRamp', 'blackbody', 'brightnessContrast', 'grid', 'waveTexture',
  'smoothstep', 'clamp', 'mix', 'mixVec3', 'mapRange',
  'multiplyVec3', 'addVec3', 'addColor',
  'particleEmitter',
  'expEase', 'doubleExpSeat', 'doubleExpSigmoid', 'logisticSigmoid',
  'circularEaseIn', 'circularEaseOut', 'doubleCircleSeat', 'doubleCircleSigmoid',
  'doubleEllipticSigmoid', 'quadBezierShaper', 'cubicBezierShaper',
  'sin', 'cos',
  'toneCurve', 'shadowsHighlights', 'liftGammaGain', 'hueRotate', 'colorSaturation',
  'mat2Construct', 'mat2Inspect', 'mat3Construct', 'mat3Inspect',
  'mat2MulVec', 'mat3MulVec',
  'group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup',
  // 3D primitives
  'sphereSDF3D', 'boxSDF3D', 'torusSDF3D', 'capsuleSDF3D', 'cylinderSDF3D',
  'coneSDF3D', 'octahedronSDF3D', 'planeSDF3D',
  'roundedBoxSDF3D', 'boxFrameSDF3D', 'ellipsoidSDF3D', 'cappedTorusSDF3D',
  'linkSDF3D', 'pyramidSDF3D', 'hexPrismSDF3D', 'triPrismSDF3D',
  'cappedConeSDF3D', 'roundedCylinderSDF3D', 'solidAngleSDF3D', 'verticalCapsuleSDF3D',
  // 3D transforms
  'translate3D', 'rotate3D', 'repeat3D', 'twist3D', 'fold3D',
  'scale3d', 'rotateAxis3D', 'sinWarp3D', 'bend3D', 'limitedRepeat3D', 'polarRepeat3D', 'displace3D',
  // 3D boolean ops
  'sdfRound', 'sdfOnion',
  // Effects / post-process
  'vignette', 'scanlines', 'sobel', 'chromaticAberrationAuto',
  'gaussianBlur', 'radialBlur', 'tiltShiftBlur', 'lensBlur',
  'depthOfField', 'motionBlur', 'chromaShift', 'gravitationalLens', 'floatWarp',
  // Scalar math
  'exp', 'pow', 'sqrt', 'ceil', 'floor', 'negate', 'sign', 'fractRaw', 'abs', 'mod',
  'tanh', 'round', 'step', 'atan2',
  // Float arithmetic
  'multiply', 'add', 'subtract', 'divide',
  // Range mapping
  'remap',
  // LFOs — deliberately excluded: they have a live scope canvas in NodeComponent
  // 'sineLFO', 'squareLFO', 'sawtoothLFO', 'triangleLFO', 'bpmSync',
  // Color combiners
  'combineRGB', 'blend', 'screenBlend',
  // Param display
  'constant', 'weightedAverage',
  // Combiners (2D + 3D)
  'smoothMin', 'smoothMax', 'smoothSubtract',
  'sdfSmoothUnion', 'sdfSmoothSubtract', 'sdfSmoothIntersect',
  'min', 'minMath', 'max', 'sdfMax', 'sdfSubtract', 'sdfUnion', 'sdfIntersect',
  // Vec2 / split
  'length', 'angleToVec2', 'vec2Angle', 'extractX', 'extractY',
  'splitVec2', 'splitVec3', 'splitVec4',
  'makeVec2', 'normalizeVec2', 'dot', 'addVec2', 'multiplyVec2',
  'makeVec3', 'floatToVec3',
  // 2D SDF
  'circleSDF', 'boxSDF', 'ringSDF', 'shapeSDF', 'sdBox', 'sdEllipse',
  // Sources
  'uv', 'pixelUV', 'time', 'mouse', 'prevFrame', 'textureInput',
  'vec2Const', 'vec3Const', 'matConst',
  // Expr / custom fn
  'exprNode', 'customFn',
  // Noise
  'fbm', 'voronoi', 'noiseFloat',
  // Space / UV warps
  'fract', 'rotate2d', 'uvWarp', 'smoothWarp', 'curlWarp', 'swirlWarp', 'displace',
  'domainWarp', 'flowField',
  'polarSpace', 'logPolarSpace', 'hyperbolicSpace', 'inversionSpace', 'mobiusSpace',
  'swirlSpace', 'kaleidoSpace', 'sphericalSpace', 'rippleSpace', 'infiniteRepeatSpace',
  'shear', 'perspective2d', 'mirroredRepeat2D', 'limitedRepeat2D', 'angularRepeat2D',
  // Color ops
  'hsv', 'invert', 'blendModes', 'lumaKey', 'sdfColorize', 'sdfOutline',
  'mask', 'glowLayer', 'alphaBlend', 'chromaticAberration',
  // Math
  'luminance', 'compare', 'select', 'reflect', 'crossProduct', 'complexMul', 'complexPow',
  // 2D SDF missing
  'sdSegment', 'opRepeat', 'opRepeatPolar', 'simpleSDF',
  // 3D SDF missing
  'sdCross3D', 'mengerSponge', 'mandelboxDE', 'kifsTetra', 'mandelbulb',
  // 3D transforms missing
  'mirroredRepeat3D', 'spiralWarp3D',
  // Lighting
  'makeLight', 'light', 'light2d', 'multiLight', 'fresnel3d', 'sdfAo', 'softShadow',
  // 2D Fractals / Patterns / Physics
  'mandelbrot', 'ifs', 'newtonFractal', 'lyapunov', 'apollonian',
  'truchet', 'metaballs', 'lissajous',
  'chladni', 'chladni3d', 'chladni3dParticles',
  // Loop / Effect nodes
  'fractalLoop', 'rotatingLinesLoop', 'accumulateLoop', 'forLoop',
  'loopStart', 'loopCarry', 'loopDomainFold',
  // Volumetrics / complex effects
  'fakeSSS', 'volumeClouds', 'volumetricFog', 'glass3d', 'glassDistortion',
  'orbitalVolume3d', 'radianceCascadesApprox',
  // Particle fields
  'vectorField', 'gravityField', 'spiralField',
  // 3D Scene nodes
  'scenePos', 'rayMarch', 'marchOutput', 'marchCamera', 'forwardCamera',
  'marchLoopInputs', 'marchLoopOutput',
]);
