/**
 * LiveFields — the Play page's pieces for Ableton Live through the Live connector
 * (docs/live-connector-plan.md): the status chip (green dot, set, tempo), a Live parameter
 * source's options, the Live clip and scene triggers' fields, and a Do in Live reaction's.
 * Names come from the set's catalogue when Live is connected; they can always be typed.
 */
import { useEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { liveClient } from '../../../lib/liveClient';
import { liveColour, LIVE_CONNECTOR_VERSION } from '../../../lib/live/liveProtocol';
import type { LiveDo, PlaySource, TriggerSpec } from '../../../types/play';
import { ABLETON_READS, type AbletonRead } from '../../../types/play';
import { useTokens } from '../../../theme/themeStore';
import { fontFamily } from '../../../theme/tokens';
import { Select } from '../../ui/Select';
import { Field } from '../../ui/Field';
import { Segmented } from '../../ui/Choice';
import { GroupedPicker } from '../../ui/GroupedPicker';
import type { PickerSection } from '../../ui/groupedPickerModel';
import { usePolledNumber } from '../liveValueStore';

/** Re-render on the Live connector's changes (status, catalogue, selected device). */
export function useLive(): number {
  return useSyncExternalStore(cb => liveClient.onChange(cb), () => liveClient.getVersion(), () => 0);
}

/** Listen for Live while this is mounted (a picker or guide is open). */
export function useWantLive(reason: string, on = true): void {
  useEffect(() => {
    if (!on) return;
    liveClient.want(reason, true);
    return () => liveClient.want(reason, false);
  }, [reason, on]);
}

/** "Connected · My Set · 124 BPM", "Not heard from", "Waiting for Live…". */
export function liveStatusText(): string {
  const st = liveClient.getStatus();
  const s = liveClient.state;
  if (st === 'connected') {
    const set = s.hello?.set ? ` · ${s.hello.set}` : '';
    const bpm = s.follower.ready() ? ` · ${Math.round(s.follower.tempo * 10) / 10} BPM` : '';
    return `Connected${set}${bpm}`;
  }
  if (st === 'lost') return 'Not heard from (is Live open, with Playfield as a Control Surface?)';
  if (st === 'error') return liveClient.getError() || 'Couldn’t listen for Live';
  if (st === 'waiting') return liveClient.getMode() === 'native' ? 'Waiting for Live…' : 'Waiting for Live (through the bridge)…';
  return 'Not listening';
}

/** The connector in Live is older than the app's. */
export function liveNeedsUpdate(): boolean {
  const v = liveClient.state.hello?.script;
  return !!v && liveClient.isConnected() && compareVersions(v, LIVE_CONNECTOR_VERSION) < 0;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0), pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** The Live connector's dot and words. */
export function LiveStatusChip({ compact = false }: { compact?: boolean }) {
  useLive();
  useWantLive('chip');
  const tk = useTokens();
  const st = liveClient.getStatus();
  const colour = st === 'connected' ? tk.status.success : st === 'waiting' ? tk.status.warning : st === 'error' || st === 'lost' ? tk.status.danger : tk.text.disabled;
  const text = liveStatusText();
  return (
    <span data-live-status={st} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: colour, flexShrink: 0 }} />
      <span title={text} style={{ color: st === 'error' ? tk.status.danger : tk.text.muted, font: `11px ${fontFamily.ui}`, maxWidth: compact ? 180 : 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Live: {text}</span>
      {liveNeedsUpdate() && <span style={{ color: tk.status.warning, font: `600 11px ${fontFamily.ui}` }}>Update the Live connector</span>}
    </span>
  );
}

/** A small colour square for a Live track or clip. */
export function LiveSwatch({ colour, size = 9 }: { colour: number; size?: number }) {
  return <span aria-hidden style={{ display: 'inline-block', width: size, height: size, borderRadius: 2, background: liveColour(colour), flexShrink: 0 }} />;
}

/** Every parameter in the set, grouped by track and device, for a picker (the Playfield rack first). */
export function liveParamSections(): PickerSection[] {
  const s = liveClient.state;
  const rack = s.rackParams();
  const out: PickerSection[] = [];
  if (rack.length) out.push({ heading: 'Playfield rack', items: rack.map(p => ({ value: p.key, label: p.name, description: `${p.track} / ${p.device}`, keywords: p.key })) });
  const groups = new Map<string, PickerSection & { items: Array<{ value: string; label: string; keywords: string }> }>();
  let n = 0;
  for (const p of s.params.values()) {
    if (p.role === 'rack') continue;
    // A huge set: the first 3000 (search narrows it).
    if (++n > 3000) break;
    const h = `${p.track} · ${p.device}`;
    let g = groups.get(h);
    if (!g) { g = { heading: h, items: [] }; groups.set(h, g); }
    g.items.push({ value: p.key, label: p.name, keywords: p.key });
  }
  return [...out, ...groups.values()];
}

/** The live value of a Live parameter, as Live shows it ("2.4 kHz"), polled. */
function LiveParamValue({ k }: { k: string }) {
  const tk = useTokens();
  const unit = usePolledNumber(() => liveClient.state.unit(k) ?? -1, true, 100, -1);
  const display = liveClient.state.values.get(k)?.display;
  if (unit < 0) return <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>no value yet</span>;
  return <span style={{ color: tk.text.muted, font: `11px ${fontFamily.mono}` }}>{display || `${Math.round(unit * 100)}%`}</span>;
}

const READ_OPTIONS: ReadonlyArray<{ value: AbletonRead; label: string; title: string }> = [
  { value: 'param', label: 'Parameter', title: 'A knob, fader or switch in Live, over its own range' },
  { value: 'beat', label: 'Beat', title: '0 → 1 on every beat of Live’s transport' },
  { value: 'bar', label: 'Bar', title: '0 → 1 on every bar' },
  { value: 'playing', label: 'Playing', title: '1 while Live plays' },
];

/** An Ableton Live source's options: what it reads, and which parameter (picked from the set, or Learn). */
export function AbletonSourceOptions({ source, row, onChange }: {
  source: Extract<PlaySource, { kind: 'ableton' }>;
  row: (children: ReactNode) => ReactNode;
  onChange: (s: PlaySource) => void;
}) {
  useLive();
  const tk = useTokens();
  const known = source.key ? liveClient.state.params.get(source.key) : undefined;
  const track = known ? liveClient.state.trackNamed(known.track) : undefined;
  const missing = !!source.key && liveClient.state.catalogGen >= 0 && !known;
  const sections = liveParamSections();
  return (
    <>
      {row(<>
        <Segmented size="sm" ariaLabel="What it reads" value={source.read} options={READ_OPTIONS} onChange={read => onChange({ kind: 'ableton', read: ABLETON_READS.includes(read) ? read : 'param', key: read === 'param' ? source.key : '' })} />
      </>)}
      {source.read === 'param' && row(<>
        {track && <LiveSwatch colour={track.colour} />}
        {sections.length
          ? <GroupedPicker ariaLabel="Live parameter" value={source.key} sections={sections} placeholder={source.key || 'Pick a parameter'} onChange={key => onChange({ ...source, key })} height={26} style={{ flex: 1, minWidth: 140 }} width={320} searchPlaceholder="Search Live’s parameters" />
          : <Field value={source.key} onChange={e => onChange({ ...source, key: e.target.value })} height={26} mono style={{ flex: 1, minWidth: 140 }} placeholder="Track / Device / Parameter" />}
        {source.key && !missing && <LiveParamValue k={source.key} />}
        {missing && <span style={{ color: tk.status.warning, font: `11px ${fontFamily.ui}` }}>not in this set</span>}
      </>)}
      {source.read === 'param' && !source.key && row(<span style={{ color: tk.text.faint, font: `11px/1.4 ${fontFamily.ui}` }}>Or Learn: click a parameter in Live while Learn is on.</span>)}
      {row(<LiveStatusChip compact />)}
    </>
  );
}

/** Live's tracks as options (regular tracks only: clips live there), with "any" first when allowed. */
function trackOptions(any: boolean, current: string): Array<{ value: string; label: string }> {
  const tracks = liveClient.state.tracks.filter(t => t.kind === 'track');
  const out = [...(any ? [{ value: '', label: 'Any track' }] : []), ...tracks.map(t => ({ value: t.name, label: t.name }))];
  if (current && !out.some(o => o.value === current)) out.push({ value: current, label: `${current} (not in this set)` });
  return out;
}

function sceneOptions(any: boolean, current: string): Array<{ value: string; label: string }> {
  const out = [...(any ? [{ value: '', label: 'Any scene' }] : []), ...liveClient.state.scenes.map(s => ({ value: s.name || `#${s.index + 1}`, label: s.name || `Scene ${s.index + 1}` }))];
  if (current && !out.some(o => o.value === current)) out.push({ value: current, label: `${current} (not in this set)` });
  return out;
}

const nameField: CSSProperties = { flex: 1, minWidth: 110 };

/** A Live clip or scene trigger's fields: which track and clip (or scene), and when it fires. */
export function LiveTriggerFields({ trigger, onChange }: {
  trigger: Extract<TriggerSpec, { on: 'liveClip' | 'liveScene' }>;
  onChange: (t: TriggerSpec) => void;
}) {
  useLive();
  useWantLive('trigger');
  const known = liveClient.state.catalogGen >= 0;
  if (trigger.on === 'liveScene') {
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexBasis: '100%', minWidth: 0, marginTop: 4 }}>
        {known
          ? <Select ariaLabel="Scene" value={trigger.scene} options={sceneOptions(true, trigger.scene)} onChange={scene => onChange({ ...trigger, scene })} height={26} />
          : <Field value={trigger.scene} onChange={e => onChange({ ...trigger, scene: e.target.value })} height={26} style={nameField} placeholder="Scene name (empty: any)" />}
        <LiveStatusChip compact />
      </span>
    );
  }
  const track = liveClient.state.trackNamed(trigger.track);
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexBasis: '100%', minWidth: 0, marginTop: 4 }}>
      {track && <LiveSwatch colour={track.colour} />}
      {known
        ? <Select ariaLabel="Track" value={trigger.track} options={trackOptions(true, trigger.track)} onChange={t => onChange({ ...trigger, track: t })} height={26} />
        : <Field value={trigger.track} onChange={e => onChange({ ...trigger, track: e.target.value })} height={26} style={nameField} placeholder="Track (empty: any)" />}
      <Field value={trigger.clip} onChange={e => onChange({ ...trigger, clip: e.target.value })} height={26} style={nameField} placeholder="Clip name (empty: any)" />
      <Segmented size="sm" ariaLabel="When" value={trigger.when} onChange={when => onChange({ ...trigger, when })}
        options={[{ value: 'triggered', label: 'Launched', title: 'As soon as it’s launched (before Live’s launch quantisation)' }, { value: 'playing', label: 'Plays', title: 'When it starts playing, on Live’s grid' }]} />
      <LiveStatusChip compact />
    </span>
  );
}

