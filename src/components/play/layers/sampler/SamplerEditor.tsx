/**
 * SamplerEditor — the Sampler layer's editor (docs/sampler.md), one editor
 * for the sidebar card, the split view's big Layers panel and a phone's
 * full-height sheet:
 *
 *   Drum view   Drum Rack's pads: a 4 × 4 window over 128 pads (‹ › bank buttons
 *               above it move the window), click to play (higher is harder)
 *               and select, drop files (several fill the next pads), drag a
 *               pad onto another to swap them. The selected pad's sample on
 *               a waveform (S / E, the loop brace, zoom, snap to zero
 *               crossings) and its voice: mode, loop, reverse, choke, the amp
 *               envelope picture, gain, transpose, pan…
 *   Keys view   Sampler's zones: the zone editor (Key / Velocity), modes
 *               (Classic / One-shot / Slice), what overlapping zones do
 *               (All / Round robin / Random), the selected zone's sample and
 *               settings, and the instrument's voice.
 *
 * Further tabs: Sample (the sample numbers, Slice to pads), Filter (the
 * response you drag, its envelope), Pitch & LFO, and Kit / Play (volume,
 * Sample index, keys, MIDI, the pad grid, readers). In the sidebar the same
 * tabs sit in a compact strip; Expand opens the split view's big panel, or a
 * sheet on a phone.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  DRUM_SYNTH_LABELS, emptyDrumPad, newSamplerZone, padHasSound, padName, padNumbers, padsReaderInput, zoneName,
  type DrumPad, type SamplerInst, type SamplerLayer, type SamplerZone,
} from '../../../../types/playLayers';
import { DP_COLS, DP_KEYS, DP_SYNTHS, dpKey } from '../../../../play/kit/drumPads.js';
import {
  SM_CHOKES, SM_PADS, SM_PARAMS, SM_WINDOW, smKeyProp, smNoteName, smNoteOfPad, smPadOfNote, smRootFromName, smTransients,
  type SmFilter, type SmLfoShape, type SmLfoTo,
} from '../../../../play/kit/sampler.js';
import { isAudioFile, layerSounds, PIANO_KEY_LABELS, playSampler, SAMPLE_ACCEPT } from '../../../../play/drumPads';
import { Button, IconButton } from '../../../ui/Button';
import { Sheet } from '../../../ui/Sheet';
import { Segmented, Toggle } from '../../../ui/Choice';
import { Select } from '../../../ui/Select';
import { NumberInput } from '../../../NodeGraph/NumberInput';
import { toast } from '../../../ui/toastStore';
import { alpha, fontFamily, radius } from '../../../../theme/tokens';
import { EMPTY_READERS, useReadersPanel } from '../../readersPanelUi';
import { setReaderInput } from '../../../../play/readerControls';
import { ReaderDots } from '../../ReaderDots';
import { sizeText } from '../../backgroundFiles';
import { Section } from '../Section';
import { BigEditorScaffold } from '../BigEditorScaffold';
import { SectionTabsContext } from '../sectionTabs';
import { openLayerInSplit, usePlaySplit } from '../../playSplit';
import { AUDIO_FX_EFFECTS, layerChainId, type PlayAudioFx } from '../../../../types/playAudioFx';
import type { EditorContext } from '../editors';
import type { FieldKit } from '../fields';
import { DrumKitRow } from '../DrumKitRow';
import { LinkedPickButton, LinkedRelinkButton, linkedMissingText, useLinkedAvailable } from '../../../linked/LinkedPickButton';
import { openLinkedPicker } from '../../../linked/linkedUi';
import { isLinkedRef, linkedRef } from '../../../../files/linkedRefs';
import { SampleWaveform, type WaveMarkers } from './SampleWaveform';
import { SamplerEnvelope, type EnvKeys } from './SamplerEnvelope';
import { FilterGraph } from './FilterGraph';
import { ZoneEditor, type ZoneAxis } from './ZoneEditor';

const keyName = (code: string) => code.replace(/^Key|^Digit/, '');
const ROWS = [3, 2, 1, 0];
const FILTERS: Array<{ value: SmFilter; label: string }> = [
  { value: 'off', label: 'Off' }, { value: 'lp12', label: 'Low-pass 12 dB' }, { value: 'lp24', label: 'Low-pass 24 dB' },
  { value: 'hp12', label: 'High-pass 12 dB' }, { value: 'hp24', label: 'High-pass 24 dB' }, { value: 'bp12', label: 'Band-pass 12 dB' }, { value: 'bp24', label: 'Band-pass 24 dB' },
];
const LFO_SHAPES: Array<{ value: SmLfoShape; label: string }> = [{ value: 'sine', label: 'Sine' }, { value: 'triangle', label: 'Triangle' }, { value: 'square', label: 'Square' }, { value: 'sawtooth', label: 'Saw' }];
const LFO_TO: Array<{ value: SmLfoTo; label: string; title: string }> = [
  { value: 'pitch', label: 'Pitch', title: 'Vibrato: up to an octave either way' }, { value: 'filter', label: 'Filter', title: 'Sweeps the cutoff up to four octaves either way' },
  { value: 'amp', label: 'Amp', title: 'Tremolo' }, { value: 'pan', label: 'Pan', title: 'Auto-pan' },
];
const defaultOf = (key: string) => SM_PARAMS.find(p => p.key === key)?.value ?? 0;

function useSamplerVersion(): number {
  const ref = useRef(0);
  return useSyncExternalStore(fn => playSampler.subscribe(() => { ref.current++; fn(); }), () => ref.current, () => ref.current);
}
/** Draw again a moment after a hit, so the lights fade. */
function useLights(): void {
  const [, setTick] = useState(0);
  useEffect(() => playSampler.subscribe(() => { window.setTimeout(() => setTick(t => t + 1), 140); }), []);
}

/** The kit's effect chain in a line: "Filter → Reverb", "None", or "off". */
export function drumFxSummary(fx: PlayAudioFx | undefined, layerId: string): string {
  const chain = fx?.chains[layerChainId(layerId)];
  const on = chain?.effects.filter(e => e.enabled !== false) ?? [];
  if (!chain || !chain.effects.length) return 'None';
  const names = (on.length ? on : chain.effects).map(e => AUDIO_FX_EFFECTS[e.kind]?.label ?? e.kind).join(' → ');
  return !chain.on || !on.length ? `${names} (off)` : names;
}

