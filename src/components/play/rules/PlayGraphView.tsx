/**
 * PlayGraphView — the Rules page's Graph view (docs/graph-view.md): the whole
 * setup drawn left to right, sources → rules → controls (a card per layer) →
 * the layers rules act on. Read-only: a click opens the thing's detail
 * window (a layer: the Layers page on it). Drag to pan, wheel or pinch to
 * zoom, Fit to see it all.
 *
 * What is drawn comes from play/playGraph.ts and where from
 * play/playGraphLayout.ts, both pure. Here: HTML boxes over one SVG of wires,
 * both in one transformed layer, so text stays crisp and ellipsises.
 *
 *   value wires    solid, accent: a route (labelled Set or Add)
 *   signal wires   dashed, purple: a rule's inputs and reactions
 *   loop wires     amber, thicker: between the rules of one loop
 *
 * Hovering a box brings forward its own wires and dims the rest.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord } from '../../../types/play';
import { playGraph, type GraphEdge, type GraphNode } from '../../../play/playGraph';
import { fitView, GRAPH_HEAD_H, layoutPlayGraph, wirePathOf, zoomAt } from '../../../play/playGraphLayout';
import { openDetail } from '../detail/detailStore';
import { usePlayUi } from '../playUi';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { ShapeBadge } from './ShapeBadge';

type View = { x: number; y: number; k: number };

/** How far a press moves before it is a drag, not a click. */
const DRAG_PX = 4;

function openNode(n: GraphNode) {
  if (n.kind === 'layer') usePlayUi.getState().reveal(n.ref);
  else openDetail(n.kind === 'rule' ? 'signal' : n.kind, n.ref);
}