/** A Do in Live reaction's fields: the track and clip, or the scene. Names, or "#3" for the third. */
export function LiveDoFields({ live, onChange }: { live: LiveDo; onChange: (d: LiveDo) => void }) {
  useLive();
  useWantLive('do');
  const known = liveClient.state.catalogGen >= 0;
  if (live.cmd === 'clip') {
    return (
      <>
        {known
          ? <Select ariaLabel="Track" value={live.track ?? ''} options={[{ value: '', label: 'Pick a track' }, ...trackOptions(false, live.track ?? '')]} onChange={track => onChange({ ...live, track })} height={26} />
          : <Field value={live.track ?? ''} onChange={e => onChange({ ...live, track: e.target.value })} height={26} style={nameField} placeholder="Track" />}
        <Field value={live.target ?? ''} onChange={e => onChange({ ...live, target: e.target.value })} height={26} style={nameField} placeholder="Clip name or #slot" />
      </>
    );
  }
  if (live.cmd === 'scene') {
    return known
      ? <Select ariaLabel="Scene" value={live.target ?? ''} options={[{ value: '', label: 'Pick a scene' }, ...sceneOptions(false, live.target ?? '')]} onChange={target => onChange({ ...live, target })} height={26} />
      : <Field value={live.target ?? ''} onChange={e => onChange({ ...live, target: e.target.value })} height={26} style={nameField} placeholder="Scene name or #number" />;
  }
  return null;
}

