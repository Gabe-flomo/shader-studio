/**
 * PairControls — two controls played as one (types/play.ts PlayPair):
 *
 *   PairCard        on the panel: a slider for each value (disabled while a
 *                   mapping drives it) and, for a position, an XY pad
 *   PairMappingRow  in the mappings: what drives the pair (a position such as
 *                   the pointer, a null or a fingertip, or any one source),
 *                   Affect A / B / both, each axis's range, curve, smoothing
 *                   and optional "only while" condition, and the axis swap
 *
 * The two controls stay ordinary controls, so layers and graphs see two plain
 * values and takes record them as two tracks.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { playEngine, applyCurve, type ControlValue } from '../../lib/playEngine';
import type { PairAxis, PairSwap, PlayControl, PlayPair, PlayPairMapping, PlayRecord, PlaySource } from '../../types/play';
import { CURVES, sourceLabel, sourceType, anchorLabel, type SourceType } from '../../play/playSources';
import { conditionLabel } from '../../play/playSources';
import { Button, IconButton } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { GroupedPicker } from '../ui/GroupedPicker';
import type { PickerSection } from '../ui/groupedPickerModel';
import { NumberInput } from '../NodeGraph/NumberInput';
import { ConditionFields, DistanceAnchorPicker, SignalPicker, labelContext } from './ConditionFields';

// ── On the panel ─────────────────────────────────────────────────────────────

export function PairCard({ pair, a, b, values, live, drivenA, drivenB, drivenBy, touch, onChange, onRename, onUnpair, onMap, onPosition }: {
  pair: PlayPair;
  a: PlayControl;
  b: PlayControl;
  values: [number | undefined, number | undefined];
  live: [ControlValue | undefined, ControlValue | undefined];
  drivenA: boolean;
  drivenB: boolean;
  drivenBy: string[];
  touch: boolean;
  onChange: (control: PlayControl, v: number) => void;
  onRename: (label: string) => void;
  onUnpair: () => void;
  onMap: () => void;
  onPosition: (position: boolean) => void;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pair.label);
  const shownA = drivenA && typeof live[0] === 'number' ? live[0] : values[0] ?? a.min;
  const shownB = drivenB && typeof live[1] === 'number' ? live[1] : values[1] ?? b.min;
  const driven = drivenA || drivenB;
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== pair.label) onRename(t); else setDraft(pair.label); };
  const row = (c: PlayControl, v: number, dv: boolean, tag: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
      <span title={c.label} style={{ width: 16, color: tk.text.faint, font: `700 10.5px ${fontFamily.mono}` }}>{tag}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <RulerSlider value={v} min={c.min} max={c.max} step={c.step ?? 0.01} disabled={dv} onChange={x => onChange(c, x)} onType={x => onChange(c, x)} ariaLabel={c.label} touch={touch} />
      </div>
    </div>
  );
  return (
    <div data-control-id={a.id} style={{ padding: '10px 10px 10px 12px', marginTop: 6, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${driven ? alpha(tk.accent.base, 0.45) : tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26, marginBottom: 2 }}>
        <span title={pair.position ? 'A position: A is X, B is Y' : 'Two values played together'} style={{ display: 'inline-flex', color: tk.accent.text }}><svgIcon.Pair /></span>
        {editing
          ? <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(pair.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
          : <button type="button" title="Rename" onClick={() => { setDraft(pair.label); setEditing(true); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair.label}</button>}
        {driven && <span title={drivenBy.join(', ')} style={{ height: 20, padding: '0 7px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 10.5px ${fontFamily.ui}`, whiteSpace: 'nowrap', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' }}>{drivenBy[0] ?? 'Mapped'}{drivenBy.length > 1 ? ` +${drivenBy.length - 1}` : ''}</span>}
        <IconButton icon="plus" label="Map something onto the pair" size="sm" onClick={onMap} />
        <IconButton icon="close" label="Unpair: two separate sliders again (its pair mappings go)" size="sm" onClick={onUnpair} />
      </div>
      {pair.position && <XYPad a={a} b={b} x={shownA} y={shownB} lockX={drivenA} lockY={drivenB} onChange={(x, y) => { if (!drivenA) onChange(a, x); if (!drivenB) onChange(b, y); }} />}
      {row(a, shownA, drivenA, pair.position ? 'X' : 'A')}
      {row(b, shownB, drivenB, pair.position ? 'Y' : 'B')}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.label} · {b.label}</span>
        <Toggle checked={pair.position} onChange={onPosition} label="XY pad" />
      </div>
    </div>
  );
}

/** A small two-arrows glyph for a pair. */
const svgIcon = {
  Pair: () => (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden>
      <path d="M2 12 L2 2 M2 12 L12 12 M2 2 L0.5 3.5 M2 2 L3.5 3.5 M12 12 L10.5 10.5 M12 12 L10.5 13.5" />
      <circle cx={8} cy={6} r={1.6} fill="currentColor" stroke="none" />
    </svg>
  ),
};

