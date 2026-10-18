/**
 * Audio Source's big window (docs/audio-tools.md), opened with Open ↗ on its card:
 *
 * - **The file's whole waveform** (decoded once: the audio engine's peaks) with In / Out handles to trim; playback
 *   loops inside the trim, the playhead shows where it is. Mic and Video: a live scrolling waveform instead.
 * - **The live spectrum** (log frequency, labelled in Hz). Drag across it to add a band; drag a band's edge to move it.
 * - **Quick bands** (Sub, Bass, Kick, Snare, Hi-hat, Vocals, Air) and **the band list**: each band's name, colour,
 *   Low / High Hz, and what it sends out (Value with Attack / Release / Gain, Trigger with Sensitivity / Cooldown),
 *   with its live level and a flash on each hit. Every band is an output on the node (lib/audioTools/bands.ts).
 *
 * - **Learn a sound** (lib/audioTools/learn.ts): select a moment on the waveform (Drag: Select) or trim to it, press
 *   Learn, and the strongest hit in it becomes a learned sound: a row with its fingerprint, Match and Cooldown, and
 *   Trigger / Match outputs on the node. On the Mic (or after a file played), Learn last hit takes the last seconds heard.
 *
 * Moving a band or the trim changes only what the engine reads (`live`: no recompile); adding, removing, renaming a
 * band or a sound, or changing what it sends, changes the node's outputs, so those recompile. Match, Cooldown and
 * Re-learn are live.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { audioSoundsOf, audioSourceKind, type AudioSourceKind } from '../../nodes/definitions/audioTools';
import { findNodeDeep } from '../../lib/audioTools/graphWalk';
import { LEARN_BANDS, newSound, type AudioSoundSpec, type LearnResult } from '../../lib/audioTools/learn';
import { audioToolsEngine } from '../../lib/audioTools/engine';
import { audioEngine } from '../../lib/audioEngine';
import { liveAudio } from '../../lib/liveAudio';
import { BAND_MAX_HZ, BAND_MIN_HZ, BAND_QUICK_PRESETS, MIN_TRIM, bandsOf, newBand, trimWindow, type AudioBandSpec } from '../../lib/audioTools/bands';
import { hzAt, spectrumBins, xOfHz } from '../../lib/audioTools/dsp';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { NumberInput } from '../NodeGraph/NumberInput';
import { addDrawer } from './drawLoop';
import { StemControls } from './StemControls';
import { STEM_LABELS } from '../../stemModel/config';

const BG = '#11111b', ACCENT = '#b4befe', DIM = 'rgba(180,190,254,0.18)', GRID = 'rgba(205,214,244,0.12)', LABEL = 'rgba(205,214,244,0.6)';
const HZ_LABELS = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const xOf = (hz: number) => xOfHz(hz, 'log', BAND_MIN_HZ, BAND_MAX_HZ);
const hzOf = (x: number) => Math.round(hzAt(Math.max(0, Math.min(1, x)), 'log', BAND_MIN_HZ, BAND_MAX_HZ));
const fmtHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${hz}`);
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
const SPEC_BINS = 160;
const MIC_HISTORY = 400;

/** Size a canvas to its box at the device pixel ratio; the 2D context in CSS pixels. */
function fit(c: HTMLCanvasElement | null): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  if (!c) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = c.clientHeight;
  if (!w || !h) return null;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const g = c.getContext('2d');
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

type TrimDrag = { which: 'in' | 'out' | 'new' | 'select'; anchor: number; start: number; end: number };
type Span = { start: number; end: number };
const SELECT = '#a6e3a1';
type SpecDrag = { kind: 'new'; a: number; b: number } | { kind: 'edge'; id: string; edge: 'lo' | 'hi' };

