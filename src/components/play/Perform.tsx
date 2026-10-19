/**
 * Perform — the Stage's default view of the controls (docs/perform-mode.md, Play audit P19):
 * big faders, knobs, switches, XY pads, colour swatches and pads in a grid (S / M / L), with
 * no editing icons, and a bar with Randomize, Reset, Panic and takes. It sits on the left of
 * the picture (the picture is always on the right); on a phone it goes under the picture.
 *
 * Every target is 44 px or more. A control a mapping drives shows its live value and a LIVE
 * mark, and can't be dragged. Faders and knobs: drag, double-click for the home value (what it
 * was when Perform opened), arrow keys step (Shift: bigger steps).
 */
import { LiveBeatBadge } from './live/LiveFields';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { controlExists, readControlValue, targetParts } from '../../play/playControls';
import { mappingLabel } from '../../play/incrementUi';
import { parseLayerTarget, type PlayControl, type PlayPair, type PlayRecord } from '../../types/play';
import { parseFinishTarget, patchFinishEffect } from '../../types/playFinish';
import { parseAudioFxTarget, patchAudioFxEffect } from '../../types/playAudioFx';
import { aeRack, aeSlot, parseAuTarget, parseMacroTarget, patchSlot } from '../../types/playAudioEngine';
import { setMacroValue } from '../../play/rackMacros';
import { playEngine, pairDrives } from '../../lib/playEngine';
import { useTakes } from '../../lib/takes';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Popover } from '../ui/Popover';
import { RulerSlider } from '../ui/RulerSlider';
import { useLiveValues } from './useLiveValues';
import { TakesList } from './TakesList';
import { useStage } from './stageStore';
import {
  PERFORM_CELL, PERFORM_GAP, RANDOM_STRENGTH, WIDGET_SPAN, performItems, performKey, unitOf, valueAt,
  type PerformItem, type PerformSize,
} from '../../play/perform';
import { currentControlValues, panic, randomizeControls, resetControls } from '../../play/performActions';

const TILE = '#14151c';
const TILE_EDGE = alpha('#ffffff', 0.07);
const TEXT = '#e8e8ef';
const MUTED = alpha('#ffffff', 0.55);

/** Write one control's own value (as the Play panel does): graph params, layers, Finish, sound. */
function useControlWrite() {
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  return (c: PlayControl, value: number | number[]) => {
    const ft = parseFinishTarget(c.target);
    if (ft) { if (typeof value === 'number') setPlay(p => ({ ...p, finish: patchFinishEffect(p.finish, ft.effectId, { [ft.key]: value }) })); return; }
    const at = parseAudioFxTarget(c.target);
    if (at) { if (typeof value === 'number') setPlay(p => ({ ...p, audioFx: patchAudioFxEffect(p.audioFx, at.chainId, at.effectId, { [at.key]: value }) })); return; }
    const au = parseAuTarget(c.target);
    if (au) { if (typeof value === 'number') setPlay(p => ({ ...p, audioEngine: patchSlot(p.audioEngine, au.rackId, au.slotId, { params: { ...aeSlot(aeRack(p.audioEngine, au.rackId), au.slotId)?.params, [au.address]: value } }) })); return; }
    const mt = parseMacroTarget(c.target);
    if (mt) { if (typeof value === 'number') setPlay(p => setMacroValue(p, mt.rackId, mt.n, value)); return; }
    const lt = parseLayerTarget(c.target);
    if (lt) { setPlay(p => ({ ...p, layers: p.layers.map(l => (l.id === lt.layerId ? { ...l, [lt.key]: value } as typeof l : l)) })); return; }
    const { nodeId, paramKey } = targetParts(c.target);
    updateNodeParams(nodeId, { [paramKey]: value }, { immediate: true });
  };
}

