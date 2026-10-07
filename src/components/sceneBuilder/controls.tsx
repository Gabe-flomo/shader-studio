/**
 * controls.tsx — the Scene Builder form's rows: a labelled ruler slider, an
 * X / Y / Z row, a colour row and a folding card. Every change goes through
 * the builder store's `edit`, with a coalesce key so one drag is one undo step.
 */
import { useState, type ReactNode } from 'react';
import { RulerSlider } from '../ui/RulerSlider';
import { ColorSwatch } from '../ui/ColorPicker';
import { Icon } from '../ui/Icon';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { HintLabel } from '../builders/BuilderHelp';
import type { Vec3 } from '../../sceneBuilder/spec';

const LABEL_W = 116;

export function Row({ label, hint, children }: { label: ReactNode; hint?: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `${LABEL_W}px minmax(0, 1fr)`, alignItems: 'center', gap: 10, minHeight: 32 }}>
      <span style={{ fontSize: 12.5, color: tk.text.secondary, minWidth: 0, display: 'flex' }}><HintLabel hint={hint}>{label}</HintLabel></span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function NumRow({ label, value, min, max, step = 0.01, onChange, hint, integer, unit }: {
  label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; hint?: string; integer?: boolean; unit?: string;
}) {
  return (
    <Row label={unit ? <>{label} <span style={{ opacity: 0.6 }}>{unit}</span></> : label} hint={hint}>
      <RulerSlider value={value} min={min} max={max} step={integer ? 1 : step} integer={integer} onChange={onChange} ariaLabel={typeof label === 'string' ? label : 'value'} />
    </Row>
  );
}

export function Vec3Row({ label, value, min, max, step = 0.01, onChange, hint, axes = ['X', 'Y', 'Z'] }: {
  label: ReactNode; value: Vec3; min: number; max: number; step?: number; onChange: (v: Vec3) => void; hint?: string; axes?: [string, string, string];
}) {
  const tk = useTokens();
  return (
    <Row label={label} hint={hint}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        {value.map((v, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
            <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.text.faint, width: 10 }}>{axes[i]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <RulerSlider value={v} min={min} max={max} step={step} ariaLabel={`${typeof label === 'string' ? label : 'value'} ${axes[i]}`}
                onChange={n => { const next = [...value] as Vec3; next[i] = n; onChange(next); }} />
            </div>
          </div>
        ))}
      </div>
    </Row>
  );
}

export function ColourRow({ label, value, onChange, hint }: { label: ReactNode; value: Vec3; onChange: (v: Vec3) => void; hint?: string }) {
  return (
    <Row label={label} hint={hint}>
      <ColorSwatch value={value} label={typeof label === 'string' ? label : 'colour'} onChange={rgb => onChange([rgb[0], rgb[1], rgb[2]])} />
    </Row>
  );
}

/** Which cards are open, kept while the app runs (a card the user opened stays open across tabs). */
const openCards = new Map<string, boolean>();

/** A folding card: a header with its title, a one-line summary while folded, and actions. */
export function Card({ id, title, summary, accent, actions, defaultOpen = false, children, selected, onHeaderClick }: {
  id: string; title: ReactNode; summary?: ReactNode; accent?: string; actions?: ReactNode; defaultOpen?: boolean; children: ReactNode; selected?: boolean; onHeaderClick?: () => void;
}) {
  const tk = useTokens();
  const [open, setOpenState] = useState(() => openCards.get(id) ?? defaultOpen);
  const setOpen = (v: boolean) => { openCards.set(id, v); setOpenState(v); };
  return (
    <div data-sb-card={id} style={{
      borderRadius: radius.control, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${selected ? tk.accent.base : tk.border.default}`, overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px 6px 10px', minHeight: 40, boxSizing: 'border-box', cursor: 'pointer' }}
        onClick={() => { setOpen(!open); onHeaderClick?.(); }}>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
        {accent && <span style={{ width: 10, height: 10, borderRadius: 3, background: accent, flexShrink: 0 }} />}
        <span style={{ fontWeight: 600, fontSize: 13, color: tk.text.primary, flexShrink: 0 }}>{title}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{!open && summary}</span>
        <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>{actions}</span>
      </div>
      {open && <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${tk.border.subtle}` }}>{children}</div>}
    </div>
  );
}

/** A touch screen with no mouse: HTML drag and drop isn't available there, so the tree and the chips use buttons. */
export const NO_DRAG = typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;

/** A combine's sign: ∪ union, − subtract, ∩ intersect. */
export const OP_GLYPH: Record<string, string> = { union: '∪', subtract: '−', intersect: '∩' };

export const rgbCss = (c: Vec3) => `rgb(${c.map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})`;
