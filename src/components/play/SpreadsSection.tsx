/**
 * SpreadsSection — the Spread cards on the Controls page (docs/spread-control.md).
 * A Spread is a group of sliders offset together: each member gets Amount ×
 * curve(its place in the order, rotated by Shift) × its range on top of its own
 * value. Amount and Shift are ordinary controls on the board ("<Spread> · Amount");
 * this card holds the order, the curve, the mode and Reset. Every edit is one
 * Play undo step through `update`.
 */
import { useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import type { PlayControl, PlayRecord, PlaySpread, SpreadCurve } from '../../types/play';
import { spreadTarget } from '../../types/play';
import { deleteSpread, moveSpreadMember, patchSpread, removeFromSpread, spreadValues } from '../../play/spreads';
import { resetSpread } from '../../play/spreadReset';
import { readControlValue } from '../../play/playControls';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Select } from '../ui/Select';
import { useLiveValue } from './liveValueStore';
import { anyLiveMapped } from './useLiveValues';

const CURVES: Array<{ value: SpreadCurve; label: string }> = [
  { value: 'linear', label: 'Linear' }, { value: 'easeIn', label: 'Ease in' }, { value: 'easeOut', label: 'Ease out' },
  { value: 'easeInOut', label: 'Ease in–out' }, { value: 'exp', label: 'Exponential' }, { value: 'sine', label: 'Sine' }, { value: 'custom', label: 'Custom' },
];

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2));

export function SpreadsSection({ play, nodes, update }: {
  play: PlayRecord;
  nodes: GraphNode[];
  update: (fn: (p: PlayRecord) => PlayRecord) => void;
}) {
  const spreads = play.spreads ?? [];
  if (!spreads.length) return null;
  return (
    <div data-spreads="" style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '2px 0 10px' }}>
      {spreads.map(sp => <SpreadCard key={sp.id} sp={sp} play={play} nodes={nodes} update={update} />)}
    </div>
  );
}

