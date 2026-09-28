/**
 * ControlsBoard — the Controls page laid out wide (the rail's full-width page
 * and the split panel's Controls section): controls grouped by where they
 * come from (controlGroups.ts: a rack, a layer, the audio readers, a group
 * the author named, the graph), each group folding, with a live graph of
 * every control's recent values under its slider (controlTrace.ts), filters,
 * and an isolated strip at the top for the graphs you pin.
 *
 * The cards are PlayPage's own (sliders, colours, buttons and pairs stay
 * usable); the board only adds a trace slot to each and draws every slot
 * of a group on one canvas laid over the group, from one shared
 * requestAnimationFrame loop that runs only while a group or the strip is
 * on screen. Values never go through React state.
 *
 * "Flat grid" puts the old single grid back (remembered on this device).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius, type Tokens } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playEngine } from '../../lib/playEngine';
import { readControlValue } from '../../play/playControls';
import { pairOf } from '../../play/pairs';
import { parseReaderTarget, type PlayControl, type PlayRecord } from '../../types/play';
import { Button, IconButton } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Select } from '../ui/Select';
import { usePlayUi } from './playUi';
import { addTraceDrawer, normalise, setTraceSource, traceBuffer, type TraceSample } from './controlTrace';
import { boardGroupList, groupControls, type ControlOriginKind, type KindFilter, type MappedFilter } from './controlGroups';

export type TraceKind = 'line' | 'level' | 'step' | 'colour' | 'xy';

/** What the board hands a card: the slot its graph is drawn in, and isolating it. */
export interface BoardSlot {
  trace: ReactNode;
  onIsolate: () => void;
  isolated: boolean;
}

const FLAT_KEY = 'shader-studio:play:controlsFlat';

interface BoardUi {
  /** Trace keys pinned to the isolated strip (a control id, or `pair:<id>`). */
  pinned: string[];
  togglePin: (key: string) => void;
  clearPins: () => void;
  flat: boolean;
  setFlat: (flat: boolean) => void;
}

export const useControlBoard = create<BoardUi>((set, get) => ({
  pinned: [],
  togglePin: key => set({ pinned: get().pinned.includes(key) ? get().pinned.filter(k => k !== key) : [...get().pinned, key] }),
  clearPins: () => set({ pinned: [] }),
  flat: (() => { try { return localStorage.getItem(FLAT_KEY) === '1'; } catch { return false; } })(),
  setFlat: flat => { try { localStorage.setItem(FLAT_KEY, flat ? '1' : '0'); } catch { /* preference only */ } set({ flat }); },
}));

/** A control's (or a pair's) trace key and how it's drawn. */
export function traceKeyOf(c: PlayControl, play: PlayRecord): { key: string; kind: TraceKind } {
  const pair = pairOf(play, c.id);
  if (pair) return { key: `pair:${pair.id}`, kind: 'xy' };
  if (c.kind === 'color') return { key: c.id, kind: 'colour' };
  if (c.kind === 'action') return { key: c.id, kind: 'step' };
  return { key: c.id, kind: parseReaderTarget(c.target) ? 'level' : 'line' };
}

/** Every trace's reading right now (the sampler calls this TRACE_HZ times a second). */
export function sampleBoard(): TraceSample[] {
  const { play, nodes } = useNodeGraphStore.getState();
  const read = (c: PlayControl): number | number[] => {
    const live = playEngine.liveValue(c.id);
    if (live !== undefined) return Array.isArray(live) ? [live[0], live[1], live[2]] : live;
    const v = readControlValue(nodes, c.target, play);
    return v === undefined ? (c.kind === 'color' ? [0, 0, 0] : c.kind === 'action' ? 0 : c.min) : v;
  };
  const out: TraceSample[] = [];
  for (const c of play.controls) {
    const pair = pairOf(play, c.id);
    if (pair) {
      if (pair.a !== c.id) continue;
      const b = play.controls.find(x => x.id === pair.b);
      const va = read(c), vb = b ? read(b) : 0;
      out.push([`pair:${pair.id}`, [typeof va === 'number' ? va : 0, typeof vb === 'number' ? vb : 0], 2]);
      continue;
    }
    const v = read(c);
    if (c.kind === 'color') out.push([c.id, Array.isArray(v) ? v : [v, v, v], 3]);
    else out.push([c.id, typeof v === 'number' ? v : 0, 1]);
  }
  return out;
}

