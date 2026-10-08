/**
 * TasteLogView — the signal log as a timeline, newest first, filterable by kind (docs/taste.md "The log and
 * tracing"). Each entry says what it was about and the features it moved most; clicking one opens its item
 * or makes its seed again. Imported entries (from a profile) are listed apart.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { useTaste } from '../../taste/store';
import { logCounts, LOG_CAP, type LogEntry } from '../../taste/log';
import type { SignalKind } from '../../taste/model';
import { featureName } from '../../taste/summary';
import { Card, Pill } from './tasteUi';
import { ago, describeRef, KIND_PLURAL, KIND_WORDS, plural, signed } from './tasteWords';
import { canOpenRef, openRef } from './tasteNav';

const KINDS: SignalKind[] = ['pick', 'rating', 'kept', 'undone', 'favourited', 'edited', 'opened'];

export function TasteLogView() {
  const tk = useTokens();
  const log = useTaste(s => s.log);
  const model = useTaste(s => s.model);
  const imported = useTaste(s => s.prior.log);
  const [kind, setKind] = useState<SignalKind | 'all' | 'imported'>('all');
  const [shown, setShown] = useState(60);
  const counts = logCounts(log);
  const list: LogEntry[] = kind === 'imported' ? [...(imported ?? [])].reverse() : log.entries.filter(e => kind === 'all' || e.kind === kind).slice().reverse();
  return (
    <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }} data-taste-log-filter>
        <Pill tone="accent" active={kind === 'all'} onClick={() => setKind('all')}>All {log.entries.length}</Pill>
        {KINDS.filter(k => counts[k]).map(k => <Pill key={k} tone="accent" active={kind === k} onClick={() => setKind(k)}>{KIND_PLURAL[k]} {counts[k]}</Pill>)}
        {imported?.length ? <Pill tone="accent" active={kind === 'imported'} onClick={() => setKind('imported')}>Imported {imported.length}</Pill> : null}
      </div>
      <span style={{ fontSize: 11.5, color: tk.text.faint }}>
        The last {LOG_CAP.toLocaleString()} lessons are kept{log.dropped ? ` (${plural(log.dropped, 'older one')} folded into “older”)` : ''}. Click one to open what it was about, or make its seed again.
      </span>
      {!list.length && <span style={{ fontSize: 12, color: tk.text.muted }}>Nothing here yet.</span>}
      <div data-taste-log style={{ display: 'flex', flexDirection: 'column' }}>
        {list.slice(0, shown).map(e => {
          const top = Object.entries(e.d).filter(([k]) => k !== '_bias').sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
          const openable = kind !== 'imported' && canOpenRef(e.ref);
          return (
            <button key={`${kind}-${e.id}`} type="button" disabled={!openable} onClick={() => { if (e.ref) void openRef(e.ref); }} data-taste-log-entry={e.kind}
              style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 2px', border: 0, borderTop: `1px solid ${tk.border.subtle}`, background: 'none', textAlign: 'left', cursor: openable ? 'pointer' : 'default', color: tk.text.primary, font: `12px ${fontFamily.ui}`, flexWrap: 'wrap' }}>
              <span style={{ width: 72, fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>{ago(e.at)}</span>
              <span style={{ width: 130, fontWeight: 600 }}>{KIND_WORDS[e.kind]}</span>
              <span style={{ flex: '1 1 200px', minWidth: 0, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: openable ? 'underline dotted' : 'none' }}>{describeRef(e.ref) || '—'}</span>
              <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                {top.map(([k, v]) => <Pill key={k} tone={v >= 0 ? 'good' : 'bad'} title={k}>{featureName(model, k, v >= 0)} {signed(v, 2)}</Pill>)}
              </span>
            </button>
          );
        })}
      </div>
      {list.length > shown && <Button size="sm" variant="ghost" onClick={() => setShown(n => n + 100)}>Show more ({list.length - shown} left)</Button>}
    </Card>
  );
}
