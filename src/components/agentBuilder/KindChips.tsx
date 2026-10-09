/**
 * The Agent Builder's kinds of walker (docs/agent-builder.md): a colour chip each, up to four.
 * Pick one to edit its cards (the viewport lights its walkers); double-click (or the pencil) to
 * rename it in place; its colour swatch and × under the chips. Each kind is a species of the rule
 * set (agentBuilder/behaviours.ts addSpecies…), so a new kind is a copy of the one picked.
 */
import { useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ColorSwatch } from '../ui/ColorPicker';
import { MAX_SPECIES, type AgentRuleSet } from '../../agentRules/spec';
import { addSpecies, removeSpecies, renameSpecies, setSpeciesColour } from '../../agentBuilder/behaviours';
import { StudioLabel } from '../builders/studio/StudioShell';

const css = (c: number[]) => `rgb(${c.map(v => Math.round(Math.min(Math.max(v, 0), 1) * 255)).join(',')})`;

export function KindChips({ set, sp, onSelect, update }: {
  set: AgentRuleSet; sp: number;
  onSelect: (i: number) => void;
  update: (next: AgentRuleSet) => void;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const startRename = (i: number) => { setEditing(i); setDraft(set.species[i]?.name ?? ''); };
  const commit = () => {
    if (editing !== null && draft.trim()) update(renameSpecies(set, editing, draft.trim()));
    setEditing(null);
  };
  const cur = set.species[sp];
  const colour = (cur?.states[0]?.colour ?? [1, 1, 1]) as [number, number, number];
  const chipBase = { height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, borderRadius: 14, cursor: 'pointer', font: `500 12px ${fontFamily.ui}` } as const;
  return (
    <div data-kind-chips style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <StudioLabel meta={`${set.species.length} of ${MAX_SPECIES}`}>Kinds</StudioLabel>
      <div role="radiogroup" aria-label="Kinds of walker" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {set.species.map((x, i) => {
          const c = x.states[0]?.colour ?? [1, 1, 1];
          if (editing === i) {
            return (
              <input key={i} data-species-rename={i} autoFocus value={draft} aria-label="Kind name" onChange={e => setDraft(e.target.value)}
                onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { e.stopPropagation(); setEditing(null); } }}
                data-captures-escape
                style={{ ...chipBase, width: 116, cursor: 'text', background: tk.bg.field, color: tk.text.primary, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, outline: 'none' }} />
            );
          }
          return (
            <button key={i} type="button" role="radio" aria-checked={i === sp} data-species={i} onClick={() => onSelect(i)} onDoubleClick={() => startRename(i)}
              title="Pick to edit its cards; double-click to rename"
              style={{ ...chipBase, background: i === sp ? tk.bg.selected : tk.bg.field, color: tk.text.primary, boxShadow: i === sp ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none' }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: css(c), boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }} />
              {x.name || `Kind ${i + 1}`}
            </button>
          );
        })}
        {set.species.length < MAX_SPECIES && (
          <button type="button" data-species-add onClick={() => { update(addSpecies(set, sp)); onSelect(set.species.length); }} title="A new kind: a copy of the one picked, in a new colour"
            style={{ ...chipBase, background: 'none', color: tk.text.muted, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
            <Icon name="plus" size={12} />Add a kind
          </button>
        )}
      </div>
      {cur && (
        <div data-species-tools style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <ColorSwatch label={`${cur.name} colour`} size="sm" showHex={false} value={colour} onChange={rgb => update(setSpeciesColour(set, sp, rgb as [number, number, number]))} />
          <button type="button" data-species-rename-start={sp} onClick={() => startRename(sp)} aria-label={`Rename ${cur.name}`} title="Rename"
            style={{ width: 26, height: 22, padding: 0, border: 0, borderRadius: 6, background: tk.bg.field, color: tk.text.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="edit" size={12} />
          </button>
          {set.species.length > 1 && (
            <button type="button" data-species-remove={sp} onClick={() => { update(removeSpecies(set, sp)); onSelect(Math.max(0, sp - 1)); }} aria-label={`Remove ${cur.name}`} title={`Take ${cur.name} away`}
              style={{ width: 26, height: 22, padding: 0, border: 0, borderRadius: 6, background: tk.bg.field, color: tk.text.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="trash" size={12} />
            </button>
          )}
          <span style={{ fontSize: 11, color: tk.text.faint, marginLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>its own cards below</span>
        </div>
      )}
    </div>
  );
}
