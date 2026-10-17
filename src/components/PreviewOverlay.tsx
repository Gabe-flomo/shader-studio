/**
 * The preview Overlay: a labelled grid of a chosen space's real values (Grid) and a marker where a
 * chosen point lies in that space (Position), drawn on a 2D canvas over the picture. Purely DOM:
 * never part of the render or an export. ShaderCanvas reads the values (lib/previewOverlay/
 * overlayRunner.ts) onto overlayBus; this draws them in a rAF, React only for the menu.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { getNodeDefinition } from '../nodes/definitions';
import { useTokens } from '../theme/themeStore';
import { fontFamily } from '../theme/tokens';
import { IconButton } from './ui/Button';
import { Popover } from './ui/Popover';
import { Segmented, Toggle } from './ui/Choice';
import { Select, type SelectOption } from './ui/Select';
import { overlayBus, type OverlayFrame } from '../lib/previewOverlay/overlayBus';
import { blendFields, declutter, edgeLabels, edgePoint, gridLines, locateValue, type Field2 } from '../lib/previewOverlay/overlayMath';
import { parseRef, refKey, useOverlay, type OverlayMode } from '../lib/previewOverlay/overlayStore';
import { vec2Outputs } from '../lib/previewOverlay/overlayRunner';

const FONT = '10.5px ui-monospace, SFMono-Regular, Menlo, monospace';

const fmt = (v: number) => {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
  return s.replace('-', '−');
};

function nodeName(n: GraphNode): string {
  const own = typeof n.params.label === 'string' ? n.params.label.trim() : '';
  return own || getNodeDefinition(n.type)?.label || n.type;
}

/** Text with a dark halo, legible on any picture. */
function haloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function drawOverlay(ctx: CanvasRenderingContext2D, frame: OverlayFrame, cw: number, ch: number, accent: string) {
  const st = useOverlay.getState();
  ctx.font = FONT;
  if (frame.error || !frame.space) {
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    haloText(ctx, frame.error ?? 'Reading…', 10, 10, 'rgba(255,255,255,0.9)');
    return;
  }
  const field: Field2 = st.space && st.blend < 1 ? blendFields(frame.plain, frame.space, st.blend) : frame.space;
  const X = (u: number) => u * cw, Y = (v: number) => (1 - v) * ch;

  if (st.mode === 'grid' || st.gridInPosition) {
    const target = Math.max(4, Math.min(12, Math.round(Math.max(cw, ch) / 70)));
    const { lines, sx, sy } = gridLines(field, target);
    // Halo under every line first, then the lines: minor faint white, the 0 lines in the accent
    for (const pass of [0, 1]) {
      for (const ln of lines) {
        ctx.beginPath();
        for (let k = 0; k < ln.segs.length; k += 4) {
          ctx.moveTo(X(ln.segs[k]), Y(ln.segs[k + 1]));
          ctx.lineTo(X(ln.segs[k + 2]), Y(ln.segs[k + 3]));
        }
        if (pass === 0) { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = ln.major ? 3.5 : 2.5; }
        else { ctx.strokeStyle = ln.major ? accent : 'rgba(255,255,255,0.55)'; ctx.lineWidth = ln.major ? 1.6 : 0.8; }
        ctx.stroke();
      }
    }
    const labels = edgeLabels(lines, sx, sy)
      .sort((a, b) => Number(b.major) - Number(a.major))
      .map(l => {
        const w = ctx.measureText(l.text).width + 6, h = 14;
        let x = X(l.u), y = Y(l.v);
        if (l.edge === 'bottom') { x -= w / 2; y = ch - h - 2; }
        else if (l.edge === 'top') { x -= w / 2; y = 2; }
        else if (l.edge === 'left') { x = 2; y -= h / 2; }
        else if (l.edge === 'right') { x = cw - w - 2; y -= h / 2; }
        else { x -= w / 2; y -= h / 2; }
        x = Math.max(2, Math.min(cw - w - 2, x)); y = Math.max(2, Math.min(ch - h - 2, y));
        return { ...l, box: [x, y, w, h] as [number, number, number, number] };
      });
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const l of declutter(labels)) {
      const [x, y, w, h] = l.box;
      haloText(ctx, l.text, x + w / 2, y + h / 2, l.major ? accent : l.axis === 'x' ? 'rgba(255,255,255,0.95)' : 'rgba(214,226,255,0.95)');
    }
  }

  if (st.mode === 'position' && frame.pos) {
    const p = frame.pos;
    const loc = locateValue(field, p);
    const text = `(${fmt(p[0])}, ${fmt(p[1])})`;
    ctx.textBaseline = 'middle';
    if (!loc.found) {
      ctx.textAlign = 'left';
      haloText(ctx, `${text}: not in view of this space`, 10, 12, '#fff');
    } else if (loc.onScreen) {
      const x = X(loc.u), y = Y(loc.v);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12); ctx.stroke();
      const w = ctx.measureText(text).width;
      const right = x + 16 + w < cw - 4;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.font = `600 ${FONT}`;
      haloText(ctx, text, right ? x + 16 : x - 16, Math.max(10, Math.min(ch - 10, y - 12)), '#fff');
    } else {
      const e = edgePoint(loc.u, loc.v, 0.05);
      const x = X(e.u), y = Y(e.v), a = -e.angle;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -7); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.stroke();
      ctx.fillStyle = accent; ctx.fill();
      ctx.restore();
      ctx.textAlign = x > cw / 2 ? 'right' : 'left';
      ctx.font = `600 ${FONT}`;
      haloText(ctx, `${text} off-screen`, x + (x > cw / 2 ? -14 : 14), Math.max(10, Math.min(ch - 10, y + (y > ch / 2 ? -16 : 16))), '#fff');
    }
  }
}

