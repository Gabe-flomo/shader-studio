/**
 * IncrementEditor — the settings of an Increment mapping (docs/increment-mapping.md),
 * shown in its mapping row: what takes a step (a trigger, a threshold on the
 * source, a repeat), the step and how it grows, then folded sections for the
 * range and its limit, the glide, the wrap-back, the start and reset, and the
 * signals it sends. The first section is open; the others start folded with a
 * one-line summary (Section, remembered across increments).
 */
import { useEffect, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { playEngine } from '../../lib/playEngine';
import { addSignal } from '../../play/pairs';
import { signalName } from '../../play/playSources';
import { INCREMENT_CURVE_OPTIONS, INCREMENT_GROWTH_OPTIONS, INCREMENT_LIMIT_OPTIONS, INCREMENT_ON_OPTIONS, INCREMENT_WRAP_OPTIONS } from '../../play/incrementUi';
import type { PlayControl, PlayIncrement, PlayMapping } from '../../types/play';
import { Section } from './layers/Section';
import { ConditionFields, SignalPicker } from './ConditionFields';
import { TriggerPicker, type TriggerLayerRef } from './TriggerPicker';
import { Segmented, Toggle } from '../ui/Choice';
import { rowField } from '../ui/rowLayout';
import { Select } from '../ui/Select';
import { Button, IconButton } from '../ui/Button';
import { NumberInput } from '../NodeGraph/NumberInput';

const KIND = 'increment';
const num = (n: number) => `${Math.round(n * 1000) / 1000}`;

/** How many steps it has taken (since its last wrap-back, and in all), polled a few times a second. */
function useIncrementNow(id: string): { n: number; count: number } | null {
  const [now, setNow] = useState(() => playEngine.incrementNow(id));
  useEffect(() => {
    const t = window.setInterval(() => {
      const v = playEngine.incrementNow(id);
      setNow(p => (p?.n === v?.n && p?.count === v?.count ? p : v));
    }, 150);
    return () => window.clearInterval(t);
  }, [id]);
  return now;
}

export function IncrementEditor({ mapping: m, control, layers, sourceEditor, numStyle, labelStyle, onUpdate }: {
  mapping: PlayMapping & { increment: PlayIncrement };
  control: PlayControl | undefined;
  layers: ReadonlyArray<TriggerLayerRef>;
  /** The row's source picker and its options (a threshold reads the source). */
  sourceEditor: ReactNode;
  numStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
  onUpdate: (patch: Partial<PlayMapping>) => void;
}) {
  const tk = useTokens();
  const inc = m.increment;
  const signals = useNodeGraphStore(s => s.play.signals);
  const setPlay = useNodeGraphStore(s => s.setPlay);
  const now = useIncrementNow(m.id);
  const set = (patch: Partial<PlayIncrement>) => onUpdate({ increment: { ...inc, ...patch } });
  const hint = (text: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{text}</span>;
  const row = (label: string, children: ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6 }}>
      <span style={labelStyle}>{label}</span>
      <div style={rowField}>{children}</div>
    </div>
  );
  const small = { ...numStyle, width: 48 };
  const sig = (id: string | undefined) => (id ? signalName(id, signals) : '');
  // Make "<control>.step" and "<control>.reset" and send them, in one edit.
  const makeSignals = () => {
    const base = control?.label ?? 'Increment';
    setPlay(p => {
      let next = p;
      let step = inc.stepSignal, reset = inc.resetSignal;
      if (!step) { const r = addSignal(next, `${base}.step`); next = r.play; step = r.id || undefined; }
      if (!reset) { const r = addSignal(next, `${base}.reset`); next = r.play; reset = r.id || undefined; }
      return { ...next, mappings: next.mappings.map(x => (x.id === m.id && x.increment ? { ...x, increment: { ...x.increment, stepSignal: step, resetSignal: reset } } : x)) };
    });
  };
  const [lo, hi] = [Math.min(m.outMin, m.outMax), Math.max(m.outMin, m.outMax)];

  return (
    <>
      <Section kind={KIND} title="Steps" primary summary={null}>
        {row('On', <Segmented size="sm" ariaLabel="What takes a step" value={inc.on} options={INCREMENT_ON_OPTIONS} onChange={on => set({ on })} />)}
        {inc.on === 'trigger' && row('When', <TriggerPicker trigger={inc.trigger} layers={layers} numStyle={numStyle} onChange={trigger => set({ trigger })} />)}
        {inc.on === 'threshold' && (
          <>
            <div style={{ marginTop: 6 }}>{sourceEditor}</div>
            {row('Level', <>
              <NumberInput value={inc.threshold} min={0} max={1} step={0.05} title="Steps when the source (0–1) reaches this" onCommit={n => set({ threshold: Math.max(0, Math.min(1, n)) })} style={small} />
              {hint('re-arm')}
              <NumberInput value={inc.hysteresis} min={0} max={1} step={0.01} title="Ready again only once the source falls this far below the level, so a noisy source doesn't step twice" onCommit={n => set({ hysteresis: Math.max(0, Math.min(1, n)) })} style={small} />
              <Toggle checked={inc.falling} onChange={falling => set({ falling })} label="Also falling" />
            </>)}
          </>
        )}
        {inc.on === 'repeat' && (
          <>
            {row('Every', <>
              <NumberInput value={inc.every} min={0.01} step={inc.unit === 'beats' ? 1 : 0.1} title="How often it steps" onCommit={n => set({ every: Math.max(0.01, n) })} style={small} />
              <Segmented size="sm" ariaLabel="Unit" value={inc.unit} options={[{ value: 'beats', label: 'Beats' }, { value: 'seconds', label: 'Seconds' }]} onChange={unit => set({ unit })} />
              {inc.unit === 'beats' && <>
                <NumberInput value={inc.bpm} min={1} max={999} step={1} title="Beats per minute" onCommit={n => set({ bpm: Math.max(1, Math.min(999, n)) })} style={small} />
                {hint('bpm')}
              </>}
            </>)}
            {row('Only', <Toggle checked={!!inc.when} onChange={on => set({ when: on ? { value: control ? `ctl:${control.id}` : 'mouse:x', cmp: 'above', threshold: 0.5, hysteresis: 0.05, tolerance: 0.01 } : undefined })} label="While a condition holds" />)}
            {inc.when && <div style={{ display: 'flex', flexWrap: 'wrap', marginTop: 6 }}><ConditionFields cond={inc.when} crossings={false} isOpen={() => playEngine.incrementCondOpen(m.id)} onChange={when => set({ when })} /></div>}
          </>
        )}
        {row('Step', <>
          <Segmented size="sm" ariaLabel="Direction" value={inc.direction < 0 ? 'down' : 'up'} options={[{ value: 'up', label: '+', title: 'Step up' }, { value: 'down', label: '−', title: 'Step down' }]} onChange={d => set({ direction: d === 'down' ? -1 : 1 })} />
          <NumberInput value={Math.abs(inc.step)} min={0} step={0.1} title={inc.growth === 'proportional' ? 'Percent of the current value' : 'How far each step moves, in the control’s units'} onCommit={n => set({ step: Math.abs(n) })} style={small} />
          {inc.growth === 'proportional' && hint('%')}
          <Select ariaLabel="Growth" value={inc.growth} options={INCREMENT_GROWTH_OPTIONS} onChange={v => set({ growth: v as PlayIncrement['growth'] })} height={26} />
          {(inc.growth === 'compound' || inc.growth === 'additive') && <>
            {hint(inc.growth === 'compound' ? '×' : '+')}
            <NumberInput value={inc.factor} step={inc.growth === 'compound' ? 0.1 : 0.5} title={inc.growth === 'compound' ? 'Each step is the last one times this' : 'Each step is the last one plus this'} onCommit={n => set({ factor: n })} style={small} />
          </>}
          {inc.growth === 'proportional' && <>
            {hint('min')}
            <NumberInput value={inc.minStep} min={0} step={0.01} title="The smallest step, so a value at 0 still moves" onCommit={n => set({ minStep: Math.max(0, n) })} style={small} />
          </>}
        </>)}
      </Section>
      <Section kind={KIND} title="Range" summary={`${num(m.outMin)} → ${num(m.outMax)}, ${inc.limit}`}>
        {row('Range', <>
          <NumberInput value={m.outMin} title="One end of the range it moves in" onCommit={n => onUpdate({ outMin: n })} style={numStyle} />
          <span style={{ color: tk.text.faint }}>→</span>
          <NumberInput value={m.outMax} title="The other end" onCommit={n => onUpdate({ outMax: n })} style={numStyle} />
        </>)}
        {row('Edges', <Segmented size="sm" ariaLabel="At the edges" value={inc.limit} options={INCREMENT_LIMIT_OPTIONS} onChange={limit => set({ limit })} />)}
      </Section>
      <Section kind={KIND} title="Glide" summary={inc.glideMs > 0 ? `${Math.round(inc.glideMs)} ms, ${INCREMENT_CURVE_OPTIONS.find(c => c.value === inc.glideCurve)?.label.toLowerCase()}` : 'Off: each step jumps'}>
        {row('Glide', <>
          <NumberInput value={inc.glideMs} min={0} max={60000} step={10} title="Each step slides over this long (0 jumps)" onCommit={n => set({ glideMs: Math.max(0, Math.min(60000, n)) })} style={numStyle} />
          {hint('ms')}
          <Select ariaLabel="Glide curve" value={inc.glideCurve} options={INCREMENT_CURVE_OPTIONS} onChange={v => set({ glideCurve: v as PlayIncrement['glideCurve'] })} height={26} />
        </>)}
      </Section>
      <Section kind={KIND} title="Wrap back" summary={inc.wrapAfter > 0 ? `After ${inc.wrapAfter} steps, ${INCREMENT_WRAP_OPTIONS.find(o => o.value === inc.wrapBack)?.label.toLowerCase()}` : 'Never'}>
        {row('After', <>
          <NumberInput value={inc.wrapAfter} min={0} step={1} title="After this many steps the next one wraps back (0 = never)" onCommit={n => set({ wrapAfter: Math.max(0, Math.round(n)) })} style={small} />
          {hint('steps')}
          <Segmented size="sm" ariaLabel="Wrap back" value={inc.wrapBack} options={INCREMENT_WRAP_OPTIONS} onChange={wrapBack => set({ wrapBack })} />
        </>)}
      </Section>
      <Section kind={KIND} title="Start and reset" summary={`${inc.start === 'value' ? `From ${num(inc.startValue)}` : 'From the control’s value'}${inc.resetOn ? `, reset on ${sig(inc.resetOn)}` : ''}`}>
        {row('Start', <>
          <Segmented size="sm" ariaLabel="Start from" value={inc.start} options={[{ value: 'current', label: 'Its value', title: 'Where the control is when the mapping starts' }, { value: 'value', label: 'A value' }]} onChange={start => set({ start })} />
          {inc.start === 'value' && <NumberInput value={inc.startValue} title="The value it starts from and wraps back to" onCommit={n => set({ startValue: n })} style={numStyle} />}
        </>)}
        {row('Reset on', <SignalPicker value={inc.resetOn ?? ''} none="No signal" ariaLabel="Reset on signal" onChange={id => set({ resetOn: id || undefined })} />)}
      </Section>
      <Section kind={KIND} title="Signals out" summary={inc.stepSignal || inc.resetSignal ? [inc.stepSignal && `Step: ${sig(inc.stepSignal)}`, inc.resetSignal && `Wrap back: ${sig(inc.resetSignal)}`].filter(Boolean).join(', ') : 'None'}>
        {row('Each step', <SignalPicker value={inc.stepSignal ?? ''} none="No signal" ariaLabel="Signal on each step" onChange={id => set({ stepSignal: id || undefined })} />)}
        {row('Wrap back', <SignalPicker value={inc.resetSignal ?? ''} none="No signal" ariaLabel="Signal on wrap back" onChange={id => set({ resetSignal: id || undefined })} />)}
        {(!inc.stepSignal || !inc.resetSignal) && row('', <Button size="sm" icon="plus" onClick={makeSignals}>Make {control?.label ?? 'Increment'}.step / .reset</Button>)}
      </Section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
        <span style={{ color: tk.text.muted, font: `500 11px ${fontFamily.mono}` }} title="Steps since the last wrap-back, and in all">
          {now ? `step ${now.n}${now.count !== now.n ? ` · ${now.count} in all` : ''}` : 'not running'}
        </span>
        {hint(`${num(lo)}…${num(hi)}`)}
        <IconButton icon="reset" label="Reset: back to the start now" size="sm" onClick={() => playEngine.resetIncrement(m.id)} />
      </div>
    </>
  );
}