export function PlayGraphView({ play }: { play: PlayRecord }) {
  const tk = useTokens();
  const graph = useMemo(() => playGraph(play), [play]);
  const layout = useMemo(() => layoutPlayGraph(graph), [graph]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 24, y: 24, k: 1 });
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const [grabbing, setGrabbing] = useState(false);
  const [hover, setHover] = useState('');

  const fit = () => {
    const el = box.current;
    if (el) setView(fitView(layout.width, layout.height, el.clientWidth, el.clientHeight));
  };
  // Fit on opening, and again when the drawing changes size (a rule added, a column more).
  const size = `${layout.width}x${layout.height}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(fit, [size]);

  // Wheel: zoom about the pointer (a trackpad pinch arrives as a wheel with ctrl). Not passive, so the page doesn't scroll.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const step = e.ctrlKey ? 0.01 : 0.0015;
      setView(v => zoomAt(v, Math.exp(-e.deltaY * step), e.clientX - r.left, e.clientY - r.top));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Pointers: one drags the view (after DRAG_PX, so a press on a box is still a click), two pinch.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ id: number; x: number; y: number; v: View; moving: boolean } | null>(null);
  const pinch = useRef<{ d: number; v: View; cx: number; cy: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, v: viewRef.current, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag.current = null;
      return;
    }
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, v: viewRef.current, moving: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    const p = pinch.current;
    if (p && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const z = zoomAt(p.v, Math.hypot(a.x - b.x, a.y - b.y) / p.d, p.cx, p.cy);
      setView({ ...z, x: z.x + (a.x + b.x) / 2 - p.cx, y: z.y + (a.y + b.y) / 2 - p.cy });
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moving && Math.hypot(dx, dy) < DRAG_PX) return;
    // Captured only once it is a drag: a plain press keeps its click on the box under it.
    if (!d.moving) { d.moving = true; setGrabbing(true); box.current?.setPointerCapture(e.pointerId); }
    setView({ ...d.v, x: d.v.x + dx, y: d.v.y + dy });
  };
  const onUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.id === e.pointerId) { drag.current = null; setGrabbing(false); }
  };

  // What the hovered box touches.
  const near = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const e of graph.edges) if (e.from === hover || e.to === hover) { s.add(e.from); s.add(e.to); }
    return s;
  }, [hover, graph]);

  const colour = (e: GraphEdge) => (e.loop ? tk.status.warning : e.kind === 'value' ? tk.accent.base : tk.kind.expr);
  const markers: Array<[string, string]> = [['value', tk.accent.base], ['signal', tk.kind.expr], ['loop', tk.status.warning]];
  const empty = !graph.nodes.length;

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: tk.bg.app }}>
      <div ref={box} data-play-graph="" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: grabbing ? 'grabbing' : 'grab', backgroundImage: `radial-gradient(${tk.text.disabled} 1px, transparent 1px)`, backgroundSize: `${20 * view.k}px ${20 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: '0 0' }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
            <defs>
              {markers.map(([id, c]) => (
                <marker key={id} id={`pg-arrow-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L8,4 L0,8 z" fill={c} />
                </marker>
              ))}
            </defs>
            {graph.edges.map(e => {
              const a = layout.nodes.get(e.from), b = layout.nodes.get(e.to);
              if (!a || !b) return null;
              const { d, mid } = wirePathOf(a, b);
              const c = colour(e);
              const lit = !near || (near.has(e.from) && near.has(e.to) && (e.from === hover || e.to === hover));
              return (
                <g key={e.id} data-edge={e.kind} data-loop={e.loop || undefined} opacity={lit ? 1 : 0.15}>
                  <path d={d} fill="none" stroke={c} strokeWidth={e.loop ? 2.4 : 1.6} strokeDasharray={e.kind === 'signal' ? '5 4' : undefined} markerEnd={`url(#pg-arrow-${e.loop ? 'loop' : e.kind})`} />
                  {e.label && (
                    <g transform={`translate(${mid.x} ${mid.y})`}>
                      <rect x={-e.label.length * 3 - 5} y={-8} width={e.label.length * 6 + 10} height={16} rx={8} fill={tk.bg.panel} stroke={alpha(c, 0.5)} />
                      <text textAnchor="middle" dy="3.5" style={{ font: `600 10px ${fontFamily.ui}`, fill: c }}>{e.label}</text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {graph.groups.map(g => {
            const gb = layout.groups.get(g.id);
            if (!gb) return null;
            if (g.kind === 'control') {
              const layerId = g.id.startsWith('grp:layer:') ? g.id.slice(10) : '';
              return (
                <div key={g.id} data-graph-group={g.id} style={{ position: 'absolute', left: gb.x, top: gb.y, width: gb.w, height: gb.h, borderRadius: radius.md, background: tk.bg.panel, border: `1px solid ${tk.border.default}`, boxShadow: tk.shadow.card }}>
                  <div title={layerId ? 'Show this layer' : undefined} onClick={layerId ? () => usePlayUi.getState().reveal(layerId) : undefined}
                    style={{ height: GRAPH_HEAD_H, display: 'flex', alignItems: 'center', gap: 5, padding: '0 8px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.head, borderRadius: `${radius.md}px ${radius.md}px 0 0`, font: `650 10.5px ${fontFamily.ui}`, color: tk.text.secondary, cursor: layerId ? 'pointer' : undefined, letterSpacing: 0.2 }}>
                    <Icon name={layerId ? 'layers' : g.id === 'grp:graph' ? 'nodes' : 'sliders'} size={11} style={{ color: tk.text.faint }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
                  </div>
                </div>
              );
            }
            return null;
          })}
          {graph.nodes.map(n => {
            const b = layout.nodes.get(n.id);
            if (!b) return null;
            const inGroup = graph.groups.find(g => g.id === n.group)?.kind === 'control';
            const loop = n.shape === 'loop';
            const dim = !!near && !near.has(n.id);
            const icon: IconName = n.kind === 'source' ? 'wave' : n.kind === 'rule' ? 'bolt' : n.kind === 'layer' ? 'layers' : 'sliders';
            const accent = n.kind === 'source' ? tk.accent.base : n.kind === 'rule' ? (loop ? tk.status.warning : tk.kind.expr) : n.kind === 'layer' ? tk.kind.expr : tk.text.faint;
            return (
              <button key={n.id} type="button" data-graph-node={n.id} title={`${n.label} — open`}
                onClick={() => openNode(n)} onPointerEnter={() => setHover(n.id)} onPointerLeave={() => setHover(h => (h === n.id ? '' : h))}
                style={{
                  position: 'absolute', left: b.x + (inGroup ? 4 : 0), top: b.y + (inGroup ? 1 : 0), width: b.w - (inGroup ? 8 : 0), height: b.h - (inGroup ? 2 : 0),
                  display: 'flex', flexDirection: n.kind === 'rule' ? 'column' : 'row', alignItems: n.kind === 'rule' ? 'flex-start' : 'center', justifyContent: 'center', gap: n.kind === 'rule' ? 3 : 6,
                  padding: '0 8px', margin: 0, textAlign: 'left', cursor: 'pointer', font: `${n.kind === 'control' ? 500 : 600} 11.5px ${fontFamily.ui}`, color: tk.text.primary,
                  background: inGroup ? (hover === n.id ? tk.bg.hover : 'transparent') : tk.bg.panel,
                  border: inGroup ? 'none' : `1px solid ${loop ? tk.status.warning : hover === n.id ? accent : tk.border.default}`,
                  boxShadow: inGroup ? undefined : `inset 3px 0 0 ${accent}${loop ? `, 0 0 0 2px ${alpha(tk.status.warning, 0.25)}` : ''}`,
                  borderRadius: inGroup ? radius.sm : radius.md, opacity: dim ? 0.35 : n.idle ? 0.6 : 1,
                }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, width: '100%' }}>
                  <Icon name={icon} size={12} style={{ flexShrink: 0, color: accent }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{n.label}</span>
                </span>
                {n.kind === 'rule' && n.shape && <ShapeBadge shape={n.shape} />}
              </button>
            );
          })}
        </div>
        {empty && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.muted, font: `12px ${fontFamily.ui}`, pointerEvents: 'none' }}>
            Nothing to draw yet: add a source, a control or a rule.
          </div>
        )}
      </div>
      <div style={{ position: 'absolute', left: 12, bottom: 12, display: 'flex', alignItems: 'center', gap: 12, padding: '5px 10px', borderRadius: radius.md, background: alpha(tk.bg.panel, 0.92), border: `1px solid ${tk.border.default}`, font: `11px ${fontFamily.ui}`, color: tk.text.muted, pointerEvents: 'none' }}>
        <Key colour={tk.accent.base} label="Value" />
        <Key colour={tk.kind.expr} label="Signal" dashed />
        <Key colour={tk.status.warning} label="Loop" dashed thick />
      </div>
      <div style={{ position: 'absolute', right: 12, bottom: 12, display: 'flex', gap: 4 }}>
        <Button size="sm" icon="minus" aria-label="Zoom out" onClick={() => { const el = box.current!; setView(v => zoomAt(v, 1 / 1.25, el.clientWidth / 2, el.clientHeight / 2)); }} />
        <Button size="sm" icon="plus" aria-label="Zoom in" onClick={() => { const el = box.current!; setView(v => zoomAt(v, 1.25, el.clientWidth / 2, el.clientHeight / 2)); }} />
        <Button size="sm" icon="fit" onClick={fit}>Fit</Button>
      </div>
    </div>
  );
}

/** One entry in the key: a short wire and its name. */
function Key({ colour, label, dashed, thick }: { colour: string; label: string; dashed?: boolean; thick?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke={colour} strokeWidth={thick ? 2.4 : 1.6} strokeDasharray={dashed ? '5 4' : undefined} /></svg>
      {label}
    </span>
  );
}
