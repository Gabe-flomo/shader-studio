import React, { useRef, useEffect } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { PALETTE_PRESETS } from '../../nodes/definitions/color';

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
const _mix   = (a: number, b: number, t: number) => a + (b - a) * t;

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
      const qx2 = Math.abs(px);
      const k1x = ry, k1y = he, k2x = (ry - r) * 0.5, k2y = he;
      const ca = _clamp(qx2 - (qy2 > 0 ? r : ry) + 0, 0, 1);
      const qy2 = py;
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
      const cs = _len(qx2, qy2), si = cs === 0 ? 0 : qy2 / cs;
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
      const qx2 = Math.abs(px), qy2 = Math.abs(py);
      const h2 = 0.5 / (0.5 + he * he / 9);
      if (qy2 < qx2) { const t = qx2; qx2; } // swap if needed — simplified
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

  for (let yi = 0; yi < H; yi++) {
    for (let xi = 0; xi < W; xi++) {
      const ux = ((xi + 0.5) / W * 2 - 1) * uvScale;
      const uy = ((1 - (yi + 0.5) / H) * 2 - 1) * uvScale;
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

// ─── Dispatch ─────────────────────────────────────────────────────────────────

export function NodeInlineViz({ node }: { node: GraphNode }) {
  switch (node.type) {
    case 'toneMap':        return <ToneCurveViz      node={node} />;
    case 'palette':
    case 'palettePreset':
    case 'gradient':       return <GradientStripViz  node={node} />;
    case 'hueRange':       return <HueRingViz         node={node} />;
    case 'posterize':      return <StepCurveViz       node={node} />;
    case 'grain':
    case 'lumaGrain':
    case 'temporalGrain':  return <NoisePatchViz      node={node} />;
    case 'desaturate':     return <DesaturateBarViz   node={node} />;
    case 'audioInput':     return <AudioFreqRangeViz  node={node} />;
    default:               return null;
  }
}

// Nodes whose inline viz fully replaces the shader thumbnail
export const INLINE_VIZ_TYPES = new Set([
  'toneMap', 'palette', 'palettePreset', 'gradient',
  'posterize', 'desaturate', 'grain', 'lumaGrain', 'temporalGrain',
  'hueRange', 'audioInput',
]);