/** The controls a mapping drives now (a pair's mappings drive its A and/or B too). */
function drivenSet(play: PlayRecord): Set<string> {
  const driven = new Set(play.mappings.filter(m => m.enabled).map(m => m.controlId));
  for (const pm of play.pairMappings ?? []) {
    const pr = pm.enabled ? play.pairs?.find(x => x.id === pm.pairId) : undefined;
    if (pr) for (const id of [pr.a, pr.b]) if (pairDrives(pm, pr, id)) driven.add(id);
  }
  return driven;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 1000 ? v.toFixed(0) : a >= 100 ? v.toFixed(1) : a >= 10 ? v.toFixed(2) : v.toFixed(3).replace(/0$/, '');
}

export function Perform({ onRender, viewInBar = false }: {
  /** A take's Export video… was pressed (the Record dialog opens for it). */
  onRender: () => void;
  /** Show the size and legend (PerformView) in Perform's own bar: on a phone, where the Stage bar has no room. */
  viewInBar?: boolean;
}) {
  const play = useNodeGraphStore(s => s.play);
  const nodes = useNodeGraphStore(s => s.nodes);
  const size = useStage(s => s.size);
  const live = useLiveValues(play);
  const write = useControlWrite();
  const driven = drivenSet(play);
  const shown = useMemo(() => play.controls.filter(c => controlExists(nodes, c, play)), [play, nodes]);
  const items = useMemo(() => performItems(shown, play.pairs ?? []), [shown, play.pairs]);

  // Home: each control's value when Perform opened (Reset goes back to it); a control added later joins with its value then.
  const home = useRef<Map<string, number | number[]> | null>(null);
  if (!home.current) home.current = currentControlValues();
  useEffect(() => {
    const now = currentControlValues();
    for (const [id, v] of now) if (!home.current!.has(id)) home.current!.set(id, v);
  }, [play.controls]);

  const strength = useStage(s => s.strength);
  const doRandomize = () => randomizeControls(useStage.getState().strength);
  const doReset = () => resetControls(home.current!);

  // Keys: ⇧R Randomize, ⇧H Reset, ⇧P Panic (a setup's own key mappings win).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = performKey(e);
      if (!k || playEngine.keyIsBound(e.code)) return;
      e.preventDefault();
      if (k === 'randomize') randomizeControls(useStage.getState().strength);
      else if (k === 'reset') resetControls(home.current!);
      else panic();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const valueOf = (c: PlayControl): number | number[] | undefined => {
    const lv = live.get(c.id);
    if (driven.has(c.id) && lv !== undefined) return lv;
    return readControlValue(nodes, c.target, play);
  };
  const homeOf = (c: PlayControl) => home.current!.get(c.id);

  return (
    <div data-perform style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', color: TEXT }}>
      <PerformBar strength={strength} onRandomize={doRandomize} onReset={doReset} onRender={onRender} play={play} viewInBar={viewInBar} />
      {/* Ableton Live (the Live connector): its tempo and beat while it's connected. */}
      <LiveBeatBadge />
      <PerformGrid size={size} items={items} empty={shown.length === 0} render={item => {
        if (item.kind === 'heading') return <div style={{ alignSelf: 'end', color: MUTED, font: `600 11px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 2px 0' }}>{item.label}</div>;
        if (item.kind === 'xy') {
          const num = (c: PlayControl) => { const v = valueOf(c); return typeof v === 'number' ? v : c.min; };
          return <XYTile pair={item.pair} a={item.a} b={item.b} x={num(item.a)} y={num(item.b)} lockX={driven.has(item.a.id)} lockY={driven.has(item.b.id)}
            onChange={(x, y) => { if (!driven.has(item.a.id)) write(item.a, x); if (!driven.has(item.b.id)) write(item.b, y); }} />;
        }
        const c = item.control;
        const v = valueOf(c);
        const isLive = driven.has(c.id);
        if (item.kind === 'pad') return <PadTile c={c} lit={typeof live.get(c.id) === 'number' && (live.get(c.id) as number) >= 0.5} />;
        if (item.kind === 'swatch') return <SwatchTile c={c} value={Array.isArray(v) ? v : [0, 0, 0]} live={isLive} onChange={x => write(c, x)} />;
        const n = typeof v === 'number' ? v : c.min;
        const h = homeOf(c);
        const toHome = typeof h === 'number' ? () => write(c, h) : undefined;
        if (item.kind === 'toggle') return <ToggleTile c={c} value={n} live={isLive} onChange={x => write(c, x)} />;
        if (item.kind === 'fader') return <FaderTile c={c} value={n} live={isLive} onChange={x => write(c, x)} onHome={toHome} />;
        return <KnobTile c={c} value={n} live={isLive} onChange={x => write(c, x)} onHome={toHome} />;
      }} />
    </div>
  );
}

// ── The grid ────────────────────────────────────────────────────────────────

function PerformGrid({ size, items, empty, render }: { size: PerformSize; items: PerformItem[]; empty: boolean; render: (i: PerformItem) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const cell = PERFORM_CELL[size], gap = PERFORM_GAP[size], pad = 14;
  const inner = Math.max(cell, w - pad * 2);
  const cols = Math.max(1, Math.floor((inner + gap) / (cell + gap)));
  // Square cells: the rows are as tall as a column is wide.
  const colW = cols > 0 ? (inner - gap * (cols - 1)) / cols : cell;
  return (
    <div ref={ref} data-perform-grid data-size={size} data-cols={cols} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad }}>
      {empty ? (
        <div style={{ color: MUTED, lineHeight: 1.5, maxWidth: 360 }}>No controls: people can only watch. Add some on the Play page’s Controls.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoRows: `${Math.round(colW)}px`, gridAutoFlow: 'row dense', gap }}>
          {items.map(item => {
            if (item.kind === 'heading') return <div key={item.key} style={{ gridColumn: '1 / -1', height: 'auto' }}>{render(item)}</div>;
            const span = WIDGET_SPAN[item.kind];
            return (
              <div key={item.key} data-widget={item.kind} style={{ gridColumn: `span ${Math.min(cols, span.cols)}`, gridRow: `span ${span.rows}`, minWidth: 0, minHeight: 0 }}>
                {render(item)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A tile: the label (and LIVE) on top, the widget filling the rest. */
function Tile({ label, live, children, style, ...rest }: { label: string; live?: boolean; children: ReactNode; style?: CSSProperties } & Record<`data-${string}`, string | boolean | undefined>) {
  const tk = useTokens();
  return (
    <div {...rest} style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 14, background: TILE, boxShadow: `inset 0 0 0 1px ${live ? alpha(tk.accent.base, 0.45) : TILE_EDGE}`, display: 'flex', flexDirection: 'column', padding: '9px 10px 10px', gap: 6, overflow: 'hidden', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexShrink: 0 }}>
        <span title={label} style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `600 11.5px ${fontFamily.ui}`, color: alpha('#ffffff', 0.82) }}>{label}</span>
        {live && <span title="A mapping moves it" style={{ color: tk.accent.base, font: `700 9.5px ${fontFamily.ui}`, letterSpacing: '0.06em' }}>LIVE</span>}
      </div>
      {children}
    </div>
  );
}

/** Pointer + keys for a number widget: absolute (faders) or relative (knobs) drags. */
function useNumberDrag(c: PlayControl, value: number, locked: boolean, onChange: (v: number) => void, mode: 'absolute' | 'relative') {
  const drag = useRef<{ startY: number; startU: number; rect: DOMRect } | null>(null);
  const fromY = (y: number, rect: DOMRect) => 1 - (y - rect.top) / Math.max(1, rect.height);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* none to capture */ }
    drag.current = { startY: e.clientY, startU: unitOf(value, c), rect };
    if (mode === 'absolute') onChange(valueAt(fromY(e.clientY, rect), c));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    if (mode === 'absolute') { onChange(valueAt(fromY(e.clientY, d.rect), c)); return; }
    const k = e.shiftKey ? 1000 : 220;
    onChange(valueAt(d.startU + (d.startY - e.clientY) / k, c));
  };
  const end = () => { drag.current = null; };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (locked) return;
    const step = e.shiftKey ? 0.1 : 0.01;
    const u = unitOf(value, c);
    const st = c.step && c.step >= 1 ? c.step / Math.max(1e-9, c.max - c.min) : step;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onChange(valueAt(u + st, c)); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onChange(valueAt(u - st, c)); }
  };
  return { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onKeyDown };
}

function sliderAria(c: PlayControl, value: number, locked: boolean) {
  return { role: 'slider', tabIndex: 0, 'aria-label': c.label, 'aria-valuemin': c.min, 'aria-valuemax': c.max, 'aria-valuenow': value, 'aria-disabled': locked || undefined } as const;
}

function FaderTile({ c, value, live, onChange, onHome }: { c: PlayControl; value: number; live: boolean; onChange: (v: number) => void; onHome?: () => void }) {
  const tk = useTokens();
  const u = unitOf(value, c);
  const h = useNumberDrag(c, value, live, onChange, 'absolute');
  return (
    <Tile label={c.label} live={live} data-fader={c.id}>
      <div {...sliderAria(c, value, live)} {...h} onDoubleClick={() => { if (!live) onHome?.(); }}
        title={live ? 'A mapping moves it' : 'Drag up and down · double-click: back to where it started'}
        style={{ position: 'relative', flex: 1, minHeight: 44, borderRadius: 10, background: '#0c0d12', boxShadow: `inset 0 0 0 1px ${TILE_EDGE}`, touchAction: 'none', cursor: live ? 'default' : 'ns-resize', overflow: 'hidden', outlineOffset: 2 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${u * 100}%`, background: `linear-gradient(to top, ${alpha(tk.accent.base, 0.55)}, ${alpha(tk.accent.base, 0.85)})`, transition: live ? 'height 40ms linear' : undefined }} />
        {/* The cap: a bright line at the value. */}
        <div style={{ position: 'absolute', left: 6, right: 6, bottom: `calc(${u * 100}% - 2px)`, height: 4, borderRadius: 2, background: '#ffffff', boxShadow: `0 0 8px ${alpha(tk.accent.base, 0.8)}` }} />
        {[0.25, 0.5, 0.75].map(t => <div key={t} style={{ position: 'absolute', left: 0, width: 8, bottom: `${t * 100}%`, height: 1, background: alpha('#ffffff', 0.18) }} />)}
      </div>
      <div style={{ font: `500 12px ${fontFamily.mono}`, color: MUTED, textAlign: 'center', flexShrink: 0 }}>{fmt(value)}</div>
    </Tile>
  );
}

function KnobTile({ c, value, live, onChange, onHome }: { c: PlayControl; value: number; live: boolean; onChange: (v: number) => void; onHome?: () => void }) {
  const tk = useTokens();
  const u = unitOf(value, c);
  const h = useNumberDrag(c, value, live, onChange, 'relative');
  // A 270° arc from bottom-left to bottom-right; 0 at the left end (or the middle for a signed range).
  const A0 = 135, SW = 270;
  const polar = (deg: number, r: number) => { const a = (deg * Math.PI) / 180; return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; };
  const arc = (from: number, to: number, r: number) => {
    const [x0, y0] = polar(from, r), [x1, y1] = polar(to, r);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${Math.abs(to - from) > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const zeroU = c.min < 0 && c.max > 0 ? unitOf(0, c) : 0;
  const a = A0 + SW * Math.min(zeroU, u), b = A0 + SW * Math.max(zeroU, u);
  const [px, py] = polar(A0 + SW * u, 30);
  return (
    <Tile label={c.label} live={live} data-knob={c.id}>
      <div {...sliderAria(c, value, live)} {...h} onDoubleClick={() => { if (!live) onHome?.(); }}
        title={live ? 'A mapping moves it' : 'Drag up and down (Shift: finer) · double-click: back to where it started'}
        style={{ flex: 1, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none', cursor: live ? 'default' : 'ns-resize', outlineOffset: 2, position: 'relative' }}>
        <svg viewBox="0 0 100 100" style={{ height: '100%', maxHeight: '100%', aspectRatio: '1', display: 'block' }} aria-hidden>
          <path d={arc(A0, A0 + SW, 40)} fill="none" stroke={alpha('#ffffff', 0.12)} strokeWidth={8} strokeLinecap="round" />
          {b - a > 0.5 && <path d={arc(a, b, 40)} fill="none" stroke={tk.accent.base} strokeWidth={8} strokeLinecap="round" />}
          <circle cx={50} cy={50} r={27} fill="#1d1f28" stroke={alpha('#ffffff', 0.08)} />
          <line x1={50 + (px - 50) * 0.35} y1={50 + (py - 50) * 0.35} x2={px} y2={py} stroke="#ffffff" strokeWidth={4} strokeLinecap="round" />
        </svg>
      </div>
      <div style={{ font: `500 12px ${fontFamily.mono}`, color: MUTED, textAlign: 'center', flexShrink: 0 }}>{fmt(value)}</div>
    </Tile>
  );
}

function ToggleTile({ c, value, live, onChange }: { c: PlayControl; value: number; live: boolean; onChange: (v: number) => void }) {
  const tk = useTokens();
  const lo = Math.min(c.min, c.max), hi = Math.max(c.min, c.max);
  const on = value >= (lo + hi) / 2;
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={c.label} disabled={live} data-toggle={c.id}
      onClick={() => onChange(on ? lo : hi)}
      title={live ? 'A mapping switches it' : on ? 'On: tap to switch off' : 'Off: tap to switch on'}
      style={{ width: '100%', height: '100%', border: 0, padding: 0, background: 'none', cursor: live ? 'default' : 'pointer', color: 'inherit', font: 'inherit', textAlign: 'left' }}>
      <Tile label={c.label} live={live} style={{ background: on ? alpha(tk.accent.base, 0.22) : TILE, boxShadow: `inset 0 0 0 1px ${on ? alpha(tk.accent.base, 0.7) : TILE_EDGE}` }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ width: 22, height: 22, borderRadius: 11, background: on ? tk.accent.base : alpha('#ffffff', 0.12), boxShadow: on ? `0 0 14px ${alpha(tk.accent.base, 0.9)}` : 'none' }} />
        </div>
        <div style={{ font: `700 11px ${fontFamily.ui}`, letterSpacing: '0.08em', color: on ? '#ffffff' : MUTED, textAlign: 'center' }}>{on ? 'ON' : 'OFF'}</div>
      </Tile>
    </button>
  );
}

function PadTile({ c, lit }: { c: PlayControl; lit: boolean }) {
  const tk = useTokens();
  const [down, setDown] = useState(false);
  const hot = down || lit;
  const fire = () => playEngine.fireControl(c.id);
  return (
    <button type="button" aria-label={c.label} data-pad={c.id}
      onPointerDown={e => { if (e.button !== 0) return; setDown(true); fire(); }}
      onPointerUp={() => setDown(false)} onPointerLeave={() => setDown(false)} onPointerCancel={() => setDown(false)}
      onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); setDown(true); fire(); } }}
      onKeyUp={() => setDown(false)}
      style={{
        width: '100%', height: '100%', border: 0, borderRadius: 14, cursor: 'pointer', touchAction: 'manipulation',
        background: hot ? tk.accent.base : `linear-gradient(160deg, ${alpha(tk.accent.base, 0.4)}, ${alpha(tk.accent.base, 0.16)})`,
        boxShadow: hot ? `0 0 22px ${alpha(tk.accent.base, 0.7)}, inset 0 0 0 1px ${alpha('#ffffff', 0.3)}` : `inset 0 0 0 1px ${alpha(tk.accent.base, 0.45)}`,
        color: '#ffffff', font: `650 13px ${fontFamily.ui}`, padding: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', textAlign: 'left',
        transition: 'background 80ms, box-shadow 80ms',
      }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.25 }}>{c.label}</span>
    </button>
  );
}

