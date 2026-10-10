/**
 * BuiltInSignals — the built-in signals on the Inputs board (docs/conditions-and-signals.md,
 * Built-in signals): Signals: count, Signals: active and Signals: active share,
 * always there, read-only, marked Built in and with nothing to delete. Each
 * card shows its value now; Map makes a source of the record that reads it
 * (a `signals` PlaySource) and starts Map mode, like any source. Also the
 * source card's options for such a source (which one, and "full at" for the
 * counts).
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { playEngine } from '../../lib/playEngine';
import { addFreeSource } from '../../play/routeOps';
import { BUILT_IN_SIGNALS, BUILT_IN_SIGNAL_MAX, type BuiltInSignalRead, type PlayRecord, type PlaySource } from '../../types/play';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { NumberInput } from '../NodeGraph/NumberInput';
import { rowField } from '../ui/rowLayout';
import { useMapMode } from './inputs/mapMode';

type Now = { count: number; active: number; share: number };

/** The built-in signals now, polled a few times a second while shown. */
function useBuiltInSignals(): Now {
  const [now, setNow] = useState<Now>(() => playEngine.builtInSignals());
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (ms - last < 100) return;
      last = ms;
      const n = playEngine.builtInSignals();
      setNow(p => (p.count === n.count && p.active === n.active ? p : n));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return now;
}

/** "3", "2", "67%". */
function builtInValueText(read: BuiltInSignalRead, now: Now): string {
  return read === 'share' ? `${Math.round(now.share * 100)}%` : `${read === 'count' ? now.count : now.active}`;
}

/** A small "Built in" tag: these can't be renamed or deleted. */
export function BuiltInBadge() {
  const tk = useTokens();
  return (
    <span data-built-in-badge="" title="Built in: always there, read-only, can't be deleted"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 18, padding: '0 6px', borderRadius: 9, background: alpha(tk.accent.base, 0.12), color: tk.accent.text, font: `600 9.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>
      <Icon name="lock" size={9} />Built in
    </span>
  );
}

/** The Inputs board's Built in group: one card per built-in signal, with its value now and Map. */
export function BuiltInSignalsSection({ onRecord }: { onRecord: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const tk = useTokens();
  const now = useBuiltInSignals();
  const [open, setOpen] = useState(true);
  const map = (read: BuiltInSignalRead, label: string) => {
    let id = '';
    onRecord(p => { const x = addFreeSource(p, { kind: 'signals', read }); id = x.id; return x.play; });
    if (id) useMapMode.getState().start(id, label);
  };
  return (
    <section data-source-group="builtin">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} title={open ? 'Fold this group away' : 'Show this group'}
        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', margin: '10px 0 0', padding: '2px 0', border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', textAlign: 'left' }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={11} />
        <span style={{ flex: 1, minWidth: 0 }}>Built in</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{BUILT_IN_SIGNALS.length}</span>
      </button>
      {open && BUILT_IN_SIGNALS.map(b => (
        <div key={b.read} data-built-in-signal={b.read}
          style={{ marginTop: 6, padding: '7px 10px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="spark" size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' }}>
              <b style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>{b.label}</b>
              <BuiltInBadge />
            </span>
            <span style={{ font: `11px/1.35 ${fontFamily.ui}`, color: tk.text.faint }}>{b.hint}</span>
          </div>
          <span data-built-in-value={b.read} title="Now" style={{ minWidth: 34, textAlign: 'right', font: `600 13px ${fontFamily.mono}`, color: tk.text.primary, fontVariantNumeric: 'tabular-nums' }}>{builtInValueText(b.read, now)}</span>
          <Button size="sm" icon="plus" title="Map: make a source that reads it, then click each control it should drive. Rules can watch it as it is." onClick={() => map(b.read, b.label)}>Map</Button>
        </div>
      ))}
    </section>
  );
}

/** A built-in signal source's options: which one, and for a count the number that reads full. */
export function BuiltInSignalOptions({ source, labelStyle, numStyle, onChange }: {
  source: Extract<PlaySource, { kind: 'signals' }>;
  labelStyle: CSSProperties;
  numStyle: CSSProperties;
  onChange: (source: PlaySource) => void;
}) {
  const tk = useTokens();
  const now = useBuiltInSignals();
  const hint = (t: string) => <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>{t}</span>;
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
      <span style={labelStyle}>Reads</span>
      <div style={rowField}>
        <Segmented size="sm" ariaLabel="Built-in signal" value={source.read} options={BUILT_IN_SIGNALS.map(b => ({ value: b.read, label: b.read === 'share' ? 'Share' : b.read === 'count' ? 'Count' : 'Active', title: b.hint }))}
          onChange={read => onChange(read === 'share' ? { kind: 'signals', read } : { kind: 'signals', read, ...(source.max ? { max: source.max } : {}) })} />
        {source.read !== 'share' && <>
          {hint('full at')}
          <NumberInput value={source.max ?? BUILT_IN_SIGNAL_MAX} min={1} max={999} step={1} title="The count that reads 1 (the top of the route's range)" onCommit={n => onChange({ ...source, max: Math.max(1, Math.min(999, Math.round(n))) })} style={{ ...numStyle, width: 44 }} />
        </>}
        <BuiltInBadge />
        {hint(`now ${builtInValueText(source.read, now)}`)}
      </div>
    </div>
  );
}
