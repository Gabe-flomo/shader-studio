/**
 * DrumPadEditor — a Drum pad layer's card (docs/drum-pads.md): the 4 × 4
 * pads (click to play, drop a sound on one to load it, the selected one is
 * edited below), the selected pad's sample with a waveform whose start and
 * end you drag, how it plays, its numbers (each a mapping target), and what
 * plays the pads (keys, MIDI, the pad grid). Its sound's effect chain is in
 * Finish → Sound; readers can listen to it from here.
 *
 * The full editor only shows in the split view's big Layers panel (ctx.big).
 * The sidebar shows a summary (DrumPadSummary: a mini grid to play, the
 * effects, Volume) with Open in split view; phones open the editor in a sheet.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { DRUM_SYNTH_LABELS, emptyDrumPad, padHasSound, padName, padsReaderInput, type DrumPad, type DrumPadLayer } from '../../../types/playLayers';
import { DP_CHOKES, DP_COLS, DP_KEYS, DP_PADS, DP_PARAMS, DP_SYNTHS, dpKey } from '../../../play/kit/drumPads.js';
import { isAudioFile, playDrumPads, SAMPLE_ACCEPT } from '../../../play/drumPads';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { Segmented, Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { NumberInput } from '../../NodeGraph/NumberInput';
import { toast } from '../../ui/toastStore';
import { alpha, fontFamily, radius } from '../../../theme/tokens';
import { EMPTY_READERS, useReadersPanel, withReaders } from '../readersPanelUi';
import { sizeText } from '../backgroundFiles';
import { Section } from './Section';
import { openLayerInSplit, usePlaySplit } from '../playSplit';
import { AUDIO_FX_EFFECTS, layerChainId, type PlayAudioFx } from '../../../types/playAudioFx';
import type { EditorContext } from './editors';
import type { FieldKit } from './fields';

const keyName = (code: string) => code.replace(/^Key|^Digit/, '');
/** Rows top to bottom: pads 13–16 on top, 1–4 at the bottom, like the hardware. */
const ROWS = Array.from({ length: DP_PADS / DP_COLS }, (_, r) => DP_PADS / DP_COLS - 1 - r);

function usePadsVersion(): number {
  const ref = useRef(0);
  return useSyncExternalStore(fn => playDrumPads.subscribe(() => { ref.current++; fn(); }), () => ref.current, () => ref.current);
}

export function DrumPadEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  return ctx.big ? <DrumPadFull f={f} ctx={ctx} /> : <DrumPadSummary f={f} ctx={ctx} />;
}

/** The kit's effect chain in a line: "Filter → Reverb", "None", or "off". */
export function drumFxSummary(fx: PlayAudioFx | undefined, layerId: string): string {
  const chain = fx?.chains[layerChainId(layerId)];
  const on = chain?.effects.filter(e => e.enabled !== false) ?? [];
  if (!chain || !chain.effects.length) return 'None';
  const names = (on.length ? on : chain.effects).map(e => AUDIO_FX_EFFECTS[e.kind]?.label ?? e.kind).join(' → ');
  return !chain.on || !on.length ? `${names} (off)` : names;
}