function SwatchTile({ c, value, live, onChange }: { c: PlayControl; value: number[]; live: boolean; onChange: (v: number[]) => void }) {
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
  const hex = `#${toHex(value[0])}${toHex(value[1])}${toHex(value[2])}`;
  const light = 0.299 * value[0] + 0.587 * value[1] + 0.114 * value[2] > 0.6;
  return (
    <label data-swatch={c.id} title={live ? 'A mapping moves it' : 'Tap to pick a colour'} style={{ position: 'relative', display: 'block', width: '100%', height: '100%', borderRadius: 14, background: hex, cursor: live ? 'default' : 'pointer', boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.12)}`, overflow: 'hidden' }}>
      <input type="color" aria-label={c.label} value={hex} disabled={live}
        onChange={e => { const h = e.target.value; onChange([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]); }}
        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'inherit' }} />
      <span style={{ position: 'absolute', left: 10, right: 10, top: 9, font: `600 11.5px ${fontFamily.ui}`, color: light ? alpha('#000000', 0.75) : alpha('#ffffff', 0.9), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{c.label}{live ? ' · LIVE' : ''}</span>
      <span style={{ position: 'absolute', left: 10, bottom: 8, font: `500 11px ${fontFamily.mono}`, color: light ? alpha('#000000', 0.6) : alpha('#ffffff', 0.7), pointerEvents: 'none' }}>{hex}</span>
    </label>
  );
}

function XYTile({ pair, a, b, x, y, lockX, lockY, onChange }: { pair: PlayPair; a: PlayControl; b: PlayControl; x: number; y: number; lockX: boolean; lockY: boolean; onChange: (x: number, y: number) => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const locked = lockX && lockY;
  const ux = unitOf(x, a), uy = unitOf(y, b);
  const at = (e: ReactPointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const px = (e.clientX - r.left) / r.width, py = 1 - (e.clientY - r.top) / r.height;
    onChange(lockX ? x : valueAt(px, a), lockY ? y : valueAt(py, b));
  };
  return (
    <Tile label={pair.label} live={lockX || lockY} data-xy={pair.id}>
      <div ref={ref} role="group" aria-label={`${a.label} and ${b.label}`}
        onPointerDown={e => { if (locked) return; drag.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* none */ } at(e); }}
        onPointerMove={e => { if (drag.current) at(e); }}
        onPointerUp={() => { drag.current = false; }} onPointerCancel={() => { drag.current = false; }}
        title={locked ? 'Both values are driven by a mapping' : 'Drag: across is X, up is Y'}
        style={{ position: 'relative', flex: 1, minHeight: 88, borderRadius: 10, background: '#0c0d12', cursor: locked ? 'default' : 'crosshair', touchAction: 'none', overflow: 'hidden',
          backgroundImage: `linear-gradient(${alpha('#ffffff', 0.06)} 1px, transparent 1px), linear-gradient(90deg, ${alpha('#ffffff', 0.06)} 1px, transparent 1px)`, backgroundSize: '25% 25%' }}>
        <span style={{ position: 'absolute', left: `${ux * 100}%`, top: 0, bottom: 0, width: 1, background: alpha(tk.accent.base, 0.5), pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', top: `${(1 - uy) * 100}%`, left: 0, right: 0, height: 1, background: alpha(tk.accent.base, 0.5), pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', left: `calc(${ux * 100}% - 13px)`, top: `calc(${(1 - uy) * 100}% - 13px)`, width: 26, height: 26, borderRadius: 13, background: tk.accent.base, boxShadow: `0 0 0 3px ${alpha('#ffffff', 0.85)}, 0 0 18px ${alpha(tk.accent.base, 0.8)}`, pointerEvents: 'none' }} />
        <span style={{ position: 'absolute', right: 8, bottom: 6, color: MUTED, font: `500 11px ${fontFamily.mono}`, pointerEvents: 'none' }}>{fmt(x)}, {fmt(y)}</span>
      </div>
    </Tile>
  );
}

// ── The bar ─────────────────────────────────────────────────────────────────

/** A bar button: 44 px tall for a finger, icon and a short word. */
function BarButton({ icon, label, title, onClick, tone, active, btnRef, wide, narrow, joinRight, ...rest }: {
  icon: IconName; label?: string; title: string; onClick: () => void; tone?: 'danger' | 'record'; active?: boolean;
  btnRef?: React.Ref<HTMLButtonElement>; wide?: boolean;
  /** The ▾ joined to the button before it. */
  narrow?: boolean;
  /** Squared right side: a ▾ follows. */
  joinRight?: boolean;
  'aria-label'?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const red = tk.status.danger;
  const bg = tone === 'record' && active ? red : active ? alpha(tk.accent.base, 0.25) : hover ? alpha('#ffffff', 0.1) : alpha('#ffffff', 0.05);
  const fg = tone === 'record' && active ? '#ffffff' : tone === 'danger' || tone === 'record' ? '#ff8a8a' : TEXT;
  return (
    <button ref={btnRef} type="button" title={title} aria-label={label ? undefined : title} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} {...rest}
      style={{ height: 44, minWidth: narrow ? 30 : 44, padding: label ? '0 13px' : 0, borderRadius: narrow ? '0 11px 11px 0' : joinRight ? '11px 0 0 11px' : 11, marginLeft: narrow ? 1 : 0, border: 0, background: bg, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: 'pointer', font: `600 12.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', flexShrink: 0, boxShadow: `inset 0 0 0 1px ${tone === 'danger' ? alpha('#ff6b6b', 0.35) : alpha('#ffffff', 0.08)}`, ...(wide ? { flex: '1 1 auto' } : {}) }}>
      <Icon name={icon} size={narrow ? 14 : 17} />{label}
    </button>
  );
}