/**
 * Perform's Live strip (shown while the Live connector is connected): the set, Live's tempo, and
 * where Live is (bar.beat) with a dot that flashes on each beat, drawn on its own animation frame.
 */
export function LiveBeatBadge() {
  useLive();
  const tk = useTokens();
  const dot = useRef<HTMLSpanElement>(null);
  const pos = useRef<HTMLSpanElement>(null);
  const on = liveClient.isConnected();
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const f = liveClient.state.follower;
      if (!f.ready()) return;
      const b = liveClient.beats();
      const per = Math.max(1, f.sigNum) * (4 / Math.max(1, f.sigDen));
      const bar = Math.floor(b / per) + 1, beat = Math.floor(b - (bar - 1) * per) + 1;
      if (pos.current) pos.current.textContent = `${bar}.${beat}`;
      if (dot.current) dot.current.style.opacity = f.playing ? String(Math.max(0.2, 1 - (b - Math.floor(b)) * 3)) : '0.2';
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [on]);
  if (!on) return null;
  const s = liveClient.state;
  return (
    <div data-live-badge="" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', font: `600 11.5px ${fontFamily.ui}`, color: tk.text.secondary }}>
      <span ref={dot} style={{ width: 9, height: 9, borderRadius: '50%', background: tk.status.success }} />
      <span>Live{s.hello?.set ? ` · ${s.hello.set}` : ''}</span>
      <span style={{ font: `600 11.5px ${fontFamily.mono}` }}>{s.follower.ready() ? `${Math.round(s.follower.tempo * 10) / 10} BPM` : ''}</span>
      <span ref={pos} style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.muted, fontVariantNumeric: 'tabular-nums' }} />
    </div>
  );
}
