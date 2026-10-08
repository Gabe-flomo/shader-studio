/**
 * TasteInternals — "Model internals" on the Taste page (docs/taste.md): the raw weight table by layer
 * (sortable, searchable), counts and constants, a "score this graph" tester for the canvas graph, and
 * Export (profile only or everything) / Import (merge or replace) / Reset (learned, steering, or both).
 */
import { useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { toast } from '../ui/toastStore';
import { askConfirm } from '../ui/dialogStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { exportTaste, importTaste, resetTaste, useTaste } from '../../taste/store';
import { EXPLORE, L2, LEARNING_RATE, SIGNAL_WEIGHT, TASTE_VERSION } from '../../taste/model';
import { graphFeatures } from '../../taste/features';
import { scoreBreakdown, steeringWeights } from '../../taste/steering';
import { featureKind, featureName, summarise } from '../../taste/summary';
import { isPortable } from '../../taste/portable';
import { LOG_CAP, logCounts } from '../../taste/log';
import { Card, Pill } from './tasteUi';
import { plural, signed } from './tasteWords';
import { imageModelUsable } from '../../imageModel/client';
import { textLookParts, textLookScore } from '../../taste/look';

type SortKey = 'key' | 'kind' | 'profile' | 'local' | 'steer' | 'total' | 'n';

export function TasteInternals({ compact }: { compact: boolean }) {
  const tk = useTokens();
  const model = useTaste(s => s.model);
  const local = useTaste(s => s.local);
  const prior = useTaste(s => s.prior);
  const log = useTaste(s => s.log);
  const steering = useTaste(s => s.steering);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ by: SortKey; dir: 1 | -1 }>({ by: 'total', dir: -1 });
  const [tested, setTested] = useState<{ f: Record<string, number>; at: number; lookText?: number; words?: Array<{ text: string; d: number }>; looking?: boolean } | null>(null);
  const [pending, setPending] = useState<{ name: string; text: string } | null>(null);
  const sw = useMemo(() => steeringWeights(steering), [steering]);
  const rows = useMemo(() => {
    const keys = new Set([...Object.keys(model.w), ...Object.keys(sw)]);
    const out = [...keys].map(k => ({ key: k, kind: featureKind(k), profile: prior.w[k] ?? 0, local: local.w[k] ?? 0, steer: sw[k] ?? 0, total: (model.w[k] ?? 0) + (sw[k] ?? 0), n: model.n[k] ?? 0, portable: isPortable(k) }));
    const ql = q.trim().toLowerCase();
    const f = ql ? out.filter(r => r.key.toLowerCase().includes(ql) || featureName(model, r.key).toLowerCase().includes(ql)) : out;
    return f.sort((a, b) => {
      const va = a[sort.by], vb = b[sort.by];
      return (typeof va === 'number' && typeof vb === 'number' ? (sort.by === 'total' || sort.by === 'local' || sort.by === 'profile' || sort.by === 'steer' ? Math.abs(va) - Math.abs(vb) : va - vb) : String(va).localeCompare(String(vb))) * sort.dir;
    });
  }, [model, prior, local, sw, q, sort]);
  const counts = logCounts(log);
  const muted = { fontSize: 12, color: tk.text.muted } as const;
  const head = (by: SortKey, label: string, right = true) => (
    <th style={{ textAlign: right ? 'right' : 'left', padding: '4px 6px', cursor: 'pointer', font: `600 11px ${fontFamily.ui}`, color: sort.by === by ? tk.text.primary : tk.text.faint, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: tk.bg.panel }}
      onClick={() => setSort(s => ({ by, dir: s.by === by ? (s.dir === 1 ? -1 : 1) : by === 'key' || by === 'kind' ? 1 : -1 }))} aria-sort={sort.by === by ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label}{sort.by === by ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  );
  const num = (v: number) => <td style={{ textAlign: 'right', padding: '3px 6px', font: `11.5px ${fontFamily.mono}`, color: v > 0 ? tk.status.success : v < 0 ? tk.status.danger : tk.text.faint }}>{v ? signed(v, 3) : '·'}</td>;

  const breakdown = tested ? scoreBreakdown(model, steering, tested.f, 10, tested.lookText ?? 0) : null;
  // The canvas graph scored: its features at once; with the image model on, its picture's look and the words by look follow.
  const scoreCanvas = () => {
    const nodes = useNodeGraphStore.getState().nodes;
    const at = Date.now();
    const usable = imageModelUsable();
    setTested({ f: graphFeatures(nodes), at, looking: usable });
    if (!usable) return;
    void import('../../imageModel/looks').then(async L => {
      const look = await L.graphLook(nodes);
      const { terms, neutral } = await L.lookTermsFor(steering);
      const lean = steering.lean;
      setTested(t => (t && t.at === at ? {
        f: graphFeatures(nodes, look ? { embedding: look.proj } : {}), at, looking: false,
        lookText: look ? lean * textLookScore(look.full, terms, neutral) : 0, words: look ? textLookParts(look.full, terms, neutral) : [],
      } : t));
    });
  };
  const layerScore = (w: Record<string, number>) => (tested ? Object.entries(tested.f).reduce((s, [k, x]) => s + (w[k] ?? 0) * x, 0) : 0);

  const download = (kind: 'profile' | 'everything') => {
    void import('../surprise/inspiredAction').then(({ presentItems }) => {
      const text = exportTaste(kind, summarise(model, steering).text, presentItems());
      const blob = new Blob([text], { type: 'application/json' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: kind === 'profile' ? 'my-taste.playfield-taste' : 'my-taste-everything.playfield-taste' });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
  };
  const upload = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.playfield-taste,.json' });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (f) setPending({ name: f.name.replace(/\.(playfield-taste|json)$/i, ''), text: await f.text() });
    };
    input.click();
  };
  const doImport = async (mode: 'merge' | 'replace') => {
    if (!pending) return;
    const { presentItems } = await import('../surprise/inspiredAction');
    const r = importTaste(pending.text, { mode, present: presentItems(), label: pending.name });
    setPending(null);
    if (r.ok) toast.success(mode === 'merge' ? 'Profile merged' : 'Profile imported', { message: `${r.woke.length ? `${plural(r.woke.length, 'item')} matched on this install. ` : ''}It’s the imported layer now; what you do here learns on top.` });
    else toast.error('Couldn’t import that file', { message: r.error });
  };
  const reset = async (what: 'learned' | 'steering' | 'both') => {
    const words = { learned: 'what it learned (both layers and the log)', steering: 'your steering (context, pins, dials)', both: 'everything: what it learned and your steering' }[what];
    if (!(await askConfirm('Reset your taste?', { message: `This forgets ${words}. Surprise, Deep and Evolve go back to ${what === 'steering' ? 'what was learned alone' : 'no lean'}.`, confirmLabel: 'Reset', danger: true }))) return;
    resetTaste(what);
    toast.info('Taste reset', { message: `Forgot ${words}.` });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-taste-internals-counts>
          <Pill>{plural(Object.keys(model.w).length, 'weight')}</Pill>
          <Pill>{plural(Object.keys(local.w).length, 'local weight')}</Pill>
          <Pill>{plural(Object.keys(prior.w).length, 'imported weight')}</Pill>
          <Pill>{plural(Object.keys(sw).length, 'steering weight')}</Pill>
          <Pill>stored version {TASTE_VERSION}</Pill>
          <Pill>embedder {model.look?.embedder ?? model.embedder ?? 'none'}</Pill>
        </div>
        <span style={muted}>
          Signals learned from: {Object.entries(model.signals).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'} · in the log: {Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'} (cap {LOG_CAP}, {log.dropped} folded).
        </span>
        <span style={muted}>
          Learning rate {LEARNING_RATE} · L2 {L2} · default ε (exploration) {EXPLORE}, yours {steering.explore} · signal weights {Object.entries(SIGNAL_WEIGHT).map(([k, v]) => `${k} ${v}`).join(', ')}.
        </span>
      </Card>

      <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Score this graph</span>
          <span style={{ ...muted, flex: 1 }}>The canvas graph’s features and its score: imported + this install + your steering.</span>
          <Button size="sm" onClick={scoreCanvas} data-taste-score>Score the canvas graph</Button>
        </div>
        {tested && breakdown && (
          <div data-taste-score-result style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pill tone="accent">imported {signed(layerScore(prior.w), 3)}</Pill>
              <Pill tone="good">this install {signed(layerScore(local.w), 3)}</Pill>
              <Pill tone="warn">steering {signed(breakdown.steering, 3)}</Pill>
              <span data-taste-score-look style={{ display: 'contents' }}>
                {tested.looking ? <Pill>look: drawing…</Pill> : imageModelUsable() ? <>
                  <Pill tone="accent" title="How close its picture is to the liked looks minus the disliked ones (image model)">look {signed(breakdown.look, 3)}</Pill>
                  {tested.words?.length ? <Pill tone="warn" title={tested.words.map(w => `“${w.text}” ${signed(w.d, 3)} vs neutral`).join(' · ')}>words by look {signed(breakdown.lookText, 3)}</Pill> : null}
                </> : <Pill title="Turn the image model on (How things look) to score the picture too">look: model off</Pill>}
              </span>
              <Pill tone={breakdown.total >= 0 ? 'good' : 'bad'}>total {signed(breakdown.total, 3)}</Pill>
            </div>
            <span style={muted}>Top contributions: {breakdown.top.map(c => `${featureName(model, c.key)} ${signed(c.learned + c.steering, 3)}${c.steering ? ` (steering ${signed(c.steering, 2)})` : ''}`).join(' · ') || 'none'}</span>
            <details>
              <summary style={{ ...muted, cursor: 'pointer' }}>Feature vector ({Object.keys(tested.f).length})</summary>
              <div style={{ font: `11px/1.6 ${fontFamily.mono}`, color: tk.text.secondary, marginTop: 4 }}>
                {Object.entries(tested.f).filter(([k]) => !k.startsWith('emb:')).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v.toFixed(2)}`).join('  ')}
                {Object.keys(tested.f).some(k => k.startsWith('emb:')) && `  emb:0…${Object.keys(tested.f).filter(k => k.startsWith('emb:')).length - 1} (its look, projected)`}
              </div>
            </details>
          </div>
        )}
      </Card>

      <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Weights</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search features" aria-label="Search features" data-taste-weight-search
            style={{ flex: 1, maxWidth: 260, height: 26, padding: '0 8px', borderRadius: radius.control, border: `1px solid ${tk.border.default}`, background: tk.bg.subtle, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />
          <span style={muted}>{plural(rows.length, 'row')}</span>
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          <table data-taste-weights style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr>{head('key', 'Feature', false)}{!compact && head('kind', 'Kind', false)}{head('profile', 'Imported')}{head('local', 'Here')}{head('steer', 'Steering')}{head('total', 'Total')}{head('n', 'n')}</tr></thead>
            <tbody>
              {rows.slice(0, 400).map(r => (
                <tr key={r.key} style={{ borderTop: `1px solid ${tk.border.subtle}` }}>
                  <td style={{ padding: '3px 6px', font: `11.5px ${fontFamily.mono}`, color: tk.text.primary }} title={featureName(model, r.key)}>{r.key}{!r.portable && <span style={{ color: tk.text.faint }}> · local</span>}</td>
                  {!compact && <td style={{ padding: '3px 6px', color: tk.text.muted }}>{r.kind}</td>}
                  {num(r.profile)}{num(r.local)}{num(r.steer)}{num(r.total)}
                  <td style={{ textAlign: 'right', padding: '3px 6px', font: `11.5px ${fontFamily.mono}`, color: tk.text.muted }}>{r.n.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Export, import, reset</span>
        <span style={muted}>A <b>profile</b> file carries what means the same on any install (techniques, stage choices, palettes, settings ranges, image look, examples) and your steering, with a summary and the log stripped of your own items. <b>Everything</b> adds what it learned about your own graphs and shaders; on another install those stay dormant until they appear there. Accounts don’t sync this yet: the file is the way to move it.</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" icon="export" onClick={() => download('profile')} data-taste-export-profile>Export profile</Button>
          <Button size="sm" variant="ghost" icon="export" onClick={() => download('everything')} data-taste-export>Export everything</Button>
          <Button size="sm" variant="ghost" icon="import" onClick={upload} data-taste-import>Import…</Button>
        </div>
        {pending && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: 8, borderRadius: radius.md, background: tk.bg.subtle }}>
            <span style={{ fontSize: 12, flex: 1 }}>“{pending.name}”: merge it with yours (weighted by evidence), or replace the imported profile and start learning here afresh on top?</span>
            <Button size="sm" variant="primary" onClick={() => { void doImport('merge'); }}>Merge</Button>
            <Button size="sm" onClick={() => { void doImport('replace'); }}>Replace</Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancel</Button>
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" variant="ghost" icon="reset" onClick={() => { void reset('learned'); }}>Reset learned</Button>
          <Button size="sm" variant="ghost" icon="reset" onClick={() => { void reset('steering'); }}>Reset steering</Button>
          <Button size="sm" variant="ghost" icon="reset" onClick={() => { void reset('both'); }} data-taste-reset>Reset both</Button>
        </div>
      </Card>
    </div>
  );
}
