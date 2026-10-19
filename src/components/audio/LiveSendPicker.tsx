/**
 * LiveSendPicker — the Audio Source's Live tab (desktop app, Pro): which Ableton Live track to
 * listen to, through the Playfield Send plug-in (lib/liveSend.ts, docs/playfield-send-plan.md).
 *
 * - `sourceTabOptions` / `pickSourceTab`: the File | Mic | Video | Live tabs. Live shows only where
 *   it can work (the desktop app); on Free it carries a Pro badge and opens the Pro sheet.
 * - `LiveSendPicker` (the card): a list of the instances the app hears from, with a meter each.
 * - `LiveSendDetails` (the Open ↗ window): the same, plus naming an unpaired send, the buffer, and
 *   the stream's counters.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { audioSendIdOf, type AudioSourceKind } from '../../nodes/definitions/audioTools';
import { liveSend, olderVersion, PLAYFIELD_SEND_VERSION, sendReaderInput, type LiveSendInstance } from '../../lib/liveSend';
import { setReaderInput } from '../../play/readerControls';
import { useReadersPanel } from '../play/readersPanelUi';
import { Popover } from '../ui/Popover';
import { Button } from '../ui/Button';
import { requireFeature, useCan } from '../../lib/plan';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { SegmentOption } from '../ui/Choice';
import { ProBadge } from '../account/ProSheet';
import { NumberInput } from '../NodeGraph/NumberInput';

/** Re-render on every change to the list, names or buffer stats. */
export function useLiveSend(): number {
  const sub = useMemo(() => (fn: () => void) => liveSend.onChange(fn), []);
  return useSyncExternalStore(sub, () => liveSend.version());
}

/** Keep the app listening while a picker is on screen. */
function useWantLiveSend(reason: string): void {
  useEffect(() => {
    liveSend.want(reason, true);
    return () => liveSend.want(reason, false);
  }, [reason]);
}

/** The source tabs: Live joins them where it can work (the desktop app), badged on Free. */
export function sourceTabOptions(kind: AudioSourceKind, liveOk: boolean): SegmentOption<AudioSourceKind>[] {
  const out: SegmentOption<AudioSourceKind>[] = [{ value: 'file', label: 'File' }, { value: 'mic', label: 'Mic' }, { value: 'video', label: 'Video' }];
  if (liveSend.available() || kind === 'send') {
    out.push({ value: 'send', label: liveOk ? 'Live' : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Live<ProBadge style={{ height: 14, fontSize: 8.5 }} /></span> });
  }
  return out;
}

/** Switch tabs; the Live tab asks for Pro first. */
export function pickSourceTab(nodeId: string, v: AudioSourceKind): void {
  if (v === 'send' && !requireFeature('audio.liveSend')) return;
  useNodeGraphStore.getState().updateNodeParams(nodeId, { source: v }, { immediate: true });
}

const statusWord: Record<LiveSendInstance['status'], string> = { streaming: 'Streaming', paused: 'Paused in Live', offline: 'Rendering in Live', unreadable: 'Can’t be read' };

function khz(rate: number): string {
  const k = rate / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
}

