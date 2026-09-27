/**
 * KindDialog — name, describe and style a sketch saved as a layer kind: the
 * icon and colour it shows with in Add layer and on its layers. Used to save
 * a Script layer as a kind, and to restyle a kind later.
 */
import { useState } from 'react';
import { useThemeMode, useTokens } from '../../../theme/themeStore';
import { accentColor } from '../../../theme/categories';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { LAYER_KIND_COLOURS, LAYER_KIND_ICONS, type LayerKindColour, type LayerKindIcon } from '../../../types/layerKinds';
import { kindHint, type KindLook } from '../../../play/layerKinds';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Icon } from '../../ui/Icon';
import type { IconName } from '../../ui/iconPaths';
import { Modal } from '../../ui/Modal';

// Every kind icon is one the app draws.
const ICONS: readonly IconName[] = LAYER_KIND_ICONS satisfies readonly IconName[];

const COLOUR_NAMES: Record<LayerKindColour, string> = {
  blue: 'Blue', sky: 'Sky', teal: 'Teal', green: 'Green', yellow: 'Yellow', peach: 'Peach', red: 'Red', pink: 'Pink', mauve: 'Mauve', lavender: 'Lavender',
};

export function KindDialog({ title, confirmLabel, initial, controls, uses, taken = [], onDone }: {
  title: string;
  /** Names of the kinds this file and your list already have (a new name that matches one gets a warning). */
  taken?: readonly string[];
  confirmLabel: string;
  initial: KindLook;
  /** How many controls the sketch declares (for the Add layer preview). */
  controls: number;
  /** Restyling: how many layers use the kind. */
  uses?: number;
  onDone: (look: KindLook | null) => void;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const [look, setLook] = useState<KindLook>(initial);
  const colour = accentColor(look.colour, mode);
  const ok = !!look.name.trim();
  const name = look.name.trim().toLowerCase();
  // Saving a new kind: any match. Renaming one: a match other than its own name.
  const clash = !!name && (uses === undefined || name !== initial.name.trim().toLowerCase()) && taken.some(n => n.trim().toLowerCase() === name);
  const label = (t: string) => <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>{t}</span>;

  return (
    <Modal
      title={title}
      subtitle={uses === undefined ? 'It joins Add layer beside the built-in layers' : `Used by ${uses} layer${uses === 1 ? '' : 's'} in this file`}
      icon={look.icon}
      iconColor={colour}
      width={460}
      onClose={() => onDone(null)}
      footer={<>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
        <Button variant="primary" disabled={!ok} onClick={() => onDone(look)}>{confirmLabel}</Button>
      </>}
    >
      <div style={{ padding: '14px 20px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {label('Name')}
          <Field autoFocus aria-label="Kind name" value={look.name} maxLength={60} onChange={e => setLook({ ...look, name: e.target.value })}
            onFocus={e => e.currentTarget.select()} onKeyDown={e => { if (e.key === 'Enter' && ok) onDone(look); }} />
          {clash && <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.status.warningText }}>You already have a kind called “{look.name.trim()}”. This makes a second one; a different name keeps them apart in Add layer.</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {label('What it does (optional)')}
          <Field aria-label="What it does" value={look.hint} maxLength={240} placeholder="One line shown under the name in Add layer" onChange={e => setLook({ ...look, hint: e.target.value })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {label('Icon')}
          <div role="radiogroup" aria-label="Icon" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ICONS.map(name => {
              const on = look.icon === name;
              return (
                <button key={name} type="button" role="radio" aria-checked={on} aria-label={name} title={name} onClick={() => setLook({ ...look, icon: name as LayerKindIcon })}
                  style={{ width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: radius.md, cursor: 'pointer',
                    background: on ? alpha(colour, 0.14) : tk.bg.field, color: on ? colour : tk.text.muted, boxShadow: on ? `inset 0 0 0 1.5px ${colour}` : 'none' }}>
                  <Icon name={name} size={16} />
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {label('Colour')}
          <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {LAYER_KIND_COLOURS.map(c => {
              const on = look.colour === c, hex = accentColor(c, mode);
              return (
                <button key={c} type="button" role="radio" aria-checked={on} aria-label={COLOUR_NAMES[c]} title={COLOUR_NAMES[c]} onClick={() => setLook({ ...look, colour: c })}
                  style={{ width: 28, height: 28, borderRadius: 14, border: 0, cursor: 'pointer', background: hex, boxShadow: on ? `0 0 0 2px ${tk.bg.panel}, 0 0 0 4px ${hex}` : 'none' }} />
              );
            })}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {label('In Add layer')}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.field }}>
            <Icon name={look.icon} size={15} style={{ color: colour, marginTop: 1, flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ color: tk.text.primary, overflowWrap: 'anywhere' }}>{look.name.trim() || 'Untitled'}</span>
              <span style={{ font: `11.5px/1.35 ${fontFamily.ui}`, color: tk.text.faint }}>{kindHint(look.hint, controls)}</span>
            </span>
          </div>
          <span style={{ fontSize: 11.5, lineHeight: 1.45, color: tk.text.muted }}>
            Every layer of this kind runs the same code; its sliders and toggles are each layer’s own properties. The kind is saved in this file (and exported sites) and in your list for other files.
          </span>
        </div>
      </div>
    </Modal>
  );
}
