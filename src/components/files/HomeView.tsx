/**
 * The Files home: a greeting with this week in one line, stat tiles with
 * sparklines (saves, renders, takes, imports, presentation saves over 7 or
 * 30 days), a month calendar with dots on active days, the recent things as
 * poster cards, what you use most as chips, and the way into the other
 * sections (Browse, Notes, Clean up, Workspace, App settings, Nodes).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/iconPaths';
import { Segmented } from '../ui/Choice';
import { ACTIVITY_CHANGED, ACTIVITY_KINDS, activitySince, activityTotals, describeCount, readActivity, startActivity, type ActivityEventKind } from '../../files/activity';
import { mostUsed, type MostUsed } from '../../files/mostUsed';
import { parseJson, walk, type FileNode, type Inventory } from '../../files/inventory';
import { recentItems } from '../../files/recent';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { SpaceMeter } from './SpaceMeter';
import type { StorageEstimate } from './useFilesInventory';
import type { StorageUsage } from '../../files/storageLimit';
import { useItemPosters } from './useItemPosters';
import { Carousel, Chip, DayEvents, HomeSection, MonthCalendar, PosterCard, StatTile } from './homeUi';
import { cardStyle, capsLabel, tintFor } from './fileUiShared';

const KIND_ICONS: Record<ActivityEventKind, IconName> = { save: 'save', render: 'camera', take: 'record', import: 'import', presentation: 'slides' };

export interface HomeEntry { id: string; icon: IconName; label: string; sub: string; count?: number; tint: string; onClick: () => void }

const isPlay = (n: FileNode) => n.kind === 'graph' && /\bPlay$/.test(n.detail ?? '');

export function HomeView({ inv, compact, estimate, usage, entries, browse, onOpen, onOpenNode, onOpenWhereItBelongs }: {
  inv: Inventory;
  compact: boolean;
  estimate: StorageEstimate | null;
  usage: StorageUsage | null;
  /** The other sections (Browse, Notes, Clean up, Workspace, App settings, Nodes). */
  entries: HomeEntry[];
  /** On a phone: the sections list, shown at the end of the home. */
  browse?: ReactNode;
  onOpen: (id: string) => void;
  onOpenNode: (type: string) => void;
  /** Open a recent thing where it lives (the Studio, Play, Present, the GLSL page). */
  onOpenWhereItBelongs: (n: FileNode) => void;
}) {
  const tk = useTokens();
  // "Now" is read outside rendering (when the home opens and whenever the log changes): the sums are of that moment.
  const [now, setNow] = useState(0);
  const [range, setRange] = useState<'7' | '30'>('7');
  const [day, setDay] = useState<number | null>(null);
  // The log starts counting the first time the home opens (nothing is seeded).
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(() => { startActivity(); tick(); }, 0);
    window.addEventListener(ACTIVITY_CHANGED, tick);
    return () => { window.clearTimeout(first); window.removeEventListener(ACTIVITY_CHANGED, tick); };
  }, []);
  const events = useMemo(() => (now ? readActivity() : []), [now]);
  const since = useMemo(() => (now ? activitySince() : 0), [now]);
  const days = range === '7' ? 7 : 30;
  const totals = useMemo(() => activityTotals(events, now, days), [events, now, days]);
  const week = useMemo(() => activityTotals(events, now, 7), [events, now]);

  const recent = useMemo(() => recentItems(inv), [inv]);
  const posters = useItemPosters(recent);
  const shaderCode = useMemo(() => {
    const list = parseJson(localStorage.getItem('shader-studio:glsl-shaders'));
    const out: Record<string, string> = {};
    for (const s of Array.isArray(list) ? list : []) { const o = s as { id?: string; code?: string }; if (typeof o?.id === 'string' && typeof o.code === 'string') out[`glsl:${o.id}`] = o.code; }
    return out;
  }, [inv]); // eslint-disable-line react-hooks/exhaustive-deps

  // The open graph counts too when it isn't a saved one as it is (store selectors: only these changing recount).
  const liveNodes = useNodeGraphStore(s => s.nodes);
  const livePlay = useNodeGraphStore(s => s.play);
  const liveUnsaved = useNodeGraphStore(s => !s.currentGraph || s.graphDirty);
  const used = useMemo<MostUsed>(() => {
    const graphs: unknown[] = [];
    for (const n of walk(inv.sections)) if (n.kind === 'graph' && n.ref?.t === 'key') { const g = parseJson(localStorage.getItem(n.ref.key)); if (g) graphs.push(g); }
    if (liveUnsaved) graphs.push({ nodes: liveNodes, play: livePlay });
    return mostUsed(graphs, { limit: compact ? 8 : 12, nodeLabel: t => getNodeDefinition(t)?.label });
  }, [inv, compact, liveNodes, livePlay, liveUnsaved]);

  const saves = week.find(t => t.kind === 'save')?.count ?? 0;
  const totalWeek = week.reduce((n, t) => n + t.count, 0);
  const hour = new Date(now || 0).getHours();
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const sinceText = since ? new Date(since).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const startedToday = since && now - since < 60_000 && events.length === 0;
  const headline = totalWeek === 0
    ? (startedToday ? 'Counting starts now: saves, renders, takes and imports from here on show up here.' : `Nothing recorded this week yet${sinceText ? ` (counting since ${sinceText})` : ''}.`)
    : `${describeCount('save', saves)} this week${totalWeek > saves ? `, ${totalWeek - saves} other thing${totalWeek - saves === 1 ? '' : 's'} done` : ''}.`;

  const pad = compact ? '14px 16px 40px' : '22px 28px 48px';
  const chips = (list: MostUsed['nodes'], onClick?: (id: string) => void, icon?: IconName) => list.length
    ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{list.map(u => <Chip key={u.id} label={u.label} count={u.count} icon={icon} title={`${u.count} in ${u.graphs} graph${u.graphs === 1 ? '' : 's'}`} onClick={onClick ? () => onClick(u.id) : undefined} />)}</div>
    : <span style={{ fontSize: 12, color: tk.text.faint }}>Nothing yet.</span>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 18 : 22, padding: pad, maxWidth: 1080, width: '100%', boxSizing: 'border-box', margin: '0 auto' }}>
      {/* Greeting */}
      <div style={{ borderRadius: radius.card, padding: compact ? '18px 18px 16px' : '22px 24px 20px', background: tk.ink.base, color: tk.ink.text, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ font: `500 12.5px ${fontFamily.ui}`, opacity: 0.7 }}>{greeting}</span>
        <span style={{ font: `650 ${compact ? 19 : 22}px ${fontFamily.ui}`, letterSpacing: '-0.015em', lineHeight: 1.25 }}>{headline}</span>
        {!!totalWeek && sinceText && <span style={{ fontSize: 11.5, opacity: 0.6 }}>Counting since {sinceText}. Nothing leaves this browser.</span>}
      </div>

      {/* Activity: tiles and the calendar */}
      <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1fr) 300px', gap: 12, alignItems: 'start' }}>
        <HomeSection title="Activity" action={<Segmented size="sm" ariaLabel="How far back" value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }]} />}>
          <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
            {totals.map(t => { const k = ACTIVITY_KINDS.find(x => x.id === t.kind)!; return <StatTile key={t.kind} icon={KIND_ICONS[t.kind]} label={k.many[0].toUpperCase() + k.many.slice(1)} count={t.count} perDay={t.perDay} days={days} compact={compact} />; })}
          </div>
        </HomeSection>
        <HomeSection title="Calendar" note={compact ? undefined : 'dots on days with activity'}>
          <MonthCalendar events={events} since={since} selected={day} onSelect={setDay} compact={compact} />
          {day != null && <DayEvents events={events} dayStart={day} onClose={() => setDay(null)} />}
        </HomeSection>
      </div>

      {/* Recent */}
      <HomeSection title="Recent" note={recent.length ? 'graphs, Plays, presentations and shaders; click one to open it' : undefined}>
        {recent.length ? (
          <Carousel compact={compact} gutter={compact ? 16 : 0}>
            {recent.map(n => (
              <PosterCard key={n.id} title={n.label} sub={isPlay(n) ? 'Play' : n.kind === 'graph' ? 'Graph' : n.kind === 'presentation' ? 'Presentation' : 'GLSL shader'}
                poster={posters[n.id]} icon={n.kind === 'presentation' ? 'slides' : n.kind === 'shader' ? 'code' : isPlay(n) ? 'play' : 'graphs'} code={n.kind === 'shader' && posters[n.id] === null ? shaderCode[n.id] : undefined}
                width={compact ? 150 : 172} tint={tintFor(tk, n)} onClick={() => onOpenWhereItBelongs(n)} />
            ))}
          </Carousel>
        ) : <Empty>Nothing saved yet. Graphs, Plays, presentations and shaders you save show up here with a picture.</Empty>}
      </HomeSection>

      {/* Most used */}
      <HomeSection title="Most used" note="across your saved graphs and the open one">
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <Card label="Nodes" hint="click one for its page">{chips(used.nodes, onOpenNode, 'nodes')}</Card>
          <Card label="Functions">{chips(used.functions, undefined, 'fn')}</Card>
          <Card label="Layer kinds">{chips(used.layerKinds, undefined, 'cube')}</Card>
          <Card label="Play sources">{chips(used.sources, undefined, 'live')}</Card>
        </div>
      </HomeSection>

      {/* Where else to go */}
      <HomeSection title="Sections">
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr 1fr' : 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
          {entries.map(e => <EntryTile key={e.id} e={e} compact={compact} />)}
        </div>
      </HomeSection>

      <HomeSection title="Space">
        <div style={{ ...cardStyle(tk), padding: compact ? '14px 14px 12px' : '16px 18px 14px' }}>
          <SpaceMeter inv={inv} estimate={estimate} usage={usage} compact={compact} onCleanUp={() => entries.find(e => e.id === 'cleanup')?.onClick()} />
        </div>
      </HomeSection>

      {browse && <HomeSection title="Everything saved">{browse}</HomeSection>}
      <span style={{ fontSize: 11, color: tk.text.faint, padding: '0 2px' }}>{compact ? '' : 'Pictures are drawn once per saved version and kept in this browser. '}The activity log keeps the last 2,000 events.{' '}
        <button type="button" onClick={() => onOpen('section:settings')} style={{ border: 0, background: 'none', padding: 0, color: tk.accent.text, font: 'inherit', cursor: 'pointer' }}>Settings</button>
      </span>
    </div>
  );
}

function Card({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const tk = useTokens();
  return (
    <div style={{ ...cardStyle(tk), padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><span style={capsLabel(tk)}>{label}</span>{hint && <span style={{ fontSize: 11, color: tk.text.faint }}>{hint}</span>}</span>
      {children}
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  const tk = useTokens();
  return <div style={{ padding: '26px 16px', textAlign: 'center', color: tk.text.faint, fontSize: 12.5, borderRadius: radius.lg, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>{children}</div>;
}

function EntryTile({ e, compact }: { e: HomeEntry; compact: boolean }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  return (
    <button type="button" onClick={e.onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...cardStyle(tk), background: hover ? tk.bg.hover : tk.bg.panel, border: 0, padding: compact ? '12px 12px' : '14px 14px', display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', textAlign: 'left', minWidth: 0 }}>
      <span style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(e.tint, 0.14), color: e.tint }}><Icon name={e.icon} size={16} /></span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{e.label}</span>
        <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.sub}</span>
      </span>
      {e.count != null && e.count > 0 && <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: tk.bg.field, color: tk.text.muted, font: `600 10.5px ${fontFamily.ui}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{e.count}</span>}
      <Icon name="chevR" size={14} style={{ color: tk.text.faint }} />
    </button>
  );
}
