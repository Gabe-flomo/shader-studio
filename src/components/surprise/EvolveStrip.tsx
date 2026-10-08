/**
 * EvolveStrip.tsx — Evolve at the top of the Do bar (evolveAction.ts): the round, what the taste model has
 * learned, and two candidates side by side, each with its picture, seed, sources and why-chips. Hovering one
 * shows it on the canvas; clicking picks it (the next round grows from it). Keep commits the one on the
 * canvas; Escape puts the original back.
 */
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { escapeEvolveSession, focusEvolve, keepEvolveSession, pickEvolveCandidate, startEvolveSession, useEvolve } from './evolveAction';
import { closeDoBar } from '../../suggestions/doBarStore';
import type { EvolveCand } from '../../taste';

const KIND: Record<EvolveCand['kind'], string> = { fresh: 'New', refine: 'Refine', branch: 'Branch' };
const KIND_HINT: Record<EvolveCand['kind'], string> = {
  fresh: 'A new graph inspired by your graphs and the examples',
  refine: 'Your pick, mutated: settings nudged, sometimes a technique swapped or a post step added',
  branch: 'A new graph that uses your pick as one of its sources, leaning on what you usually pick',
};

export function EvolveToggle() {
  const tk = useTokens();
  const open = useEvolve(s => s.open);
  return (
    <button type="button" data-do-evolve aria-pressed={open}
      title="Evolve: pick one of two, round after round; it learns your taste (all on this device). Keep commits the one on screen, Escape puts this graph back"
      onClick={() => { if (open) escapeEvolveSession(); else void startEvolveSession(); }}
      style={{
        height: 24, padding: '0 8px', borderRadius: radius.md, cursor: 'pointer', font: `600 11px ${fontFamily.ui}`,
        border: `1px solid ${open ? tk.accent.base : tk.border.default}`, background: open ? alpha(tk.accent.base, 0.14) : 'transparent', color: open ? tk.accent.text : tk.text.muted,
      }}>Evolve</button>
  );
}

export function EvolveStrip() {
  const tk = useTokens();
  const { open, state, views, focus, busy, learned } = useEvolve();
  if (!open) return null;
  const chip = { font: `11px ${fontFamily.ui}`, padding: '1px 7px', borderRadius: 999, background: tk.bg.hover, color: tk.text.secondary, whiteSpace: 'nowrap' } as const;
  return (
    <div data-do-evolve-strip style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 8px 8px 10px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span data-do-evolve-round style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, whiteSpace: 'nowrap' }}>Evolve · round {state?.round ?? 1}</span>
        <span data-do-evolve-learned title="What the taste model has learned so far (it lives on this device only)"
          style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11.5, color: tk.text.muted }}>
          learned: {learned}
        </span>
        <Button size="sm" variant="primary" icon="check" disabled={!state || busy} onClick={() => { keepEvolveSession(); closeDoBar(); }} data-do-evolve-keep>Keep</Button>
        <Button size="sm" variant="ghost" icon="undo" onClick={escapeEvolveSession} data-do-evolve-undo>Undo</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, opacity: busy ? 0.55 : 1, transition: 'opacity 120ms' }}>
        {state ? state.pair.map((c, i) => {
          const v = views.get(c);
          const on = focus === i;
          return (
            <button key={c.id} type="button" data-do-evolve-card={i} disabled={busy}
              onMouseEnter={() => focusEvolve(i as 0 | 1)} onFocus={() => focusEvolve(i as 0 | 1)} onClick={() => pickEvolveCandidate(i as 0 | 1)}
              title={`${KIND_HINT[c.kind]}. Click to pick it: the next round grows from it.`}
              style={{
                display: 'flex', flexDirection: 'column', gap: 4, padding: 6, textAlign: 'left', cursor: busy ? 'wait' : 'pointer', minWidth: 0,
                borderRadius: radius.md, border: `1.5px solid ${on ? tk.accent.base : tk.border.subtle}`, background: on ? alpha(tk.accent.base, 0.08) : tk.bg.panel, color: tk.text.primary,
              }}>
              <div style={{ position: 'relative', width: '100%', aspectRatio: '192 / 120', borderRadius: radius.sm ?? 4, overflow: 'hidden', background: tk.bg.hover }}>
                {v?.thumb && <img src={v.thumb} alt="" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />}
                <span style={{ position: 'absolute', left: 6, top: 6, ...chip, background: alpha('#000000', 0.55), color: '#ffffff', font: `600 10.5px ${fontFamily.ui}` }}>{KIND[c.kind]}</span>
                <span style={{ position: 'absolute', right: 6, top: 6, ...chip, background: alpha('#000000', 0.55), color: '#ffffff', font: `10.5px ${fontFamily.mono}` }}>seed {c.seed}</span>
              </div>
              <span style={{ fontSize: 11.5, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {c.comp.inspirations.length ? `Inspired by ${c.comp.inspirations.map(x => (x.id.startsWith('evolve:') ? 'your pick' : x.label)).join(', ')}` : 'A random line'}
              </span>
              <span style={{ fontSize: 11, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[...c.changes, c.comp.stages.map(x => x.choice).join(' → ')].filter(Boolean).join(' · ')}
              </span>
              {!!v?.why.length && (
                <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} data-do-evolve-why>
                  {v.why.map(w => <span key={w} style={w.startsWith('your') ? chip : { ...chip, background: alpha(tk.accent.base, 0.14), color: tk.accent.text }}>{w}</span>)}
                </span>
              )}
            </button>
          );
        }) : [0, 1].map(i => <div key={i} style={{ aspectRatio: '192 / 150', borderRadius: radius.md, background: tk.bg.hover }} />)}
      </div>
      <span style={{ fontSize: 11, color: tk.text.faint }}>{busy ? 'Growing the next round…' : 'Hover to see one on the canvas · click to pick it · Enter keeps the one on the canvas · Escape puts your graph back'}</span>
    </div>
  );
}
