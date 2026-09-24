/**
 * vizGeneric — table-driven inline visuals for whole families of nodes.
 *
 *  - SpaceViz: a checkerboard seen through a 2D space node's mapping, so a
 *    warp, repeat or fold shows what it does to any pattern fed through it.
 *  - CurveViz: the transfer curve of a falloff / SDF modifier / Fresnel node.
 *  - EchoViz: the after-image stems of the Echo node.
 *  - WaveRadiusViz: the radius wave of Wave Radius.
 *
 * Each table entry reads the node's params (falling back to the definition's
 * defaults) and is pure maths ported from the node's GLSL, so the picture
 * matches what the shader does.
 */
import { useEffect, useRef } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { pal, MONO, vizContainer, setupViz, imageSize, blitImage } from './vizKit';

const num = (node: GraphNode, key: string, fallback: number): number => {
  const v = node.params[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const d = getNodeDefinition(node.type)?.defaultParams?.[key];
  return typeof d === 'number' ? d : fallback;
};
const str = (node: GraphNode, key: string, fallback: string): string => {
  const v = node.params[key];
  if (typeof v === 'string') return v;
  const d = getNodeDefinition(node.type)?.defaultParams?.[key];
  return typeof d === 'string' ? d : fallback;
};
const TAU = Math.PI * 2;
const glslMod = (a: number, b: number) => a - b * Math.floor(a / b);
const fract = (a: number) => a - Math.floor(a);
const smoothstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ── 2D space mappings ───────────────────────────────────────────────────────
type Vec2 = [number, number];
type SpaceMap = (p: Vec2, n: GraphNode) => Vec2;

const rot = ([x, y]: Vec2, a: number): Vec2 => { const c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; };

const SPACE_MAPS: Record<string, SpaceMap> = {
  rotate2d: (p, n) => rot(p, num(n, 'angle', 0)),
  uvTransform2d: ([x, y], n) => {
    const px = num(n, 'pivotX', 0), py = num(n, 'pivotY', 0), sx = num(n, 'sx', 1), sy = num(n, 'sy', 1), a = num(n, 'angle', 0);
    const c = Math.cos(a), s = Math.sin(a);
    const ux = x - px, uy = y - py;
    return [c * sx * ux - s * sy * uy + px + num(n, 'tx', 0), s * sx * ux + c * sy * uy + py + num(n, 'ty', 0)];
  },
  shear: ([x, y], n) => [x + num(n, 'shearX', 0.3) * y, y + num(n, 'shearY', 0) * x],
  fract: ([x, y], n) => { const s = num(n, 'scale', 3); return [fract(x * s) - 0.5, fract(y * s) - 0.5]; },
  infiniteRepeatSpace: ([x, y], n) => {
    const cx = num(n, 'cellX', 1), cy = num(n, 'cellY', 1);
    return [glslMod(x + cx / 2, cx) - cx / 2, glslMod(y + cy / 2, cy) - cy / 2];
  },
  mirroredRepeat2D: ([x, y], n) => {
    const s: Vec2 = [num(n, 'cellX', 1), num(n, 'cellY', 1)];
    const out: Vec2 = [0, 0];
    ([x, y] as Vec2).forEach((v, i) => { const id = Math.floor(v / s[i] + 0.5); const r = v - s[i] * id; out[i] = glslMod(Math.abs(id), 2) >= 0.5 ? -r : r; });
    return out;
  },
  limitedRepeat2D: ([x, y], n) => {
    const s: Vec2 = [num(n, 'cellX', 0.5), num(n, 'cellY', 0.5)];
    const half: Vec2 = [(num(n, 'countX', 3) - 1) / 2, (num(n, 'countY', 3) - 1) / 2];
    const out: Vec2 = [0, 0];
    ([x, y] as Vec2).forEach((v, i) => { const id = Math.max(-half[i], Math.min(half[i], Math.floor(v / s[i] + 0.5))); out[i] = v - s[i] * id; });
    return out;
  },
  angularRepeat2D: ([x, y], n) => {
    const sp = TAU / Math.max(1, num(n, 'count', 6));
    const an = Math.atan2(y, x), id = Math.floor(an / sp + 0.5), aw = an - sp * id, r = Math.hypot(x, y);
    return [Math.cos(aw) * r, Math.sin(aw) * r];
  },
  kaleidoSpace: ([x, y], n) => {
    const s = TAU / Math.max(1, num(n, 'segments', 6));
    let a = glslMod(Math.atan2(y, x) + num(n, 'rotate', 0), s);
    if (a > s / 2) a = s - a;
    const r = Math.hypot(x, y);
    return [Math.cos(a) * r, Math.sin(a) * r];
  },
  swirlSpace: (p, n) => rot(p, num(n, 'strength', 2) * Math.exp(-Math.hypot(p[0], p[1]) * num(n, 'falloff', 1))),
  polarSpace: ([x, y], n) => {
    const r = Math.hypot(x, y) * num(n, 'radialScale', 1);
    const a = fract(Math.atan2(y, x) / TAU + 0.5);
    return [a + r * num(n, 'twist', 0), r];
  },
  logPolarSpace: ([x, y], n) => [fract(Math.atan2(y, x) / TAU + 0.5), Math.log(Math.max(Math.hypot(x, y), 1e-5)) * num(n, 'scale', 1)],
  inversionSpace: ([x, y], n) => { const d2 = x * x + y * y, r = num(n, 'radius', 0.5); return d2 > 1e-5 ? [x * r * r / d2, y * r * r / d2] : [x, y]; },
  mobiusSpace: ([x, y], n) => {
    const px = num(n, 'poleX', 0.3), py = num(n, 'poleY', 0), a = num(n, 'angle', 0);
    const mul = (a1: Vec2, b: Vec2): Vec2 => [a1[0] * b[0] - a1[1] * b[1], a1[0] * b[1] + a1[1] * b[0]];
    const numr = mul([Math.cos(a), Math.sin(a)], [x - px, y - py]);
    const dm = mul([px, -py], [x, y]);
    const den: Vec2 = [1 - dm[0], -dm[1]];
    const d2 = den[0] * den[0] + den[1] * den[1] || 1e-9;
    return [(numr[0] * den[0] + numr[1] * den[1]) / d2, (numr[1] * den[0] - numr[0] * den[1]) / d2];
  },
  sphericalSpace: ([x, y], n) => {
    const r = Math.hypot(x, y), k = num(n, 'strength', 0.5);
    const f = r > 1e-4 && Math.abs(k) > 1e-4 ? Math.atan(r * k * 1.5708) / (r * k * 1.5708) : 1;
    return [x * f, y * f];
  },
  hyperbolicSpace: ([x, y], n) => { const f = 2 / Math.max(1 + num(n, 'curvature', 0.7) * (x * x + y * y), 0.001); return [x * f, y * f]; },
  rippleSpace: ([x, y], n) => [x + Math.sin(y * num(n, 'freqY', 5)) * num(n, 'ampX', 0.1), y + Math.sin(x * num(n, 'freqX', 5)) * num(n, 'ampY', 0.1)],
  perspective2d: ([x, y], n) => {
    const ratio = num(n, 'ratio', 1), axis = str(n, 'axis', 'y'), sign = str(n, 'flip', 'false') === 'true' ? -1 : 1;
    const denom = Math.max(axis === 'x' ? 1 - x * ratio : axis === 'xy' ? 1 - (x + y) * 0.5 * ratio : 1 - sign * y * ratio, 0.001);
    return [x / denom, y / denom];
  },
};

/** A checkerboard in the node's output space, seen from its input space: what any pattern fed through it will look like. */
function SpaceViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const map = SPACE_MAPS[node.type];
  const paramsKey = JSON.stringify(node.params);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !map) return;
    const viz = setupViz(canvas);
    if (!viz) return;
    const { ctx, W, H } = viz;
    const { IW, IH } = imageSize(viz, 220);
    const img = ctx.createImageData(IW, IH);
    const aspect = IW / IH;
    const bg = hexRgb(pal.crust), light = hexRgb(pal.surface2), dark = hexRgb(pal.base), tint = hexRgb(pal.blue);
    const cells = 4; // checker cells per unit of output space
    for (let j = 0; j < IH; j++) {
      const y = 1 - (j / (IH - 1)) * 2;
      for (let i = 0; i < IW; i++) {
        const x = ((i / (IW - 1)) * 2 - 1) * aspect;
        const [mx, my] = map([x, y], node);
        const k = (j * IW + i) * 4;
        if (!Number.isFinite(mx) || !Number.isFinite(my)) { img.data[k] = bg[0]; img.data[k + 1] = bg[1]; img.data[k + 2] = bg[2]; img.data[k + 3] = 255; continue; }
        const odd = (Math.floor(mx * cells) + Math.floor(my * cells)) & 1;
        const base = odd ? light : dark;
        // Inside the unit square of output space: a faint tint, so folds and repeats read as "the same region again"
        const inside = Math.abs(mx) <= 1 && Math.abs(my) <= 1 ? 0.22 : 0;
        img.data[k]     = Math.round(base[0] * (1 - inside) + tint[0] * inside);
        img.data[k + 1] = Math.round(base[1] * (1 - inside) + tint[1] * inside);
        img.data[k + 2] = Math.round(base[2] * (1 - inside) + tint[2] * inside);
        img.data[k + 3] = 255;
      }
    }
    blitImage(ctx, img, W, H);
    // Axes of input space
    ctx.strokeStyle = pal.overlay0; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.overlay0; ctx.font = `9px ${MONO}`;
    ctx.fillText('checker through this space', 4, H - 4);
  }, [map, node, paramsKey]);
  return (
    <div style={vizContainer()}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 96 }} />
    </div>
  );
}