export function SamplerEditor({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as SamplerLayer;
  const compact = !ctx.big;
  const splitOk = usePlaySplit(s => s.available) && !ctx.touch;
  const [sheet, setSheet] = useState(false);
  const expand = () => { if (!splitOk || !openLayerInSplit(l.id)) setSheet(true); };
  return (
    <>
      <SamplerBody f={f} ctx={ctx} compact={compact} onExpand={compact ? expand : undefined} expandLabel={splitOk ? 'Expand in split view' : 'Open full editor'} />
      {sheet && (
        <Sheet title={l.label} onClose={() => setSheet(false)} maxHeight="100dvh">
          {/* Its own tabs: the card's tab host (behind the sheet) mustn't take this editor's sections. */}
          <SectionTabsContext.Provider value={null}>
            <SamplerBody f={f} ctx={{ ...ctx, big: true }} compact={false} />
          </SectionTabsContext.Provider>
        </Sheet>
      )}
    </>
  );
}

/** The layer key behind a voice number: the selected pad's (`pad3_cutoff`) or the instrument's (`k_cutoff`). */
type KeyOf = (key: string) => string;

function SamplerBody({ f, ctx, compact, onExpand, expandLabel }: { f: FieldKit; ctx: EditorContext; compact: boolean; onExpand?: () => void; expandLabel?: string }) {
  const l = f.l as SamplerLayer;
  useSamplerVersion();
  useLights();
  const [sel, setSel] = useState(() => smPadOfNote(l.bank, l.baseNote));
  const [zsel, setZsel] = useState(0);
  const [snap, setSnap] = useState(true);
  const keysView = l.view === 'keys';
  const num = (k: string) => { const v = (l as unknown as Record<string, unknown>)[k]; return typeof v === 'number' && Number.isFinite(v) ? v : defaultOf(k.replace(/^pad\d+_|^k_/, '')); };

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      <Segmented size="sm" ariaLabel="Sampler view" value={l.view}
        options={[{ value: 'drum', label: 'Drum', title: 'Pads, Drum Rack-style: each pad its own sound and settings' }, { value: 'keys', label: 'Keys', title: 'A multisampler: zones across the keyboard, played at pitch' }]}
        onChange={v => f.set({ view: v })} />
      <span style={{ flex: 1 }} />
      <IconButton icon="pause" label="Stop everything sounding" size="sm" onClick={() => playSampler.stopAll(l.id)} />
      {onExpand && <Button size="sm" variant="ghost" icon="popout" onClick={onExpand} title="The full editor: the zone editor and every section">{expandLabel}</Button>}
    </div>
  );

  return (
    <BigEditorScaffold kind="sampler" scope={`layer:${l.id}`} compact={compact}>
      {keysView
        ? <KeysSections f={f} ctx={ctx} compact={compact} header={header} zsel={Math.min(zsel, Math.max(0, l.zones.length - 1))} setZsel={setZsel} snap={snap} setSnap={setSnap} num={num} />
        : <DrumSections f={f} ctx={ctx} compact={compact} header={header} sel={sel} setSel={setSel} snap={snap} setSnap={setSnap} num={num} />}
      <PlaySection f={f} ctx={ctx} />
    </BigEditorScaffold>
  );
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

const note = (tk: FieldKit['tk'], text: React.ReactNode) => <div style={{ margin: '6px 0 0 0', color: tk.text.faint, font: `11px/1.45 ${fontFamily.ui}` }}>{text}</div>;

/** Loading sounds: a file, a linked folder file; errors as toasts. */
function useLoader() {
  const [busy, setBusy] = useState<string>('');
  const load = async (tag: string, file: File): Promise<{ sampleId: string; fileName: string; bytes: number } | null> => {
    if (!isAudioFile(file)) { toast.error('That isn’t a sound file', { message: 'Drop a WAV, MP3, OGG, M4A, AIFF or FLAC.' }); return null; }
    setBusy(tag);
    try {
      const got = await playSampler.pick(file);
      if (!got.kept) toast.info('Playing for this session only', { message: 'The library couldn’t keep this sound (storage full or blocked), so after a reload it asks for it again.' });
      return { sampleId: got.sampleId, fileName: got.fileName, bytes: got.bytes };
    } catch (e) {
      toast.error('Couldn’t open that sound', { message: e instanceof Error ? e.message : String(e) });
      return null;
    } finally { setBusy(''); }
  };
  const linked = async (tag: string, ref: string, name: string, bytes: number) => {
    setBusy(tag);
    try { return await playSampler.useLinked(ref, name, bytes); }
    catch (e) { toast.error('Couldn’t open that sound', { message: e instanceof Error ? e.message : String(e) }); return null; }
    finally { setBusy(''); }
  };
  return { busy, load, linked };
}

/** The sound picker row: a file, a linked folder's file, a generated drum, or clear. */
function SoundRow({ f, sound, busy, onFile, onLinked, onSynth, onClear }: {
  f: FieldKit; sound: Pick<DrumPad, 'sampleId' | 'synth' | 'fileName' | 'bytes'>; busy: boolean;
  onFile: () => void; onLinked: (ref: string, name: string, size: number) => void; onSynth: (s: DrumPad['synth']) => void; onClear?: () => void;
}) {
  const tk = f.tk;
  const status = playSampler.status(sound);
  return (
    <>
      {f.row('Sound', (
        <>
          <Button size="sm" icon="import" disabled={busy} onClick={onFile}>{status === 'missing' ? 'Pick it again' : sound.sampleId ? 'Replace…' : 'Choose file…'}</Button>
          <LinkedPickButton filter="audio" label="Linked folder…" disabled={busy} onPick={(ref, e) => onLinked(ref, e.name, e.size)} />
          {status === 'missing' && <LinkedRelinkButton id={sound.sampleId} filter="audio" onRelinked={ref => onLinked(ref, ref.split('/').pop() ?? sound.fileName, sound.bytes)} />}
          <Select ariaLabel="Generated drum" value={sound.sampleId ? '' : sound.synth} height={26}
            options={[{ value: '', label: sound.sampleId ? 'File' : 'Generated…' }, ...DP_SYNTHS.map(s => ({ value: s, label: DRUM_SYNTH_LABELS[s] }))]}
            onChange={v => { if (v) onSynth(v as DrumPad['synth']); }} />
          {onClear && padHasSound(sound) && <IconButton icon="trash" label="Empty it" size="sm" onClick={onClear} />}
        </>
      ), 'A sound file of your own (kept in this browser’s library, not in the setup) or a generated drum.')}
      {sound.sampleId && note(tk, `${sound.fileName}${sound.bytes ? ` · ${sizeText(sound.bytes)}` : ''}${status === 'missing' ? (isLinkedRef(sound.sampleId) ? ` · ${linkedMissingText(sound.sampleId, sound.fileName)}` : ' isn’t in this browser’s library (another browser, or a cleared library). Pick it again.') : status === 'error' ? ` · ${playSampler.errorText(sound)}` : ''}`)}
    </>
  );
}

/** Velocity → volume: a small curve you drag up and down (the curve), with the amount beside. */
function VelCurve({ f, amountKey, curveKey }: { f: FieldKit; amountKey: string; curveKey: string }) {
  const tk = f.tk;
  const l = f.l as unknown as Record<string, number>;
  const amt = typeof l[amountKey] === 'number' ? l[amountKey] : 1, curve = typeof l[curveKey] === 'number' ? l[curveKey] : 0;
  const drag = useRef<{ y0: number; c0: number } | null>(null);
  const W = 64, H = 40;
  const pts: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const v = i / 24, bent = curve === 0 ? v : Math.pow(v, Math.pow(4, -curve)), gain = 1 - amt + amt * bent;
    pts.push(`${(v * W).toFixed(1)},${(H - gain * (H - 2) - 1).toFixed(1)}`);
  }
  return f.row('Vel curve', (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={W} height={H} role="slider" aria-label="Velocity curve" aria-valuenow={curve} aria-valuemin={-1} aria-valuemax={1}
        style={{ background: tk.bg.render, borderRadius: radius.sm, cursor: 'ns-resize', touchAction: 'none', flexShrink: 0 }}
        onPointerDown={e => { (e.currentTarget as Element).setPointerCapture(e.pointerId); drag.current = { y0: e.clientY, c0: curve }; }}
        onPointerMove={e => { const d = drag.current; if (d) f.set({ [curveKey]: Math.round(Math.max(-1, Math.min(1, d.c0 + (d.y0 - e.clientY) / 50)) * 100) / 100 }); }}
        onPointerUp={() => { drag.current = null; }} onDoubleClick={() => f.set({ [curveKey]: 0 })}>
        <polyline points={pts.join(' ')} fill="none" stroke={tk.accent.base} strokeWidth={1.75} />
      </svg>
      <span style={{ color: tk.text.faint, font: `11px/1.35 ${fontFamily.ui}` }}>Drag up: soft hits louder. Down: quieter. Double-click: straight.</span>
    </div>
  ), 'How velocity becomes volume. Vel → Vol sets how much it matters; the curve bends it.');
}