export function AudioSourceWindow({ nodeId, onClose, onLoad }: { nodeId: string; onClose: () => void; onLoad: () => void }) {
  const tk = useTokens();
  const node = useNodeGraphStore(s => findNodeDeep(s.nodes, nodeId));
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef<HTMLCanvasElement>(null);
  const meterRefs = useRef(new Map<string, HTMLCanvasElement>());
  const soundRefs = useRef(new Map<string, HTMLCanvasElement>());
  const [selected, setSelected] = useState<string | null>(null);
  /** Dragging on the waveform trims, or selects a moment to learn from. */
  const [dragMode, setDragMode] = useState<'trim' | 'select'>('trim');
  const [selection, setSelection] = useState<Span | null>(null);
  const [learnMsg, setLearnMsg] = useState('');
  const trimDrag = useRef<TrimDrag | null>(null);
  const specDrag = useRef<SpecDrag | null>(null);
  const [, redraw] = useState(0);
  // What the drawer reads (the latest node, without restarting the loop).
  const latest = useRef({ bands: [] as AudioBandSpec[], sounds: [] as AudioSoundSpec[], trimIn: 0, trimOut: 0, selected: null as string | null, selection: null as Span | null });
  const bands = node ? bandsOf(node.params) : [];
  const sounds = node ? audioSoundsOf(node.params) : [];
  const trimIn = Number(node?.params.trimIn ?? 0), trimOut = Number(node?.params.trimOut ?? 0);
  useEffect(() => { latest.current = { bands, sounds, trimIn, trimOut, selected, selection }; });

  useEffect(() => {
    const row = new Float32Array(SPEC_BINS);
    const mic = new Float32Array(MIC_HISTORY);
    let micAt = 0, seen = -1;
    return addDrawer(() => {
      const v = audioToolsEngine.sourceView(nodeId);
      if (!v) return;
      const fresh = audioToolsEngine.frame !== seen;
      seen = audioToolsEngine.frame;
      const L = latest.current;
      // ── Waveform ──
      const wv = fit(waveRef.current);
      if (wv) {
        const { g, w, h } = wv;
        g.fillStyle = BG; g.fillRect(0, 0, w, h);
        const mid = h / 2;
        if (v.kind === 'file' && v.loaded && v.duration > 0) {
          // With a stem picked, its waveform (what Learn and the bands hear), on the song's time line.
          const peaks = audioEngine.peaks(nodeId, Math.min(2000, Math.max(200, Math.round(w))), v.stem !== 'mix');
          const d = trimDrag.current;
          const win = d ? { start: d.start, end: d.end } : trimWindow(v.duration, L.trimIn, L.trimOut);
          const xa = (win.start / v.duration) * w, xb = (win.end / v.duration) * w;
          if (peaks) {
            const bw = w / peaks.length;
            for (let i = 0; i < peaks.length; i++) {
              const x = i * bw, inside = x >= xa && x <= xb, a = peaks[i] * (mid - 4);
              g.fillStyle = inside ? ACCENT : DIM;
              g.fillRect(x, mid - a, Math.max(1, bw), Math.max(1, a * 2));
            }
          }
          g.fillStyle = 'rgba(17,17,27,0.55)'; g.fillRect(0, 0, xa, h); g.fillRect(xb, 0, w - xb, h);
          for (const x of [xa, xb]) { g.fillStyle = '#f9e2af'; g.fillRect(x - 1, 0, 2, h); g.fillRect(x - 5, 0, 10, 8); }
          // The moment selected to learn from.
          const sel = d?.which === 'select' ? { start: d.start, end: d.end } : L.selection;
          if (sel) {
            const sa = (sel.start / v.duration) * w, sb = (sel.end / v.duration) * w;
            g.fillStyle = 'rgba(166,227,161,0.22)'; g.fillRect(sa, 0, Math.max(1, sb - sa), h);
            g.fillStyle = SELECT; g.fillRect(sa, h - 3, Math.max(1, sb - sa), 3);
          }
          const px = (v.time / v.duration) * w;
          g.fillStyle = '#ffffff'; g.fillRect(px - 0.5, 0, 1.5, h);
        } else if (v.kind !== 'file') {
          if (fresh && v.active) {
            let m = 0;
            for (let i = 0; i < v.wave.length; i++) m = Math.max(m, Math.abs(v.wave[i]));
            mic[micAt] = Math.min(1, m); micAt = (micAt + 1) % MIC_HISTORY;
          }
          const bw = w / MIC_HISTORY;
          g.fillStyle = ACCENT;
          for (let i = 0; i < MIC_HISTORY; i++) { const a = mic[(micAt + i) % MIC_HISTORY] * (mid - 4); g.fillRect(i * bw, mid - a, Math.max(1, bw), Math.max(1, a * 2)); }
        } else {
          g.fillStyle = LABEL; g.font = `12px ${fontFamily.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText('Load a sound, or switch to Mic.', w / 2, mid);
        }
      }
      // ── Spectrum ──
      const sp = fit(specRef.current);
      if (sp) {
        const { g, w, h } = sp;
        const axis = 16, sh = h - axis;
        g.fillStyle = BG; g.fillRect(0, 0, w, h);
        g.font = `10px ${fontFamily.ui}`; g.textAlign = 'center'; g.textBaseline = 'top';
        for (const hz of HZ_LABELS) {
          const x = xOf(hz) * w;
          g.fillStyle = GRID; g.fillRect(x, 0, 1, sh);
          g.fillStyle = LABEL; g.fillText(`${fmtHz(hz)} Hz`, x, sh + 3);
        }
        for (const b of L.bands) {
          const x0 = xOf(b.lo) * w, x1 = xOf(b.hi) * w, lv = v.bands.get(b.id);
          const flash = lv ? Math.max(0, 1 - (performance.now() - lv.hitAt) / 250) : 0;
          g.fillStyle = `${b.color}${L.selected === b.id ? '40' : '26'}`; g.fillRect(x0, 0, x1 - x0, sh);
          if (flash > 0) { g.fillStyle = `${b.color}${Math.round(flash * 120).toString(16).padStart(2, '0')}`; g.fillRect(x0, 0, x1 - x0, sh); }
          if (lv) { g.fillStyle = b.color; g.fillRect(x0, sh - 4 - (sh - 20) * lv.level, x1 - x0, 2); }
          g.fillStyle = b.color; g.fillRect(x0, 0, 1.5, sh); g.fillRect(x1 - 1.5, 0, 1.5, sh);
          g.textAlign = 'left'; g.fillText(b.name, x0 + 4, 4); g.textAlign = 'center';
        }
        spectrumBins(v.freq, v.sampleRate, row, 'log', -90, -20, 0.5);
        g.fillStyle = 'rgba(205,214,244,0.75)';
        const bw = w / SPEC_BINS;
        for (let i = 0; i < SPEC_BINS; i++) { const a = row[i] * (sh - 18); g.fillRect(i * bw, sh - a, Math.max(1, bw - 0.5), a); }
        const d = specDrag.current;
        if (d?.kind === 'new') {
          const a = Math.min(d.a, d.b) * w, b = Math.max(d.a, d.b) * w;
          g.fillStyle = 'rgba(249,226,175,0.25)'; g.fillRect(a, 0, b - a, sh);
          g.fillStyle = '#f9e2af'; g.textAlign = 'center';
          g.fillText(`${fmtHz(hzOf(Math.min(d.a, d.b)))}–${fmtHz(hzOf(Math.max(d.a, d.b)))} Hz`, (a + b) / 2, 4);
        }
      }
      // ── Band meters ──
      for (const b of L.bands) {
        const m = fit(meterRefs.current.get(b.id) ?? null), lv = v.bands.get(b.id);
        if (!m) continue;
        const { g, w, h } = m;
        g.fillStyle = BG; g.fillRect(0, 0, w, h);
        g.fillStyle = DIM; g.fillRect(0, h / 2 - 3, w - h - 4, 6);
        g.fillStyle = b.color; g.fillRect(0, h / 2 - 3, (w - h - 4) * (lv?.level ?? 0), 6);
        const flash = lv && b.trigger ? Math.max(0, 1 - (performance.now() - lv.hitAt) / 250) : 0;
        g.fillStyle = b.trigger ? `rgba(249,226,175,${0.15 + 0.85 * flash})` : 'transparent';
        g.beginPath(); g.arc(w - h / 2, h / 2, h / 2 - 2, 0, Math.PI * 2); g.fill();
      }
      // ── Learned sounds: the fingerprint's bars, the Match now against its threshold, a flash when it fires ──
      for (const snd of L.sounds) {
        const m = fit(soundRefs.current.get(snd.id) ?? null), lv = v.sounds.get(snd.id);
        if (!m) continue;
        const { g, w, h } = m;
        const flash = lv ? Math.max(0, 1 - (performance.now() - lv.hitAt) / 300) : 0;
        g.fillStyle = BG; g.fillRect(0, 0, w, h);
        if (flash > 0) { g.fillStyle = `${snd.color}${Math.round(flash * 90).toString(16).padStart(2, '0')}`; g.fillRect(0, 0, w, h); }
        const fh = h - 8, n = snd.spec.length;
        if (n) {
          const lo = Math.min(...snd.spec), hi = Math.max(...snd.spec), bw = w / n;
          g.fillStyle = snd.color;
          for (let i = 0; i < n; i++) { const a = ((snd.spec[i] - lo) / Math.max(1e-6, hi - lo)) * (fh - 2); g.fillRect(i * bw, fh - a, Math.max(1, bw - 0.6), a); }
        }
        g.fillStyle = DIM; g.fillRect(0, h - 5, w, 4);
        g.fillStyle = (lv?.match ?? 0) >= snd.match ? snd.color : LABEL; g.fillRect(0, h - 5, w * (lv?.match ?? 0), 4);
        g.fillStyle = '#ffffff'; g.fillRect(w * snd.match - 1, h - 7, 2, 7);
      }
    });
  }, [nodeId]);

  if (!node) return null;
  const kind = audioSourceKind(node);
  const view = audioToolsEngine.sourceView(nodeId);
  const duration = view?.duration ?? 0;
  const win = trimWindow(duration, node.params.trimIn, node.params.trimOut);
  const playing = node.params.playing !== false;
  const set = (p: Record<string, unknown>, live = false) => update(nodeId, p, live ? { immediate: true, live: true } : { immediate: true });
  /** Bands: a move is live (no recompile); adding, removing, renaming or what a band sends changes the outputs. */
  const setBands = (next: AudioBandSpec[], structural: boolean) => set({ bands: next }, !structural);
  const patchBand = (id: string, p: Partial<AudioBandSpec>, structural = false) => setBands(bands.map(b => (b.id === id ? { ...b, ...p } : b)), structural);
  const addBand = (preset: string | { lo: number; hi: number }) => { const b = newBand(bands, preset); setBands([...bands, b], true); setSelected(b.id); };

  // ── Learned sounds ──
  const takenIds = new Set(bands.map(b => b.id));
  /** Sounds: Match, Cooldown and Re-learn are live; adding, removing, renaming or what one sends changes the outputs. */
  const setSounds = (next: AudioSoundSpec[], structural: boolean) => set({ sounds: next }, !structural);
  const patchSound = (id: string, p: Partial<AudioSoundSpec>, structural = false) => setSounds(sounds.map(q => (q.id === id ? { ...q, ...p } : q)), structural);
  /** Where Learn takes the hit from: the selection, else the trim (a file), or the last seconds heard (`last`, the Mic). */
  const learnSpan = (): Span | null => (selection ?? (duration > 0 ? win : null));
  const learn = (o: { last?: boolean; relearn?: string } = {}) => {
    const last = o.last || kind !== 'file';
    const span = last ? null : learnSpan();
    let r: LearnResult;
    if (!last && !span) r = { error: 'Load a sound first.' };
    else r = audioToolsEngine.learn(nodeId, span ? { from: span.start, to: span.end } : undefined);
    if ('error' in r) { setLearnMsg(r.error); return; }
    const where = last ? 'the last hit heard' : `the hit at ${fmtSec(r.at)}`;
    // A sound waiting to be learned (an example's Clap, already wired) takes the first fingerprint.
    const target = o.relearn ?? sounds.find(q => !q.spec.length)?.id;
    if (target) {
      patchSound(target, { spec: r.spec, env: r.env });
      if (!o.relearn) { setLearnMsg(`Learned ${sounds.find(q => q.id === target)?.name} from ${where}: it fires on sounds like it from now on.`); return; }
      setLearnMsg(`Learned again from ${where}.`);
    } else {
      const snd = newSound(sounds, r, takenIds);
      setSounds([...sounds, snd], true);
      setLearnMsg(`Learned ${snd.name} from ${where}: it fires on sounds like it from now on.`);
    }
  };

  // ── Trim: drag a handle, or drag across to set a new trim ──
  const secAt = (e: RPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration));
  };
  const onWaveDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (kind !== 'file' || !(duration > 0)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect(), t = secAt(e), px = (e.clientX - r.left);
    if (dragMode === 'select') { trimDrag.current = { which: 'select', anchor: t, start: t, end: t }; return; }
    const xa = (win.start / duration) * r.width, xb = (win.end / duration) * r.width;
    const which = Math.abs(px - xa) <= 8 ? 'in' : Math.abs(px - xb) <= 8 ? 'out' : 'new';
    trimDrag.current = { which, anchor: t, start: which === 'new' ? t : win.start, end: which === 'new' ? t : win.end };
  };
  const onWaveMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = trimDrag.current;
    if (!d) return;
    const t = secAt(e);
    if (d.which === 'in') d.start = Math.min(t, d.end - MIN_TRIM);
    else if (d.which === 'out') d.end = Math.max(t, d.start + MIN_TRIM);
    else { d.start = Math.min(d.anchor, t); d.end = Math.max(d.anchor, t); }
  };
  const onWaveUpAny = () => {
    const d = trimDrag.current;
    if (d?.which !== 'select') { onWaveUp(); return; }
    trimDrag.current = null;
    // A click clears the selection; a drag makes one.
    setSelection(d.end - d.start >= 0.02 ? { start: +d.start.toFixed(4), end: +d.end.toFixed(4) } : null);
  };
  const onWaveUp = () => {
    const d = trimDrag.current;
    trimDrag.current = null;
    if (!d) return;
    // A click without a drag leaves the trim as it was.
    if (d.which === 'new' && d.end - d.start < MIN_TRIM) return;
    set({ trimIn: +Math.max(0, d.start).toFixed(4), trimOut: d.end >= duration - 1e-3 ? 0 : +d.end.toFixed(4) }, true);
  };

  // ── Spectrum: drag across empty space to add a band, drag a band's edge to move it, click a band to pick it ──
  const xAt = (e: RPointerEvent<HTMLCanvasElement>) => { const r = e.currentTarget.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const onSpecDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect(), x = xAt(e), px = x * r.width;
    for (const b of [...bands].reverse()) {
      for (const edge of ['lo', 'hi'] as const) if (Math.abs(xOf(b[edge]) * r.width - px) <= 6) { specDrag.current = { kind: 'edge', id: b.id, edge }; setSelected(b.id); return; }
    }
    const inside = [...bands].reverse().find(b => x >= xOf(b.lo) && x <= xOf(b.hi));
    if (inside) { setSelected(inside.id); return; }
    specDrag.current = { kind: 'new', a: x, b: x };
  };
  const onSpecMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = specDrag.current;
    if (!d) return;
    const x = xAt(e);
    if (d.kind === 'new') { d.b = x; return; }
    const b = bands.find(q => q.id === d.id);
    if (!b) return;
    const hz = hzOf(x);
    patchBand(b.id, d.edge === 'lo' ? { lo: Math.min(hz, b.hi - 1) } : { hi: Math.max(hz, b.lo + 1) });
  };
  const onSpecUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = specDrag.current;
    specDrag.current = null;
    if (d?.kind !== 'new') return;
    const r = e.currentTarget.getBoundingClientRect();
    if (Math.abs(d.b - d.a) * r.width < 6) return;
    addBand({ lo: hzOf(Math.min(d.a, d.b)), hi: hzOf(Math.max(d.a, d.b)) });
  };

  const head: CSSProperties = { font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint };
  const small: CSSProperties = { font: `500 11.5px ${fontFamily.ui}`, color: tk.text.muted };
  const numStyle: CSSProperties = {
    width: 54, font: `500 11.5px ${fontFamily.mono}`, color: tk.text.primary, background: tk.bg.panel,
    border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px', boxSizing: 'border-box',
  };
  const field = (label: string, value: number, onCommit: (v: number) => void, o: { step?: number; min?: number; max?: number; title: string; disabled?: boolean }) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 4, ...small, opacity: o.disabled ? 0.45 : 1 }} title={o.title}>
      {label}<NumberInput value={value} step={o.step} min={o.min} max={o.max} disabled={o.disabled} style={numStyle} onCommit={onCommit} />
    </label>
  );

  return (
    <Modal title={typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Audio Source'}
      subtitle={kind === 'file' ? 'Audio Source · trim the file, pick frequency bands, learn sounds' : kind === 'video' ? 'Audio Source · a video\'s sound, its frequency bands and learned sounds' : 'Audio Source · the Mic, its frequency bands and learned sounds'}
      icon="wave" width={1240} height={800} onClose={onClose} headerActions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div data-audio-source-window style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16, height: '100%', boxSizing: 'border-box', overflowY: 'auto', font: `500 12px ${fontFamily.ui}` }}>
        {/* Transport */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ width: 220 }}>
            <Segmented<AudioSourceKind> size="sm" fill ariaLabel="Source" value={kind} onChange={v => set({ source: v })} options={[{ value: 'file', label: 'File' }, { value: 'mic', label: 'Mic' }, { value: 'video', label: 'Video' }]} />
          </div>
          <Button size="sm" onClick={() => set({ playing: !playing })}>{playing ? 'Pause' : 'Play'}</Button>
          {kind === 'file' && <Toggle checked={node.params.loop !== false} onChange={c => set({ loop: c })} label="Loop" />}
          {field('Gain', Number(node.params.gain ?? 1), v => set({ gain: Math.max(0, v) }, true), { step: 0.05, min: 0, title: 'How loud the bands and the listening nodes hear it (not how loud you hear it).' })}
          {kind === 'file' && <Button size="sm" onClick={onLoad}>{view?.loaded ? 'Replace…' : 'Load a sound…'}</Button>}
          {kind === 'mic' && !liveAudio.isOn() && <Button size="sm" onClick={() => { void audioToolsEngine.startMic(nodeId); redraw(x => x + 1); }}>Start</Button>}
          <span style={{ ...small, marginLeft: 'auto' }}>{audioToolsEngine.status(nodeId)}</span>
        </div>

        {/* Stems */}
        {kind === 'file' && <>
          <span style={head}>Stems · split the song on this device, then pick what everything listening hears</span>
          <StemControls node={node} loaded={!!view?.loaded} />
        </>}

        {/* Waveform + trim */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={head}>{kind === 'file' ? `${view?.stem && view.stem !== 'mix' ? `Waveform (${STEM_LABELS[view.stem]})` : 'Waveform'} · ${dragMode === 'trim' ? 'drag the yellow handles (or across) to trim: it loops inside' : 'drag across one hit of a sound to learn it'}` : 'Live waveform'}</span>
          {kind === 'file' && <div style={{ width: 190, marginLeft: 'auto' }}>
            <Segmented<'trim' | 'select'> size="sm" fill ariaLabel="Drag on the waveform to" value={dragMode} onChange={setDragMode} options={[{ value: 'trim', label: 'Drag: Trim' }, { value: 'select', label: 'Drag: Select' }]} />
          </div>}
        </div>
        <canvas ref={waveRef} data-audio-wave onPointerDown={onWaveDown} onPointerMove={onWaveMove} onPointerUp={onWaveUpAny}
          style={{ width: '100%', height: 120, borderRadius: radius.md, display: 'block', cursor: kind === 'file' && duration > 0 ? 'ew-resize' : 'default', touchAction: 'none' }} />
        {kind === 'file' && duration > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {field('In', +win.start.toFixed(3), v => set({ trimIn: Math.max(0, Math.min(v, win.end - MIN_TRIM)) }, true), { step: 0.01, min: 0, title: 'Where the trim starts, in seconds.' })}
          {field('Out', +win.end.toFixed(3), v => set({ trimOut: v >= duration ? 0 : Math.max(win.start + MIN_TRIM, v) }, true), { step: 0.01, min: 0, title: 'Where the trim ends, in seconds.' })}
          <span style={small}>{fmtSec(win.end - win.start)} of {fmtSec(duration)}</span>
          <Button size="sm" disabled={win.start <= 0 && win.end >= duration} onClick={() => set({ trimIn: 0, trimOut: 0 }, true)}>Whole file</Button>
          {selection && <span style={{ ...small, color: SELECT }}>Selected {fmtSec(selection.start)}–{fmtSec(selection.end)}</span>}
          {selection && <Button size="sm" variant="ghost" onClick={() => setSelection(null)}>Clear selection</Button>}
        </div>}

        {/* Spectrum + bands */}
        <span style={head}>Spectrum · drag across it to add a band, drag a band's edge to move it</span>
        <canvas ref={specRef} data-audio-spectrum onPointerDown={onSpecDown} onPointerMove={onSpecMove} onPointerUp={onSpecUp}
          style={{ width: '100%', height: 200, borderRadius: radius.md, display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={small}>Add a band:</span>
          {BAND_QUICK_PRESETS.map(p => (
            <Button key={p.key} size="sm" data-band-preset={p.key} onClick={() => addBand(p.key)}
              title={`${p.name}: ${fmtHz(p.lo)}–${fmtHz(p.hi)} Hz, sends ${p.trigger ? 'a Trigger on each hit' : 'its level'}`}>{p.name}</Button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!bands.length && <span style={small}>No bands yet. Each band you add becomes an output on the Audio Source: its level (Value) or a Trigger on each hit in it.</span>}
          {bands.map(b => (
            <div key={b.id} data-band-row={b.id} onClick={() => setSelected(b.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px', borderRadius: radius.md, border: `1px solid ${selected === b.id ? b.color : tk.border.default}`, background: tk.bg.field }}>
              <input type="color" value={b.color} onChange={e => patchBand(b.id, { color: e.target.value })} title="The band's colour" style={{ width: 22, height: 22, border: 0, padding: 0, background: 'none', cursor: 'pointer' }} />
              <input defaultValue={b.name} key={`${b.id}:${b.name}`} aria-label="Band name" title="The band's name: its outputs take it"
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== b.name) patchBand(b.id, { name: v }, true); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={{ width: 84, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, background: 'transparent', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px' }} />
              {field('Low', b.lo, v => patchBand(b.id, { lo: Math.max(BAND_MIN_HZ, Math.min(v, b.hi - 1)) }), { step: 1, min: BAND_MIN_HZ, max: BAND_MAX_HZ, title: 'The band\'s bottom, in Hz.' })}
              {field('High', b.hi, v => patchBand(b.id, { hi: Math.min(BAND_MAX_HZ, Math.max(v, b.lo + 1)) }), { step: 1, min: BAND_MIN_HZ, max: BAND_MAX_HZ, title: 'The band\'s top, in Hz.' })}
              <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />
              <Toggle checked={b.value} onChange={c => patchBand(b.id, c || b.trigger ? { value: c } : { value: false, trigger: true }, true)} label="Value" />
              {field('Attack', b.attack, v => patchBand(b.id, { attack: Math.max(0, v) }), { step: 0.01, min: 0, title: 'Seconds the Value takes to rise.', disabled: !b.value })}
              {field('Release', b.release, v => patchBand(b.id, { release: Math.max(0, v) }), { step: 0.01, min: 0, title: 'Seconds the Value takes to fall back.', disabled: !b.value })}
              {field('Gain', b.gain, v => patchBand(b.id, { gain: Math.max(0, v) }), { step: 0.05, min: 0, title: 'Scales the Value (it stops at 1).', disabled: !b.value })}
              <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />
              <Toggle checked={b.trigger} onChange={c => patchBand(b.id, c || b.value ? { trigger: c } : { trigger: false, value: true }, true)} label="Trigger" />
              {field('Sensitivity', b.sensitivity, v => patchBand(b.id, { sensitivity: Math.max(0, Math.min(1, v)) }), { step: 0.05, min: 0, max: 1, title: 'Higher catches quieter hits (and more false ones).', disabled: !b.trigger })}
              {field('Cooldown', b.cooldown, v => patchBand(b.id, { cooldown: Math.max(40, v) }), { step: 10, min: 40, title: 'Milliseconds after a hit before the next can count.', disabled: !b.trigger })}
              <canvas ref={c => { if (c) meterRefs.current.set(b.id, c); else meterRefs.current.delete(b.id); }} style={{ width: 84, height: 18, display: 'block', marginLeft: 'auto' }} title="The band now: its level, and a flash on each hit" />
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setBands(bands.filter(q => q.id !== b.id), true); }} title="Remove the band (and its outputs' wires)">✕</Button>
            </div>
          ))}
        </div>

        {/* Learn a sound */}
        <span style={head}>Learned sounds · fire on any sound like the one you show it</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {kind === 'file' && <Button size="sm" variant="primary" data-learn onClick={() => learn()} disabled={!(duration > 0)}
            title="Learn the strongest hit in the selection (Drag: Select), or in the trim when nothing is selected">Learn</Button>}
          <Button size="sm" data-learn-last onClick={() => learn({ last: true })}
            title="Learn the strongest hit in the last two seconds heard">Learn last hit</Button>
          <span style={small}>{learnMsg || (kind === 'file'
            ? (selection ? 'Learn takes the strongest hit in the selection.' : 'Select one hit (Drag: Select) or trim to it, then press Learn.')
            : kind === 'video' ? 'Play the video, then press Learn last hit just after the sound.' : 'Play the sound into the Mic, then press Learn last hit.')}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sounds.map(snd => (
            <div key={snd.id} data-sound-row={snd.id}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px', borderRadius: radius.md, border: `1px solid ${tk.border.default}`, background: tk.bg.field }}>
              <input type="color" value={snd.color} onChange={e => patchSound(snd.id, { color: e.target.value })} title="The sound's colour" style={{ width: 22, height: 22, border: 0, padding: 0, background: 'none', cursor: 'pointer' }} />
              <input defaultValue={snd.name} key={`${snd.id}:${snd.name}`} aria-label="Sound name" title="The sound's name: its outputs take it"
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== snd.name) patchSound(snd.id, { name: v }, true); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={{ width: 84, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, background: 'transparent', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px' }} />
              <canvas ref={c => { if (c) soundRefs.current.set(snd.id, c); else soundRefs.current.delete(snd.id); }} style={{ width: 132, height: 26, display: 'block', borderRadius: radius.sm }}
                title={snd.spec.length === LEARN_BANDS ? 'Its fingerprint (low to high frequency), and how close the last hit was (the bar; the white tick is Match). Flashes when it fires.' : 'Nothing learned yet: press Re-learn.'} />
              {field('Match', snd.match, v => patchSound(snd.id, { match: Math.max(0, Math.min(1, v)) }), { step: 0.01, min: 0, max: 1, title: 'How alike a hit must be to fire, 0–1: higher only fires on very close matches.' })}
              {field('Cooldown', snd.cooldown, v => patchSound(snd.id, { cooldown: Math.max(40, v) }), { step: 10, min: 40, title: 'Milliseconds after it fires before it can fire again.' })}
              <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />
              <Toggle checked={snd.trigger} onChange={c => patchSound(snd.id, c || snd.matchOut ? { trigger: c } : { trigger: false, matchOut: true }, true)} label="Trigger" />
              <Toggle checked={snd.matchOut} onChange={c => patchSound(snd.id, c || snd.trigger ? { matchOut: c } : { matchOut: false, trigger: true }, true)} label="Match" />
              <span style={{ marginLeft: 'auto' }} />
              <Button size="sm" onClick={() => learn({ relearn: snd.id })} title={kind === 'file' ? 'Learn it (again) from the selection, or the trim' : 'Learn it (again) from the last hit heard'}>{snd.spec.length ? 'Re-learn' : 'Learn'}</Button>
              <Button size="sm" variant="ghost" onClick={() => setSounds(sounds.filter(q => q.id !== snd.id), true)} title="Remove the sound (and its outputs' wires)">✕</Button>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