/** The XY pad: drag the dot (X across, Y up), each axis only while no mapping drives it. */
export function XYPad({ a, b, x, y, lockX, lockY, onChange }: { a: PlayControl; b: PlayControl; x: number; y: number; lockX: boolean; lockY: boolean; onChange: (x: number, y: number) => void }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);
  const u = (v: number, c: PlayControl) => (c.max > c.min ? Math.max(0, Math.min(1, (v - c.min) / (c.max - c.min))) : 0);
  const at = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    const ux = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), uy = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    onChange(lockX ? x : a.min + (a.max - a.min) * ux, lockY ? y : b.min + (b.max - b.min) * uy);
  };
  const locked = lockX && lockY;
  return (
    <div ref={ref} role="group" aria-label={`${a.label} and ${b.label}`}
      onPointerDown={e => { if (locked) return; drag.current = true; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* none to capture */ } at(e); }}
      onPointerMove={e => { if (drag.current) at(e); }}
      onPointerUp={() => { drag.current = false; }}
      onPointerCancel={() => { drag.current = false; }}
      title={locked ? 'Both values are driven by a mapping' : 'Drag the dot: across is X, up is Y'}
      style={{ position: 'relative', height: 120, margin: '4px 0 6px', borderRadius: radius.md, background: tk.bg.field, cursor: locked ? 'default' : 'crosshair', touchAction: 'none', overflow: 'hidden',
        backgroundImage: `linear-gradient(${alpha(tk.text.primary, 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(tk.text.primary, 0.05)} 1px, transparent 1px)`, backgroundSize: '25% 25%' }}>
      <span style={{ position: 'absolute', left: `${u(x, a) * 100}%`, top: 0, bottom: 0, width: 1, background: alpha(tk.accent.base, 0.35), pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', top: `${(1 - u(y, b)) * 100}%`, left: 0, right: 0, height: 1, background: alpha(tk.accent.base, 0.35), pointerEvents: 'none' }} />
      <span style={{ position: 'absolute', left: `calc(${u(x, a) * 100}% - 7px)`, top: `calc(${(1 - u(y, b)) * 100}% - 7px)`, width: 14, height: 14, borderRadius: 7, background: tk.accent.base, boxShadow: `0 0 0 2px ${tk.bg.panel}`, pointerEvents: 'none', transition: 'left 50ms linear, top 50ms linear' }} />
      <span style={{ position: 'absolute', right: 6, bottom: 4, color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, pointerEvents: 'none' }}>{fmt(x)}, {fmt(y)}</span>
    </div>
  );
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

// ── In the mappings ──────────────────────────────────────────────────────────

/** "Mouse → Dot", "LFO sine 0.5 Hz → Size (A)". */
export function pairMappingLabel(m: PlayPairMapping, play: PlayRecord): string {
  const src = m.source.kind === 'position' ? anchorLabel(m.source.anchor, play.layers) : sourceLabel(m.source.source, play.controls, play.layers);
  const pair = play.pairs?.find(p => p.id === m.pairId);
  return `${src} → ${pair?.label ?? 'missing pair'}${m.affect === 'both' || m.source.kind === 'position' ? '' : m.affect === 'a' ? ' (A)' : ' (B)'}`;
}

/** The pair mapping's readings now, polled while its row shows. */
function usePairNow(m: PlayPairMapping): { ua: number | null; ub: number | null; axis: 'a' | 'b'; condA: boolean; condB: boolean } {
  const [now, setNow] = useState({ ua: null as number | null, ub: null as number | null, axis: 'a' as 'a' | 'b', condA: false, condB: false });
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 60) return;
      last = ms;
      const n = playEngine.pairNow(m);
      const r = (v: number | null) => (v === null ? null : Math.round(v * 100) / 100);
      const next = { ua: r(n.ua), ub: r(n.ub), axis: n.axis, condA: playEngine.pairCondOpen(m.id, 'a'), condB: playEngine.pairCondOpen(m.id, 'b') };
      setNow(p => (p.ua === next.ua && p.ub === next.ub && p.axis === next.axis && p.condA === next.condA && p.condB === next.condB ? p : next));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [m]);
  return now;
}