/**
 * The view's own settings: the grid's size (S / M / L) and the keys-and-MIDI legend (ⓘ). In the
 * Stage bar on wide screens (beside Screen / Phone), in Perform's bar on a phone.
 */
export function PerformView() {
  const tk = useTokens();
  const size = useStage(s => s.size);
  const setSize = useStage(s => s.setSize);
  const play = useNodeGraphStore(s => s.play);
  const [open, setOpen] = useState(false);
  const legendRef = useRef<HTMLButtonElement>(null);
  return (
    <div data-perform-view style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <div role="radiogroup" aria-label="Control size" style={{ display: 'flex', borderRadius: 9, boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.1)}`, overflow: 'hidden', flexShrink: 0 }}>
        {(['S', 'M', 'L'] as PerformSize[]).map(s => (
          <button key={s} type="button" role="radio" aria-checked={size === s} title={`${s === 'S' ? 'Small' : s === 'M' ? 'Medium' : 'Large'} controls`} onClick={() => setSize(s)}
            style={{ width: 36, height: 36, border: 0, background: size === s ? alpha(tk.accent.base, 0.3) : alpha('#ffffff', 0.04), color: size === s ? '#ffffff' : MUTED, font: `650 12.5px ${fontFamily.ui}`, cursor: 'pointer' }}>{s}</button>
        ))}
      </div>
      <button ref={legendRef} type="button" aria-label="Which keys, MIDI and so on do what" title="Which keys, MIDI and so on do what" onClick={() => setOpen(o => !o)} data-perform-legend
        style={{ width: 36, height: 36, borderRadius: 9, border: 0, background: open ? alpha(tk.accent.base, 0.25) : alpha('#ffffff', 0.05), color: TEXT, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.1)}` }}>
        <Icon name="info" size={16} />
      </button>
      {open && (
        <Popover anchorRef={legendRef} onClose={() => setOpen(false)} align="end" width={320} padding={12}>
          <InputLegend play={play} empty="No sources: only these controls move the picture." />
        </Popover>
      )}
    </div>
  );
}