/** The slot a card's graph is drawn into (the group's canvas finds it by its data attributes). */
export function TraceSlot({ traceKey, kind, min, max, min2, max2, height = 30 }: { traceKey: string; kind: TraceKind; min: number; max: number; min2?: number; max2?: number; height?: number }) {
  const tk = useTokens();
  return (
    <div
      aria-hidden
      data-trace-slot=""
      data-trace-key={traceKey}
      data-trace-kind={kind}
      data-min={min}
      data-max={max}
      data-min2={min2 ?? min}
      data-max2={max2 ?? max}
      style={{ height, marginTop: 8, borderRadius: 4, background: alpha(tk.text.faint, 0.07) }}
    />
  );
}

const ORIGIN_ICONS: Record<ControlOriginKind, IconName> = {
  group: 'folder', rack: 'piano', layer: 'layers', readers: 'wave', finish: 'curve', sound: 'wave', graph: 'sliders',
};

const GRID: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(300px, 100%), 1fr))', columnGap: 10, alignItems: 'start' };

export function ControlsBoard({ play, renderCard, drivenBy, flatView }: {
  play: PlayRecord;
  /** A control's card (PlayPage's), with the board's slot. */
  renderCard: (c: PlayControl, index: number, slot: BoardSlot) => ReactNode;
  /** What drives a trace (its mappings' sources), for the isolated strip. */
  drivenBy: (key: string) => string[];
  /** The old single grid, for Flat grid. */
  flatView: ReactNode;
}) {
  const tk = useTokens();
  const flat = useControlBoard(s => s.flat), setFlat = useControlBoard(s => s.setFlat);
  const pinned = useControlBoard(s => s.pinned), togglePin = useControlBoard(s => s.togglePin), clearPins = useControlBoard(s => s.clearPins);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [mapped, setMapped] = useState<MappedFilter>('all');
  const [kind, setKind] = useState<KindFilter>('all');
  const allGroups = useMemo(() => boardGroupList(play), [play]);
  const shownGroup = allGroups.some(g => g.id === group) ? group : 'all';
  const groups = useMemo(() => groupControls(play, { query, group: shownGroup, mapped, kind }), [play, query, shownGroup, mapped, kind]);
  const filtered = query.trim() !== '' || shownGroup !== 'all' || mapped !== 'all' || kind !== 'all';

  useEffect(() => { setTraceSource(sampleBoard); return () => setTraceSource(null); }, []);

  // The pinned traces that still exist, with what they show.
  const pins = pinned.flatMap(key => {
    if (key.startsWith('pair:')) {
      const pair = play.pairs?.find(p => `pair:${p.id}` === key);
      const a = pair && play.controls.find(c => c.id === pair.a), b = pair && play.controls.find(c => c.id === pair.b);
      return pair && a && b ? [{ key, label: pair.label, kind: 'xy' as TraceKind, min: a.min, max: a.max, min2: b.min, max2: b.max, colour: false }] : [];
    }
    const c = play.controls.find(x => x.id === key);
    return c ? [{ key, label: c.label, kind: traceKeyOf(c, play).kind, min: c.kind === 'float' ? c.min : 0, max: c.kind === 'float' ? c.max : 1, min2: 0, max2: 1, colour: c.kind === 'color' }] : [];
  });

  const bar = (
    <div data-board-bar="" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 0 6px' }}>
      {!flat && <>
        <Field placeholder="Search controls" aria-label="Search controls" value={query} onChange={e => setQuery(e.target.value)} height={28} style={{ width: 200 }} leading={<Icon name="search" size={14} style={{ color: tk.text.faint }} />} />
        {allGroups.length > 1 && (
          <Select ariaLabel="Group" value={shownGroup} height={28}
            options={[{ value: 'all', label: `All groups · ${play.controls.length}` }, ...allGroups.map(g => ({ value: g.id, label: `${g.label} · ${g.count}` }))]}
            onChange={setGroup} />
        )}
        <Segmented<MappedFilter> size="sm" ariaLabel="Mapped" value={mapped} onChange={setMapped}
          options={[{ value: 'all', label: 'All' }, { value: 'mapped', label: 'Mapped', title: 'Controls something drives' }, { value: 'unmapped', label: 'Unmapped', title: 'Controls nothing drives yet' }]} />
        <Select ariaLabel="Kind" value={kind} height={28} onChange={v => setKind(v as KindFilter)}
          options={[{ value: 'all', label: 'Every kind' }, { value: 'float', label: 'Sliders' }, { value: 'color', label: 'Colours' }, { value: 'action', label: 'Buttons' }]} />
        {filtered && <Button size="sm" variant="ghost" onClick={() => { setQuery(''); setGroup('all'); setMapped('all'); setKind('all'); }}>Clear</Button>}
      </>}
      <span style={{ flex: 1 }} />
      <IconButton icon="grid" size="sm" active={flat} label={flat ? 'Grouped, with live graphs' : 'Flat grid: every card in one grid, no groups or graphs'} onClick={() => setFlat(!flat)} />
    </div>
  );

  if (flat) return <div data-controls-board="flat">{bar}{flatView}</div>;

  return (
    <div data-controls-board="">
      {bar}
      {pins.length > 0 && (
        <TraceArea id="isolated" style={{ margin: '2px 0 10px', padding: '8px 10px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${alpha(tk.accent.base, 0.4)}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <Icon name="target" size={13} style={{ color: tk.accent.text }} />
            <span style={{ font: `650 12px ${fontFamily.ui}` }}>Isolated</span>
            <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{pins.length}</span>
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="ghost" onClick={clearPins}>Show all</Button>
          </div>
          {pins.map(p => {
            const by = drivenBy(p.key);
            return (
              <div key={p.key} data-isolated={p.key} style={{ marginTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ font: `600 12px ${fontFamily.ui}` }}>{p.label}</span>
                  <span data-trace-stats={p.key} data-colour={p.colour ? '1' : undefined} style={{ color: tk.text.secondary, font: `500 11px ${fontFamily.mono}` }} />
                  <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{by.length ? `Driven by ${by.join(', ')}` : 'Not mapped: moved by hand'}</span>
                  <span style={{ flex: 1 }} />
                  <IconButton icon="close" size="sm" label="Unpin" onClick={() => togglePin(p.key)} />
                </div>
                <TraceSlot traceKey={p.key} kind={p.kind} min={p.min} max={p.max} min2={p.min2} max2={p.max2} height={64} />
              </div>
            );
          })}
        </TraceArea>
      )}
      {groups.length === 0 && <div style={{ padding: '14px 4px', color: tk.text.faint }}>No control matches.</div>}
      {groups.map(g => (
        <BoardGroupView key={g.origin.id} id={g.origin.id} label={g.origin.label} icon={ORIGIN_ICONS[g.origin.kind]} count={g.items.length}>
          {g.items.map(({ control, index }) => {
            const t = traceKeyOf(control, play);
            const pair = pairOf(play, control.id);
            const b = pair ? play.controls.find(x => x.id === pair.b) : undefined;
            const trace = <TraceSlot traceKey={t.key} kind={t.kind} min={control.kind === 'float' ? control.min : 0} max={control.kind === 'float' ? control.max : 1} min2={b?.min} max2={b?.max} height={t.kind === 'xy' ? 44 : 30} />;
            return <div key={control.id} style={{ minWidth: 0 }}>{renderCard(control, index, { trace, onIsolate: () => togglePin(t.key), isolated: pinned.includes(t.key) })}</div>;
          })}
        </BoardGroupView>
      ))}
    </div>
  );
}

function BoardGroupView({ id, label, icon, count, children }: { id: string; label: string; icon: IconName; count: number; children: ReactNode }) {
  const tk = useTokens();
  const key = `board:${id}`;
  const folded = usePlayUi(s => !!s.folded[key]);
  const toggleFold = usePlayUi(s => s.toggleFold);
  return (
    <section data-board-group={id} style={{ marginTop: 6 }}>
      <button type="button" onClick={() => toggleFold(key)} aria-expanded={!folded}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', border: 0, background: 'none', padding: '6px 2px 2px', cursor: 'pointer', color: tk.text.secondary, font: `600 11.5px ${fontFamily.ui}`, textAlign: 'left' }}>
        <Icon name={folded ? 'chevR' : 'chevD'} size={12} style={{ color: tk.text.faint }} />
        <Icon name={icon} size={13} style={{ color: tk.text.faint }} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>{count}</span>
        <span aria-hidden style={{ flex: 1, height: 1, marginLeft: 6, background: tk.border.subtle }} />
      </button>
      {!folded && <TraceArea id={id} style={GRID}>{children}</TraceArea>}
    </section>
  );
}

/**
 * An area whose trace slots are drawn on one canvas laid over it, while it's
 * on screen. Slot positions are measured when the area resizes (and twice a
 * second, for a card opening its details), not every frame.
 */
function TraceArea({ id, style, children }: { id: string; style: React.CSSProperties; children: ReactNode }) {
  const tk = useTokens();
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tkRef = useRef(tk);
  tkRef.current = tk;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const io = new IntersectionObserver(es => setVisible(es.some(e => e.isIntersecting)));
    io.observe(box);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const box = boxRef.current, canvas = canvasRef.current;
    if (!visible || !box || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    type Slot = { key: string; kind: TraceKind; x: number; y: number; w: number; h: number; min: number; max: number; min2: number; max2: number };
    let slots: Slot[] = [];
    let stats: HTMLElement[] = [];
    let dpr = 1;
    const measure = () => {
      dpr = window.devicePixelRatio || 1;
      const r = box.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; }
      slots = Array.from(box.querySelectorAll<HTMLElement>('[data-trace-slot]')).map(el => {
        const s = el.getBoundingClientRect();
        const d = el.dataset;
        return { key: d.traceKey ?? '', kind: (d.traceKind ?? 'line') as TraceKind, x: s.left - r.left, y: s.top - r.top, w: s.width, h: s.height, min: Number(d.min), max: Number(d.max), min2: Number(d.min2), max2: Number(d.max2) };
      });
      stats = Array.from(box.querySelectorAll<HTMLElement>('[data-trace-stats]'));
    };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(box);
    const every = window.setInterval(measure, 500);
    let frame = 0;
    const draw = () => {
      frame++;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
      for (const s of slots) drawTrace(ctx, s, tkRef.current);
      if (frame % 6 === 0) for (const el of stats) el.textContent = statsText(el.dataset.traceStats ?? '', !!el.dataset.colour);
    };
    const stop = addTraceDrawer(draw);
    return () => { stop(); ro?.disconnect(); window.clearInterval(every); };
  }, [visible]);

  return (
    <div ref={boxRef} data-trace-area={id} style={{ ...style, position: 'relative' }}>
      {children}
      <canvas ref={canvasRef} aria-hidden style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 1 }} />
    </div>
  );
}

