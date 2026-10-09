/**
 * The Agent Builder's behaviour cards (docs/agent-builder.md): a picture, a plain name with its
 * one-line hint on hover, an on/off switch where the behaviour can be off, two or three settings,
 * a folded "More" for the rest, and "Learn more" (the field guide's paragraph, retold).
 *
 * Settings tell the viewport which one is under the pointer or being dragged (`onFocus`), so its
 * diagram lights that part.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Toggle } from '../ui/Choice';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { RulerSlider } from '../ui/RulerSlider';

export type CardPicture = 'born' | 'senses' | 'turning' | 'moving' | 'trail' | 'advanced'
  | 'gravity' | 'wind' | 'curl' | 'attract' | 'drag' | 'fade' | 'die' | 'life' | 'look' | 'neighbours'
  | 'separate' | 'match' | 'cohere' | 'avoidEdges' | 'goal' | 'slow' | 'orbit' | 'wobble';

/** A card's small picture: the behaviour drawn in a few strokes. */
export function CardGlyph({ kind, size = 40 }: { kind: CardPicture; size?: number }) {
  const tk = useTokens();
  const a = tk.accent.base;
  const ink = tk.text.secondary;
  const body = (() => {
    switch (kind) {
      case 'born': return <>
        <circle cx={20} cy={20} r={11} fill={alpha(a, 0.15)} stroke={a} strokeWidth={1.5} strokeDasharray="3 3" />
        {[[16, 17], [22, 15], [25, 22], [18, 24], [20, 20]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={1.6} fill={ink} />)}
      </>;
      case 'senses': return <>
        <path d="M20 31 L20 13 M20 31 L13 15 M20 31 L27 15" stroke={ink} strokeWidth={1.4} strokeDasharray="2.5 2" />
        {[[20, 12], [12.5, 14], [27.5, 14]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill="none" stroke={a} strokeWidth={1.6} />)}
        <path d="M20 27 l3 6 l-3 -2 l-3 2 z" fill={ink} />
      </>;
      case 'turning': return <>
        <path d="M20 31 L20 12" stroke={ink} strokeWidth={1.2} strokeDasharray="2.5 2" />
        <path d="M20 31 L11 15" stroke={ink} strokeWidth={1.8} />
        <path d="M20 21 A 10 10 0 0 0 15 22.5" fill="none" stroke={a} strokeWidth={2} />
      </>;
      case 'moving': return <>
        {[30, 25, 20, 15].map((y, i) => <circle key={i} cx={20} cy={y} r={1.9} fill={ink} opacity={0.4 + i * 0.2} />)}
        <path d="M20 6 l4 7 l-4 -2 l-4 2 z" fill={a} />
      </>;
      case 'trail': return <>
        {[31, 26, 21, 16].map((y, i) => <circle key={i} cx={20} cy={y} r={2 + i * 0.3} fill="#e8a33a" opacity={0.25 + i * 0.22} />)}
        <path d="M20 6 l4 7 l-4 -2 l-4 2 z" fill={ink} />
      </>;
      case 'advanced': return <>
        <rect x={9} y={11} width={22} height={18} rx={4} fill="none" stroke={ink} strokeWidth={1.4} />
        <path d="M13 17 h9 M13 21 h14 M13 25 h6" stroke={a} strokeWidth={1.6} />
      </>;
      case 'gravity': return <>
        <circle cx={20} cy={13} r={3} fill={ink} />
        <path d="M20 17 V31 M15.5 26.5 L20 31 L24.5 26.5" fill="none" stroke={a} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </>;
      case 'wind': return <>
        <path d="M8 15 h17 a3.5 3.5 0 1 0 -3.5 -3.5 M8 21 h22 M8 27 h13 a3.5 3.5 0 1 1 -3.5 3.5" fill="none" stroke={a} strokeWidth={1.8} strokeLinecap="round" />
      </>;
      case 'curl': return <>
        <path d="M20 20 m-2 0 a2 2 0 1 1 4 0 a5 5 0 1 1 -10 0 a8 8 0 1 1 16 0 a11 11 0 0 1 -6 9.6" fill="none" stroke={a} strokeWidth={1.7} strokeLinecap="round" />
      </>;
      case 'attract': return <>
        <circle cx={20} cy={20} r={3.2} fill={a} />
        {[0, 90, 180, 270].map(d => { const r = d * Math.PI / 180; const o = [20 + Math.cos(r) * 14, 20 + Math.sin(r) * 14], i = [20 + Math.cos(r) * 7, 20 + Math.sin(r) * 7]; return <path key={d} d={`M${o[0]} ${o[1]} L${i[0]} ${i[1]}`} stroke={ink} strokeWidth={1.6} strokeLinecap="round" />; })}
      </>;
      case 'drag': return <>
        <path d="M8 14 H32 M8 20 H24 M8 26 H16" stroke={a} strokeWidth={2.2} strokeLinecap="round" />
      </>;
      case 'fade': case 'life': return <>
        {[0, 1, 2, 3, 4].map(i => <circle key={i} cx={9 + i * 5.5} cy={20} r={2.6} fill={a} opacity={1 - i * 0.2} />)}
      </>;
      case 'die': return <>
        <circle cx={20} cy={20} r={9} fill="none" stroke={ink} strokeWidth={1.4} strokeDasharray="2.5 2.5" />
        <path d="M16 16 L24 24 M24 16 L16 24" stroke={a} strokeWidth={2} strokeLinecap="round" />
      </>;
      case 'look': return <>
        <circle cx={14} cy={22} r={3} fill={a} /><circle cx={24} cy={16} r={5} fill={alpha(a, 0.35)} /><circle cx={24} cy={16} r={2.2} fill={a} />
        <path d="M11 30 L27 26" stroke={ink} strokeWidth={1.6} strokeLinecap="round" />
      </>;
      case 'neighbours': return <>
        <circle cx={20} cy={20} r={11} fill="none" stroke={a} strokeWidth={1.5} strokeDasharray="3 2.5" />
        {[[20, 20], [14, 16], [25, 14], [24, 25], [33, 31], [7, 9]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2} fill={i === 0 ? ink : i > 3 ? alpha(ink, 0.35) : a} />)}
      </>;
      case 'separate': return <>
        <circle cx={20} cy={20} r={2.6} fill={ink} />
        <path d="M17 17 L10 10 M23 23 L30 30 M23 17 L30 10" stroke={a} strokeWidth={1.8} strokeLinecap="round" />
      </>;
      case 'match': return <>
        {[[12, 26], [20, 22], [28, 26]].map(([x, y], i) => <path key={i} d={`M${x} ${y} l3 -9`} stroke={i === 1 ? a : ink} strokeWidth={2} strokeLinecap="round" />)}
      </>;
      case 'cohere': return <>
        <circle cx={20} cy={20} r={2.6} fill={a} />
        {[[9, 11], [31, 13], [12, 31], [30, 29]].map(([x, y], i) => <path key={i} d={`M${x} ${y} L${20 + (x - 20) * 0.35} ${20 + (y - 20) * 0.35}`} stroke={ink} strokeWidth={1.6} strokeLinecap="round" />)}
      </>;
      case 'avoidEdges': return <>
        <path d="M31 8 V32" stroke={ink} strokeWidth={1.6} strokeDasharray="3 2.5" />
        <path d="M12 28 Q 27 22 18 12" fill="none" stroke={a} strokeWidth={1.8} strokeLinecap="round" />
      </>;
      case 'goal': return <>
        <circle cx={29} cy={20} r={4} fill="none" stroke={a} strokeWidth={1.8} /><circle cx={29} cy={20} r={1.4} fill={a} />
        <path d="M8 24 Q 16 26 23 21" fill="none" stroke={ink} strokeWidth={1.7} strokeLinecap="round" />
      </>;
      case 'slow': return <>
        {[[10, 20], [16, 20], [21, 20], [25, 20], [28, 20], [30.5, 20]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2} fill={i > 2 ? a : ink} />)}
      </>;
      case 'orbit': return <>
        <circle cx={20} cy={20} r={2.4} fill={ink} />
        <circle cx={20} cy={20} r={11} fill="none" stroke={a} strokeWidth={1.6} />
        <circle cx={31} cy={20} r={2.4} fill={a} />
      </>;
      case 'wobble': return <>
        <path d="M20 31 L20 13 M20 31 L13 15 M20 31 L27 15" stroke={ink} strokeWidth={1} strokeDasharray="2 2" />
        <path d="M20 31 Q 16 24 21 19 T 19 9" fill="none" stroke={a} strokeWidth={1.8} strokeLinecap="round" />
      </>;
    }
  })();
  return (
    <span style={{ width: size, height: size, borderRadius: 10, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.field }}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>{body}</svg>
    </span>
  );
}

