/**
 * TasteFeatureRow — one learned feature on the Taste page: its name, a bar of its parts (imported profile,
 * this install, your steering), evidence and sureness, pins (boost / avoid / ban), and its trace when
 * opened: which signals made it and by how much (docs/taste.md "Trace").
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { useTaste } from '../../taste/store';
import { traceOf } from '../../taste/log';
import { steeringWeights } from '../../taste/steering';
import { featureName, surenessOf } from '../../taste/summary';
import { isPortable } from '../../taste/portable';
import { Pill, SignedBar, SurePill } from './tasteUi';
import { ago, describeRef, KIND_PLURAL, KIND_WORDS, signed, togglePin } from './tasteWords';
import { canOpenRef, openRef } from './tasteNav';

export function PinButtons({ k }: { k: string }) {
  const pin = useTaste(s => s.steering.pins[k]);
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      <Pill tone="good" active={pin === 'boost'} onClick={() => togglePin(k, 'boost')} title="Boost: lean towards this (your steering, on top of what it learned)">boost</Pill>
      <Pill tone="warn" active={pin === 'avoid'} onClick={() => togglePin(k, 'avoid')} title="Avoid: lean away from this">avoid</Pill>
      <Pill tone="bad" active={pin === 'ban'} onClick={() => togglePin(k, 'ban')} title="Ban: Surprise, Deep and Evolve never pick it">ban</Pill>
    </span>
  );
}

export function TasteFeatureRow({ k }: { k: string }) {
  const tk = useTokens();
  const model = useTaste(s => s.model);
  const local = useTaste(s => s.local);
  const prior = useTaste(s => s.prior);
  const log = useTaste(s => s.log);
  const steering = useTaste(s => s.steering);
  const [open, setOpen] = useState(false);
  const here = local.w[k] ?? 0, imported = prior.w[k] ?? 0, steer = steeringWeights(steering)[k] ?? 0;
  const learned = model.w[k] ?? 0;
  const n = model.n[k] ?? 0;
  const name = featureName(model, k, learned + steer >= 0);
  const trace = open ? traceOf(log, k) : null;
  return (
    <div data-taste-feature={k} style={{ display: 'flex', flexDirection: 'column', borderTop: `1px solid ${tk.border.subtle}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 4px', flexWrap: 'wrap' }}>
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} title="Where it came from"
          style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 180px', minWidth: 0, border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: tk.text.primary }}>
          <Icon name={open ? 'chevD' : 'chevR'} size={11} style={{ color: tk.text.faint, flexShrink: 0 }} />
          <span style={{ font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          {!isPortable(k) && <span title="Install-specific: stays on this install unless you export everything" style={{ fontSize: 10.5, color: tk.text.faint }}>local</span>}
        </button>
        <SignedBar parts={[{ v: imported, tone: 'profile' }, { v: here, tone: 'local' }, { v: steer, tone: 'steer' }]} />
        <span style={{ font: `500 11.5px ${fontFamily.mono}`, color: learned + steer >= 0 ? tk.status.success : tk.status.danger, width: 48, textAlign: 'right' }}>{signed(learned + steer)}</span>
        <span style={{ fontSize: 11, color: tk.text.faint, width: 56 }} title="Evidence: how much it has seen this">n {n.toFixed(1)}</span>
        <SurePill sure={surenessOf(n)} />
        <PinButtons k={k} />
      </div>
      {trace && (
        <div data-taste-trace={k} style={{ margin: '0 4px 8px 22px', padding: '8px 10px', borderRadius: radius.md, background: tk.bg.subtle, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 11.5, color: tk.text.secondary }}>
            <span>This install <b style={{ fontFamily: fontFamily.mono }}>{signed(here, 3)}</b></span>
            {imported !== 0 && <span>Imported profile{prior.from ? ` (${prior.from.label})` : ''} <b style={{ fontFamily: fontFamily.mono }}>{signed(imported, 3)}</b></span>}
            {steer !== 0 && <span>Your steering <b style={{ fontFamily: fontFamily.mono }}>{signed(steer, 3)}</b></span>}
            <span style={{ color: tk.text.faint }}>= {signed(learned + steer, 3)}</span>
          </div>
          {Object.keys(trace.byKind).length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(trace.byKind).sort((a, b) => Math.abs(b[1]!) - Math.abs(a[1]!)).map(([kind, v]) => (
                <Pill key={kind} tone={v! >= 0 ? 'good' : 'bad'}>{KIND_PLURAL[kind as keyof typeof KIND_PLURAL]} {signed(v!, 3)}</Pill>
              ))}
            </div>
          )}
          {trace.items.slice(0, 40).map(({ entry: e, delta }) => {
            const openable = canOpenRef(e.ref);
            return (
              <button key={e.id} type="button" disabled={!openable} onClick={() => { if (e.ref) void openRef(e.ref); }} data-taste-trace-entry={e.id}
                title={openable ? (e.ref?.item ? 'Open it' : `Make seed ${e.ref?.seed} again`) : undefined}
                style={{ display: 'flex', alignItems: 'baseline', gap: 8, border: 0, background: 'none', padding: '2px 0', textAlign: 'left', cursor: openable ? 'pointer' : 'default', color: tk.text.primary, font: `12px ${fontFamily.ui}` }}>
                <span style={{ width: 46, font: `500 11.5px ${fontFamily.mono}`, color: delta >= 0 ? tk.status.success : tk.status.danger }}>{signed(delta, 3)}</span>
                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{KIND_WORDS[e.kind]}</span>
                <span style={{ color: tk.text.secondary, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: openable ? 'underline dotted' : 'none' }}>{describeRef(e.ref)}</span>
                <span style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>{ago(e.at)}</span>
              </button>
            );
          })}
          {trace.items.length > 40 && <span style={{ fontSize: 11, color: tk.text.faint }}>…and {trace.items.length - 40} more</span>}
          {Math.abs(trace.carried) > 5e-4 && <span style={{ fontSize: 11.5, color: tk.text.muted }}><b style={{ fontFamily: fontFamily.mono, fontWeight: 500 }}>{signed(trace.carried, 3)}</b> older than the log, or too small to list</span>}
          {!trace.items.length && Math.abs(trace.carried) <= 5e-4 && <span style={{ fontSize: 11.5, color: tk.text.muted }}>Nothing learned on this install{imported ? ': it all came with the imported profile' : ''}.</span>}
          <span style={{ fontSize: 10.5, color: tk.text.faint }}>The listed changes{Math.abs(trace.carried) > 5e-4 ? ' and the older part' : ''} add up to this install’s {signed(trace.sum, 3)} (each change includes the small L2 decay of its step).</span>
        </div>
      )}
    </div>
  );
}