const fmt = (n: number) => (Number.isFinite(n) ? (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)) : '–');

/** "0.42 · 0.10–0.93 seen" (a pair: both; a colour: its RGB now). */
export function statsText(key: string, colour = false): string {
  const b = traceBuffer(key, key.startsWith('pair:') ? 2 : colour ? 3 : 1);
  if (!b.length) return '';
  if (colour) return `rgb ${[0, 1, 2].map(c => Math.round(b.last(c) * 255)).join(' ')}`;
  if (b.channels === 2) {
    const [a0, a1] = b.seenRange(0), [b0, b1] = b.seenRange(1);
    return `${fmt(b.last(0))}, ${fmt(b.last(1))} · seen ${fmt(a0)}–${fmt(a1)}, ${fmt(b0)}–${fmt(b1)}`;
  }
  return `${fmt(b.last())} · seen ${fmt(b.seenMin)}–${fmt(b.seenMax)}`;
}

function drawTrace(ctx: CanvasRenderingContext2D, s: { key: string; kind: TraceKind; x: number; y: number; w: number; h: number; min: number; max: number; min2: number; max2: number }, tk: Tokens) {
  const b = traceBuffer(s.key, s.kind === 'xy' ? 2 : s.kind === 'colour' ? 3 : 1);
  const n = b.length;
  if (!n || s.w < 4 || s.h < 4) return;
  const pad = 3;
  const x0 = s.x + pad, y0 = s.y + pad, w = s.w - pad * 2, h = s.h - pad * 2;
  const cap = b.capacity;
  // Newest at the right edge; the trace scrolls left as samples come in.
  const xAt = (i: number) => x0 + w - ((n - 1 - i) / Math.max(1, cap - 1)) * w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (s.kind === 'colour') {
    const step = w / Math.max(1, cap - 1);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgb(${Math.round(b.at(i, 0) * 255)},${Math.round(b.at(i, 1) * 255)},${Math.round(b.at(i, 2) * 255)})`;
      ctx.fillRect(xAt(i) - step, y0, step + 0.6, h);
    }
    return;
  }
  if (s.kind === 'xy') {
    // A square pad on the left with the pair's recent path as a fading trail; A and B as thin lines beside it.
    const side = h;
    ctx.strokeStyle = alpha(tk.text.faint, 0.3);
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, side - 1, side - 1);
    for (let i = Math.max(0, n - 60); i < n; i++) {
      const px = x0 + normalise(b.at(i, 0), s.min, s.max) * side, py = y0 + side - normalise(b.at(i, 1), s.min2, s.max2) * side;
      const a = (i - (n - 60)) / 60;
      ctx.fillStyle = alpha(tk.accent.base, Math.max(0.08, a));
      ctx.beginPath();
      ctx.arc(px, py, i === n - 1 ? 2.6 : 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    const lx = x0 + side + 8, lw = w - side - 8;
    if (lw > 20) {
      for (const [ch, lo, hi, a] of [[0, s.min, s.max, 1], [1, s.min2, s.max2, 0.45]] as const) {
        ctx.strokeStyle = alpha(tk.accent.base, a);
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const px = lx + lw - ((n - 1 - i) / Math.max(1, cap - 1)) * lw, py = y0 + h - normalise(b.at(i, ch), lo, hi) * h;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    return;
  }
  const yAt = (i: number) => y0 + h - (s.kind === 'step' ? (b.at(i) >= 0.5 ? 1 : 0) : normalise(b.at(i), s.min, s.max)) * h;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const px = xAt(i), py = yAt(i);
    if (i === 0) ctx.moveTo(px, py);
    else if (s.kind === 'step') { ctx.lineTo(px, yAt(i - 1)); ctx.lineTo(px, py); }
    else ctx.lineTo(px, py);
  }
  if (s.kind === 'level') {
    ctx.save();
    ctx.lineTo(xAt(n - 1), y0 + h);
    ctx.lineTo(xAt(0), y0 + h);
    ctx.closePath();
    ctx.fillStyle = alpha(tk.accent.base, 0.18);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    for (let i = 0; i < n; i++) { const px = xAt(i), py = yAt(i); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }
  }
  ctx.strokeStyle = tk.accent.base;
  ctx.lineWidth = 1.25;
  ctx.stroke();
  ctx.fillStyle = tk.accent.base;
  ctx.beginPath();
  ctx.arc(xAt(n - 1), yAt(n - 1), 2.2, 0, Math.PI * 2);
  ctx.fill();
}