/** The voice's Filter, and Pitch & LFO sections: shared by a pad and the Keys instrument. */
function VoiceSections({ f, keyOf, filter, lfoShape, lfoTo, setChoice, num, released, scope }: {
  f: FieldKit; keyOf: KeyOf; filter: SmFilter; lfoShape: SmLfoShape; lfoTo: SmLfoTo;
  setChoice: (patch: { filter?: SmFilter; lfoShape?: SmLfoShape; lfoTo?: SmLfoTo }) => void;
  num: (k: string) => number; released: boolean; scope: string;
}) {
  const tk = f.tk;
  const env = (a: string, d: string, s: string, r: string): EnvKeys => ({ attack: keyOf(a), decay: keyOf(d), sustain: keyOf(s), release: keyOf(r) });
  const envVals = (k: EnvKeys) => ({ attack: num(k.attack), decay: num(k.decay), sustain: num(k.sustain), release: num(k.release), aSlope: 0, dSlope: 0, rSlope: 0 });
  const fk = env('fA', 'fD', 'fS', 'fR'), pk = env('pA', 'pD', 'pS', 'pR');
  const fenv = num(keyOf('fEnv')), penv = num(keyOf('pEnv')), lfoAmt = num(keyOf('lfoAmt'));
  return (
    <>
      <Section id={`sampler-filter-${scope}`} kind="sampler" title="Filter" summary={filter === 'off' ? 'Off' : `${FILTERS.find(x => x.value === filter)?.label} · ${Math.round(num(keyOf('cutoff')))} Hz${fenv ? ` · env ${fenv > 0 ? '+' : ''}${fenv} st` : ''}`}>
        {f.row('Type', <Select ariaLabel="Filter type" value={filter} height={26} options={FILTERS} onChange={v => setChoice({ filter: v as SmFilter })} />, 'Low-pass keeps the lows, high-pass the highs, band-pass a band round the frequency. 24 dB cuts twice as steeply.')}
        <FilterGraph type={filter} cutoff={num(keyOf('cutoff'))} res={num(keyOf('res'))} envAmount={fenv}
          onChange={p => f.set({ ...(p.cutoff !== undefined ? { [keyOf('cutoff')]: p.cutoff } : {}), ...(p.res !== undefined ? { [keyOf('res')]: p.res } : {}) })} />
        {filter !== 'off' && (
          <>
            {f.prop(keyOf('cutoff'), 'Frequency')}
            {f.prop(keyOf('res'), 'Res')}
            {f.prop(keyOf('fVel'), 'Vel → Freq')}
            {f.prop(keyOf('fEnv'), 'Env amount')}
            {fenv !== 0
              ? <SamplerEnvelope title="Filter envelope" values={envVals(fk)} keys={fk} released={released} colour={tk.status.warning} height={72} onChange={p => f.set(p)} />
              : note(tk, 'Set Env amount to sweep the cutoff with its own envelope on every hit.')}
          </>
        )}
      </Section>
      <Section id={`sampler-mod-${scope}`} kind="sampler" title="Pitch & LFO" summary={`${penv ? `Pitch env ${penv > 0 ? '+' : ''}${penv} st` : 'No pitch env'} · ${lfoAmt ? `LFO → ${lfoTo} ${Math.round(lfoAmt * 100)}%` : 'LFO off'}`}>
        {f.prop(keyOf('pEnv'), 'Pitch env')}
        {penv !== 0
          ? <SamplerEnvelope title="Pitch envelope" values={envVals(pk)} keys={pk} released={released} colour="#cba6f7" height={72} onChange={p => f.set(p)} />
          : note(tk, 'A kick’s drop, a zap: set Pitch env (semitones) and shape it with its envelope.')}
        {f.row('LFO', (
          <>
            <Segmented size="sm" ariaLabel="LFO target" value={lfoTo} options={LFO_TO} onChange={v => setChoice({ lfoTo: v as SmLfoTo })} />
            <Select ariaLabel="LFO shape" value={lfoShape} height={26} options={LFO_SHAPES} onChange={v => setChoice({ lfoShape: v as SmLfoShape })} />
          </>
        ), 'One LFO per voice, started with the note: to pitch (vibrato), the filter, amp (tremolo) or pan.')}
        {f.prop(keyOf('lfoRate'), 'Rate')}
        {f.prop(keyOf('lfoAmt'), 'Amount')}
      </Section>
    </>
  );
}

// ── Drum view ─────────────────────────────────────────────────────────────────