function SpreadCard({ sp, play, nodes, update }: {
  sp: PlaySpread; play: PlayRecord; nodes: GraphNode[]; update: (fn: (p: PlayRecord) => PlayRecord) => void;
}) {
  const tk = useTokens();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<string | null>(null);
  const amountCtl = play.controls.find(c => c.target === spreadTarget(sp.id, 'amount'));
  const shiftCtl = play.controls.find(c => c.target === spreadTarget(sp.id, 'shift'));
  // A driven Amount or Shift shows its live value; otherwise the record's.
  const liveOn = anyLiveMapped(play);
  const amountLive = useLiveValue(amountCtl?.id, liveOn), shiftLive = useLiveValue(shiftCtl?.id, liveOn);
  const liveNum = (id: string | undefined, v: unknown): number | undefined => { if (!id || !play.mappings.some(m => m.enabled && m.controlId === id)) return undefined; return typeof v === 'number' ? v : undefined; };
  const amount = liveNum(amountCtl?.id, amountLive) ?? sp.amount, shift = liveNum(shiftCtl?.id, shiftLive) ?? sp.shift;
  const baseOf = (id: string): number | undefined => {
    const c = play.controls.find(x => x.id === id);
    if (!c) return undefined;
    const v = readControlValue(nodes, c.target, play);
    return typeof v === 'number' ? v : undefined;
  };
  const rows = spreadValues(sp, play.controls, baseOf, amount, shift);
  const ctl = (id: string): PlayControl | undefined => play.controls.find(x => x.id === id);
  const summary = `${sp.members.length} slider${sp.members.length === 1 ? '' : 's'} · ${CURVES.find(c => c.value === sp.curve)?.label ?? sp.curve}${sp.invert ? ' · inverted' : ''} · ${sp.mode === 'reset' ? 'Reset' : 'Offset'} · Amount ${fmt(amount)}`;
  const label = (text: string) => <span style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: 0.4, textTransform: 'uppercase', minWidth: 72 }}>{text}</span>;
  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minHeight: 28 };
  return (
    <section data-spread={sp.id} style={{ padding: '8px 10px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${alpha(tk.accent.base, 0.25)}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconButton icon={open ? 'chevD' : 'chevR'} size="sm" label={open ? 'Fold' : 'Show'} onClick={() => setOpen(!open)} />
        <Icon name="sliders" size={13} style={{ color: tk.accent.text }} />
        {draft === null
          ? <span style={{ font: `650 12px ${fontFamily.ui}`, cursor: 'text' }} title="Double-click to rename" onDoubleClick={() => setDraft(sp.label)}>{sp.label}</span>
          : <Field autoFocus value={draft} height={24} style={{ width: 160 }} onChange={e => setDraft(e.target.value)}
              onBlur={() => { const t = (draft ?? '').trim(); if (t && t !== sp.label) update(p => patchSpread(p, sp.id, { label: t })); setDraft(null); }}
              onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null); }} />}
        <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.ui}`, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" icon="undo" title="Every member back to its slider's minimum; the curve lays the offsets from there" onClick={() => resetSpread(sp.id)}>Reset</Button>
        <IconButton icon="trash" size="sm" tone="danger" label="Delete the Spread (its sliders stay)" onClick={() => update(p => deleteSpread(p, sp.id))} />
      </div>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
          <div style={rowStyle}>
            {label('Curve')}
            <Select ariaLabel="Curve" value={sp.curve} height={26} options={CURVES} onChange={v => update(p => patchSpread(p, sp.id, { curve: v as SpreadCurve }))} />
            <Toggle checked={!!sp.invert} label="Invert" onChange={v => update(p => patchSpread(p, sp.id, { invert: v }))} />
            <CurvePreview sp={sp} n={Math.max(2, sp.members.length)} shift={shift} colour={tk.accent.base} />
          </div>
          {sp.curve === 'custom' && sp.curveY && (
            <div style={rowStyle}>
              {label('Points')}
              {sp.curveY.map((y, i) => (
                <input key={i} type="range" min={0} max={1} step={0.01} value={y} aria-label={`Point ${i + 1}`} style={{ width: 70 }}
                  onChange={e => { const ys = [...(sp.curveY ?? [])]; ys[i] = Number(e.target.value); update(p => patchSpread(p, sp.id, { curveY: ys })); }} />
              ))}
            </div>
          )}
          <div style={rowStyle}>
            {label('Mode')}
            <Select ariaLabel="Mode" value={sp.mode} height={26} options={[{ value: 'offset', label: 'Offset — on top of each slider' }, { value: 'reset', label: 'Reset — from each slider’s minimum' }]}
              onChange={v => update(p => patchSpread(p, sp.id, { mode: v as PlaySpread['mode'] }))} />
            {sp.mode === 'reset' && (
              <Field placeholder="Reset on signal…" title="A signal name: when it fires, every member goes back to its minimum" value={sp.resetOn ?? ''} height={26} style={{ width: 170 }}
                onChange={e => update(p => patchSpread(p, sp.id, { resetOn: e.target.value.trim() || undefined }))} />
            )}
          </div>
          <div style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}`, margin: '2px 0' }}>
            Amount and Shift are the controls “{sp.label} · Amount” and “{sp.label} · Shift” on this board: map, increment or record them like any slider.
          </div>
          {!sp.members.length && <div style={{ color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, padding: '4px 0' }}>No sliders yet — right-click a slider and choose “Add to {sp.label}”.</div>}
          {rows.map((r, i) => {
            const c = ctl(r.id);
            if (!c || c.kind !== 'float') return null;
            const span = Math.max(1e-9, c.max - c.min);
            const pct = (v: number) => `${Math.max(0, Math.min(100, ((v - c.min) / span) * 100))}%`;
            return (
              <div key={r.id} data-spread-member={r.id} style={{ ...rowStyle, gap: 6 }}>
                <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}`, width: 18, textAlign: 'right' }}>{i + 1}</span>
                <span style={{ font: `600 11.5px ${fontFamily.ui}`, width: 150, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.label}>{c.label}</span>
                <div title={`Share of Amount at this place: ${(r.weight * 100).toFixed(0)}%`} style={{ position: 'relative', flex: 1, height: 8, borderRadius: 4, background: alpha(tk.text.primary, 0.08), minWidth: 60 }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round(r.weight * 100)}%`, borderRadius: 4, background: alpha(tk.accent.base, 0.35) }} />
                  <div style={{ position: 'absolute', top: -2, bottom: -2, width: 2, left: pct(r.base), background: tk.text.faint }} title={`Own value ${fmt(r.base)}`} />
                  <div style={{ position: 'absolute', top: -3, bottom: -3, width: 3, left: pct(r.value), background: tk.accent.base, borderRadius: 2 }} title={`Now ${fmt(r.value)}`} />
                </div>
                <span style={{ color: tk.text.secondary, font: `500 11px ${fontFamily.mono}`, width: 108, textAlign: 'right' }}>{fmt(r.base)} → {fmt(r.value)}</span>
                <IconButton icon="chevU" size="sm" label="Earlier in the order" disabled={i === 0} onClick={() => update(p => moveSpreadMember(p, sp.id, i, i - 1))} />
                <IconButton icon="chevD" size="sm" label="Later in the order" disabled={i === rows.length - 1} onClick={() => update(p => moveSpreadMember(p, sp.id, i, i + 1))} />
                <IconButton icon="close" size="sm" label="Take it out of the Spread" onClick={() => update(p => removeFromSpread(p, sp.id, r.id))} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The curve over the order, as a tiny bar chart: one bar per place, after Shift. */
function CurvePreview({ sp, n, shift, colour }: { sp: PlaySpread; n: number; shift: number; colour: string }) {
  const rows = spreadValues(sp, [], () => 0, 1, shift);
  const weights = rows.length ? rows.map(r => r.weight) : [];
  const bars = weights.length ? weights : Array.from({ length: n }, (_, i) => (n <= 1 ? 1 : i / (n - 1)));
  return (
    <svg width={Math.max(40, bars.length * 7)} height={18} aria-hidden="true" style={{ display: 'block' }}>
      {bars.map((w, i) => <rect key={i} x={i * 7} y={18 - 2 - w * 14} width={5} height={Math.max(1, w * 14)} rx={1} fill={colour} opacity={0.75} />)}
    </svg>
  );
}