function Meter({ level, colour, width = 46 }: { level: number; colour: string; width?: number }) {
  const tk = useTokens();
  // RMS → a dB-ish bar: −60 dB empty, 0 dB full.
  const db = level > 0 ? 20 * Math.log10(level) : -60;
  const f = Math.max(0, Math.min(1, (db + 60) / 60));
  return (
    <span data-live-send-meter aria-hidden style={{ width, height: 5, borderRadius: 3, background: tk.bg.panel, overflow: 'hidden', flexShrink: 0 }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.round(f * 100)}%`, background: colour, transition: 'width 90ms linear' }} />
    </span>
  );
}

/** The instances to choose from, the saved one first when it isn't there (so the card says what it waits for). */
function rows(saved: number | null): Array<{ id: number; inst: LiveSendInstance | undefined }> {
  const list = liveSend.list();
  const out: Array<{ id: number; inst: LiveSendInstance | undefined }> = [];
  if (saved !== null && !list.some(i => i.id === saved)) out.push({ id: saved, inst: undefined });
  for (const i of list) if (!out.some(r => r.id === i.id)) out.push({ id: i.id, inst: i });
  return out;
}

function SendRow({ id, inst, chosen, onPick, savedLabel, compact }: { id: number; inst: LiveSendInstance | undefined; chosen: boolean; onPick: () => void; savedLabel: string; compact: boolean }) {
  const tk = useTokens();
  const colour = liveSend.colour(id) ?? tk.accent.base;
  const name = liveSend.label(id, savedLabel);
  const dot = !inst ? tk.text.disabled : inst.status === 'streaming' ? tk.status.success : inst.status === 'offline' ? tk.status.warning : tk.text.faint;
  return (
    <button type="button" data-live-send-row={id} aria-pressed={chosen} onClick={onPick}
      title={inst ? `Pairing ID ${id} · ${statusWord[inst.status]} · ${khz(inst.sampleRate)}${inst.dropouts ? ` · ${inst.dropouts} dropouts` : ''}` : `Playfield Send ${id} isn’t running: open the set in Live`}
      style={{
        display: 'flex', alignItems: 'center', gap: 7, width: '100%', minWidth: 0, padding: compact ? '4px 6px' : '6px 8px', borderRadius: radius.sm, cursor: 'pointer', textAlign: 'left',
        border: `1px solid ${chosen ? tk.accent.base : 'transparent'}`, background: chosen ? alpha(tk.accent.base, 0.1) : tk.bg.field, color: tk.text.primary,
        font: `500 ${compact ? 11.5 : 12.5}px ${fontFamily.ui}`,
      }}>
      <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: liveSend.colour(id) ?? 'transparent', flexShrink: 0 }} />
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Live · {name}</span>
      {inst ? <>
        {!compact && <span style={{ color: tk.text.faint, font: `500 11px ${fontFamily.mono}` }}>{khz(inst.sampleRate)}</span>}
        {inst.status !== 'streaming' && <span style={{ color: tk.text.muted, fontSize: 11 }}>{statusWord[inst.status]}</span>}
        <Meter level={inst.status === 'streaming' ? inst.level : 0} colour={colour} />
      </> : <span style={{ color: tk.text.faint, fontSize: 11 }}>Not found</span>}
    </button>
  );
}

/** The card's Live tab: pick a track (or see what it waits for). */
export function LiveSendPicker({ node, compact = true }: { node: GraphNode; compact?: boolean }) {
  useLiveSend();
  useWantLiveSend(`card:${node.id}`);
  const tk = useTokens();
  const ok = useCan('audio.liveSend');
  const saved = audioSendIdOf(node);
  const savedLabel = typeof node.params.sendLabel === 'string' ? node.params.sendLabel : '';
  const set = (p: Record<string, unknown>) => useNodeGraphStore.getState().updateNodeParams(node.id, p, { immediate: true });
  if (!ok) {
    return (
      <div data-live-send-locked style={{ display: 'flex', alignItems: 'center', gap: 6, color: tk.text.muted, fontSize: 11.5, lineHeight: 1.45 }}>
        <ProBadge /> <span>Live tracks are part of Pro. <button type="button" onClick={() => requireFeature('audio.liveSend')} style={{ border: 0, padding: 0, background: 'none', color: tk.accent.text, cursor: 'pointer', font: 'inherit' }}>What’s in Pro</button></span>
      </div>
    );
  }
  if (!liveSend.available()) {
    return <div style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.45 }}>Live tracks come in through the Playfield desktop app.</div>;
  }
  const list = rows(saved);
  return (
    <div data-live-send-picker style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {list.map(r => (
        <SendRow key={r.id} id={r.id} inst={r.inst} chosen={r.id === saved} compact={compact} savedLabel={r.id === saved ? savedLabel : ''}
          onPick={() => set({ sendId: r.id, sendLabel: liveSend.label(r.id, r.id === saved ? savedLabel : '') })} />
      ))}
      {list.length === 0 && (
        <div data-live-send-empty style={{ color: tk.text.muted, fontSize: 11.5, lineHeight: 1.45 }}>
          No Playfield Send running. In Live, put <b>Playfield Send</b> on a track (Audio Effects → Plug-ins). Not there? Install it from Connect → Ableton.
        </div>
      )}
      {liveSend.getError() && <div style={{ color: tk.status.danger, fontSize: 11.5 }}>{liveSend.getError()}</div>}
    </div>
  );
}

/** The Open ↗ window's Live section: the picker, a name for an unpaired send, the buffer, the counters. */
export function LiveSendDetails({ node }: { node: GraphNode }) {
  useLiveSend();
  const tk = useTokens();
  const ok = useCan('audio.liveSend');
  const id = audioSendIdOf(node);
  const inst = id === null ? undefined : liveSend.instance(id);
  const stats = id === null ? null : liveSend.bufferStats(id);
  const small: CSSProperties = { color: tk.text.muted, fontSize: 11.5 };
  return (
    <div data-live-send-details style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ flex: '1 1 320px', minWidth: 260, maxWidth: 460 }}><LiveSendPicker node={node} compact={false} /></div>
      {ok && id !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 260px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...small }}>
            Name
            {liveSend.pairedByLive(id)
              ? <span style={{ color: tk.text.primary }} title="Named after its track by the Live connector">{liveSend.label(id)} <span style={{ color: tk.text.faint }}>(from Live)</span></span>
              : <input data-live-send-name defaultValue={liveSend.userName(id)} placeholder={`Send ${id}`} onBlur={e => liveSend.setUserName(id, e.target.value)}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                title="Without the Live connector, name the send here (kept per Pairing ID). With it, the track's name is used."
                style={{ height: 24, padding: '0 8px', borderRadius: radius.sm, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.ui}`, width: 160 }} />}
          </label>
          <span style={small} data-live-send-stream>
            Pairing ID {id}{inst ? ` · ${khz(inst.sampleRate)} in Live · plug-in ${inst.version}` : ''}
            {inst && olderVersion(inst.version, PLAYFIELD_SEND_VERSION) ? ' (update it from Connect → Ableton)' : ''}
          </span>
          <span style={small} data-live-send-counters>
            {stats ? `Buffer ${Math.round((stats.fill / Math.max(1, stats.target)) * 100)}% · ${stats.drops} drops · ${stats.pads} pads · ${stats.underruns} gaps` : 'Buffer: waiting for audio'}
            {inst ? ` · ${inst.dropouts} dropouts` : ''}
          </span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...small }} title="How much audio the page keeps in hand: more rides out a busy graph, less is quicker. The Sync offset lines up what's left.">
            Cushion
            <NumberInput value={liveSend.cushionMs()} min={10} max={100} step={5} onCommit={n => liveSend.setCushionMs(n)}
              style={{ width: 48, height: 22, borderRadius: 5, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 11px ${fontFamily.mono}`, textAlign: 'center' }} />
            ms
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * Play's Live audio chip: the Live tracks next to the mic (desktop, when any Playfield Send is
 * running). Picking one points the audio readers at it and opens them.
 */
export function LiveSendsButton() {
  useLiveSend();
  useWantLiveSend('chip');
  const tk = useTokens();
  const ok = useCan('audio.liveSend');
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const input = useNodeGraphStore(s => s.play.audioReaders?.input ?? '');
  const list = liveSend.list();
  if (!liveSend.available() || !list.length) return null;
  const use = (id: number) => {
    if (!requireFeature('audio.liveSend')) return;
    useNodeGraphStore.getState().setPlay(p => setReaderInput(p, sendReaderInput(id)));
    setOpen(false);
    useReadersPanel.getState().show();
  };
  return (
    <span ref={ref} style={{ display: 'inline-flex' }} data-live-sends-chip>
      <Button size="sm" variant={open ? 'secondary' : 'ghost'} onClick={() => setOpen(o => !o)} title="Tracks in Ableton Live with Playfield Send on them: point the readers at one">
        Live tracks · {list.length}{!ok && <ProBadge style={{ marginLeft: 4 }} />}
      </Button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} align="end" width={300} padding={8}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ color: tk.text.faint, fontSize: 11 }}>Readers listen to…</span>
            {list.map(i => <SendRow key={i.key} id={i.id} inst={i} chosen={input === sendReaderInput(i.id)} compact savedLabel="" onPick={() => use(i.id)} />)}
          </div>
        </Popover>
      )}
    </span>
  );
}
