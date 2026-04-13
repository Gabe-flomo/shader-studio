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
    default:               return null;
  }
}

// Nodes whose inline viz fully replaces the shader thumbnail
export const INLINE_VIZ_TYPES = new Set([
  'toneMap', 'palette', 'palettePreset', 'gradient',
  'posterize', 'desaturate', 'grain', 'lumaGrain', 'temporalGrain',
  'hueRange',
]);