// ── Transfer curves ─────────────────────────────────────────────────────────
interface Curve {
  /** Input range along x */
  x: [number, number];
  /** Fixed output range; auto-fit when omitted */
  y?: [number, number];
  /** One or more series to draw (label, colour role) */
  series: { label: string; color: (p: typeof pal) => string; fn: (x: number, n: GraphNode) => number }[];
  xLabel: string;
  /** Vertical marker (e.g. a threshold) */
  marker?: (n: GraphNode) => number | null;
  /** Draw the y = x diagonal for reference */
  identity?: boolean;
}

const CURVES: Record<string, Curve> = {
  sdfOffset:  { x: [-1, 1], y: [-1, 1], identity: true, xLabel: 'distance in', series: [{ label: 'distance out', color: p => p.green, fn: (x, n) => x + num(n, 'amount', 0) }], marker: n => -num(n, 'amount', 0) },
  sdfSharpen: { x: [-1, 1], y: [-1, 1], identity: true, xLabel: 'distance in', series: [{ label: 'distance out', color: p => p.green, fn: (x, n) => x * num(n, 'sharpness', 1) }] },
  sdfOnion:   { x: [-1, 1], y: [-1, 1], identity: true, xLabel: 'distance in', series: [{ label: 'shell distance', color: p => p.green, fn: (x, n) => Math.abs(x) - num(n, 'r', 0.1) }] },
  distanceFalloff: { x: [0, 2], y: [0, 1], xLabel: 'distance', series: [{ label: 'falloff', color: p => p.blue, fn: (d, n) => {
    const k = num(n, 'k', 4), pw = num(n, 'power', 2);
    switch (str(n, 'mode', 'bounded_inv_sq')) {
      case 'gaussian': return Math.exp(-d * d * k);
      case 'linear':   return Math.max(0, 1 - d * k);
      case 'wyvill':   return Math.pow(Math.max(0, 1 - d * d * k), 3);
      default:         return 1 / (1 + Math.pow(Math.max(d, 0), pw) * k);
    }
  } }] },
  glowFalloff: { x: [0, 2], xLabel: 'distance', series: [{ label: 'glow', color: p => p.yellow, fn: (d, n) => num(n, 'brightness', 0.5) / (1 + Math.pow(Math.max(d, 0), num(n, 'power', 2)) * num(n, 'k', 8)) }] },
  metaballThreshold: { x: [0, 2], y: [0, 1], xLabel: 'field', marker: n => num(n, 'threshold', 0.8), series: [
    { label: 'blob', color: p => p.blue, fn: (f, n) => smoothstep(num(n, 'threshold', 0.8) - num(n, 'softness', 0.05), num(n, 'threshold', 0.8) + num(n, 'softness', 0.05), f) },
    { label: 'edge', color: p => p.peach, fn: (f, n) => 1 - smoothstep(0, num(n, 'softness', 0.05) * 2, Math.abs(f - num(n, 'threshold', 0.8))) },
  ] },
  fresnelSchlick: { x: [0, 1], y: [0, 1], xLabel: 'cos θ  (1 = facing you)', series: [{ label: 'reflect', color: p => p.sky, fn: (c, n) => { const ior = num(n, 'ior', 1.5); const f0 = Math.pow((ior - 1) / (ior + 1), 2); return f0 + (1 - f0) * Math.pow(Math.max(1 - c, 0), 5); } }] },
  fresnel3d:      { x: [0, 1], y: [0, 1], xLabel: 'cos θ  (1 = facing you)', series: [{ label: 'rim', color: p => p.sky, fn: (c, n) => Math.pow(Math.max(0, 1 - c), num(n, 'power', 3)) }] },
};

function CurveViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const curve = CURVES[node.type];
  const paramsKey = JSON.stringify(node.params);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !curve) return;
    const viz = setupViz(canvas);
    if (!viz) return;
    const { ctx, W, H } = viz;
    const padL = 6, padR = 6, padT = 6, padB = 14;
    const pw = W - padL - padR, ph = H - padT - padB;
    ctx.fillStyle = pal.crust; ctx.fillRect(0, 0, W, H);
    // sample
    const N = Math.max(64, Math.floor(pw));
    const xs = Array.from({ length: N + 1 }, (_, i) => curve.x[0] + (i / N) * (curve.x[1] - curve.x[0]));
    const all = curve.series.map(s => xs.map(x => s.fn(x, node)));
    let [y0, y1] = curve.y ?? [Infinity, -Infinity];
    if (!curve.y) {
      for (const ys of all) for (const y of ys) if (Number.isFinite(y)) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      if (!Number.isFinite(y0)) { y0 = 0; y1 = 1; }
      if (y1 - y0 < 1e-6) { y0 -= 0.5; y1 += 0.5; }
      y0 = Math.min(0, y0);
    }
    const X = (x: number) => padL + ((x - curve.x[0]) / (curve.x[1] - curve.x[0])) * pw;
    const Y = (y: number) => padT + ph - ((Math.max(y0, Math.min(y1, y)) - y0) / (y1 - y0)) * ph;
    // grid
    ctx.strokeStyle = pal.base; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const gx = padL + (i / 4) * pw, gy = padT + (i / 4) * ph;
      ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, padT + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + pw, gy); ctx.stroke();
    }
    // zero line
    if (y0 < 0 && y1 > 0) { ctx.strokeStyle = pal.surface1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(padL, Y(0)); ctx.lineTo(padL + pw, Y(0)); ctx.stroke(); ctx.setLineDash([]); }
    if (curve.x[0] < 0 && curve.x[1] > 0) { ctx.strokeStyle = pal.surface1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(0), padT); ctx.lineTo(X(0), padT + ph); ctx.stroke(); ctx.setLineDash([]); }
    if (curve.identity) { ctx.strokeStyle = pal.surface1; ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(X(curve.x[0]), Y(curve.x[0])); ctx.lineTo(X(curve.x[1]), Y(curve.x[1])); ctx.stroke(); ctx.setLineDash([]); }
    // marker
    const m = curve.marker?.(node);
    if (m !== null && m !== undefined && Number.isFinite(m)) { ctx.strokeStyle = pal.overlay0; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(X(m), padT); ctx.lineTo(X(m), padT + ph); ctx.stroke(); ctx.setLineDash([]); }
    // series
    curve.series.forEach((s, si) => {
      ctx.strokeStyle = s.color(pal); ctx.lineWidth = 1.5; ctx.beginPath();
      let pen = false;
      all[si].forEach((y, i) => { if (!Number.isFinite(y)) { pen = false; return; } const px = X(xs[i]), py = Y(y); if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py); pen = true; });
      ctx.stroke();
    });
    // labels
    ctx.font = `9px ${MONO}`; ctx.fillStyle = pal.overlay0;
    ctx.fillText(curve.xLabel, padL, H - 3);
    let lx = W - padR;
    [...curve.series].reverse().forEach(s => { const w = ctx.measureText(s.label).width; lx -= w; ctx.fillStyle = s.color(pal); ctx.fillText(s.label, lx, H - 3); lx -= 8; });
    ctx.fillStyle = pal.overlay0; ctx.textAlign = 'right';
    ctx.fillText(fmt(y1), W - padR, padT + 8); ctx.fillText(fmt(y0), W - padR, padT + ph - 2);
    ctx.textAlign = 'left';
  }, [curve, node, paramsKey]);
  return (
    <div style={vizContainer()}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 72 }} />
    </div>
  );
}
const fmt = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2));

