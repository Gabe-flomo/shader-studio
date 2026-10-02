/**
 * BehavioursDialog — the Behaviours library (implementation guide, phase 9):
 * the starter set and your own, each with what it needs (hands, sound,
 * MIDI). Pick one, fill its slots (which layer, which slider), Add: it lands
 * as ordinary rules and sources, shown on the Rules page.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily, radius } from '../../../theme/tokens';
import type { PlayRecord } from '../../../types/play';
import { BEHAVIOURS_CHANGED, BUILT_IN_BEHAVIOURS, applyBehaviour, deleteBehaviour, loadBehaviours, missingFor, slotChoices, type Behaviour } from '../../../play/behaviours';
import { Modal } from '../../ui/Modal';
import { Button, IconButton } from '../../ui/Button';
import { Select } from '../../ui/Select';
import { toast } from '../../ui/toastStore';

const NEED_WORDS = { hands: 'Hands', audio: 'Sound', midi: 'MIDI' } as const;

export function BehavioursDialog({ play, onChange, onAdded, onClose }: {
  play: PlayRecord;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** The first rule it added (to select), or '' when it added only sources. */
  onAdded: (ruleId: string) => void;
  onClose: () => void;
}) {
  const tk = useTokens();
  const [mine, setMine] = useState(() => loadBehaviours());
  useEffect(() => {
    const on = () => setMine(loadBehaviours());
    window.addEventListener(BEHAVIOURS_CHANGED, on);
    return () => window.removeEventListener(BEHAVIOURS_CHANGED, on);
  }, []);
  const [picked, setPicked] = useState<Behaviour | null>(null);
  const [fill, setFill] = useState<Record<string, string>>({});
  const all = useMemo(() => [...BUILT_IN_BEHAVIOURS, ...mine], [mine]);
  const pick = (b: Behaviour) => {
    setPicked(b);
    setFill(Object.fromEntries(b.slots.map(s => [s.key, slotChoices(play, s)[0]?.id ?? ''])));
  };
  const add = () => {
    if (!picked) return;
    let first = '', sources = 0;
    onChange(p => { const r = applyBehaviour(p, picked, fill); first = r.ruleIds[0] ?? ''; sources = r.sourceIds.length; return r.play; });
    toast.success(`Added ${picked.name}`, { message: first ? 'Its rules are on the Rules page, ready to change.' : `${sources === 1 ? 'Its source is' : 'Its sources are'} on the Inputs board.` });
    onAdded(first);
    onClose();
  };
  const card = (b: Behaviour) => {
    const missing = missingFor(play, b);
    const on = picked?.id === b.id;
    return (
      <div key={b.id} data-behaviour={b.id} role="button" tabIndex={0} aria-pressed={on} onClick={() => !missing && pick(b)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !missing) pick(b); }}
        style={{ padding: '8px 10px', borderRadius: radius.card, cursor: missing ? 'default' : 'pointer', opacity: missing ? 0.55 : 1, background: on ? tk.bg.selected : tk.bg.panel, boxShadow: `inset 0 0 0 1px ${on ? tk.accent.base : tk.border.default}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: on ? tk.accent.text : tk.text.primary, flex: 1, minWidth: 0 }}>{b.name}</span>
          {b.needs.map(n => <span key={n} style={{ height: 17, padding: '0 6px', borderRadius: 5, display: 'inline-flex', alignItems: 'center', background: tk.bg.field, color: tk.text.muted, font: `600 10px ${fontFamily.ui}` }}>{NEED_WORDS[n]}</span>)}
          {!b.builtIn && <IconButton icon="trash" label="Delete this behaviour" size="sm" tone="danger" onClick={e => { e.stopPropagation(); deleteBehaviour(b.id); if (picked?.id === b.id) setPicked(null); }} />}
        </div>
        <div style={{ color: tk.text.muted, font: `11.5px/1.4 ${fontFamily.ui}`, marginTop: 2 }}>{missing ?? b.hint}</div>
      </div>
    );
  };
  return (
    <Modal title="Behaviours" subtitle="Ready-made rules and sources: pick one, say what it works on, Add" icon="star" onClose={onClose} width={620} height={600}
      footer={<div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
        <span style={{ flex: 1, color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}>{picked ? `Adds ${picked.rules.length ? `${picked.rules.length} rule${picked.rules.length === 1 ? '' : 's'}` : ''}${picked.rules.length && picked.sources.length ? ' and ' : ''}${picked.sources.length ? `${picked.sources.length} source${picked.sources.length === 1 ? '' : 's'}` : ''}` : 'Your own: Save as behaviour on a rule card.'}</span>
        <Button variant="primary" disabled={!picked || picked.slots.some(s => !fill[s.key])} onClick={add}>Add</Button>
      </div>}>
      <div style={{ padding: '12px 16px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 8 }}>{all.map(card)}</div>
        {picked && picked.slots.length > 0 && (
          <div data-behaviour-slots="" style={{ marginTop: 14, padding: '10px 12px', borderRadius: radius.card, background: tk.bg.field }}>
            <div style={{ font: `600 12px ${fontFamily.ui}`, marginBottom: 6 }}>{picked.name} works on</div>
            {picked.slots.map(s => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <span style={{ width: 90, color: tk.text.muted, font: `12px ${fontFamily.ui}` }}>{s.label}</span>
                <Select ariaLabel={s.label} value={fill[s.key] ?? ''} height={28} style={{ flex: 1 }} options={slotChoices(play, s).map(c => ({ value: c.id, label: c.label }))} onChange={v => setFill(f => ({ ...f, [s.key]: v }))} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
