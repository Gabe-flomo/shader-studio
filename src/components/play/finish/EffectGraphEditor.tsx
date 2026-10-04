/**
 * EffectGraphEditor — the Look effect editor's Nodes tab: a small node canvas
 * for one effect. The same node definitions as the Studio (their settings,
 * ranges and GLSL), on a reduced editor of its own: the Studio's graph editor
 * is bound to the one open graph (a single store), so it can't host a second,
 * separate graph inside the Play page.
 *
 * Fixed nodes: **Effect inputs** (Picture colour, UV 0–1, Centred UV, Time)
 * on the left and **Effect output** (Colour). Drag from an output dot to an
 * input dot to wire; press a wired input to pick its wire up again; drag a
 * card by its title; drag the background (or scroll) to pan, ctrl/⌘-scroll
 * or − / + to zoom, Fit to see it all; Delete removes the selected node. A node added from + Add node that takes and gives a colour goes into
 * the chain just before the output.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { IconButton } from '../../ui/Button';
import { RulerSlider } from '../../ui/RulerSlider';
import { Select } from '../../ui/Select';
import { Toggle } from '../../ui/Choice';
import { ColorSwatch } from '../../ui/ColorPicker';
import { GroupedPicker, type PickerSection } from '../../ui/GroupedPicker';
import { TYPE_COLORS } from '../../NodeGraph/typeColors';
import { getNodeDefinition } from '../../../nodes/definitions';
import { isParamVisible } from '../../../compiler/uniformPatcher';
import { paramSliderRange } from '../../../nodes/sliderRange';
import type { DataType, ParamDef } from '../../../types/nodeGraph';
import {
  canWire, colourSockets, effectPaletteDefs, FX_IN_ID, FX_IN_TYPE, FX_OUT_TYPE, FX_PICTURE_AT_TYPE, newEffectGraphNode, nextEffectNodeId,
  type EffectGraph, type EffectGraphNode,
} from '../../../play/lookGraph';
import { graphWires, HEAD_H, layoutNodes, NODE_W, nodeBox, ROW_H, wirePath, type NodeBox } from './effectGraphLayout';

const PICTURE_AT = '__pictureAt';

export function EffectGraphEditor({ graph, onChange, touch = false }: { graph: EffectGraph; onChange: (g: EffectGraph) => void; touch?: boolean }) {
  const tk = useTokens();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 24, y: 12, z: 1 });
  const innerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [wireDrag, setWireDrag] = useState<{ from: string; out: string; type: DataType; a: { x: number; y: number }; at: { x: number; y: number } } | null>(null);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  const boxes = useMemo(() => layoutNodes(graph).map(nodeBox), [graph]);
  const wires = useMemo(() => graphWires(graph), [graph]);

  const toLocal = (clientX: number, clientY: number) => {
    const r = canvasRef.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0) - pan.x) / pan.z, y: (clientY - (r?.top ?? 0) - pan.y) / pan.z };
  };
  const setNodes = (fn: (nodes: EffectGraphNode[]) => EffectGraphNode[]) => onChange({ ...graphRef.current, nodes: fn(graphRef.current.nodes) });

  // ── Dragging: the background pans, a title moves its card ──
  const drag = (ev: RPointerEvent, move: (dx: number, dy: number) => void) => {
    const x0 = ev.clientX, y0 = ev.clientY;
    const onMove = (e: PointerEvent) => move(e.clientX - x0, e.clientY - y0);
    const onUp = () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const startPan = (ev: RPointerEvent) => {
    if (ev.target !== ev.currentTarget && !(ev.target as HTMLElement).dataset?.bg) return;
    setSelected(null);
    const p0 = pan;
    drag(ev, (dx, dy) => setPan({ ...p0, x: p0.x + dx, y: p0.y + dy }));
  };
  const startMove = (ev: RPointerEvent, id: string) => {
    ev.stopPropagation();
    setSelected(id);
    if (id === FX_IN_ID) return;
    const n = graphRef.current.nodes.find(m => m.id === id);
    if (!n) return;
    const { x, y } = n;
    const z = pan.z;
    drag(ev, (dx, dy) => setNodes(ns => ns.map(m => (m.id === id ? { ...m, x: Math.round(x + dx / z), y: Math.round(y + dy / z) } : m))));
  };

  // ── Wires: from an output dot to an input dot ──
  const startWire = (ev: RPointerEvent, from: string, out: string, type: DataType, a: { x: number; y: number }) => {
    ev.stopPropagation();
    ev.preventDefault();
    setWireDrag({ from, out, type, a, at: toLocal(ev.clientX, ev.clientY) });
    const onMove = (e: PointerEvent) => setWireDrag(w => (w ? { ...w, at: toLocal(e.clientX, e.clientY) } : w));
    const onUp = (e: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setWireDrag(null);
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-in-socket]');
      if (!el) return;
      const to = el.dataset.node!, key = el.dataset.key!, toType = el.dataset.type as DataType;
      const target = graphRef.current.nodes.find(m => m.id === to);
      if (!target || to === from || !canWire(type, toType, target.type)) return;
      setNodes(ns => ns.map(m => (m.id === to ? { ...m, wires: { ...(m.wires ?? {}), [key]: [from, out] } } : m)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  /** Pressing a wired input picks its wire up (drop it elsewhere, or on nothing to remove it). */
  const pickUpWire = (ev: RPointerEvent, node: EffectGraphNode, key: string) => {
    const w = node.wires?.[key];
    if (!w) return;
    const src = boxes.find(b => b.node.id === w[0]);
    const srcType = src?.outputs.find(o => o.key === w[1])?.type as DataType | undefined;
    if (!src || !srcType) return;
    const rest = { ...(node.wires ?? {}) };
    delete rest[key];
    setNodes(ns => ns.map(m => (m.id === node.id ? { ...m, wires: rest } : m)));
    const a = { x: src.node.x + NODE_W, y: src.node.y + HEAD_H + src.outputs.findIndex(o => o.key === w[1]) * ROW_H + ROW_H / 2 };
    startWire(ev, w[0], w[1], srcType, a);
  };

  const remove = (id: string) => {
    const n = graphRef.current.nodes.find(m => m.id === id);
    if (!n || n.type === FX_OUT_TYPE) return;
    // Whatever went in by colour comes out where it went: removing a node from the chain keeps the chain.
    const inWire = Object.values(n.wires ?? {})[0];
    setNodes(ns => ns.filter(m => m.id !== id).map(m => {
      if (!m.wires) return m;
      const wires: Record<string, [string, string]> = {};
      for (const [k, w] of Object.entries(m.wires)) {
        if (w[0] !== id) wires[k] = w;
        else if (m.type === FX_OUT_TYPE && inWire) wires[k] = inWire;
      }
      return { ...m, wires };
    }));
    setSelected(null);
  };
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) { e.preventDefault(); remove(selected); }
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // ── Seeing it all: fit the cards (measured as laid out) into the canvas; zoom about a point ──
  const fit = () => {
    const c = canvasRef.current, inner = innerRef.current;
    if (!c || !inner) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of inner.querySelectorAll<HTMLElement>('[data-node-id]')) {
      x0 = Math.min(x0, el.offsetLeft); y0 = Math.min(y0, el.offsetTop);
      x1 = Math.max(x1, el.offsetLeft + el.offsetWidth); y1 = Math.max(y1, el.offsetTop + el.offsetHeight);
    }
    if (!Number.isFinite(x0)) return;
    const W = c.clientWidth, H = c.clientHeight, m = 28;
    const z = Math.max(0.35, Math.min(1, (W - m * 2) / (x1 - x0), (H - m * 2) / (y1 - y0)));
    setPan({ z, x: (W - (x1 - x0) * z) / 2 - x0 * z, y: Math.min(m, (H - (y1 - y0) * z) / 2) - y0 * z });
  };
  useLayoutEffect(() => { const t = requestAnimationFrame(fit); return () => cancelAnimationFrame(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomAt = (factor: number, cx?: number, cy?: number) => setPan(p => {
    const c = canvasRef.current;
    const px = cx ?? (c ? c.clientWidth / 2 : 0), py = cy ?? (c ? c.clientHeight / 2 : 0);
    const z = Math.max(0.3, Math.min(1.6, p.z * factor));
    return { z, x: px - (px - p.x) * (z / p.z), y: py - (py - p.y) * (z / p.z) };
  });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top); }
      else setPan(p => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Adding nodes ──
  const sections: PickerSection[] = useMemo(() => {
    const groups = new Map<string, PickerSection['items'][number][]>();
    for (const d of effectPaletteDefs()) {
      const list = groups.get(d.category) ?? [];
      list.push({ value: d.type, label: d.label, description: (d.description ?? '').split(/(?<=\.)\s/)[0].slice(0, 90), keywords: `${d.category} ${(d.aliases ?? []).join(' ')}` });
      groups.set(d.category, list);
    }
    return [
      { heading: 'The picture', items: [{ value: PICTURE_AT, label: 'Picture at', description: 'The picture read at another point (blurs, offsets, edges)', icon: 'eye' }] },
      ...[...groups].map(([heading, items]) => ({ heading, items })),
    ];
  }, []);
  const add = (value: string) => {
    if (!value) return;
    const g = graphRef.current;
    const r = canvasRef.current?.getBoundingClientRect();
    const out = g.nodes.find(n => n.type === FX_OUT_TYPE);
    let x = ((r ? r.width / 2 : 300) - pan.x) / pan.z - NODE_W / 2, y = (40 - pan.y) / pan.z + (g.nodes.length % 4) * 24;
    if (value === PICTURE_AT) {
      const n: EffectGraphNode = { id: nextEffectNodeId(g), type: FX_PICTURE_AT_TYPE, x: Math.round(x), y: Math.round(y + 140) };
      onChange({ ...g, nodes: [...g.nodes, n] });
      setSelected(n.id);
      return;
    }
    const def = getNodeDefinition(value);
    if (!def) return;
    const cs = colourSockets(def);
    const into = out?.wires?.color;
    if (cs && out) {
      // Into the chain, just before the output: the output moves right to make room.
      x = out.x;
      y = out.y;
    }
    const n = newEffectGraphNode(g, value, x, y);
    let nodes = [...g.nodes, n];
    if (cs && out) {
      n.wires = { [cs.input]: into ?? [FX_IN_ID, 'color'] };
      nodes = nodes.map(m => (m.id === out.id ? { ...m, x: m.x + NODE_W + 60, wires: { ...(m.wires ?? {}), color: [n.id, cs.output] } } : m));
    }
    onChange({ ...g, nodes });
    setSelected(n.id);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 220 }}>
          <GroupedPicker value="" placeholder="+ Add node" ariaLabel="Add a node" title="Add a node" sections={sections} onChange={add} width={320} search />
        </div>
        <IconButton icon="minus" size="sm" label="Zoom out" onClick={() => zoomAt(1 / 1.2)} />
        <IconButton icon="plus" size="sm" label="Zoom in" onClick={() => zoomAt(1.2)} />
        <IconButton icon="fit" size="sm" label="Fit the graph in view" onClick={fit} />
        <span style={{ flex: 1, color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>
          Drag from a dot on the right of a node to a dot on the left of another. Press a wired dot to move its wire. Delete removes the selected node.
        </span>
      </div>
      <div
        ref={canvasRef}
        tabIndex={0}
        aria-label="Effect nodes"
        data-bg="1"
        onPointerDown={startPan}
        style={{
          position: 'relative', flex: 1, minHeight: 260, overflow: 'hidden', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, outline: 'none',
          background: tk.bg.app, backgroundImage: `radial-gradient(${tk.text.disabled} 1px, transparent 1px)`,
          backgroundSize: `${18 * pan.z}px ${18 * pan.z}px`, backgroundPosition: `${pan.x}px ${pan.y}px`, cursor: 'grab', touchAction: 'none',
        }}
      >
        <div ref={innerRef} data-bg="1" style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.z})` }}>
          <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
            {wires.map(w => <path key={`${w.to}:${w.key}`} d={wirePath(w.a, w.b)} fill="none" stroke={TYPE_COLORS[w.type] ?? tk.text.faint} strokeWidth={2.5} />)}
            {wireDrag && <path d={wirePath(wireDrag.a, wireDrag.at)} fill="none" stroke={TYPE_COLORS[wireDrag.type] ?? tk.text.faint} strokeWidth={2.5} strokeDasharray="6 4" />}
          </svg>
          {boxes.map(b => (
            <NodeCard key={b.node.id} box={b} selected={selected === b.node.id} touch={touch}
              onHeadDown={ev => startMove(ev, b.node.id)}
              onOutDown={(ev, key, type, a) => startWire(ev, b.node.id, key, type, a)}
              onInDown={(ev, key) => pickUpWire(ev, b.node, key)}
              onRemove={() => remove(b.node.id)}
              onParams={patch => setNodes(ns => ns.map(m => (m.id === b.node.id ? { ...m, params: { ...(m.params ?? {}), ...patch } } : m)))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function NodeCard({ box, selected, touch, onHeadDown, onOutDown, onInDown, onRemove, onParams }: {
  box: NodeBox;
  selected: boolean;
  touch: boolean;
  onHeadDown: (ev: RPointerEvent) => void;
  onOutDown: (ev: RPointerEvent, key: string, type: DataType, a: { x: number; y: number }) => void;
  onInDown: (ev: RPointerEvent, key: string) => void;
  onRemove: () => void;
  onParams: (patch: Record<string, unknown>) => void;
}) {
  const tk = useTokens();
  const n = box.node;
  const io = n.type === FX_IN_TYPE || n.type === FX_OUT_TYPE || n.type === FX_PICTURE_AT_TYPE;
  const rows = Math.max(box.inputs.length, box.outputs.length);
  const dot = (type: string, filled: boolean): React.CSSProperties => ({
    position: 'absolute', top: ROW_H / 2 - 6, width: 12, height: 12, borderRadius: '50%', boxSizing: 'border-box',
    border: `2px solid ${TYPE_COLORS[type] ?? tk.text.faint}`, background: filled ? TYPE_COLORS[type] ?? tk.text.faint : tk.bg.panel, cursor: 'crosshair',
  });
  return (
    <div
      data-node-id={n.id}
      onPointerDown={ev => ev.stopPropagation()}
      style={{
        position: 'absolute', left: n.x, top: n.y, width: NODE_W, borderRadius: 8, background: tk.bg.panel,
        border: `1.5px solid ${selected ? tk.accent.base : io ? alpha(tk.accent.base, 0.45) : tk.border.strong}`, boxShadow: tk.shadow.card, cursor: 'default',
      }}
    >
      <div onPointerDown={onHeadDown} style={{
        height: HEAD_H, display: 'flex', alignItems: 'center', gap: 4, padding: '0 4px 0 9px', borderRadius: '7px 7px 0 0',
        background: io ? alpha(tk.accent.base, 0.14) : tk.bg.head, cursor: n.type === FX_IN_TYPE ? 'default' : 'move', userSelect: 'none',
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.primary, font: `650 11.5px ${fontFamily.ui}` }}>{box.label}</span>
        {n.type !== FX_IN_TYPE && n.type !== FX_OUT_TYPE && <IconButton icon="close" size="sm" label={`Remove ${box.label}`} onClick={onRemove} />}
      </div>
      <div style={{ position: 'relative', height: rows * ROW_H }}>
        {Array.from({ length: rows }, (_, i) => {
          const inp = box.inputs[i], out = box.outputs[i];
          const wired = !!(inp && n.wires?.[inp.key]);
          return (
            <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * ROW_H, height: ROW_H, display: 'flex', alignItems: 'center', font: `11px ${fontFamily.ui}`, color: tk.text.muted }}>
              {inp && (
                <div data-in-socket="1" data-node={n.id} data-key={inp.key} data-type={inp.type} title={`${inp.label} (${inp.type})${wired ? ': press to move its wire' : ''}`}
                  onPointerDown={ev => { if (wired) { ev.stopPropagation(); onInDown(ev, inp.key); } }}
                  style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', paddingLeft: 11 }}>
                  <span style={{ ...dot(inp.type, wired), left: -6 }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.label}</span>
                </div>
              )}
              {!inp && <span style={{ flex: 1 }} />}
              {out && (
                <div title={`${out.label} (${out.type}): drag to wire`}
                  onPointerDown={ev => onOutDown(ev, out.key, out.type as DataType, { x: n.x + NODE_W, y: n.y + HEAD_H + i * ROW_H + ROW_H / 2 })}
                  style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 11, cursor: 'crosshair' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out.label}</span>
                  <span style={{ ...dot(out.type, true), right: -6 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
      {!io && <NodeParams node={n} touch={touch} onParams={onParams} />}
      {/* The node's comment (as on a Studio card): it also goes into the code, above the node's lines. */}
      {typeof n.params?.__comment === 'string' && n.params.__comment.trim() && (
        <div style={{ padding: '4px 9px 0', color: tk.text.faint, font: `italic 10.5px/1.35 ${fontFamily.ui}` }}>{n.params.__comment}</div>
      )}
      {!io && <div style={{ height: 6 }} />}
    </div>
  );
}

/** A node's settings, as on its Studio card (sliders, menus, switches, colours). A setting whose socket is wired isn't shown. */
function NodeParams({ node, touch, onParams }: { node: EffectGraphNode; touch: boolean; onParams: (patch: Record<string, unknown>) => void }) {
  const tk = useTokens();
  const def = getNodeDefinition(node.type);
  if (!def?.paramDefs) return null;
  const params = { ...(def.defaultParams ?? {}), ...(node.params ?? {}) };
  const rows = Object.entries(def.paramDefs).filter(([key, pd]) => !key.startsWith('__') && isParamVisible(pd, params, def.defaultParams) && !node.wires?.[key]
    && (pd.type === 'float' || pd.type === 'int' || pd.type === 'select' || pd.type === 'bool' || pd.type === 'vec3color'));
  if (!rows.length) return null;
  const label = (pd: ParamDef) => (
    <span title={pd.hint} style={{ width: 62, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.faint, font: `600 9.5px ${fontFamily.ui}`, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{pd.label}</span>
  );
  return (
    <div onPointerDown={ev => ev.stopPropagation()} style={{ padding: '2px 8px 0', display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${tk.border.subtle}` }}>
      {rows.map(([key, pd]) => {
        const v = params[key];
        let body: React.ReactNode = null;
        if (pd.type === 'float' || pd.type === 'int') {
          const { min, max } = paramSliderRange(params, key, pd);
          const value = typeof v === 'number' ? v : 0;
          body = <RulerSlider value={value} min={Math.min(min, value)} max={Math.max(max, value)} step={pd.step ?? (pd.type === 'int' ? 1 : undefined)} integer={pd.type === 'int'} defaultValue={def.defaultParams?.[key] as number | undefined} onChange={x => onParams({ [key]: x })} ariaLabel={`${def.label} ${pd.label}`} touch={touch} />;
        } else if (pd.type === 'select') {
          body = <Select value={String(v ?? '')} options={(pd.options ?? []).map(o => ({ value: o.value, label: o.label }))} onChange={x => onParams({ [key]: x })} ariaLabel={`${def.label} ${pd.label}`} height={24} />;
        } else if (pd.type === 'bool') {
          body = <Toggle checked={!!v} onChange={x => onParams({ [key]: x })} />;
        } else if (pd.type === 'vec3color') {
          const rgb = Array.isArray(v) && v.length >= 3 ? [v[0], v[1], v[2]] as [number, number, number] : [1, 1, 1] as [number, number, number];
          body = <ColorSwatch value={rgb} onChange={x => onParams({ [key]: [...x] })} label={pd.label} size="sm" showHex={false} />;
        }
        return <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 24 }}>{label(pd)}<div style={{ flex: 1, minWidth: 0 }}>{body}</div></div>;
      })}
    </div>
  );
}
