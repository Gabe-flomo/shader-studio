/**
 * The viewport's legend, its tags and the focus demo (docs/agent-builder.md "Legend, tags and focus"):
 *
 *  - `ViewportLegend`: one compact, foldable panel in the viewport's corner listing what is drawn
 *    (agentBuilder/legend.ts): a colour dot matching the drawing, its key numbers and one plain line;
 *  - `DiagramTags`: the small coloured number tags the diagrams put next to their drawings, laid out
 *    so they don't overlap (`layoutTags`), off the legend;
 *  - `FocusDemo`: the small looping demo a focus view plays (agentBuilder/demos.ts), drawn on a
 *    canvas by requestAnimationFrame only while it is mounted (only in focus).
 *
 * Hovering an entry or a tag lights its drawing (the others dim) and its control in the inspector;
 * clicking one enters focus. `ViewportLink` is what the diagrams need for that.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { type Box, type LegendEntry, type TagRequest, dimFor, layoutTags, TAG_H } from '../../agentBuilder/legend';
import { type Demo, makeDemo } from '../../agentBuilder/demos';
import type { ViewRect } from '../builders/studio/LiveViewport';

/** What the diagrams need to draw their tags and to light / dim with the legend. */
export interface ViewportLink {
  entries: readonly LegendEntry[];
  /** The entry lit (hovered in the legend, a tag, or its control). */
  lit: string | null;
  /** Dim the drawings of the other entries (a legend or tag hover, or focus). */
  dim: boolean;
  focused: string | null;
  onHover: (id: string | null) => void;
  onFocus: (id: string) => void;
  /** Boxes the tags keep off (the legend, the demo). */
  avoid: readonly Box[];
  /** Where the free part of the viewport starts (right of the legend): lenses are centred in it. */
  freeLeft?: number;
}


export const LEGEND_W = 292;
const PREF = 'builder:agent-builder:studio:legend';
const readOpen = () => { try { return localStorage.getItem(PREF) !== '0'; } catch { return true; } };

