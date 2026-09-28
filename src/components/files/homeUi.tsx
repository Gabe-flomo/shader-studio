/**
 * The Files home's pieces: a stat tile with a sparkline, the month calendar
 * with dots on active days, a chip with a count, a poster card, and a
 * horizontal carousel. All draw with the app's tokens (one accent colour,
 * text in text tokens), light and dark.
 */
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/Button';
import type { IconName } from '../ui/iconPaths';
import { cardStyle, capsLabel } from './fileUiShared';
import { ACTIVITY_KINDS, calendarBuckets, type ActivityEvent } from '../../files/activity';

/** A thin line over the last days' counts, the area under it faintly filled. */
export function Sparkline({ values, width = 96, height = 28, colour }: { values: number[]; width?: number; height?: number; colour: string }) {
  const max = Math.max(1, ...values);
  const n = values.length;
  const pts = values.map((v, i) => [n === 1 ? width / 2 : (i / (n - 1)) * (width - 2) + 1, height - 2 - (v / max) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${height} L${pts[0][0].toFixed(1)} ${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
      <path d={area} fill={alpha(colour, 0.12)} />
      <path d={line} fill="none" stroke={colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={3} fill={colour} />
    </svg>
  );
}

/** "14 saves" over a sparkline, with the hover giving each day's count. */
export function StatTile({ icon, label, count, perDay, days, compact }: { icon: IconName; label: string; count: number; perDay: number[]; days: number; compact: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState<number | null>(null);
  const dayLabel = (i: number) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (days - 1 - i)); return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); };
  return (
    <div style={{ ...cardStyle(tk), padding: compact ? '12px 12px 10px' : '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, position: 'relative' }}
      onMouseLeave={() => setHover(null)}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: tk.text.muted, font: `500 11.5px ${fontFamily.ui}` }}>
        <Icon name={icon} size={13} />{label}
      </span>
      <span style={{ font: `650 ${compact ? 22 : 26}px ${fontFamily.ui}`, letterSpacing: '-0.02em', color: tk.text.primary, lineHeight: 1.1 }}>{count}</span>
      <div style={{ position: 'relative', marginTop: 2 }}
        onMouseMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(days - 1, Math.round(((e.clientX - r.left) / r.width) * (days - 1))))); }}>
        <Sparkline values={perDay} width={compact ? 120 : 140} height={26} colour={count ? tk.accent.base : tk.text.disabled} />
        {hover != null && (
          <span role="tooltip" style={{ position: 'absolute', left: 0, bottom: '100%', marginBottom: 4, padding: '3px 7px', borderRadius: radius.sm, background: tk.tooltip.bg, color: tk.tooltip.text, font: `11px ${fontFamily.ui}`, whiteSpace: 'nowrap', pointerEvents: 'none' }}>
            {dayLabel(hover)}: {perDay[hover]}
          </span>
        )}
      </div>
    </div>
  );
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** A month, a dot on each day with activity; click a day for its events. */
export function MonthCalendar({ events, since, selected, onSelect, compact }: { events: ActivityEvent[]; since: number; selected: number | null; onSelect: (dayStart: number | null) => void; compact: boolean }) {
  const tk = useTokens();
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const [shown, setShown] = useState(() => ({ y: today.getFullYear(), m: today.getMonth() }));
  const buckets = useMemo(() => calendarBuckets(events, shown.y, shown.m), [events, shown]);
  const first = new Date(shown.y, shown.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(shown.y, shown.m + 1, 0).getDate();
  const cells: Array<number | null> = [...Array<null>(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const isNow = shown.y === today.getFullYear() && shown.m === today.getMonth();
  const cell = compact ? 34 : 36;
  return (
    <div style={{ ...cardStyle(tk), padding: compact ? '12px 12px 10px' : '14px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, font: `650 13px ${fontFamily.ui}`, color: tk.text.primary }}>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        <IconButton icon="chevL" size="sm" label="Earlier month" tooltip={false} onClick={() => setShown(s => (s.m ? { y: s.y, m: s.m - 1 } : { y: s.y - 1, m: 11 }))} />
        <IconButton icon="chevR" size="sm" label="Later month" tooltip={false} disabled={isNow} onClick={() => setShown(s => (s.m === 11 ? { y: s.y + 1, m: 0 } : { y: s.y, m: s.m + 1 }))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, justifyItems: 'center' }}>
        {WEEKDAYS.map(d => <span key={d} style={{ ...capsLabel(tk), fontSize: 9.5, padding: '2px 0 4px' }}>{d}</span>)}
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} style={{ width: cell, height: cell }} />;
          const start = new Date(shown.y, shown.m, d).getTime();
          const n = buckets.get(d)?.length ?? 0;
          const isToday = isNow && d === today.getDate();
          const active = selected === start;
          const future = start > today.getTime();
          const before = since > 0 && start < new Date(since).setHours(0, 0, 0, 0);
          return (
            <button key={d} type="button" disabled={future} onClick={() => onSelect(active ? null : start)} aria-pressed={active}
              title={n ? `${n} event${n === 1 ? '' : 's'}` : before ? 'Before counting started' : undefined}
              style={{
                width: cell, height: cell, border: 0, borderRadius: 9, cursor: future ? 'default' : 'pointer', padding: 0, position: 'relative',
                background: active ? tk.accent.base : isToday ? alpha(tk.accent.base, 0.12) : 'transparent',
                color: active ? tk.bg.panel : future || before ? tk.text.disabled : tk.text.primary, font: `${isToday || n ? 600 : 400} 12px ${fontFamily.ui}`,
              }}>
              {d}
              {n > 0 && <span aria-hidden="true" style={{ position: 'absolute', left: '50%', bottom: 4, transform: 'translateX(-50%)', display: 'flex', gap: 2 }}>
                {Array.from({ length: Math.min(3, n) }, (_, k) => <span key={k} style={{ width: 4, height: 4, borderRadius: 2, background: active ? tk.bg.panel : tk.accent.base }} />)}
              </span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The events of one day, newest first. */
export function DayEvents({ events, dayStart, onClose }: { events: ActivityEvent[]; dayStart: number; onClose: () => void }) {
  const tk = useTokens();
  const list = events.filter(e => e.at >= dayStart && e.at < dayStart + 86_400_000).sort((a, b) => b.at - a.at);
  const label = new Date(dayStart).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div style={{ ...cardStyle(tk), padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{label}</span>
        <IconButton icon="close" size="sm" label="Close the day" tooltip={false} onClick={onClose} />
      </div>
      {list.length === 0 && <span style={{ fontSize: 12, color: tk.text.faint }}>Nothing recorded that day.</span>}
      {list.slice(0, 40).map((e, i) => {
        const k = ACTIVITY_KINDS.find(x => x.id === e.kind)!;
        return (
          <span key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, color: tk.text.secondary }}>
            <span style={{ width: 44, flexShrink: 0, font: `500 11px ${fontFamily.mono}`, color: tk.text.faint }}>{new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.verb}{e.label ? ` “${e.label}”` : ''}</span>
          </span>
        );
      })}
      {list.length > 40 && <span style={{ fontSize: 11.5, color: tk.text.faint }}>and {list.length - 40} more</span>}
    </div>
  );
}

/** A small rounded chip: a label and a count; clickable when it leads somewhere. */
export function Chip({ label, count, icon, onClick, title }: { label: string; count?: number; icon?: IconName; onClick?: () => void; title?: string }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const style: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px 4px 9px', borderRadius: 999, border: 0, maxWidth: '100%',
    background: hover && onClick ? tk.bg.hover : tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, cursor: onClick ? 'pointer' : 'default', textAlign: 'left',
  };
  const body = <>
    {icon && <Icon name={icon} size={12} style={{ color: tk.text.muted, flexShrink: 0 }} />}
    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    {count != null && <span style={{ font: `600 10.5px ${fontFamily.mono}`, color: tk.accent.text, background: alpha(tk.accent.base, 0.12), borderRadius: 999, padding: '1px 6px', flexShrink: 0 }}>{count}</span>}
  </>;
  return onClick
    ? <button type="button" title={title} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={style}>{body}</button>
    : <span title={title} style={style}>{body}</span>;
}

/** A 16:9 picture with a title under it; a code-card or an icon while there's no picture. */
export function PosterCard({ title, sub, poster, icon, code, width = 168, onClick, tint }: { title: string; sub?: string; poster: string | null | undefined; icon: IconName; code?: string; width?: number; onClick?: () => void; tint: string }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const h = Math.round(width * 9 / 16);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} title={sub ? `${title} · ${sub}` : title}
      style={{ width, flexShrink: 0, border: 0, padding: 4, borderRadius: radius.card, background: hover ? tk.bg.hover : 'transparent', cursor: onClick ? 'pointer' : 'default', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, scrollSnapAlign: 'start' }}>
      <span style={{ width: width - 8, height: h, borderRadius: radius.lg, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: poster ? tk.bg.render : alpha(tint, 0.1), boxShadow: `inset 0 0 0 1px ${tk.border.default}`, position: 'relative' }}>
        {poster ? <img src={poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : code ? <pre aria-hidden="true" style={{ margin: 0, padding: '8px 10px', width: '100%', height: '100%', boxSizing: 'border-box', overflow: 'hidden', font: `9.5px/1.35 ${fontFamily.mono}`, color: tk.text.muted, whiteSpace: 'pre', maskImage: 'linear-gradient(#000 60%, transparent)' }}>{code.split('\n').slice(0, 9).join('\n')}</pre>
          : <Icon name={icon} size={22} style={{ color: poster === null ? tint : tk.text.faint }} />}
        {poster === undefined && !code && <span aria-hidden="true" style={{ position: 'absolute', right: 6, bottom: 6, width: 6, height: 6, borderRadius: 3, background: tk.text.disabled }} />}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, padding: '0 4px', minWidth: 0 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {sub && <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>}
      </span>
    </button>
  );
}

/** A row that scrolls sideways, with arrows on a desktop. */
export function Carousel({ children, compact, gutter = 0 }: { children: ReactNode; compact: boolean; gutter?: number }) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * (ref.current.clientWidth - 80), behavior: 'smooth' });
  return (
    <div style={{ position: 'relative', margin: gutter ? `0 -${gutter}px` : 0 }}>
      <div ref={ref} style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollSnapType: 'x proximity', padding: gutter ? `2px ${gutter}px` : 2, scrollbarWidth: 'thin' }}>{children}</div>
      {!compact && <>
        <span style={{ position: 'absolute', left: -6, top: 32, background: tk.bg.panel, borderRadius: 999, boxShadow: tk.shadow.float }}><IconButton icon="chevL" size="sm" label="Scroll back" tooltip={false} onClick={() => by(-1)} /></span>
        <span style={{ position: 'absolute', right: -6, top: 32, background: tk.bg.panel, borderRadius: 999, boxShadow: tk.shadow.float }}><IconButton icon="chevR" size="sm" label="Scroll on" tooltip={false} onClick={() => by(1)} /></span>
      </>}
    </div>
  );
}

/** A section's heading row on the home: a title, a note, an action on the right. */
export function HomeSection({ title, note, action, children }: { title: string; note?: string; action?: ReactNode; children: ReactNode }) {
  const tk = useTokens();
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '0 2px', minHeight: 24 }}>
        <span style={{ font: `650 14px ${fontFamily.ui}`, color: tk.text.primary }}>{title}</span>
        {note && <span style={{ fontSize: 11.5, color: tk.text.faint, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{note}</span>}
        {!note && <span style={{ flex: 1 }} />}
        {action}
      </div>
      {children}
    </section>
  );
}