function DrumSections({ f, ctx, compact, header, sel, setSel, snap, setSnap, num }: {
  f: FieldKit; ctx: EditorContext; compact: boolean; header: React.ReactNode; sel: number; setSel: (i: number) => void; snap: boolean; setSnap: (on: boolean) => void; num: (k: string) => number;
}) {
  const l = f.l as SamplerLayer;
  const tk = f.tk;
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, load, linked } = useLoader();
  const pad = l.pads[sel] ?? emptyDrumPad();
  const has = padHasSound(pad);
  const keyOf: KeyOf = k => dpKey(sel, k);
  const noteOf = (i: number) => smNoteOfPad(i, l.baseNote);
  const linkedOk = useLinkedAvailable();

  /** Pads, grown as needed, with `patch` on pad i (a pad getting its first sound gets its numbers too). */
  const padsWith = (pads: DrumPad[], i: number, patch: Partial<DrumPad>): DrumPad[] => {
    const out = [...pads];
    while (out.length <= i) out.push(emptyDrumPad());
    out[i] = { ...out[i], ...patch };
    return out;
  };
  const setPad = (i: number, patch: Partial<DrumPad>) => {
    const was = padHasSound(l.pads[i]);
    const pads = padsWith(l.pads, i, patch);
    f.set({ pads, ...(!was && padHasSound(pads[i]) ? padNumbers(i) : {}) });
  };
  const setPads = (entries: Array<[number, Partial<DrumPad>]>, numbers: Record<string, number> = {}) => {
    let pads = l.pads;
    const fresh: Record<string, number> = {};
    for (const [i, patch] of entries) { if (!padHasSound(pads[i])) Object.assign(fresh, padNumbers(i)); pads = padsWith(pads, i, patch); }
    f.set({ pads, ...fresh, ...numbers });
  };

  const loadFiles = async (start: number, files: File[]) => {
    const sounds = files.filter(isAudioFile).slice(0, SM_PADS);
    if (!sounds.length) { if (files.length) toast.error('That isn’t a sound file', { message: 'Drop a WAV, MP3, OGG, M4A, AIFF or FLAC.' }); return; }
    const got: Array<[number, Partial<DrumPad>]> = [];
    for (let k = 0; k < sounds.length; k++) {
      const i = (start + k) % SM_PADS;
      const g = await load(`pad${i}`, sounds[k]);
      if (g) got.push([i, { ...g, synth: '', name: '' }]);
    }
    if (got.length) { setPads(got); setSel(got[0][0]); }
    if (got.length > 1) toast.success(`${got.length} sounds on ${smNoteName(noteOf(got[0][0]))}–${smNoteName(noteOf(got[got.length - 1][0]))}`, { message: 'Dropped files fill pads in order from the one you dropped on.' });
  };
  const loadFolder = async () => {
    const p = await openLinkedPicker({ filter: 'audio', mode: 'folder', title: 'Load a folder onto the pads' });
    if (p?.kind !== 'folder') return;
    const files = p.files.slice(0, SM_WINDOW);
    const got = await Promise.all(files.map(e => playSampler.useLinked(linkedRef(p.folderId, e.path), e.name, e.size).catch(() => null)));
    const first = smPadOfNote(l.bank, l.baseNote);
    setPads(got.flatMap((g, k) => (g ? [[(first + k) % SM_PADS, { ...g, synth: '', name: '' }] as [number, Partial<DrumPad>]] : [])));
    const ok = got.filter(Boolean).length, bad = files.length - ok;
    toast.success(`Loaded ${ok} sound${ok === 1 ? '' : 's'} onto the pads in view`, { message: `${bad ? `${bad} couldn’t be decoded and were left as they were. ` : ''}${p.files.length > SM_WINDOW ? `The folder has ${p.files.length}: the first ${SM_WINDOW} alphabetically went on. ` : ''}Played from the folder, not copied into the library.` });
  };

  /** Swap two pads (and their numbers), like dragging one Drum Rack pad onto another. */
  const swap = (a: number, b: number) => {
    if (a === b) return;
    let pads = padsWith(padsWith(l.pads, a, {}), b, {});
    const pa = pads[a], pb = pads[b];
    pads = [...pads]; pads[a] = pb; pads[b] = pa;
    const nums: Record<string, number> = {};
    for (const p of SM_PARAMS) {
      const ka = dpKey(a, p.key), kb = dpKey(b, p.key);
      const va = (l as unknown as Record<string, number>)[ka], vb = (l as unknown as Record<string, number>)[kb];
      nums[ka] = typeof vb === 'number' ? vb : p.value;
      nums[kb] = typeof va === 'number' ? va : p.value;
    }
    f.set({ pads, ...nums });
    setSel(b);
  };

  /** Cut the pad's sample at its transients onto the pads after it (Ableton's Slice to Drum Rack). */
  const sliceToPads = () => {
    const buf = playSampler.buffer(pad);
    if (!buf) return;
    const st = num(keyOf('start')), en = num(keyOf('end'));
    const data = buf.getChannelData(0);
    const cuts = smTransients(data, buf.sampleRate, 0.55).filter(x => x >= st && x < en);
    if (cuts[0] !== st) cuts.unshift(st);
    const n = Math.min(cuts.length, SM_PADS - 1);
    if (n < 2) { toast.info('One hit only', { message: 'No transients found inside Start…End to cut at. Try a loop with clear hits.' }); return; }
    const entries: Array<[number, Partial<DrumPad>]> = [], numbers: Record<string, number> = {};
    for (let k = 0; k < n; k++) {
      const i = (sel + k) % SM_PADS;
      entries.push([i, { sampleId: pad.sampleId, fileName: pad.fileName, bytes: pad.bytes, synth: pad.synth, name: `${padName({ ...pad, name: '' }, sel)} ${k + 1}`, mode: 'oneshot', loop: false, reverse: false, choke: pad.choke }]);
      Object.assign(numbers, padNumbers(i), { [dpKey(i, 'start')]: cuts[k], [dpKey(i, 'end')]: k + 1 < n ? cuts[k + 1] : en });
    }
    setPads(entries, numbers);
    toast.success(`${n} slices on ${smNoteName(noteOf(sel))}–${smNoteName(noteOf((sel + n - 1) % SM_PADS))}`, { message: 'Each pad plays one slice (its Start and End). Undo puts the pads back.' });
  };

  // The window: Drum Rack's 4 × 4 over the 128 notes.
  const windowPads = Array.from({ length: SM_WINDOW }, (_, k) => smPadOfNote(l.bank + k, l.baseNote));
  const moveBank = (to: number) => f.set({ bank: Math.max(0, Math.min(SM_PADS - SM_WINDOW, Math.round(to))) });
  const loaded = l.pads.filter(padHasSound).length;
  const now = performance.now();
  const [over, setOver] = useState(-1);

  const padButton = (i: number, k: number) => {
    const p = l.pads[i];
    const hasP = padHasSound(p);
    const hit = playSampler.lastHit(l.id, i);
    const lit = hit && now - hit.at < 130 ? hit.vel : 0;
    const st = playSampler.status(p);
    const selected = i === sel;
    const n = noteOf(i);
    const down = (e: ReactPointerEvent<HTMLButtonElement>) => {
      setSel(i);
      if (!hasP) return;
      const r = e.currentTarget.getBoundingClientRect();
      const vel = Math.max(0.2, Math.min(1, 1.1 - (e.clientY - r.top) / Math.max(1, r.height) * 0.8));
      playSampler.trigger(l.id, i, vel);
    };
    return (
      <button key={i} type="button" draggable={hasP}
        aria-label={`Pad ${smNoteName(n)}: ${hasP ? padName(p, i) : 'empty'}`}
        title={hasP ? `${padName(p, i)} · ${smNoteName(n)} (note ${n})${l.keys ? ` · key ${keyName(DP_KEYS[k])}` : ''}. Drop a sound to replace it; drag onto another pad to swap.` : `${smNoteName(n)}: empty. Drop sounds here (several fill the next pads), or select it and pick one.`}
        onPointerDown={down}
        onPointerUp={() => playSampler.letGo(l.id, i)}
        onPointerLeave={e => { if (e.buttons) playSampler.letGo(l.id, i); }}
        onDragStart={(e: DragEvent) => { e.dataTransfer.setData('application/x-sampler-pad', String(i)); e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e: DragEvent) => { if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-sampler-pad')) { e.preventDefault(); setOver(i); } }}
        onDragLeave={() => setOver(o => (o === i ? -1 : o))}
        onDrop={(e: DragEvent) => {
          e.preventDefault(); setOver(-1);
          const from = e.dataTransfer.getData('application/x-sampler-pad');
          if (from) { swap(Number(from), i); return; }
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) void loadFiles(i, files);
        }}
        style={{
          position: 'relative', minHeight: compact ? 40 : 54, padding: compact ? '4px 5px' : '5px 7px', borderRadius: radius.md, border: 0, cursor: 'pointer', textAlign: 'left', touchAction: 'none',
          background: lit ? alpha(tk.accent.base, 0.35 + 0.5 * lit) : hasP ? tk.bg.field : alpha(tk.bg.field, 0.45),
          boxShadow: `inset 0 0 0 ${selected || over === i ? 1.5 : 1}px ${over === i || selected ? tk.accent.base : tk.border.default}`,
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minWidth: 0, transition: 'background 90ms',
        }}>
        <span style={{ color: hasP ? tk.text.primary : tk.text.faint, font: `600 ${compact ? 10.5 : 11}px/1.2 ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
          {busy === `pad${i}` ? 'Opening…' : hasP ? padName(p, i) : ''}
        </span>
        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 4, color: st === 'missing' || st === 'error' ? tk.status.danger : tk.text.faint, font: `500 9.5px ${fontFamily.mono}` }}>
          <span>{st === 'missing' ? 'missing' : st === 'error' ? 'error' : smNoteName(n)}</span>
          {!compact && hasP && p.choke ? <span title={`Choke group ${p.choke}`}>⊘{p.choke}</span> : null}
          {l.keys && !compact && <span>{keyName(DP_KEYS[k])}</span>}
        </span>
      </button>
    );
  };

  const markers: WaveMarkers = { start: num(keyOf('start')), end: num(keyOf('end')), loopStart: num(keyOf('loopStart')), loopEnd: num(keyOf('loopEnd')) };
  const ampKeys: EnvKeys = { attack: keyOf('attack'), decay: keyOf('decay'), sustain: keyOf('sustain'), release: keyOf('release'), aSlope: keyOf('aSlope'), dSlope: keyOf('dSlope'), rSlope: keyOf('rSlope') };
  const amp = { attack: num(ampKeys.attack), decay: num(ampKeys.decay), sustain: num(ampKeys.sustain), release: num(ampKeys.release), aSlope: num(ampKeys.aSlope!), dSlope: num(ampKeys.dSlope!), rSlope: num(ampKeys.rSlope!) };
  const classic = pad.mode === 'gate';

  return (
    <>
      <Section id="sampler-pads" kind="sampler" title="Pads" primary summary={`${loaded} pad${loaded === 1 ? '' : 's'} with sounds · ${smNoteName(l.bank)}–${smNoteName(l.bank + 15)} in view`}>
        {header}
        <input ref={fileRef} type="file" accept={SAMPLE_ACCEPT} multiple style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void loadFiles(sel, files); }} />
        {/* Which 16 of the 128 notes are in view: ‹ › step a bank of 16; scrolling over the pads steps a row. */}
        <div data-pad-bank="" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
          <IconButton icon="chevL" label="Lower 16 pads" size="sm" disabled={l.bank <= 0} onClick={() => moveBank(l.bank - SM_WINDOW)} />
          <span style={{ minWidth: 72, textAlign: 'center', color: tk.text.muted, font: `600 11px ${fontFamily.mono}` }}>{smNoteName(l.bank)}–{smNoteName(l.bank + SM_WINDOW - 1)}</span>
          <IconButton icon="chevR" label="Higher 16 pads" size="sm" disabled={l.bank >= SM_PADS - SM_WINDOW} onClick={() => moveBank(l.bank + SM_WINDOW)} />
        </div>
        <div role="grid" aria-label="Pads" onWheel={e => { if (Math.abs(e.deltaY) > 4) moveBank(l.bank + (e.deltaY < 0 ? 4 : -4)); }}
          style={{ marginTop: 6, display: 'grid', gridTemplateColumns: `repeat(${DP_COLS}, minmax(0, 1fr))`, gap: compact ? 4 : 5 }}>
          {ROWS.flatMap(r => Array.from({ length: DP_COLS }, (_, c) => r * DP_COLS + c)).map(k => padButton(windowPads[k], k))}
        </div>
        {/* The selected pad: its sound, sample and how it plays. */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
          <span style={{ color: tk.text.primary, font: `650 12px ${fontFamily.ui}` }}>{has ? padName(pad, sel) : 'Empty pad'}</span>
          <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>{smNoteName(noteOf(sel))} · pad {sel + 1}</span>
        </div>
        <SoundRow f={f} sound={pad} busy={busy === `pad${sel}`} onFile={() => fileRef.current?.click()}
          onLinked={(ref, name, size) => { void linked(`pad${sel}`, ref, name, size).then(g => { if (g) setPad(sel, { ...g, synth: '', name: '' }); }); }}
          onSynth={s => setPad(sel, { synth: s, sampleId: '', fileName: '', bytes: 0, name: '' })}
          onClear={() => setPad(sel, emptyDrumPad())} />
        {has && (
          <>
            <SampleWaveform buffer={playSampler.buffer(pad)} peaks={playSampler.peaks(pad)} markers={markers} loop={classic && pad.loop} xfade={num(keyOf('xfade'))} reverse={pad.reverse}
              snap={snap} onSnap={setSnap} compact={compact} height={compact ? 64 : 104}
              onChange={p => f.set(Object.fromEntries(Object.entries(p).map(([k, v]) => [keyOf(k), Math.round((v as number) * 100000) / 100000])))} />
            {f.row('Mode', (
              <>
                <Segmented size="sm" ariaLabel="Mode" value={pad.mode} options={[{ value: 'oneshot', label: 'One-shot', title: 'Plays to the end, however short the hit' }, { value: 'gate', label: 'Classic', title: 'Plays while held, then Release' }]} onChange={v => setPad(sel, { mode: v as DrumPad['mode'] })} />
                {classic && <Toggle checked={pad.loop} onChange={v => setPad(sel, { loop: v })} label="Loop" />}
                <Toggle checked={pad.reverse} onChange={v => setPad(sel, { reverse: v })} label="Rev" />
              </>
            ), 'One-shot plays the sample to its end. Classic plays while the pad, key or note is held, then fades over Release; with Loop it goes round the loop brace while held.')}
            {f.row('Choke', <Select ariaLabel="Choke group" value={String(pad.choke)} height={26} options={[{ value: '0', label: 'None' }, ...Array.from({ length: SM_CHOKES }, (_, i) => ({ value: String(i + 1), label: `Group ${i + 1}` }))]} onChange={v => setPad(sel, { choke: Number(v) })} />,
              'A hit cuts every pad sounding in the same group (over 4 ms, no click): put a closed and an open hat together.')}
            <SamplerEnvelope title="Amp" values={amp} keys={ampKeys} released={classic} height={compact ? 72 : 96} touch={ctx.touch} onChange={p => f.set(p)} />
            {f.prop(keyOf('volume'), 'Gain')}
            {f.prop(keyOf('pitch'), 'Transpose')}
            {!compact && f.prop(keyOf('pan'), 'Pan')}
          </>
        )}
        {!has && note(tk, 'Click a pad to play it (higher is harder) and select it. Drop sound files on pads (several fill the next ones), drag a pad onto another to swap.')}
        {!compact && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {linkedOk && <Button size="sm" icon="link" onClick={() => void loadFolder()} title="Fill the pads in view from a linked folder’s sounds, alphabetically, played from the folder">Load a folder onto pads…</Button>}
          </div>
        )}
      </Section>

      {has && (
        <Section id="sampler-sample" kind="sampler" title="Sample" summary={`${pad.mode === 'gate' ? 'Classic' : 'One-shot'}${pad.loop && classic ? ' · loop' : ''}${pad.reverse ? ' · reversed' : ''} · ${(num(keyOf('pitch')) >= 0 ? '+' : '') + num(keyOf('pitch'))} st`}>
          {f.prop(keyOf('start'), 'Start')}
          {f.prop(keyOf('end'), 'End')}
          {classic && pad.loop && <>{f.prop(keyOf('loopStart'), 'Loop start')}{f.prop(keyOf('loopEnd'), 'Loop end')}{f.prop(keyOf('xfade'), 'Crossfade')}</>}
          {!classic && f.prop(keyOf('fadeOut'), 'Fade out')}
          {f.prop(keyOf('detune'), 'Detune')}
          {compact && f.prop(keyOf('pan'), 'Pan')}
          {f.prop(keyOf('vel'), 'Vel → Vol')}
          <VelCurve f={f} amountKey={keyOf('vel')} curveKey={keyOf('velCurve')} />
          {pad.sampleId && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              <Button size="sm" icon="grid" onClick={sliceToPads} title="Cut this sample at its hits (inside Start…End) and put one slice on each pad from this one on">Slice to pads</Button>
            </div>
          )}
        </Section>
      )}
      {has && (
        <VoiceSections f={f} keyOf={keyOf} filter={pad.filter ?? 'off'} lfoShape={pad.lfoShape ?? 'sine'} lfoTo={pad.lfoTo ?? 'pitch'} num={num} released={classic} scope="pad"
          setChoice={p => setPad(sel, p)} />
      )}

      <Section id="sampler-kit" kind="sampler" title="Kit" summary={`Volume ${Math.round(l.volume * 100)}% · Effects: ${drumFxSummary(ctx.play.audioFx, l.id)}`}>
        <DrumKitRow f={f} ctx={ctx} />
        {f.props('sampleIndex', 'indexSpread')}
        {f.select('Index mode', 'indexMode', [{ value: 'index', label: 'Index — its place plus Index' }, { value: 'random', label: 'Random — any pad, seeded' }, { value: 'spread', label: 'Index ± spread' }], 'Which pad’s sound a hit plays. Step Index from a beat, a signal or an Increment to walk through the sounds.')}
      </Section>
    </>
  );
}

// ── Keys view ─────────────────────────────────────────────────────────────────

function KeysSections({ f, ctx, compact, header, zsel, setZsel, snap, setSnap, num }: {
  f: FieldKit; ctx: EditorContext; compact: boolean; header: React.ReactNode; zsel: number; setZsel: (i: number) => void; snap: boolean; setSnap: (on: boolean) => void; num: (k: string) => number;
}) {
  const l = f.l as SamplerLayer;
  const tk = f.tk;
  const fileRef = useRef<HTMLInputElement>(null);
  const { busy, load, linked } = useLoader();
  const [axis, setAxis] = useState<ZoneAxis>('key');
  const [over, setOver] = useState(false);
  const z = l.zones[zsel];
  const inst = l.inst;
  const keyOf: KeyOf = k => smKeyProp(k);
  const setInst = (patch: Partial<SamplerInst>) => f.set({ inst: { ...inst, ...patch } });
  const setZone = (i: number, patch: Partial<SamplerZone>) => f.set({ zones: l.zones.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const nextId = () => { let id = 1; while (l.zones.some(x => x.id === id)) id++; return id; };
  const now = performance.now();
  const held = useMemo(() => {
    const s = new Set<number>();
    for (let i = 0; i < SM_PADS; i++) { const h = playSampler.lastHit(l.id, i); if (h && now - h.at < 160) s.add(smNoteOfPad(i, l.baseNote)); }
    return s;
  }, [l.id, l.baseNote, now]);

  /** New zones from files: each at its root (its name's note, else C3); several split the keyboard between their roots. */
  const addFiles = async (files: File[]) => {
    const sounds = files.filter(isAudioFile).slice(0, 64 - l.zones.length);
    if (!sounds.length) { if (files.length) toast.error('That isn’t a sound file', { message: 'Drop a WAV, MP3, OGG, M4A, AIFF or FLAC.' }); return; }
    const made: SamplerZone[] = [];
    let id = nextId();
    for (const file of sounds) {
      const g = await load('zone', file);
      if (!g) continue;
      while (l.zones.some(x => x.id === id) || made.some(x => x.id === id)) id++;
      made.push(newSamplerZone(id, { ...g, root: smRootFromName(g.fileName, 60) }));
    }
    if (!made.length) return;
    // Several with different roots: each from halfway to the root below to halfway to the root above (Sampler's auto-map).
    const roots = [...new Set(made.map(m => m.root))].sort((a, b) => a - b);
    if (roots.length > 1 && roots.length === made.length) {
      made.sort((a, b) => a.root - b.root).forEach((m, k) => {
        m.lo = k === 0 ? 0 : Math.floor((made[k - 1].root + m.root) / 2) + 1;
        m.hi = k === made.length - 1 ? 127 : Math.floor((m.root + made[k + 1].root) / 2);
      });
    }
    f.set({ zones: [...l.zones, ...made] });
    setZsel(l.zones.length);
    toast.success(made.length === 1 ? `“${made[0].fileName}” at root ${smNoteName(made[0].root)}` : `${made.length} zones, split between their roots`, { message: 'A file named with a note (Cello_A2.wav) is rooted there; otherwise C3. Drag a zone’s bar to change its keys.' });
  };

  const detectSlices = (i = 0) => {
    const zz = l.zones[i];
    const buf = zz && playSampler.buffer(zz);
    if (!buf) return;
    const cuts = smTransients(buf.getChannelData(0), buf.sampleRate, inst.sensitivity).filter(x => x >= zz.start && x < zz.end);
    if (!cuts.length || cuts[0] > zz.start) cuts.unshift(zz.start);
    setZone(i, { slices: cuts.slice(0, SM_PADS) });
  };
  useEffect(() => {
    // Slice mode with no slices yet: find them as soon as the sample is here.
    if (inst.mode === 'slice' && l.zones[0] && !l.zones[0].slices?.length && playSampler.buffer(l.zones[0])) detectSlices(0);
  });

  const slicing = inst.mode === 'slice';
  const shown = slicing ? 0 : zsel;
  const zz = l.zones[shown];
  const ampKeys: EnvKeys = { attack: keyOf('attack'), decay: keyOf('decay'), sustain: keyOf('sustain'), release: keyOf('release'), aSlope: keyOf('aSlope'), dSlope: keyOf('dSlope'), rSlope: keyOf('rSlope') };
  const amp = { attack: num(ampKeys.attack), decay: num(ampKeys.decay), sustain: num(ampKeys.sustain), release: num(ampKeys.release), aSlope: num(ampKeys.aSlope!), dSlope: num(ampKeys.dSlope!), rSlope: num(ampKeys.rSlope!) };
  const releases = inst.mode === 'classic' || (slicing && inst.sliceGate);
  const octave = playSampler.octave(l);

  return (
    <>
      <Section id="sampler-zones" kind="sampler" title="Zones" primary summary={`${l.zones.length} zone${l.zones.length === 1 ? '' : 's'} · ${inst.mode === 'classic' ? 'Classic' : inst.mode === 'oneshot' ? 'One-shot' : 'Slice'}`}>
        {header}
        <input ref={fileRef} type="file" accept={SAMPLE_ACCEPT} multiple style={{ display: 'none' }} onChange={e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; if (files.length) void addFiles(files); }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <Segmented size="sm" ariaLabel="Mode" value={inst.mode} onChange={v => setInst({ mode: v as SamplerInst['mode'] })}
            options={[{ value: 'classic', label: 'Classic', title: 'Plays while held, loops if the zone loops, then Release' }, { value: 'oneshot', label: 'One-shot', title: 'Plays to the end; letting go does nothing' }, { value: 'slice', label: 'Slice', title: 'The first zone’s sample cut at its hits: slice 1 on the first pad, and on' }]} />
          {!slicing && !compact && <Segmented size="sm" ariaLabel="Zone axis" value={axis} onChange={v => setAxis(v as ZoneAxis)} options={[{ value: 'key', label: 'Key' }, { value: 'vel', label: 'Velocity' }]} />}
        </div>
        {!slicing && (
          <div onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); const files = Array.from(e.dataTransfer.files ?? []); if (files.length) void addFiles(files); }}
            style={{ borderRadius: radius.md, boxShadow: over ? `0 0 0 1.5px ${tk.accent.base}` : undefined }}>
            <ZoneEditor zones={l.zones} sel={zsel} onSelect={setZsel} onChange={setZone} axis={compact ? 'key' : axis}
              onPlay={(n, v) => playSampler.trigger(l.id, smPadOfNote(n, l.baseNote), v)} onRelease={n => playSampler.letGo(l.id, smPadOfNote(n, l.baseNote))} held={held}
              height={compact ? 26 + 4 + Math.max(2, Math.min(4, l.zones.length)) * 20 + 4 : undefined} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
          <Button size="sm" icon="plus" disabled={busy === 'zone'} onClick={() => fileRef.current?.click()} title="Add sound files as zones (each at its root key)">{busy === 'zone' ? 'Opening…' : 'Add sounds…'}</Button>
          {!slicing && l.zones.length > 1 && f.row('Overlaps', <Segmented size="sm" ariaLabel="Overlapping zones" value={inst.select} onChange={v => setInst({ select: v as SamplerInst['select'] })}
            options={[{ value: 'all', label: 'All', title: 'Every zone under the note plays (layered)' }, { value: 'cycle', label: 'Round robin', title: 'They take turns, note by note' }, { value: 'random', label: 'Random', title: 'One at random each note (seeded: a take repeats it)' }]} />,
            'Where zones overlap a note: all play together, they take turns, or one at random.')}
        </div>
        {z && !slicing && zz && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 10 }}>
            <span style={{ color: tk.text.primary, font: `650 12px ${fontFamily.ui}` }}>{zoneName(zz, shown)}</span>
            <span style={{ color: tk.text.faint, font: `500 10.5px ${fontFamily.mono}` }}>{smNoteName(zz.lo)}–{smNoteName(zz.hi)} · root {smNoteName(zz.root)} · vel {zz.vlo}–{zz.vhi}</span>
            <span style={{ flex: 1 }} />
            <IconButton icon="trash" label="Remove this zone" size="sm" onClick={() => { f.set({ zones: l.zones.filter((_, j) => j !== zsel) }); setZsel(Math.max(0, zsel - 1)); }} />
          </div>
        )}
        {zz && (
          <>
            <SoundRow f={f} sound={zz} busy={busy === 'zone'} onFile={() => fileRef.current?.click()}
              onLinked={(ref, name, size) => { void linked('zone', ref, name, size).then(g => { if (g) setZone(shown, { ...g, synth: '', name: '' }); }); }}
              onSynth={s => setZone(shown, { synth: s, sampleId: '', fileName: '', bytes: 0, name: '' })} />
            <SampleWaveform buffer={playSampler.buffer(zz)} peaks={playSampler.peaks(zz)} markers={{ start: zz.start, end: zz.end, loopStart: zz.loopStart, loopEnd: zz.loopEnd }}
              loop={inst.mode === 'classic' && zz.loop} xfade={zz.xfade} reverse={zz.reverse} snap={snap} onSnap={setSnap} compact={compact} height={compact ? 64 : 104}
              slices={slicing ? (zz.slices?.length ? zz.slices : [zz.start]) : null} onSlices={slicing ? s => setZone(0, { slices: s }) : undefined}
              onChange={p => setZone(shown, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.round((v as number) * 100000) / 100000])))} />
            {slicing && (
              <>
                {f.row('Slices', (
                  <>
                    <Button size="sm" icon="rebuild" onClick={() => detectSlices(0)} title="Find the hits again with this Sensitivity">Detect</Button>
                    <input type="range" aria-label="Slice sensitivity" min={0} max={1} step={0.01} value={inst.sensitivity} onChange={e => setInst({ sensitivity: Number(e.target.value) })} onPointerUp={() => detectSlices(0)} style={{ flex: 1, minWidth: 60 }} />
                    <Toggle checked={inst.sliceGate} onChange={v => setInst({ sliceGate: v })} label="Hold" />
                  </>
                ), 'Detect cuts at the hits (higher sensitivity finds softer ones). Drag a line to move it, double-click the wave to add one, double-click a line to remove it. Hold: a slice plays only while held.')}
                {note(tk, `${(zz.slices?.length ?? 1)} slices, from ${smNoteName(smNoteOfPad(0, l.baseNote))} (pad 1) up: each pad or key plays one.`)}
              </>
            )}
            {!slicing && f.row('Zone', (
              <>
                <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Root</span>
                <NumberInput value={zz.root} min={0} max={127} step={1} title={`Root key (${smNoteName(zz.root)}): where it plays at its own pitch`} onCommit={n => setZone(shown, { root: Math.max(0, Math.min(127, Math.round(n))) })} style={f.numStyle} />
                <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Tune</span>
                <NumberInput value={zz.tune} min={-48} max={48} step={1} title="Semitones" onCommit={n => setZone(shown, { tune: Math.max(-48, Math.min(48, Math.round(n))) })} style={f.numStyle} />
                <Toggle checked={zz.track} onChange={v => setZone(shown, { track: v })} label="Track" />
              </>
            ), 'Root: the key it plays at its own pitch (from the file’s name when it has a note). Tune: semitones. Track off plays every key at the root’s pitch (a drum).')}
            {!slicing && f.row('Play', (
              <>
                {inst.mode === 'classic' && <Toggle checked={zz.loop} onChange={v => setZone(shown, { loop: v })} label="Loop" />}
                <Toggle checked={zz.reverse} onChange={v => setZone(shown, { reverse: v })} label="Rev" />
                <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Gain</span>
                <NumberInput value={Math.round(zz.gain * 100) / 100} min={0} max={4} step={0.05} title="This zone’s level (1 as recorded)" onCommit={n => setZone(shown, { gain: Math.max(0, Math.min(4, n)) })} style={f.numStyle} />
                <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Pan</span>
                <NumberInput value={zz.pan} min={-1} max={1} step={0.05} title="−1 left, 1 right" onCommit={n => setZone(shown, { pan: Math.max(-1, Math.min(1, n)) })} style={f.numStyle} />
              </>
            ), 'Loop (Classic): round the loop brace while held. Rev: backwards. Gain and pan on top of the instrument’s.')}
            {!slicing && inst.mode === 'classic' && zz.loop && f.row('Crossfade', (
              <NumberInput value={zz.xfade} min={0} max={10} step={0.005} title="Seconds of the loop’s end blended into its start" onCommit={n => setZone(shown, { xfade: Math.max(0, Math.min(10, n)) })} style={f.numStyle} />
            ), 'Blends the end of the loop into its start so the wrap is seamless.')}
          </>
        )}
        {!l.zones.length && note(tk, `Drop sound files on the keyboard above (or Add sounds…). Then play with the keys (${PIANO_KEY_LABELS.slice(0, 8).join(' ')}…; Z / X octave), MIDI or the strip.`)}
        {l.zones.length > 0 && <SamplerEnvelope title="Amp" values={amp} keys={ampKeys} released={releases} height={compact ? 72 : 96} touch={ctx.touch} onChange={p => f.set(p)} />}
        {l.zones.length > 0 && <>{f.prop(keyOf('volume'), 'Gain')}{f.prop(keyOf('pitch'), 'Transpose')}</>}
        {l.keys && l.zones.length > 0 && note(tk, `Keys: ${PIANO_KEY_LABELS.slice(0, 13).join(' ')} play ${smNoteName((octave + 2) * 12)} up; Z / X move the octave (now ${smNoteName((octave + 2) * 12)}).`)}
      </Section>

      {l.zones.length > 0 && (
        <Section id="sampler-voice" kind="sampler" title="Voice" summary={`${inst.voices} voice${inst.voices === 1 ? '' : 's'}${inst.legato && inst.voices === 1 ? ' · legato' : ''}${num(keyOf('glide')) ? ` · glide ${num(keyOf('glide'))} s` : ''}`}>
          {f.row('Voices', (
            <>
              <NumberInput value={inst.voices} min={1} max={32} step={1} title="Notes at once; the oldest fades out to make room" onCommit={n => setInst({ voices: Math.max(1, Math.min(32, Math.round(n))) })} style={f.numStyle} />
              <Toggle checked={inst.retrigger} onChange={v => setInst({ retrigger: v })} label="Retrigger" />
              {inst.voices === 1 && <Toggle checked={inst.legato} onChange={v => setInst({ legato: v })} label="Legato" />}
            </>
          ), 'Voices: how many notes sound at once. Retrigger: the same note again restarts it (a 4 ms fade) rather than stacking. Legato (one voice): a new note while one is held slides there without a new attack.')}
          {f.prop(keyOf('glide'), 'Glide')}
          {f.prop(keyOf('detune'), 'Detune')}
          {f.prop(keyOf('pan'), 'Pan')}
          {f.prop(keyOf('vel'), 'Vel → Vol')}
          <VelCurve f={f} amountKey={keyOf('vel')} curveKey={keyOf('velCurve')} />
          {inst.mode === 'oneshot' && f.prop(keyOf('fadeOut'), 'Fade out')}
        </Section>
      )}
      {l.zones.length > 0 && (
        <VoiceSections f={f} keyOf={keyOf} filter={inst.filter} lfoShape={inst.lfoShape} lfoTo={inst.lfoTo} num={num} released={releases} scope="keys" setChoice={p => setInst(p)} />
      )}
    </>
  );
}

// ── Play: what plays it, readers ──────────────────────────────────────────────

function PlaySection({ f, ctx }: { f: FieldKit; ctx: EditorContext }) {
  const l = f.l as SamplerLayer;
  const tk = f.tk;
  const cfg = ctx.play.audioReaders ?? EMPTY_READERS;
  const mine = cfg.input === padsReaderInput(l.id);
  const listenHere = () => ctx.changePlay(p => setReaderInput(p, padsReaderInput(l.id)));
  const openReaders = () => { listenHere(); useReadersPanel.getState().show({ focus: cfg.readers[0]?.id || '' }); };
  const sounds = layerSounds(l).length;
  return (
    <Section id="sampler-play" kind="sampler" title="Play" summary={`${[l.keys && 'Keys', l.midi && 'MIDI', l.grid && l.view === 'drum' && 'Pad grid'].filter(Boolean).join(' · ') || 'No triggers'} · ${sounds} sound${sounds === 1 ? '' : 's'}`}>
      {f.prop('volume')}
      {l.view === 'drum'
        ? f.toggle('Keys', 'keys', 'Z X C V · A S D F · Q W E R · 1 2 3 4', 'On the Play page, these keys play the 16 pads in view (the bottom row is the bottom row).')
        : f.toggle('Keys', 'keys', `${PIANO_KEY_LABELS.slice(0, 8).join(' ')}… · Z / X octave`, 'On the Play page, the keyboard plays notes like Live’s: A is C, W C#, S D…; Z and X move the octave.')}
      {l.view === 'keys' && l.keys && f.row('Octave', (
        <NumberInput value={l.octave} min={-2} max={8} step={1} title="The octave A plays the C of (3: C3, middle C)" onCommit={n => f.set({ octave: Math.max(-2, Math.min(8, Math.round(n))) })} style={f.numStyle} />
      ), 'Where the keyboard starts: A plays C of this octave (C3 = 60, middle C).')}
      {f.toggle('MIDI', 'midi', l.view === 'drum' ? 'Notes play their pads' : 'Notes play the zones', 'MIDI notes play the pad on their note (Drum) or the zones under them (Keys). Velocity sets how hard.')}
      {l.midi && f.row('Notes', (
        <>
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.ui}` }}>Pad 1 is</span>
          <NumberInput value={l.baseNote} min={0} max={127} step={1} title={`The note pad 1 plays (${smNoteName(l.baseNote)}); every pad is a note up from it`} onCommit={n => f.set({ baseNote: Math.max(0, Math.min(127, Math.round(n))) })} style={f.numStyle} />
          <span style={{ color: tk.text.faint, font: `11px ${fontFamily.mono}` }}>{smNoteName(l.baseNote)}</span>
          <Select ariaLabel="MIDI channel" value={String(l.channel)} height={26} options={[{ value: '0', label: 'Any channel' }, ...Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: `Channel ${i + 1}` }))]} onChange={v => f.set({ channel: Number(v) })} />
        </>
      ), 'Pad 1’s note (C1 = 36, a drum rack’s): actions’ “Play pad N” and takes count pads from it. Notes on another channel are left alone.')}
      {l.view === 'drum' && f.toggle('Pad grid', 'grid', 'The grid’s lower-left 4 × 4', 'With a pad grid set up (MIDI settings), its lower-left 4 × 4 pads (or the on-screen grid) play the 16 pads in view.')}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {!mine && <Button size="sm" icon="wave" onClick={listenHere} title="Point the setup’s audio readers at this Sampler">Readers listen here</Button>}
        <Button size="sm" variant={mine ? 'primary' : 'ghost'} icon="wave" onClick={openReaders} title="The spectrum and readers, listening to this Sampler">Audio readers…</Button>
      </div>
      {mine && <div style={{ marginTop: 6 }}><ReaderDots play={ctx.play} input={padsReaderInput(l.id)} compact /></div>}
      {note(tk, 'Actions play it too (Do: Play pad N, from any trigger or signal). Takes record every hit; a render plays each where it landed. The effect chain is in Finish → Sound.')}
    </Section>
  );
}