export function ViewportLegend({ entries, lit, focused, note, onHover, onFocus, onBox }: {
  entries: readonly LegendEntry[]; lit: string | null; focused: string | null;
  /** A short line under the title (what the lens shows, the 3D camera). */
  note?: string;
  onHover: (id: string | null) => void; onFocus: (id: string) => void;
  /** Its box in the viewport, for the tags to keep off. */
  onBox?: (b: Box | null) => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(readOpen);
  const ref = useRef<HTMLDivElement>(null);
  const toggle = () => { setOpen(v => { try { localStorage.setItem(PREF, v ? '0' : '1'); } catch { /* this session */ } return !v; }); };
  useEffect(() => {
    const el = ref.current;
    if (!el || !onBox) return;
    const report = () => onBox({ left: el.offsetLeft, top: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => { ro.disconnect(); onBox(null); };
  }, [onBox, open, entries.length]);
  if (!entries.length) return null;
  return (
    <div ref={ref} data-viewport-legend={open ? 'open' : 'folded'} onPointerLeave={() => onHover(null)}
      style={{
        position: 'absolute', left: 12, top: 12, width: open ? LEGEND_W : undefined, maxHeight: 'calc(100% - 24px)', overflowY: 'auto', boxSizing: 'border-box',
        background: alpha(tk.bg.panel, 0.94), borderRadius: radius.lg, boxShadow: `${tk.shadow.float}, inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary,
        backdropFilter: 'blur(6px)', pointerEvents: 'auto',
      }}>
      <button type="button" data-legend-toggle aria-expanded={open} onClick={toggle} title={open ? 'Fold the legend' : 'What is drawn on the picture'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', padding: '8px 10px', border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `700 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={12} />
        <span style={{ flex: 1, textAlign: 'left' }}>On the picture</span>
        {!open && <span style={{ display: 'inline-flex', gap: 3 }}>{entries.map(e => <Dot key={e.id} colour={e.colour} size={7} />)}</span>}
      </button>
      {open && <>
        {note && <span data-legend-note style={{ display: 'block', padding: '0 12px 6px', fontSize: 11, color: tk.text.faint, marginTop: -2 }}>{note}</span>}
        <ul style={{ listStyle: 'none', margin: 0, padding: '0 6px 6px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {entries.map(e => {
            const isLit = lit === e.id, isFocused = focused === e.id;
            return (
              <li key={e.id}>
                <button type="button" data-legend-entry={e.id} data-lit={isLit || undefined} data-focused={isFocused || undefined}
                  onPointerEnter={() => onHover(e.id)} onFocus={() => onHover(e.id)} onBlur={() => onHover(null)} onClick={() => onFocus(e.id)}
                  title="Click to focus: its controls, more about it, and a moving demo"
                  style={{
                    display: 'flex', gap: 9, width: '100%', padding: '7px 8px', border: 0, borderRadius: radius.md, cursor: 'pointer', textAlign: 'left',
                    background: isFocused || isLit ? tk.bg.selected : 'none', color: 'inherit', opacity: e.on ? 1 : 0.55,
                    boxShadow: isFocused ? `inset 0 0 0 1.5px ${tk.accent.base}` : isLit ? `inset 3px 0 0 ${tk.accent.base}` : 'none',
                  }}>
                  <Dot colour={e.colour} size={10} style={{ marginTop: 3 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                      <b style={{ fontSize: 12.5, fontWeight: 650 }}>{e.title}</b>
                      <span data-legend-numbers style={{ fontSize: 11, color: tk.text.muted, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.numbers}{e.on ? '' : ' · off'}</span>
                    </span>
                    <span data-legend-line style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.text.secondary }}>{e.line}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </>}
    </div>
  );
}

function Dot({ colour, size, style }: { colour: string; size: number; style?: React.CSSProperties }) {
  const tk = useTokens();
  return <span aria-hidden style={{ width: size, height: size, borderRadius: '50%', flexShrink: 0, background: colour, boxShadow: `0 0 0 1px ${alpha(tk.text.primary, 0.25)}`, ...style }} />;
}

/** The diagrams' small number tags, placed off each other and off the legend. */
export function DiagramTags({ requests, bounds, link }: { requests: readonly TagRequest[]; bounds: ViewRect; link?: ViewportLink }) {
  const placed = useMemo(() => layoutTags(requests, bounds, link?.avoid ?? []), [requests, bounds, link?.avoid]);
  const colourOf = (id: string) => link?.entries.find(e => e.id === id)?.colour ?? '#ffffff';
  return (
    <g data-diagram-tags>
      {placed.map(t => {
        const isLit = !!link?.lit && link.lit === t.entry;
        const op = dimFor(link, t.entry) < 1 ? 0.35 : 1;
        const c = colourOf(t.entry);
        return (
          <g key={t.key ?? `${t.entry}:${t.text}`} data-tag={t.entry} data-tag-text={t.text} data-x={t.left.toFixed(1)} data-y={t.top.toFixed(1)} opacity={op}
            style={{ pointerEvents: link && t.entry ? 'auto' : 'none', cursor: 'pointer' }}
            onPointerEnter={() => link?.onHover(t.entry)} onPointerLeave={() => link?.onHover(null)} onClick={() => t.entry && link?.onFocus(t.entry)}>
            <rect x={t.left} y={t.top} width={t.w} height={TAG_H} rx={TAG_H / 2} fill="rgba(13,13,18,0.84)" stroke={isLit ? c : 'rgba(255,255,255,0.16)'} strokeWidth={isLit ? 1.5 : 1} />
            <circle cx={t.left + 9.5} cy={t.top + TAG_H / 2} r={3.5} fill={c} />
            <text x={t.left + 17} y={t.top + TAG_H / 2 + 3.6} fill="#fff" style={{ font: `600 10.5px ${fontFamily.ui}`, fontVariantNumeric: 'tabular-nums' }}>{t.text}</text>
          </g>
        );
      })}
    </g>
  );
}

export const DEMO_W = 320, DEMO_H = 200;

/**
 * The focus view's moving demo: a small panel over the picture's corner, the demo drawn on a canvas
 * each animation frame while mounted (and only then), from the entry's live values.
 */
export function FocusDemo({ entry, onClose }: { entry: LegendEntry; onClose: () => void }) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const specKey = JSON.stringify(entry.demo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const demo = useMemo(() => makeDemo(entry.demo, entry.colour), [specKey, entry.colour]);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      drawDemo(canvasRef.current, demo, (now - t0) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [demo]);
  return (
    <div data-focus-demo={entry.id} data-demo-kind={entry.demo.kind}
      style={{ position: 'absolute', right: 12, bottom: 12, width: DEMO_W + 20, boxSizing: 'border-box', padding: 10, display: 'flex', flexDirection: 'column', gap: 8,
        background: alpha(tk.bg.panel, 0.95), borderRadius: radius.lg, boxShadow: `${tk.shadow.float}, inset 0 0 0 1px ${tk.border.default}`, color: tk.text.primary, pointerEvents: 'auto' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Dot colour={entry.colour} size={10} />
        <b style={{ fontSize: 12.5, fontWeight: 650, flex: 1 }}>{entry.title} <span style={{ fontWeight: 500, color: tk.text.muted, fontSize: 11 }}>{entry.numbers}</span></b>
        <button type="button" data-focus-close aria-label="Leave focus (Esc)" title="Leave focus (Esc)" onClick={onClose}
          style={{ width: 22, height: 22, padding: 0, border: 0, borderRadius: 6, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={12} />
        </button>
      </span>
      <canvas ref={canvasRef} width={DEMO_W} height={DEMO_H} style={{ width: DEMO_W, height: DEMO_H, borderRadius: radius.md, background: tk.bg.render, display: 'block' }} />
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {demo.key.map(k => <span key={k.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: tk.text.muted }}><Dot colour={k.colour} size={7} />{k.label}</span>)}
      </span>
    </div>
  );
}

function drawDemo(c: HTMLCanvasElement | null, demo: Demo, t: number) {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = DEMO_W, H = DEMO_H;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const b = demo.bounds;
  const k = Math.min(W / (b.x1 - b.x0), H / (b.y1 - b.y0));
  const ox = (W - (b.x1 - b.x0) * k) / 2, oy = (H - (b.y1 - b.y0) * k) / 2;
  const X = (x: number) => ox + (x - b.x0) * k, Y = (y: number) => H - oy - (y - b.y0) * k;
  const f = demo.frame(t);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of f.rects) {
    ctx.setLineDash(r.dashed ? [6, 5] : []);
    if (r.fill) { ctx.fillStyle = r.fill; ctx.fillRect(X(r.x0), Y(r.y1), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k); }
    ctx.strokeStyle = r.colour; ctx.lineWidth = 1.5; ctx.strokeRect(X(r.x0), Y(r.y1), (r.x1 - r.x0) * k, (r.y1 - r.y0) * k);
  }
  for (const r of f.rings) {
    ctx.beginPath(); ctx.arc(X(r.x), Y(r.y), Math.max(r.r * k, 2), 0, Math.PI * 2);
    if (r.fill) { ctx.fillStyle = r.fill; ctx.fill(); }
    ctx.setLineDash(r.dashed ? [5, 4] : []); ctx.strokeStyle = r.colour; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const p of f.paths) {
    if (p.pts.length < 2) continue;
    ctx.globalAlpha = p.opacity ?? 1;
    ctx.setLineDash(p.dashed ? [4, 4] : []);
    ctx.strokeStyle = p.colour; ctx.lineWidth = p.width ?? 1.5;
    ctx.beginPath(); p.pts.forEach((q, i) => (i ? ctx.lineTo(X(q.x), Y(q.y)) : ctx.moveTo(X(q.x), Y(q.y)))); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const a of f.arrows) {
    const x0 = X(a.from.x), y0 = Y(a.from.y), x1 = X(a.to.x), y1 = Y(a.to.y);
    ctx.strokeStyle = a.colour; ctx.lineWidth = a.width ?? 2;
    // A flow arrow's dashes march along it (the field moving).
    ctx.setLineDash(a.flow ? [3, 3] : []); ctx.lineDashOffset = a.flow ? -((t * 24) % 6) : 0;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(y1 - y0, x1 - x0), s = 3 + (a.width ?? 2) * 1.5;
    ctx.beginPath(); ctx.moveTo(x1 - Math.cos(ang - 0.5) * s, y1 - Math.sin(ang - 0.5) * s); ctx.lineTo(x1, y1); ctx.lineTo(x1 - Math.cos(ang + 0.5) * s, y1 - Math.sin(ang + 0.5) * s); ctx.stroke();
  }
  for (const d of f.dots) {
    ctx.globalAlpha = d.opacity ?? 1;
    ctx.beginPath(); ctx.arc(X(d.x), Y(d.y), d.r, 0, Math.PI * 2);
    if (d.hollow) { ctx.setLineDash([]); ctx.strokeStyle = d.colour; ctx.lineWidth = 1.3; ctx.stroke(); } else { ctx.fillStyle = d.colour; ctx.fill(); }
  }
  ctx.globalAlpha = 1; ctx.setLineDash([]);
}
