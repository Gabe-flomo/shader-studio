/**
 * Behaviours from outside the Rules header (Play audit P11): a Behaviours…
 * button for the Controls and Sources empty states, and the Rules page's
 * start pane (what a rule is, and a few behaviours to start from) for when
 * nothing is selected. Adding one that makes rules goes to the Rules page.
 */
import { useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord } from '../../../types/play';
import { BUILT_IN_BEHAVIOURS, missingFor } from '../../../play/behaviours';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { BehavioursDialog } from './BehavioursDialog';
import { goToSignal } from '../playSplit';

type Change = (fn: (p: PlayRecord) => PlayRecord) => void;

/** "Behaviours…": the library, opened here; a behaviour that adds rules shows them on the Rules page. */
export function BehavioursButton({ play, onChange, label = 'Behaviours…', variant = 'ghost', stay = false }: {
  play: PlayRecord;
  onChange: Change;
  label?: string;
  variant?: 'ghost' | 'secondary' | 'primary';
  /** Already on the Rules page: select the new rule here instead of going there. */
  stay?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} icon="star" onClick={() => setOpen(true)} title="Ready-made rules and sources: pinch to burst, pulse to the beat, bass shakes it…">{label}</Button>
      {open && <BehavioursDialog play={play} onChange={onChange} onClose={() => setOpen(false)} onAdded={id => { if (id && !stay) goToSignal(id); }} />}
    </>
  );
}

/** How many behaviours the start pane suggests. */
const IDEAS = 4;

/**
 * The Rules page's other half when no rule is selected: When → Do in two lines with examples, and
 * behaviours this setup can use right away (one opens the library on it).
 */
export function RulesStart({ play, onChange, onAdded, compact = false }: {
  play: PlayRecord;
  onChange: Change;
  /** A behaviour added its first rule (to select it). */
  onAdded: (ruleId: string) => void;
  /** Stacked under the list (a narrow panel): only the behaviours. */
  compact?: boolean;
}) {
  const tk = useTokens();
  const [opening, setOpening] = useState<string | null>(null);
  const ideas = BUILT_IN_BEHAVIOURS.filter(b => !missingFor(play, b)).slice(0, IDEAS);
  const head: React.CSSProperties = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 6 };
  const example = (when: string, does: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, font: `12px/1.6 ${fontFamily.ui}`, color: tk.text.secondary }}>
      <span style={{ color: tk.text.faint, width: 34, flexShrink: 0 }}>When</span>
      <span style={{ minWidth: 0 }}>{when}</span>
      <Icon name="chevR" size={11} style={{ flexShrink: 0, color: tk.text.faint }} />
      <span style={{ minWidth: 0, color: tk.text.primary }}>{does}</span>
    </div>
  );
  return (
    <div data-rules-start="" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 520 }}>
      {!compact && (
        <div style={{ padding: '12px 14px', borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
          <div style={head}>A rule</div>
          <div style={{ font: `12px/1.5 ${fontFamily.ui}`, color: tk.text.muted, marginBottom: 8 }}>
            Says <b style={{ color: tk.text.secondary }}>when</b> something happens (a key, a note, a pinch, a beat, a value crossing a line, another rule) and what to <b style={{ color: tk.text.secondary }}>do</b> then: something to a layer, set or nudge a control, play notes, or send a signal to other rules.
          </div>
          {example('Space is pressed', 'Burst the particles')}
          {example('the bass hits', 'Nudge Radius by +0.1')}
          {example('Reached arrives', 'Set Glow to 1')}
        </div>
      )}
      {ideas.length > 0 && (
        <div>
          <div style={head}>Start from a behaviour</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(200px, 100%), 1fr))', gap: 6 }}>
            {ideas.map(b => (
              <button key={b.id} type="button" data-behaviour-idea={b.id} onClick={() => setOpening(b.id)}
                style={{ textAlign: 'left', padding: '8px 10px', border: 0, borderRadius: radius.card, cursor: 'pointer', background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>
                  <Icon name="star" size={12} style={{ color: tk.text.faint, flexShrink: 0 }} />{b.name}
                </div>
                <div style={{ marginTop: 2, font: `11.5px/1.4 ${fontFamily.ui}`, color: tk.text.muted }}>{b.hint}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {opening && <BehavioursDialog play={play} onChange={onChange} initial={opening} onClose={() => setOpening(null)} onAdded={onAdded} />}
    </div>
  );
}