/** The sidebar's card: what's loaded, a small grid to play, the effects and Volume, and the way to the full editor. */
function DrumPadSummary({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as DrumPadLayer;
  const tk = f.tk;
  usePadsVersion();
  const [, setTick] = useState(0);
  useEffect(() => playDrumPads.subscribe(() => { window.setTimeout(() => setTick(t => t + 1), 140); }), []);
  const splitOk = usePlaySplit(s => s.available) && !ctx.touch;
  const [sheet, setSheet] = useState(false);
  const loaded = l.pads.filter(padHasSound).length;
  const now = performance.now();
  const open = () => { if (!splitOk || !openLayerInSplit(l.id)) setSheet(true); };
  const text = (t: string) => <span style={{ color: tk.text.muted, font: `11.5px/1.4 ${fontFamily.ui}` }}>{t}</span>;
  return (
    <>
      <Section kind="drumpad" title="Pads">
        <div data-drum-summary style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 6 }}>
          <div role="grid" aria-label="Drum pads (mini)" style={{ display: 'grid', gridTemplateColumns: `repeat(${DP_COLS}, 18px)`, gap: 3, flexShrink: 0 }}>
            {ROWS.flatMap(r => Array.from({ length: DP_COLS }, (_, c) => r * DP_COLS + c)).map(i => {
              const p = l.pads[i];
              const has = padHasSound(p);
              const hit = playDrumPads.lastHit(l.id, i);
              const lit = hit && now - hit.at < 130 ? hit.vel : 0;
              return (
                <button key={i} type="button" disabled={!has} aria-label={`Pad ${i + 1}: ${has ? padName(p, i) : 'empty'}`} title={has ? `${i + 1} · ${padName(p, i)}` : `${i + 1} · empty`}
                  onPointerDown={() => { if (has) playDrumPads.trigger(l.id, i, 0.85); }}
                  onPointerUp={() => playDrumPads.letGo(l.id, i)}
                  onPointerLeave={e => { if (e.buttons) playDrumPads.letGo(l.id, i); }}
                  style={{ width: 18, height: 18, padding: 0, border: 0, borderRadius: 4, cursor: has ? 'pointer' : 'default', touchAction: 'none',
                    background: lit ? alpha(tk.accent.base, 0.35 + 0.5 * lit) : has ? alpha(tk.accent.base, 0.28) : tk.bg.field,
                    boxShadow: `inset 0 0 0 1px ${has ? alpha(tk.accent.base, 0.5) : tk.border.default}` }} />
              );
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
            <span style={{ color: tk.text.primary, font: `600 12px ${fontFamily.ui}` }}>{loaded} of {DP_PADS} pads have sounds</span>
            {text(`Effects: ${drumFxSummary(ctx.play.audioFx, l.id)}`)}
            {text('Tap a pad to play it.')}
          </div>
        </div>
        <div style={{ marginTop: 6 }}>{f.prop('volume')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <Button size="sm" variant="primary" icon={splitOk ? 'splitPanel' : 'sliders'} onClick={open} title={splitOk ? 'Edit the pads, their samples and how they play in the split view’s big Layers panel' : 'Edit the pads, their samples and how they play'}>
            {splitOk ? 'Open in split view' : 'Open full editor'}
          </Button>
          <Button size="sm" icon="pause" onClick={() => playDrumPads.stopAll(l.id)} title="Stop everything sounding">Stop</Button>
        </div>
      </Section>
      {sheet && (
        <Sheet title={l.label} onClose={() => setSheet(false)} maxHeight="100dvh">
          <DrumPadFull f={f} ctx={{ ...ctx, big: true }} />
        </Sheet>
      )}
    </>
  );
}

function DrumPadFull({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as DrumPadLayer;
  const tk = f.tk;
  usePadsVersion();
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(-1);
  const [over, setOver] = useState(-1);
  const fileRef = useRef<HTMLInputElement>(null);
  // Lights fade: draw again a moment after a hit.
  const [, setTick] = useState(0);
  useEffect(() => playDrumPads.subscribe(() => { window.setTimeout(() => setTick(t => t + 1), 140); }), []);

  const pad = l.pads[sel] ?? emptyDrumPad();
  const setPad = (i: number, patch: Partial<DrumPad>) => f.set({ pads: l.pads.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  const load = async (i: number, file: File) => {
    if (!isAudioFile(file)) { toast.error('That isn’t a sound file', { message: 'Drop a WAV, MP3, OGG, M4A, AIFF or FLAC.' }); return; }
    setBusy(i);
    try {
      const got = await playDrumPads.pick(file);
      setPad(i, { sampleId: got.sampleId, fileName: got.fileName, bytes: got.bytes, synth: '', name: '' });
      setSel(i);
      if (!got.kept) toast.info('Playing for this session only', { message: 'The library couldn’t keep this sound (storage full or blocked), so after a reload the pad asks for it again.' });
    } catch (e) {
      toast.error('Couldn’t open that sound', { message: e instanceof Error ? e.message : String(e) });
    } finally { setBusy(-1); }
  };

  const down = (i: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    setSel(i);
    if (!padHasSound(l.pads[i])) return;
    // Higher on the pad is harder, like a velocity-sensitive pad.
    const r = e.currentTarget.getBoundingClientRect();
    const vel = Math.max(0.2, Math.min(1, 1.1 - (e.clientY - r.top) / Math.max(1, r.height) * 0.8));
    playDrumPads.trigger(l.id, i, vel);
  };
  const up = (i: number) => playDrumPads.letGo(l.id, i);

  const cfg = ctx.play.audioReaders ?? EMPTY_READERS;
  const mine = cfg.input === padsReaderInput(l.id);
  const listenHere = () => ctx.changePlay(p => withReaders(p, { ...(p.audioReaders ?? EMPTY_READERS), input: padsReaderInput(l.id) }));
  const openReaders = () => { listenHere(); useReadersPanel.getState().show({ focus: cfg.readers[0]?.id || '' }); };

  const now = performance.now();
  const status = playDrumPads.status(pad);
  const note = (text: string) => <div style={{ margin: '6px 0 0 0', color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{text}</div>;

  return (
    <>
      <Section kind="drumpad" title="Pads">
        <input ref={fileRef} type="file" accept={SAMPLE_ACCEPT} style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void load(sel, file); }} />
        <div role="grid" aria-label="Drum pads" style={{ display: 'grid', gridTemplateColumns: `repeat(${DP_COLS}, minmax(0, 1fr))`, gap: 5, marginTop: 6 }}>
          {ROWS.flatMap(r => Array.from({ length: DP_COLS }, (_, c) => r * DP_COLS + c)).map(i => {
            const p = l.pads[i];
            const has = padHasSound(p);
            const hit = playDrumPads.lastHit(l.id, i);
            const lit = hit && now - hit.at < 130 ? hit.vel : 0;
            const st = playDrumPads.status(p);
            const selected = i === sel;
            return (
              <button
                key={i}
                type="button"
                aria-label={`Pad ${i + 1}: ${has ? padName(p, i) : 'empty'}`}
                title={has ? `${padName(p, i)} · key ${keyName(DP_KEYS[i])} · note ${l.baseNote + i}. Drop a sound here to replace it.` : 'Empty: drop a sound here, or select it and pick one below.'}
                onPointerDown={e => down(i, e)}
                onPointerUp={() => up(i)}
                onPointerLeave={e => { if (e.buttons) up(i); }}
                onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(i); } }}
                onDragLeave={() => setOver(o => (o === i ? -1 : o))}
                onDrop={e => { e.preventDefault(); setOver(-1); const file = e.dataTransfer.files?.[0]; if (file) void load(i, file); }}
                style={{
                  position: 'relative', minHeight: 50, padding: '5px 6px', borderRadius: radius.md, border: 0, cursor: 'pointer', textAlign: 'left', touchAction: 'none',
                  background: lit ? alpha(tk.accent.base, 0.35 + 0.5 * lit) : has ? tk.bg.field : alpha(tk.bg.field, 0.5),
                  boxShadow: `inset 0 0 0 ${selected || over === i ? 1.5 : 1}px ${over === i ? tk.accent.base : selected ? tk.accent.base : tk.border.default}`,
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0, transition: 'background 120ms',
                }}
              >
                <span style={{ color: has ? tk.text.primary : tk.text.faint, font: `600 11px/1.2 ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                  {busy === i ? 'Opening…' : has ? padName(p, i) : '+'}
                </span>
                <span style={{ display: 'flex', justifyContent: 'space-between', color: st === 'missing' || st === 'error' ? tk.status.danger : tk.text.faint, font: `500 9.5px ${fontFamily.mono}` }}>
                  <span>{st === 'missing' ? 'missing' : st === 'error' ? 'error' : i + 1}</span>
                  {l.keys && <span>{keyName(DP_KEYS[i])}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {note('Click a pad to play it (higher is harder) and edit it below. Drop sound files on pads to load them.')}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <Button size="sm" icon="pause" onClick={() => playDrumPads.stopAll(l.id)} title="Stop everything sounding">Stop</Button>
          {!mine && <Button size="sm" icon="wave" onClick={listenHere} title="Point the setup’s audio readers at these pads">Readers listen here</Button>}
          <Button size="sm" variant={mine ? 'primary' : 'ghost'} icon="wave" onClick={openReaders} title="The spectrum and readers, listening to these pads">Audio readers…</Button>
        </div>
      </Section>

      <Section kind="drumpad" title={`Pad ${sel + 1}${padHasSound(pad) ? ` · ${padName(pad, sel)}` : ''}`}>
        {f.row('Sound', (
          <>
            <Button size="sm" icon="import" disabled={busy === sel} onClick={() => fileRef.current?.click()}>{status === 'missing' ? 'Pick it again' : pad.sampleId ? 'Replace…' : 'Choose file…'}</Button>
            <Select ariaLabel="Generated drum" value={pad.sampleId ? '' : pad.synth} height={26}
              options={[{ value: '', label: pad.sampleId ? 'File' : 'Generated…' }, ...DP_SYNTHS.map(s => ({ value: s, label: DRUM_SYNTH_LABELS[s] }))]}
              onChange={v => { if (v) setPad(sel, { synth: v as DrumPad['synth'], sampleId: '', fileName: '', bytes: 0, name: '' }); }} />
            {padHasSound(pad) && <Button size="sm" variant="ghost" icon="trash" onClick={() => setPad(sel, emptyDrumPad())} title="Empty this pad">Clear</Button>}
          </>
        ), 'A sound file of your own (kept in this browser’s library, not in the setup) or a generated drum.')}
        {pad.sampleId && note(`${pad.fileName}${pad.bytes ? ` · ${sizeText(pad.bytes)}` : ''}${status === 'missing' ? ' isn’t in this browser’s library (another browser, or a cleared library). Pick it again.' : status === 'error' ? ` · ${playDrumPads.errorText(pad)}` : ''}`)}
        {padHasSound(pad) && (
          <>
            <Waveform f={f} layer={l} pad={sel} />
            {f.row('Name', <input aria-label="Pad name" value={pad.name} placeholder={padName({ ...pad, name: '' }, sel)} onChange={e => setPad(sel, { name: e.target.value.slice(0, 60) })}
              style={{ flex: 1, minWidth: 0, height: 26, borderRadius: 6, border: 0, padding: '0 8px', background: tk.bg.field, color: tk.text.primary, font: `12px ${fontFamily.ui}` }} />)}
            {f.row('Mode', <Segmented size="sm" ariaLabel="Mode" value={pad.mode} options={[{ value: 'oneshot', label: 'One-shot', title: 'Plays to the end, however short the hit' }, { value: 'gate', label: 'Gate', title: 'Plays while held; Release fades it after' }]} onChange={v => setPad(sel, { mode: v as DrumPad['mode'] })} />,
              'One-shot plays the sample to its end. Gate plays while the pad, key or note is held, then fades over Release.')}
            {f.row('Play', (
              <>
                <Toggle checked={pad.loop} onChange={v => setPad(sel, { loop: v })} label="Loop" />
                <Toggle checked={pad.reverse} onChange={v => setPad(sel, { reverse: v })} label="Reverse" />
              </>
            ), 'Loop (gate pads): start to end, round and round while held. Reverse: backwards, from end to start.')}
            {f.row('Choke', <Select ariaLabel="Choke group" value={String(pad.choke)} height={26} options={[{ value: '0', label: 'None' }, ...Array.from({ length: DP_CHOKES }, (_, i) => ({ value: String(i + 1), label: `Group ${i + 1}` }))]} onChange={v => setPad(sel, { choke: Number(v) })} />,
              'A hit cuts every pad sounding in the same group: put a closed and an open hat together.')}
            {/* Short labels: the section says which pad. */}
            {DP_PARAMS.filter(d => d.key !== 'start' && d.key !== 'end').map(d => f.prop(dpKey(sel, d.key), d.label))}
          </>
        )}
      </Section>

      <Section kind="drumpad" title="Kit">
        {f.prop('volume')}
        {f.toggle('Keys', 'keys', 'Z X C V · A S D F · Q W E R · 1 2 3 4', 'On the Play page, these keys play pads 1–16 (the bottom row is 1–4, like the pads above).')}
        {f.toggle('MIDI', 'midi', 'Notes play the pads', 'MIDI notes from the base note up play pads 1–16 (36–51, a drum rack’s, by default). Velocity sets how hard.')}
        {l.midi && f.row('Notes', (
          <>
            <NumberInput value={l.baseNote} min={0} max={112} step={1} title="The note that plays pad 1" onCommit={n => f.set({ baseNote: Math.max(0, Math.min(112, Math.round(n))) })} style={f.numStyle} />
            <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>to {l.baseNote + DP_PADS - 1}</span>
            <Select ariaLabel="MIDI channel" value={String(l.channel)} height={26} options={[{ value: '0', label: 'Any channel' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Channel ${i + 1}` }))]} onChange={v => f.set({ channel: Number(v) })} />
          </>
        ), 'Notes outside the range, or on another channel, are left alone.')}
        {f.toggle('Pad grid', 'grid', 'The grid’s lower-left 4 × 4', 'With a pad grid set up (MIDI settings), its lower-left 4 × 4 pads (or the on-screen grid) play pads 1–16.')}
        {note('Actions can play a pad too (Do: Play pad), from any trigger or signal. Takes record every hit; a render plays each at the moment it landed. The effect chain is in Finish → Sound.')}
      </Section>
    </>
  );
}

/** The sample's waveform: the part that plays is lit; drag either edge to move Start or End. */
function Waveform({ f, layer, pad }: { f: FieldKit; layer: DrumPadLayer; pad: number }) {
  const tk = f.tk;
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<'start' | 'end' | null>(null);
  const p = layer.pads[pad];
  const peaks = playDrumPads.peaks(p);
  const sk = dpKey(pad, 'start'), ek = dpKey(pad, 'end');
  const start = layer[sk as `pad${number}_${string}`] ?? 0, end = layer[ek as `pad${number}_${string}`] ?? 1;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const lo = Math.min(start, end), hi = Math.max(start, end);
    g.fillStyle = alpha(tk.accent.base, 0.12);
    g.fillRect(lo * w, 0, (hi - lo) * w, h);
    if (peaks) {
      const n = peaks.length;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w, t = i / n, a = peaks[i] * (h / 2 - 2);
        g.fillStyle = t >= lo && t <= hi ? tk.accent.base : tk.text.faint;
        g.fillRect(x, h / 2 - a, Math.max(1, w / n - 0.5), Math.max(1, a * 2));
      }
    }
    g.fillStyle = tk.text.primary;
    for (const x of [lo, hi]) g.fillRect(Math.round(x * w) - 1, 0, 2, h);
  }, [peaks, start, end, tk]);
  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))); };
  return (
    <div style={{ marginTop: 8 }}>
      <canvas
        ref={ref}
        aria-label="Waveform: drag the edges to set start and end"
        onPointerDown={e => { const x = at(e); drag.current = Math.abs(x - start) <= Math.abs(x - end) ? 'start' : 'end'; e.currentTarget.setPointerCapture(e.pointerId); f.set({ [drag.current === 'start' ? sk : ek]: x }); }}
        onPointerMove={e => { if (drag.current) f.set({ [drag.current === 'start' ? sk : ek]: at(e) }); }}
        onPointerUp={() => { drag.current = null; }}
        style={{ display: 'block', width: '100%', height: 56, borderRadius: radius.md, background: tk.bg.field, cursor: 'ew-resize', touchAction: 'none' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', color: tk.text.faint, font: `500 10px ${fontFamily.mono}`, marginTop: 3 }}>
        <span>start {(start * 100).toFixed(1)}%</span>
        <span>{playDrumPads.duration(p) ? `${(playDrumPads.duration(p) * Math.abs(end - start)).toFixed(3)} s` : ''}</span>
        <span>end {(end * 100).toFixed(1)}%</span>
      </div>
    </div>
  );
}