function PerformBar({ strength, onRandomize, onReset, onRender, play, viewInBar }: { strength: number; onRandomize: () => void; onReset: () => void; onRender: () => void; play: PlayRecord; viewInBar: boolean }) {
  const tk = useTokens();
  const setStrength = useStage(s => s.setStrength);
  const phase = useTakes(s => s.phase);
  const countdown = useTakes(s => s.countdown);
  const busy = phase === 'recording' || phase === 'countdown';
  const takes = play.takes?.length ?? 0;
  const [open, setOpen] = useState<null | 'strength' | 'takes'>(null);
  const strengthRef = useRef<HTMLButtonElement>(null);
  const takesRef = useRef<HTMLButtonElement>(null);
  const group: CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
  // A narrow column (a tablet held upright): icons for all but Panic, so the bar keeps to two rows.
  const barRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const on = () => setCompact(el.clientWidth < 440);
    const ro = new ResizeObserver(on);
    ro.observe(el);
    on();
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={barRef} data-perform-bar data-compact={compact || undefined} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: `1px solid ${alpha('#ffffff', 0.07)}`, flexShrink: 0 }}>
      <div style={{ ...group, gap: 0 }}>
        <BarButton icon="dice" label={compact ? undefined : 'Randomize'} joinRight title={`Randomize: move every control by up to ${Math.round(strength * 100)}% of its range (⇧R) · ⌘Z undoes`} onClick={onRandomize} data-perform-randomize />
        <BarButton btnRef={strengthRef} icon="chevD" narrow title={`Strength: ${Math.round(strength * 100)}%`} onClick={() => setOpen(o => (o === 'strength' ? null : 'strength'))} active={open === 'strength'} data-perform-strength />
      </div>
      <div style={group}>
        <BarButton icon="reset" label={compact ? undefined : 'Reset'} title="Every control back to where it was when the Stage opened (⇧H) · ⌘Z undoes" onClick={onReset} data-perform-reset />
        <BarButton icon="pause" label="Panic" tone="danger" title="Stop all sound and let go of held keys, pads and actions (⇧P). Controls keep their values" onClick={panic} data-perform-panic />
      </div>
      <div style={group}>
        <BarButton icon="record" label={phase === 'countdown' ? `${countdown}…` : busy ? 'Stop' : compact ? undefined : 'Take'} tone="record" active={busy}
          title={busy ? 'Stop and watch it back' : 'Record performance (take): your moves are kept, to watch back and export as a video'}
          onClick={() => (busy ? useTakes.getState().stop() : useTakes.getState().begin())} aria-label={busy ? 'Stop the take' : 'Record performance (take)'} data-perform-take />
        <BarButton btnRef={takesRef} icon="film" label={String(takes)} title={`Takes (${takes}): also under Sound → Arrangement → Takes`} onClick={() => setOpen(o => (o === 'takes' ? null : 'takes'))} active={open === 'takes'} data-perform-takes />
      </div>
      {viewInBar && <><span style={{ flex: 1 }} /><PerformView /></>}

      {open === 'strength' && (
        <Popover anchorRef={strengthRef} onClose={() => setOpen(null)} width={260} padding={12}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', font: `600 12px ${fontFamily.ui}` }}><span>Strength</span><span style={{ fontFamily: fontFamily.mono, color: tk.text.muted }}>{Math.round(strength * 100)}%</span></div>
            <RulerSlider ariaLabel="Randomize strength" value={strength} min={RANDOM_STRENGTH.min} max={RANDOM_STRENGTH.max} step={0.05} hard defaultValue={RANDOM_STRENGTH.default} onChange={setStrength} touch />
            <div style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.45 }}>How far Randomize may move each control, as a share of its range. Switches flip with this chance.</div>
          </div>
        </Popover>
      )}
      {open === 'takes' && (
        <Popover anchorRef={takesRef} onClose={() => setOpen(null)} width={320} padding={10}>
          <TakesList onRender={() => { setOpen(null); onRender(); }} empty="No takes yet. Press Take and play: your moves are kept, to watch back and export as a video." />
        </Popover>
      )}
    </div>
  );
}

/** Which keys, clicks, MIDI and so on do what: the mappings, read as a legend. */
export function InputLegend({ play, empty }: { play: PlayRecord; empty?: string }) {
  const rows = play.mappings.filter(m => m.enabled).map(m => ({
    id: m.id,
    from: mappingLabel(m, play, true),
    to: play.controls.find(c => c.id === m.controlId)?.label ?? '—',
  }));
  if (!rows.length) return empty ? <div style={{ color: MUTED, lineHeight: 1.45, fontSize: 12 }}>{empty}</div> : null;
  return (
    <div>
      <div style={{ color: alpha('#ffffff', 0.45), font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>Sources</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map(r => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ flexShrink: 0, maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '2px 7px', borderRadius: radius.sm, background: alpha('#ffffff', 0.08), font: `500 11.5px ${fontFamily.mono}` }}>{r.from}</span>
            <Icon name="chevR" size={11} style={{ color: alpha('#ffffff', 0.35), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: alpha('#ffffff', 0.8) }}>{r.to}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
