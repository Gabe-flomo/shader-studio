/**
 * SurpriseStrip.tsx — the Do bar's Surprise carousel (inspiredAction.ts): ‹ 1 / 3 › at the top of the
 * bar, the candidate's seed, sources and (Deep) why it ranked, with Keep and Undo; and the Deep toggle
 * beside the dice.
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { cancelSurprise, keepSurprise, setDeep, stepSurprise, useSurpriseCarousel } from './inspiredAction';
import { closeDoBar } from '../../suggestions/doBarStore';

export function DeepToggle() {
  const tk = useTokens();
  const deep = useSurpriseCarousel(s => s.deep);
  return (
    <button type="button" data-do-deep aria-pressed={deep}
      title={deep ? 'Deep is on: each roll tries 16 candidates, draws each one small and keeps the best few (colour, contrast, detail, movement, and how new it looks)' : 'Deep: try many candidates and keep the best few (takes a few seconds)'}
      onClick={() => setDeep(!deep)}
      style={{
        height: 24, padding: '0 8px', borderRadius: radius.md, cursor: 'pointer', font: `600 11px ${fontFamily.ui}`,
        border: `1px solid ${deep ? tk.accent.base : tk.border.default}`, background: deep ? alpha(tk.accent.base, 0.14) : 'transparent', color: deep ? tk.accent.text : tk.text.muted,
      }}>Deep</button>
  );
}

export function SurpriseStrip() {
  const tk = useTokens();
  const s = useSurpriseCarousel();
  if (!s.open) return null;
  const c = s.items[s.index];
  const deepRunning = !!s.progress;
  const chip = { font: `11px ${fontFamily.ui}`, padding: '1px 7px', borderRadius: 999, background: tk.bg.hover, color: tk.text.secondary, whiteSpace: 'nowrap' } as const;
  return (
    <div data-do-carousel style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 8px 6px 8px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconButton icon="chevL" size="sm" label="The candidate before (←)" disabled={s.index === 0 || deepRunning} onClick={() => void stepSurprise(-1)} data-do-carousel-prev />
        <span data-do-carousel-count style={{ font: `600 12px ${fontFamily.mono}`, minWidth: 44, textAlign: 'center', color: tk.text.primary }}>
          {deepRunning ? '…' : `${s.index + 1} / ${s.items.length}${s.generating ? '+' : ''}`}
        </span>
        <IconButton icon="chevR" size="sm" label={s.index === s.items.length - 1 ? 'Make another (→)' : 'The next candidate (→)'} disabled={deepRunning || !c} onClick={() => void stepSurprise(1)} data-do-carousel-next />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: tk.text.muted }} data-do-carousel-info>
          {deepRunning
            ? `Deep: trying ${s.progress!.done} of ${s.progress!.total}…`
            : c ? (c.res.inspirations.length ? `Inspired by ${c.res.inspirations.map(i => i.label).join(', ')}` : 'A random line (nothing inspired passed)') : ''}
        </span>
        {c && !deepRunning && <span style={{ font: `11px ${fontFamily.mono}`, color: tk.text.faint }}>seed {c.res.seed}</span>}
        <Button size="sm" variant="primary" icon="check" disabled={!c || deepRunning} onClick={() => { keepSurprise(); closeDoBar(); }} data-do-carousel-keep>Keep</Button>
        <Button size="sm" variant="ghost" icon="undo" onClick={() => { cancelSurprise(); }} data-do-carousel-undo>Undo</Button>
      </div>
      {deepRunning && (
        <div style={{ height: 3, borderRadius: 2, background: tk.border.subtle, overflow: 'hidden', margin: '0 4px' }}>
          <div style={{ width: `${(100 * s.progress!.done) / Math.max(1, s.progress!.total)}%`, height: '100%', background: tk.accent.base, transition: 'width 120ms' }} />
        </div>
      )}
      {c && !deepRunning && (c.score?.why.length || c.taste?.length || c.res.stages.length) ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', padding: '0 4px' }} data-do-carousel-why>
          {c.score?.why.map(w => <span key={w} style={{ ...chip, background: alpha(tk.accent.base, 0.14), color: tk.accent.text }}>{w}</span>)}
          {c.taste?.map(w => <span key={w} data-do-carousel-taste style={chip}>{w}</span>)}
          <span style={{ fontSize: 11, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.res.stages.map(x => x.what).join(' → ')}</span>
        </div>
      ) : null}
    </div>
  );
}