export function PairMappingRow({ mapping: m, play, sourceSections, renderSourceOptions, onPickSource, onUpdate, onRemove }: {
  mapping: PlayPairMapping;
  play: PlayRecord;
  sourceSections: PickerSection[];
  /** The fields a single source needs beyond its kind (the mappings' own Options row). */
  renderSourceOptions: (source: PlaySource, onChange: (s: PlaySource) => void) => ReactNode;
  /** A source kind picked from the list, as a source (null: the pick opened something instead). */
  onPickSource: (type: string, prev: PlaySource) => PlaySource | null;
  onUpdate: (patch: Partial<PlayPairMapping>) => void;
  onRemove: () => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(true);
  const pair = play.pairs?.find(p => p.id === m.pairId);
  const ca = pair && play.controls.find(c => c.id === pair.a), cb = pair && play.controls.find(c => c.id === pair.b);
  const now = usePairNow(m);
  const value = m.source.kind === 'value' ? m.source.source : null;
  const swapping = !!m.swap && !!value;
  const labelStyle: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', width: 54, flexShrink: 0 };
  const line: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' };
  const numStyle = { width: 58, height: 26, borderRadius: 6, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.mono}`, textAlign: 'center' as const };
  const layerRefs = useMemo(() => play.layers.map(l => ({ id: l.id, label: l.label, kind: l.kind })), [play.layers]);
  const setAxis = (k: 'a' | 'b', patch: Partial<PairAxis>) => onUpdate({ [k]: { ...m[k], ...patch } } as Partial<PlayPairMapping>);
  const drivesA = swapping || m.source.kind === 'position' ? true : m.affect !== 'b';
  const drivesB = swapping || m.source.kind === 'position' ? true : m.affect !== 'a';
  const ctx = labelContext(play);

  const axisBlock = (k: 'a' | 'b', c: PlayControl | undefined, u: number | null, drives: boolean) => {
    const ax = m[k];
    const tag = pair?.position ? (k === 'a' ? 'X' : 'Y') : k.toUpperCase();
    const active = swapping ? now.axis === k : drives;
    const condOk = !ax.when || (k === 'a' ? now.condA : now.condB);
    const out = u === null ? null : applyCurve(u, ax.curve, ax.curveY);
    return (
      <div style={{ marginTop: 8, padding: '6px 8px 8px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.03), boxShadow: `inset 0 0 0 1px ${active && condOk ? alpha(tk.accent.base, 0.5) : tk.border.subtle}`, opacity: drives ? 1 : 0.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ font: `700 11px ${fontFamily.mono}`, color: active && condOk ? tk.accent.text : tk.text.muted, width: 16 }}>{tag}</span>
          <span style={{ flex: 1, minWidth: 0, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c?.label ?? 'missing control'}</span>
          {swapping && <span style={{ font: `600 10.5px ${fontFamily.ui}`, color: now.axis === k ? tk.accent.text : tk.text.faint }}>{now.axis === k ? 'driving' : 'holding'}</span>}
          {!swapping && !drives && <span style={{ font: `11px ${fontFamily.ui}`, color: tk.text.faint }}>not driven</span>}
        </div>
        <div title="The source (tick) and where it lands after the curve (bar)" style={{ position: 'relative', height: 5, margin: '6px 0 2px 22px', borderRadius: 2, background: tk.bg.field, overflow: 'hidden' }}>
          {out !== null && <div style={{ width: `${Math.max(0, Math.min(1, out)) * 100}%`, height: '100%', background: active && condOk ? tk.accent.base : tk.text.disabled }} />}
        </div>
        <div style={line}>
          <span style={labelStyle}>Range</span>
          <NumberInput value={ax.outMin} title="Value at the source's minimum" onCommit={n => setAxis(k, { outMin: n })} style={numStyle} />
          <span style={{ color: tk.text.faint }}>→</span>
          <NumberInput value={ax.outMax} title="Value at the source's maximum" onCommit={n => setAxis(k, { outMax: n })} style={numStyle} />
          <IconButton icon="bidir" label="Invert the range" size="sm" onClick={() => setAxis(k, { outMin: ax.outMax, outMax: ax.outMin })} />
          <span style={{ flex: 1 }} />
          <Segmented size="sm" ariaLabel="Curve" value={ax.curve === 'custom' ? 'linear' : ax.curve} options={CURVES.filter(x => x.value !== 'custom')} onChange={v => setAxis(k, { curve: v, curveY: undefined })} />
        </div>
        <div style={line}>
          <span style={labelStyle}>Smooth</span>
          <NumberInput value={ax.smoothMs} min={0} max={5000} step={10} title="Smoothing time in milliseconds" onCommit={n => setAxis(k, { smoothMs: Math.max(0, n) })} style={numStyle} />
          <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}` }}>ms</span>
          <span style={{ flex: 1 }} />
          <Toggle checked={!!ax.when} onChange={on => setAxis(k, { when: on ? { value: m.source.kind === 'position' && pair?.position ? `dist:${m.source.anchor}|pt:0.5,0.5` : `ctl:${c?.id ?? ''}`, cmp: 'below', threshold: m.source.kind === 'position' ? 0.3 : (c ? (c.min + c.max) / 2 : 0.5), hysteresis: 0.02, tolerance: 0.01 } : undefined })} label="Only while…" />
        </div>
        {ax.when && <>
          <div style={{ margin: '4px 0 0 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>{`Drives ${tag} only while ${conditionLabel(ax.when, ctx)}; otherwise it holds where it was.`}</div>
          <div style={{ display: 'flex' }}><ConditionFields cond={ax.when} crossings={false} isOpen={() => playEngine.pairCondOpen(m.id, k)} onChange={when => setAxis(k, { when })} /></div>
        </>}
      </div>
    );
  };

  const setSwap = (patch: Partial<PairSwap>) => m.swap && onUpdate({ swap: { ...m.swap, ...patch } });
  const dirOpts = [{ value: 'up' as const, label: '↑ up' }, { value: 'down' as const, label: '↓ down' }];
  return (
    <div style={{ marginTop: 6, padding: '8px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, opacity: m.enabled ? 1 : 0.55 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse' : 'Expand'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <span style={{ ...labelStyle, width: 40 }}>Pair</span>
        <Select ariaLabel="Pair" value={m.pairId} options={(play.pairs ?? []).map(p => ({ value: p.id, label: p.label }))} height={26} style={{ flex: 1, minWidth: 0 }}
          onChange={pairId => {
            const p = play.pairs?.find(x => x.id === pairId);
            const na = p && play.controls.find(c => c.id === p.a), nb = p && play.controls.find(c => c.id === p.b);
            onUpdate({ pairId, a: { ...m.a, outMin: na?.min ?? m.a.outMin, outMax: na?.max ?? m.a.outMax }, b: { ...m.b, outMin: nb?.min ?? m.b.outMin, outMax: nb?.max ?? m.b.outMax } });
          }} />
        <Toggle checked={m.enabled} onChange={enabled => onUpdate({ enabled })} />
        <IconButton icon="trash" label="Remove pair mapping" size="sm" tone="danger" onClick={onRemove} />
      </div>
      {!open && <div style={{ margin: '4px 0 0 22px', color: tk.text.secondary, font: `12px ${fontFamily.ui}` }}>{pairMappingLabel(m, play)}</div>}
      {open && <>
        <div style={line}>
          <span style={labelStyle}>Source</span>
          <Segmented size="sm" ariaLabel="Source kind" value={m.source.kind} options={[
            { value: 'position', label: 'Position', title: 'Both axes at once: across and up the picture' },
            { value: 'value', label: 'One value', title: 'Any source (a knob, an LFO…) sent to A, B or both' },
          ]} onChange={kind => {
            if (kind === m.source.kind) return;
            onUpdate(kind === 'position' ? { source: { kind: 'position', anchor: 'mouse' }, swap: undefined, affect: 'both' } : { source: { kind: 'value', source: { kind: 'mouse', axis: 'x' } } });
          }} />
          {m.source.kind === 'position' && <DistanceAnchorPicker value={m.source.anchor} layers={layerRefs} ariaLabel="Position from" onChange={anchor => onUpdate({ source: { kind: 'position', anchor } })} />}
          {value && <GroupedPicker ariaLabel="Source" value={sourceType(value)} sections={sourceSections} height={26} style={{ flex: 1, minWidth: 120 }} width={300} searchPlaceholder="Search sources"
            onChange={v => { const s = onPickSource(v as SourceType, value); if (s) onUpdate({ source: { kind: 'value', source: s } }); }} />}
        </div>
        {value && renderSourceOptions(value, s => onUpdate({ source: { kind: 'value', source: s } }))}
        {m.source.kind === 'position' && <div style={{ margin: '4px 0 0 60px', color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Across the picture drives {pair?.position ? 'X' : 'A'}, up the picture drives {pair?.position ? 'Y' : 'B'}, each 0 to 1 through its range below.</div>}
        {value && !swapping && (
          <div style={line}>
            <span style={labelStyle}>Affect</span>
            <Segmented size="sm" ariaLabel="Affect" value={m.affect} options={[
              { value: 'a', label: `${pair?.position ? 'X' : 'A'} only` },
              { value: 'b', label: `${pair?.position ? 'Y' : 'B'} only` },
              { value: 'both', label: 'Both' },
            ]} onChange={affect => onUpdate({ affect })} />
          </div>
        )}
        {axisBlock('a', ca, now.ua, drivesA)}
        {axisBlock('b', cb, now.ub, drivesB)}
        {value && (
          <div style={{ marginTop: 8, padding: '6px 8px 8px', borderRadius: radius.md, background: alpha(tk.text.primary, 0.03), boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Toggle checked={swapping} label="Axis swap" onChange={on => onUpdate({ swap: on ? { at: ca ? ca.min + (ca.max - ca.min) * 0.9 : 0.9, dir: 'up', backAt: cb ? cb.min + (cb.max - cb.min) * 0.1 : 0.1, backDir: 'down' } : undefined })} />
              <span style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Drive A until it crosses a line, then B until B crosses back. Rewinding starts on A.</span>
            </div>
            {m.swap && <>
              <div style={line}>
                <span style={labelStyle}>To B</span>
                <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>when A crosses</span>
                <NumberInput value={m.swap.at} title="A's value that swaps to B" onCommit={at => setSwap({ at })} style={numStyle} />
                <Segmented size="sm" ariaLabel="Swap direction" value={m.swap.dir} options={dirOpts} onChange={dir => setSwap({ dir })} />
                <SignalPicker ariaLabel="Signal on the swap" none="No signal" value={m.swap.signal ?? ''} onChange={signal => setSwap({ signal: signal || undefined })} />
              </div>
              <div style={line}>
                <span style={labelStyle}>Back</span>
                <span style={{ color: tk.text.muted, font: `11.5px ${fontFamily.ui}` }}>when B crosses</span>
                <NumberInput value={m.swap.backAt} title="B's value that swaps back to A" onCommit={backAt => setSwap({ backAt })} style={numStyle} />
                <Segmented size="sm" ariaLabel="Swap-back direction" value={m.swap.backDir} options={dirOpts} onChange={backDir => setSwap({ backDir })} />
                <SignalPicker ariaLabel="Signal on the swap back" none="No signal" value={m.swap.backSignal ?? ''} onChange={backSignal => setSwap({ backSignal: backSignal || undefined })} />
              </div>
              <div style={{ margin: '6px 0 0 60px', display: 'flex', alignItems: 'center', gap: 6, font: `500 11.5px ${fontFamily.ui}`, color: tk.accent.text }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, background: tk.accent.base }} />
                Driving {now.axis === 'a' ? `A · ${ca?.label ?? ''}` : `B · ${cb?.label ?? ''}`}
                <Button size="sm" variant="ghost" onClick={() => playEngine.resetSwaps()}>Start on A</Button>
              </div>
            </>}
          </div>
        )}
      </>}
    </div>
  );
}