/** The overlay canvas, mounted over the picture (ShaderCanvas). */
export function PreviewOverlay() {
  const mode = useOverlay(s => s.mode);
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const accent = tk.accent.base;

  useEffect(() => {
    if (mode === 'off') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = overlayBus.get();
      const st = useOverlay.getState();
      const key = `${st.mode}|${refKey(st.space)}|${refKey(st.mode === 'position' ? st.position : null)}`;
      if (!frame || frame.key !== key || !cw || !ch) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawOverlay(ctx, frame, cw, ch, accent);
    };
    const ask = () => { if (!raf) raf = requestAnimationFrame(draw); };
    ask();
    const unsubBus = overlayBus.subscribe(ask);
    const unsubStore = useOverlay.subscribe(ask);
    const ro = new ResizeObserver(ask);
    ro.observe(canvas);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      useOverlay.getState().setMode('off');
    };
    window.addEventListener('keydown', onKey);
    return () => { unsubBus(); unsubStore(); ro.disconnect(); window.removeEventListener('keydown', onKey); if (raf) cancelAnimationFrame(raf); };
  }, [mode, accent]);

  if (mode === 'off') return null;
  return <canvas ref={canvasRef} data-testid="preview-overlay" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />;
}

const MODES: { value: OverlayMode; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'grid', label: 'Grid' },
  { value: 'position', label: 'Position' },
];

function OverlayMenu() {
  const tk = useTokens();
  const st = useOverlay();
  const nodes = useNodeGraphStore(s => s.nodes);
  const outs = useMemo(() => vec2Outputs(nodes, nodeName), [nodes]);
  const opts = (none: string, cur: string): SelectOption[] => [
    { value: '', label: none },
    ...outs.map(o => ({ value: refKey(o.ref), label: o.label, group: o.group || undefined })),
    // A pick whose node has gone (another graph loaded): still shown, as missing
    ...(cur && !outs.some(o => refKey(o.ref) === cur) ? [{ value: cur, label: 'Missing node', disabled: true }] : []),
  ];
  // Position mode starts on the Mouse node when there is one
  useEffect(() => {
    if (st.mode !== 'position' || st.position) return;
    const m = outs.find(o => o.type === 'mouse' && o.ref.outputKey === 'uv');
    if (m) st.setPosition(m.ref);
  }, [st.mode, st.position, outs, st]);
  const row = { display: 'flex', flexDirection: 'column', gap: 4 } as const;
  const cap = { font: `600 11px ${fontFamily.ui}`, color: tk.text.muted } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 6 }}>
      <Segmented options={MODES} value={st.mode} onChange={st.setMode} fill size="sm" ariaLabel="Overlay mode" />
      {st.mode !== 'off' && (
        <>
          {st.mode === 'position' && (
            <div style={row}>
              <span style={cap}>Position (a vec2 point)</span>
              <Select ariaLabel="Position" value={refKey(st.position)} options={opts('Pick a vec2 output…', refKey(st.position))} onChange={v => st.setPosition(parseRef(v))} />
            </div>
          )}
          <div style={row}>
            <span style={cap}>Space</span>
            <Select ariaLabel="Space" value={refKey(st.space)} options={opts('Plain UV (the UV node)', refKey(st.space))} onChange={v => st.setSpace(parseRef(v))} />
          </div>
          {st.space && (
            <div style={row}>
              <span style={{ ...cap, display: 'flex' }}><span style={{ flex: 1 }}>Warp blend</span><span style={{ fontFamily: fontFamily.mono }}>{st.blend.toFixed(2)}</span></span>
              <input type="range" aria-label="Warp blend" min={0} max={1} step={0.01} value={st.blend}
                onChange={e => st.setBlend(Number(e.target.value))} style={{ width: '100%', accentColor: tk.accent.base }} />
            </div>
          )}
          {st.mode === 'position' && <Toggle checked={st.gridInPosition} onChange={st.setGridInPosition} label="Show the grid" />}
          <span style={{ font: `500 11px ${fontFamily.ui}`, color: tk.text.faint }}>Drawn over the picture only; never in exports. Esc turns it off.</span>
        </>
      )}
    </div>
  );
}

/** The Overlay button in the preview's header. */
export function OverlayButton() {
  const on = useOverlay(s => s.mode !== 'off');
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={ref} style={{ display: 'inline-flex' }}>
        <IconButton icon="grid" label="Overlay: a labelled grid of a space, or where a point lies in it" size="sm" active={on || open} onClick={() => setOpen(o => !o)} />
      </span>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} width={260} align="end">
          <OverlayMenu />
        </Popover>
      )}
    </>
  );
}
