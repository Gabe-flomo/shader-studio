import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { setRandomizeOptions, useRandomizeOptions, useRandomizeProgress, type RandomizeOptions } from '../../nodes/randomizeOptions';

/** One tick row. */
export function TickRow({ on, label, hint, onClick }: { on: boolean; label: ReactNode; hint?: string; onClick: () => void }) {
  const tk = useTokens();
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      title={hint}
      onClick={onClick}
      onMouseEnter={e => { e.currentTarget.style.background = tk.bg.hover; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
      style={{
        width: '100%', minHeight: 30, display: 'flex', alignItems: 'center', gap: 9, padding: '0 8px', border: 0, borderRadius: 8,
        background: 'none', cursor: 'pointer', textAlign: 'left', color: on ? tk.text.primary : tk.text.muted, font: `12.5px ${fontFamily.ui}`,
      }}
    >
      <span style={{
        width: 16, height: 16, flexShrink: 0, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: on ? tk.accent.base : 'none', boxShadow: on ? 'none' : `inset 0 0 0 1.5px ${tk.border.strong}`, color: '#ffffff',
      }}>{on && <Icon name="check" size={12} />}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </button>
  );
}

/**
 * The Randomize options (nodes/randomizeOptions.ts), shared by the canvas dice's popover and a node
 * card's right-click menu. `scope="node"` leaves out the group toggles. Changes are saved at once.
 */
export function RandomizeOptionsPanel({ scope }: { scope: 'graph' | 'node' }) {
  const tk = useTokens();
  const o = useRandomizeOptions();
  const progress = useRandomizeProgress();
  const set = (patch: Partial<RandomizeOptions>) => setRandomizeOptions(patch);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 8px 6px' }}
        title="How far a randomize moves each setting: 1 picks anywhere in its interesting range, 0 nudges it a little around where it is">
        <span style={{ width: 58, flexShrink: 0, color: tk.text.secondary }}>Strength</span>
        <RulerSlider value={Math.round(o.strength * 100) / 100} min={0} max={1} step={0.05} hard defaultValue={0.5}
          onChange={v => set({ strength: Math.min(1, Math.max(0, v)) })} ariaLabel="Randomize strength" />
        <span style={{ width: 28, flexShrink: 0, textAlign: 'right', color: tk.text.muted, fontVariantNumeric: 'tabular-nums' }}>{+o.strength.toFixed(2)}</span>
      </div>
      <TickRow on={o.colours} label="Colours" hint="Change colour settings too" onClick={() => set({ colours: !o.colours })} />
      <TickRow on={o.includeChoices} label="Include choices" hint="Also change menus and switches (modes, shapes). Off: they stay as they are" onClick={() => set({ includeChoices: !o.includeChoices })} />
      {scope === 'graph' && (
        <>
          <TickRow on={o.groupFace} label="Settings on a group's face" hint="Change the values shown on a group's card" onClick={() => set({ groupFace: !o.groupFace })} />
          <TickRow on={o.insideGroups} label="Inside groups" hint="Go into groups and randomize what is inside (locks inside are respected)" onClick={() => set({ insideGroups: !o.insideGroups })} />
        </>
      )}
      <TickRow
        on={o.focus}
        label={progress.busy ? `Measuring… ${progress.done}/${progress.total}` : 'Focus on what changes the picture'}
        hint="Draw the graph small with each setting nudged and weight the randomizing by how much the picture changes. Takes about a second; dead settings are left alone"
        onClick={() => set({ focus: !o.focus })}
      />
    </div>
  );
}