// ── Echo: after-image stems ─────────────────────────────────────────────────
function EchoViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const copies = Math.max(1, Math.round(num(node, 'copies', 3)));
  const delay = Math.max(1, Math.round(num(node, 'delay', 6)));
  const decay = num(node, 'decay', 0.7);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viz = setupViz(canvas);
    if (!viz) return;
    const { ctx, W, H } = viz;
    ctx.fillStyle = pal.crust; ctx.fillRect(0, 0, W, H);
    const padL = 8, padR = 8, base = H - 16, top = 8;
    const span = copies * delay;              // frames covered, live frame at the right
    const X = (framesBack: number) => W - padR - (framesBack / span) * (W - padL - padR);
    ctx.strokeStyle = pal.base; ctx.beginPath(); ctx.moveTo(padL, base); ctx.lineTo(W - padR, base); ctx.stroke();
    // live frame
    ctx.fillStyle = pal.text; ctx.fillRect(X(0) - 3, top, 6, base - top);
    let w = 1;
    for (let i = 0; i < copies; i++) {
      w *= decay;
      const x = X((i + 1) * delay), h = Math.max(1, (base - top) * w);
      ctx.fillStyle = pal.mauve; ctx.globalAlpha = 0.35 + 0.65 * w;
      ctx.fillRect(x - 3, base - h, 6, h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.overlay0; ctx.font = `9px ${MONO}`;
    ctx.fillText(`${copies} ${copies === 1 ? 'copy' : 'copies'} · every ${delay} frames · ×${decay.toFixed(2)} each`, padL, H - 4);
    ctx.textAlign = 'right'; ctx.fillText('now', W - padR, H - 4); ctx.textAlign = 'left';
  }, [copies, delay, decay]);
  return (
    <div style={vizContainer()}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 64 }} />
    </div>
  );
}

