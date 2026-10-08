/**
 * TastePanel — "Your taste" (docs/taste.md), opened from the Do bar: what the taste model has learned (its
 * clearest likes and dislikes, the top choices per stage), how many signals it has learned from, and
 * Reset, Export and Import. Everything lives on this device.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { toast } from '../ui/toastStore';
import { learnedLine, learnedTraits, stageSuggestions, type SignalKind } from '../../taste';
import { exportTaste, importTaste, resetTaste, useTaste } from '../../taste/store';

const SIGNAL_WORDS: Array<[SignalKind, string]> = [
  ['pick', 'Evolve picks'], ['rating', 'ratings'], ['kept', 'surprises kept'], ['undone', 'undone'], ['favourited', 'nodes starred'], ['edited', 'edited after keeping'], ['opened', 'opened often'],
];
const STAGE_ORDER = ['space', 'field', 'picture', 'light', 'colour', 'post'];

export function TastePanel() {
  const tk = useTokens();
  const m = useTaste(s => s.model);
  const likes = learnedTraits(m, 6, 1);
  const dislikes = learnedTraits(m, 3, -1);
  const stages = Object.entries(m.stages)
    .map(([stage, row]) => ({ stage, top: Object.entries(row).sort((a, b) => b[1] - a[1]).slice(0, 3), total: Object.values(row).reduce((s, v) => s + v, 0) }))
    .filter(s => s.top.length).sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
  const counts = SIGNAL_WORDS.map(([k, w]) => [w, m.signals[k] ?? 0] as const).filter(([, n]) => n > 0);
  const rated = Object.values(m.ratings);
  const muted = { fontSize: 11.5, color: tk.text.muted } as const;
  const download = () => {
    const blob = new Blob([exportTaste()], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'playfield-taste.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const upload = () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      const r = importTaste(await f.text());
      if (r.ok) toast.success('Taste imported', { message: 'Surprise, Deep and Evolve now lean on it.' }); else toast.error('Couldn’t import that file', { message: r.error });
    };
    input.click();
  };
  return (
    <div data-taste-panel style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ fontSize: 12.5 }} data-taste-learned>Learned: {learnedLine(m)}.</span>
      {(likes.length > 0 || dislikes.length > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {likes.map(l => <span key={l} style={{ font: `11px ${fontFamily.ui}`, padding: '1px 7px', borderRadius: 999, background: tk.bg.hover, color: tk.status.success }}>+ {l}</span>)}
          {dislikes.map(l => <span key={l} style={{ font: `11px ${fontFamily.ui}`, padding: '1px 7px', borderRadius: 999, background: tk.bg.hover, color: tk.text.faint }}>− {l}</span>)}
        </div>
      )}
      {stages.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 10px', alignItems: 'baseline' }} data-taste-stages>
          {stages.map(s => (
            <div key={s.stage} style={{ display: 'contents' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: tk.text.faint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.stage}</span>
              <span style={{ fontSize: 12, color: tk.text.secondary }}>{s.top.map(([c, v]) => `${c} ${Math.round((100 * v) / s.total)}%`).join(' · ')}</span>
            </div>
          ))}
        </div>
      )}
      {stageSuggestions(m).map(t => <span key={t} style={muted}>{t}.</span>)}
      <span style={muted} data-taste-counts>
        {counts.length || rated.length
          ? `From ${counts.map(([w, n]) => `${n} ${w}`).join(', ')}${rated.length ? ` · ${rated.filter(r => r.v > 0).length} liked, ${rated.filter(r => r.v < 0).length} disliked` : ''}.`
          : 'Nothing yet: rate graphs, shaders, examples, palettes and techniques with like / dislike, keep surprises, or play a few rounds of Evolve.'}
        {' '}All of it stays on this device.
      </span>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" variant="ghost" icon="export" onClick={download} data-taste-export>Export</Button>
        <Button size="sm" variant="ghost" icon="import" onClick={upload}>Import</Button>
        <Button size="sm" variant="ghost" icon="reset" data-taste-reset onClick={() => {
          if (!window.confirm('Reset your taste? Surprise, Deep and Evolve forget every rating and pick.')) return;
          resetTaste();
          toast.info('Taste reset', { message: 'Surprise is back to no lean at all.' });
        }}>Reset my taste</Button>
      </div>
    </div>
  );
}