export function BehaviourCard({ id, picture, title, hint, summary, learn, guide, on, onToggle, children, more, footer, handle, onlyWhen, onRemove, hot = false }: {
  id: string; picture: CardPicture; title: string; hint: string; summary?: string;
  learn?: string; guide?: string;
  /** The card's switch (absent: the behaviour is always part of the walker). */
  on?: boolean; onToggle?: (on: boolean) => void;
  children?: ReactNode;
  /** Folded settings ("More"). */
  more?: ReactNode;
  footer?: ReactNode;
  /** A drag handle (cards whose order matters). */
  handle?: ReactNode;
  /** The "Only when…" line. */
  onlyWhen?: ReactNode;
  /** Take the card away. */
  onRemove?: () => void;
  /** Its diagram is the one drawn (pointed at). */
  hot?: boolean;
}) {
  const tk = useTokens();
  const [learnOpen, setLearnOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const off = on === false;
  return (
    <section data-card={id} data-card-on={on === undefined ? undefined : String(on)}
      style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: radius.card, background: tk.bg.panel, boxShadow: `inset 0 0 0 ${hot ? 1.5 : 1}px ${hot ? alpha(tk.accent.base, 0.55) : tk.border.default}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {handle}
        <CardGlyph kind={picture} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <Tooltip label={title} description={hint} placement="bottom">
            <b style={{ fontSize: 14, fontWeight: 650, cursor: 'help' }}>{title}</b>
          </Tooltip>
          {summary && <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span>}
        </span>
        {onToggle && <span data-card-switch={id}><Toggle checked={!!on} onChange={onToggle} label={on ? 'On' : 'Off'} /></span>}
        {onRemove && (
          <button type="button" data-card-remove={id} aria-label={`Take ${title} away`} title={`Take ${title} away`} onClick={onRemove}
            style={{ width: 24, height: 24, padding: 0, border: 0, borderRadius: 7, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
      {children && <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: off ? 0.5 : 1 }}>{children}</div>}
      {onlyWhen}
      {more && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button type="button" data-card-more={id} aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.text.muted, font: `600 11.5px ${fontFamily.ui}` }}>
            <Icon name={moreOpen ? 'chevD' : 'chevR'} size={12} />More
          </button>
          {moreOpen && <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: off ? 0.5 : 1 }}>{more}</div>}
        </div>
      )}
      {footer}
      {learn && (
        <div style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button type="button" data-learn-more={id} aria-expanded={learnOpen} onClick={() => setLearnOpen(v => !v)}
            style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, padding: 0, border: 0, background: 'none', cursor: 'pointer', color: tk.accent.text, font: `600 11.5px ${fontFamily.ui}` }}>
            <Icon name="book" size={13} />{learnOpen ? 'Less' : 'Learn more'}
          </button>
          {learnOpen && <>
            <p data-learn-text={id} style={{ margin: 0, fontSize: 12, lineHeight: 1.55, color: tk.text.secondary }}>{learn}</p>
            {guide && <span style={{ fontSize: 11, color: tk.text.faint }}>{guide}</span>}
          </>}
        </div>
      )}
    </section>
  );
}

/** A setting's row: its plain name (hint on hover) above its control; tells the diagram when it is pointed at or dragged. */
export function SettingRow({ id, label, hint, onFocus, children, right }: {
  id: string; label: string; hint?: string; onFocus?: (setting: string | undefined) => void; children: ReactNode; right?: ReactNode;
}) {
  const tk = useTokens();
  return (
    <div data-setting={id}
      onPointerEnter={() => onFocus?.(id)}
      onPointerLeave={e => { if (!(e.buttons & 1)) onFocus?.(undefined); }}
      onPointerDown={() => onFocus?.(id)}
      onFocus={() => onFocus?.(id)}
      style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 18 }}>
        <span title={hint} style={{ fontSize: 12, fontWeight: 600, color: tk.text.secondary, flex: 1 }}>{label}</span>
        {right}
      </span>
      {children}
    </div>
  );
}

/** A slider setting (the app's ruler). */
export function SliderSetting({ id, label, hint, value, min, max, step, onChange, onFocus, disabled, right, defaultValue }: {
  id: string; label: string; hint?: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
  onFocus?: (s: string | undefined) => void; disabled?: boolean; right?: ReactNode; defaultValue?: number;
}) {
  return (
    <SettingRow id={id} label={label} hint={hint} onFocus={onFocus} right={right}>
      <RulerSlider value={value} min={min} max={max} step={step} onChange={onChange} ariaLabel={label} disabled={disabled} defaultValue={defaultValue} />
    </SettingRow>
  );
}

/** Pick-one chips ("Smells": its own, food, home…). */
export function ChipRow<T extends string | number>({ label, options, value, onChange }: {
  label: string; options: ReadonlyArray<{ value: T; label: string; dot?: string }>; value: T; onChange: (v: T) => void;
}) {
  const tk = useTokens();
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} data-chip={String(o.value)} onClick={() => onChange(o.value)}
            style={{
              height: 26, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 10px', borderRadius: 13, border: 0, cursor: 'pointer',
              background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.secondary,
              boxShadow: on ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none', font: `500 12px ${fontFamily.ui}`,
            }}>
            {o.dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: o.dot }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