// ── Wave Radius ─────────────────────────────────────────────────────────────
function WaveRadiusViz({ node }: { node: GraphNode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speed = num(node, 'speed', 1), freq = num(node, 'freq', 6), amp = num(node, 'amp', 0.1), base = num(node, 'base', 0.3);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viz = setupViz(canvas);
    if (!viz) return;
    const { ctx, W, H } = viz;
    ctx.fillStyle = pal.crust; ctx.fillRect(0, 0, W, H);
    const top = 6, bottom = H - 14, ph = bottom - top;
    const Y = (v: number) => bottom - Math.max(0, Math.min(1, v)) * ph;
    ctx.strokeStyle = pal.base; for (let i = 0; i <= 4; i++) { const gy = top + (i / 4) * ph; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
    ctx.strokeStyle = pal.surface1; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, Y(base)); ctx.lineTo(W, Y(base)); ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = pal.teal; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i <= W; i++) { const d = i / W; const r = Math.sin(d * speed * freq) * amp + base; if (i === 0) ctx.moveTo(i, Y(r)); else ctx.lineTo(i, Y(r)); }
    ctx.stroke();
    ctx.fillStyle = pal.overlay0; ctx.font = `9px ${MONO}`;
    ctx.fillText('radius over distance 0 → 1, at t = 0', 4, H - 3);
  }, [speed, freq, amp, base]);
  return (
    <div style={vizContainer()}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: 60 }} />
    </div>
  );
}

export const GENERIC_VIZ_TYPES: ReadonlySet<string> = new Set([...Object.keys(SPACE_MAPS), ...Object.keys(CURVES), 'echo', 'waveRadius']);

export function GenericViz({ node }: { node: GraphNode }) {
  if (SPACE_MAPS[node.type]) return <SpaceViz node={node} />;
  if (CURVES[node.type]) return <CurveViz node={node} />;
  if (node.type === 'echo') return <EchoViz node={node} />;
  if (node.type === 'waveRadius') return <WaveRadiusViz node={node} />;
  return null;
}
