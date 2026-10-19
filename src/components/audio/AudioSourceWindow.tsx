/**
 * Audio Source's big window (docs/audio-tools.md), opened with Open ↗ on its card:
 *
 * - **The file's whole waveform** (decoded once: the audio engine's peaks) with In / Out handles to trim; playback
 *   loops inside the trim, the playhead shows where it is. Mic and Video: a live scrolling waveform instead.
 * - **The bands as an equaliser** (BandEqEditor.tsx): the live spectrum with each band a handle on its curve
 *   (Band, Low cut, High cut); double-click to add one, drag to move it, scroll for its width, its floating panel
 *   for the rest (Solo, Shape, Slope). **Hear hovered**: while on, only the frequencies under the pointer play.
 * - **Quick bands** (Sub, Bass, Kick, Snare, Hi-hat, Vocals, Air) and **the band list**: each band's name, colour,
 *   Low / High Hz, and what it sends out (Value with Attack / Release / Gain, Trigger with Threshold / Release / Gate /
 *   Min time / Cooldown and Learn noise), with its live level and a flash on each hit. Every band is an output on the
 *   node (lib/audioTools/bands.ts).
 * - **The trigger scope** under each trigger band: the last seconds of the level its trigger measures, the Threshold
 *   line (drag it), the Release and Gate lines (drag them too) and a tick where it fired, so it is tuned by eye. A File's
 *   comes from the file analysed ahead, lined up with what is heard. A band's **Detect** (Level, Hits, Transient,
 *   Noisy ↔ tonal, Brightness, Drums only) and **Only** (any / noisy / tonal) pick what it measures; with a feature
 *   picked the scope draws that curve, the level faint behind it (the Gate reads the level). **Add a detector** adds
 *   bands with their Detect set (Kick, Snare, Hats, Melody notes).
 * - **The transport** (AudioTransport.tsx, as on the card): Play / Pause, Restart, Mute, Volume; then Loop, Gain and
 *   Sync offset (ms added to when its triggers fire, on top of the output latency taken off by itself).
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
import { audioToolsEngine, type BandView } from '../../lib/audioTools/engine';
import { audioEngine } from '../../lib/audioEngine';
import { liveAudio } from '../../lib/liveAudio';
import {
  BAND_CHARACTERS, BAND_DETECTS, BAND_DETECT_PRESETS, BAND_MAX_HZ, BAND_MIN_HZ, BAND_QUICK_PRESETS, MIN_TRIM, bandsOf, newBand, trimWindow,
  type AudioBandCharacter, type AudioBandDetect, type AudioBandSpec,
} from '../../lib/audioTools/bands';
import { Select } from '../ui/Select';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Segmented, Toggle } from '../ui/Choice';
import { NumberInput } from '../NodeGraph/NumberInput';
import { addDrawer } from './drawLoop';
import { BandEqEditor, type Hearing } from './BandEqEditor';
import { isBandDeleteKey } from './bandEq';
import { AudioTransport } from './AudioTransport';

const HIT_TICK = 'rgba(249,226,175,0.9)';
const BG = '#11111b', ACCENT = '#b4befe', DIM = 'rgba(180,190,254,0.18)', LABEL = 'rgba(205,214,244,0.6)';
const fmtHz = (hz: number) => (hz >= 1000 ? `${+(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k` : `${hz}`);
const fmtSec = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`;
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

type ScopeLine = 'threshold' | 'release' | 'gate';
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** The scope's level scale: 0 at the bottom, 1 at the top, with a little room. */
const SCOPE_PAD = 6;
const scopeY = (v: number, h: number) => SCOPE_PAD + (1 - clamp01(v)) * (h - SCOPE_PAD * 2);
const scopeValueAt = (y: number, h: number) => 1 - (y - SCOPE_PAD) / Math.max(1, h - SCOPE_PAD * 2);

/** Whether a band has a scope: a trigger, or a Value that reads a feature (its curve is worth seeing). */
const hasScope = (b: AudioBandSpec) => b.trigger || b.detect !== 'level';
const detectLabel = (b: AudioBandSpec) => BAND_DETECTS.find(d => d.key === b.detect)?.label ?? 'Level';

/**
 * A band's scope: what its trigger measured lately (oldest left; the level, or the feature its Detect picked, then
 * with the level faint behind it, as the Gate reads that), its lines, and a tick where it fired.
 */
function drawScope(g: CanvasRenderingContext2D, w: number, h: number, b: AudioBandSpec, bv: BandView | null) {
  g.fillStyle = BG; g.fillRect(0, 0, w, h);
  // Under the Gate: silence.
  const gy = scopeY(b.gate, h);
  g.fillStyle = 'rgba(205,214,244,0.06)'; g.fillRect(0, gy, w, h - gy);
  const line = (v: number, color: string, dash: number[], width: number) => {
    const y = Math.round(scopeY(v, h)) + 0.5;
    g.strokeStyle = color; g.lineWidth = width; g.setLineDash(dash);
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    g.setLineDash([]);
  };
  const feature = b.detect !== 'level';
  if (bv) {
    const sc = bv.scope, n = sc.vals.length, dx = w / (n - 1);
    const trace = (arr: Float32Array, stroke: string, width: number) => {
      g.beginPath();
      for (let k = 0; k < n; k++) { const v = arr[(sc.at + k) % n], x = k * dx, y = scopeY(v, h); if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.strokeStyle = stroke; g.lineWidth = width; g.stroke();
    };
    if (feature) trace(sc.lvls, 'rgba(205,214,244,0.28)', 1);
    trace(sc.vals, feature ? b.color : 'rgba(205,214,244,0.85)', feature ? 1.5 : 1.25);
    g.fillStyle = HIT_TICK;
    if (b.trigger) for (let k = 0; k < n; k++) if (sc.hits[(sc.at + k) % n]) { const x = k * dx; g.fillRect(x - 1, 0, 2, h); }
  }
  line(b.gate, 'rgba(205,214,244,0.45)', [2, 3], 1);
  g.font = `10px ${fontFamily.ui}`; g.textAlign = 'right'; g.textBaseline = 'bottom';
  const tag = (text: string, v: number, color: string) => { g.fillStyle = color; g.fillText(text, w - 4, scopeY(v, h) - 2); };
  if (b.trigger) {
    line(b.threshold * b.releaseAt, b.color, [5, 4], 1);
    line(b.threshold, b.color, [], 2);
    tag(`Threshold ${b.threshold.toFixed(2)}`, b.threshold, b.color);
    if (Math.abs(scopeY(b.threshold * b.releaseAt, h) - scopeY(b.threshold, h)) > 11) tag(`Release ${(b.threshold * b.releaseAt).toFixed(2)}`, b.threshold * b.releaseAt, b.color);
  }
  if (b.gate > 0 && (!b.trigger || Math.abs(scopeY(b.gate, h) - scopeY(b.threshold * b.releaseAt, h)) > 11)) tag(`Gate ${b.gate.toFixed(2)}${feature ? ' (level)' : ''}`, b.gate, LABEL);
  g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = LABEL;
  const what = feature ? `${detectLabel(b)} (level faint)` : 'Level';
  const only = b.trigger && b.character !== 'any' && b.detect !== 'flatness' && b.detect !== 'brightness' ? ` · only ${b.character}` : '';
  g.fillText(bv
    ? `${what}${only} · ${bv.ahead ? 'analysed ahead · ' : ''}${bv.gateOpen ? 'gate open' : 'gate shut'}${b.trigger ? ` · ${bv.armed ? 'armed' : 'waiting to fall below Release'} · ${bv.count} hits` : ''}`
    : `${what} · not running`, 4, 3);
}

type TrimDrag = { which: 'in' | 'out' | 'new' | 'select'; anchor: number; start: number; end: number };
type Span = { start: number; end: number };
const SELECT = '#a6e3a1';

export function AudioSourceWindow({ nodeId, onClose, onLoad }: { nodeId: string; onClose: () => void; onLoad: () => void }) {
  const tk = useTokens();
  const node = useNodeGraphStore(s => findNodeDeep(s.nodes, nodeId));
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const waveRef = useRef<HTMLCanvasElement>(null);
  const meterRefs = useRef(new Map<string, HTMLCanvasElement>());
  const soundRefs = useRef(new Map<string, HTMLCanvasElement>());
  const scopeRefs = useRef(new Map<string, HTMLCanvasElement>());
  /** The line being dragged on a band's scope. */
  const scopeDrag = useRef<{ id: string; line: ScopeLine } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Dragging on the waveform trims, or selects a moment to learn from. */
  const [dragMode, setDragMode] = useState<'trim' | 'select'>('trim');
  const [selection, setSelection] = useState<Span | null>(null);
  const [learnMsg, setLearnMsg] = useState('');
  const trimDrag = useRef<TrimDrag | null>(null);
  const [, redraw] = useState(0);
  // What the drawer reads (the latest node, without restarting the loop).
  const latest = useRef({ bands: [] as AudioBandSpec[], sounds: [] as AudioSoundSpec[], trimIn: 0, trimOut: 0, selected: null as string | null, selection: null as Span | null });
  const bands = node ? bandsOf(node.params) : [];
  const sounds = node ? audioSoundsOf(node.params) : [];
  const trimIn = Number(node?.params.trimIn ?? 0), trimOut = Number(node?.params.trimOut ?? 0);
  useEffect(() => { latest.current = { bands, sounds, trimIn, trimOut, selected, selection }; });
  /** Removes a band (set each render: it writes the latest bands). */
  const removeBandRef = useRef<(id: string) => void>(() => {});
  // Delete / Backspace in the window removes the selected band, wherever the focus is (a row clicked, the panel's
  // buttons, the spectrum), and never reaches the graph: there it would delete the Audio Source node itself (it is
  // the selected node behind the window), closing the window and dropping its wires. The capture phase on window
  // runs before the app's shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isBandDeleteKey(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const L = latest.current;
      if (L.selected && L.bands.some(b => b.id === L.selected)) removeBandRef.current(L.selected);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
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
          const peaks = audioEngine.peaks(nodeId, Math.min(2000, Math.max(200, Math.round(w))));
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
      // ── Trigger scopes: the measured level, the Threshold / Release / Gate lines, a tick on each hit ──
      for (const b of L.bands) {
        if (!hasScope(b)) continue;
        const m = fit(scopeRefs.current.get(b.id) ?? null), bv = v.bands.get(b.id);
        if (m) drawScope(m.g, m.w, m.h, b, bv ?? null);
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
  const set = (p: Record<string, unknown>, live = false) => update(nodeId, p, live ? { immediate: true, live: true } : { immediate: true });
  /** Bands: a move is live (no recompile); adding, removing, renaming or what a band sends changes the outputs. */
  const setBands = (next: AudioBandSpec[], structural: boolean) => set({ bands: next }, !structural);
  const patchBand = (id: string, p: Partial<AudioBandSpec>, structural = false) => setBands(bands.map(b => (b.id === id ? { ...b, ...p } : b)), structural);
  const addBand = (preset: string | { lo: number; hi: number }) => { const b = newBand(bands, preset); setBands([...bands, b], true); setSelected(b.id); };
  /** Remove a band (and its outputs' wires); let go of it if it was selected. */
  const removeBand = (id: string) => { setBands(bands.filter(q => q.id !== id), true); if (selected === id) setSelected(null); };
  removeBandRef.current = removeBand;
  // The editor's band, its row: picked in one, highlighted (and brought into view) in the other.
  useEffect(() => { if (selected) document.querySelector(`[data-band-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);

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

  // ── Trigger scope: drag a line (the nearest of Threshold, Release, Gate) up or down ──
  const onScope = (e: RPointerEvent<HTMLCanvasElement>, b: AudioBandSpec, phase: 'down' | 'move') => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const val = clamp01(scopeValueAt(e.clientY - r.top, r.height));
    if (phase === 'down') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const y = e.clientY - r.top, near = (v: number) => Math.abs(scopeY(v, r.height) - y);
      const lines: Array<[ScopeLine, number]> = [['threshold', near(b.threshold)], ['release', near(b.threshold * b.releaseAt)], ['gate', near(b.gate)]];
      lines.sort((p, q) => p[1] - q[1]);
      // A Value-only band (a feature's scope) has only its Gate to drag.
      scopeDrag.current = { id: b.id, line: !b.trigger ? 'gate' : lines[0][1] <= 8 ? lines[0][0] : 'threshold' };
      setSelected(b.id);
    } else if (!scopeDrag.current || scopeDrag.current.id !== b.id || !(e.buttons & 1)) return;
    const line = scopeDrag.current!.line;
    const v2 = +val.toFixed(2);
    if (line === 'threshold') patchBand(b.id, { threshold: v2 });
    else if (line === 'release') patchBand(b.id, { releaseAt: b.threshold > 0 ? +clamp01(v2 / b.threshold).toFixed(2) : b.releaseAt });
    else patchBand(b.id, { gate: v2 });
  };

  /** Learn noise: the Gate just over the band's floor (a File's selection, else the last seconds heard). */
  const learnNoise = (b: AudioBandSpec) => {
    const span = kind === 'file' ? selection : null;
    const r = audioToolsEngine.learnNoise(nodeId, b.id, span ? { from: span.start, to: span.end } : undefined);
    if ('error' in r) { setLearnMsg(r.error); return; }
    patchBand(b.id, { gate: r.gate });
    setLearnMsg(`${b.name}: the noise sits at ${r.floor.toFixed(2)}, so its Gate is now ${r.gate.toFixed(2)}.`);
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

  // ── Hear hovered: while on, only the frequencies under the pointer play (BandEqEditor) ──
  const [hearHover, setHearHover] = useState(false);
  const [hearing, setHearing] = useState<Hearing>(null);
  useEffect(() => () => audioToolsEngine.stopAudition(), []);
  useEffect(() => { if (!hearHover) { audioToolsEngine.stopAudition(); setHearing(null); } }, [hearHover]);

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
          <div style={{ minWidth: 300 }}><AudioTransport node={node} /></div>
          {kind === 'file' && <Toggle checked={node.params.loop !== false} onChange={c => set({ loop: c })} label="Loop" />}
          {field('Gain', Number(node.params.gain ?? 1), v => set({ gain: Math.max(0, v) }, true), { step: 0.05, min: 0, title: 'How loud the bands and the listening nodes hear it (not how loud you hear it).' })}
          {kind === 'file' && <Button size="sm" onClick={onLoad}>{view?.loaded ? 'Replace…' : 'Load a sound…'}</Button>}
          {kind === 'mic' && !liveAudio.isOn() && <Button size="sm" onClick={() => { void audioToolsEngine.startMic(nodeId); redraw(x => x + 1); }}>Start</Button>}
          {field('Sync offset', Number(node.params.syncOffset ?? 0), v => set({ syncOffset: Math.max(-500, Math.min(1000, Math.round(v))) }, true), {
            step: 5, min: -500, max: 1000,
            title: `Milliseconds added to when its triggers fire: + if the picture is early, − if it is late. The output's own latency (${view?.latencyMs ?? 0} ms here) is already taken off${kind === 'mic' ? ' (the Mic is heard in the room: only a + offset applies)' : ''}.`,
          })}
          <span style={small} data-audio-sync>{kind === 'file' ? (view?.ahead === 'analysing' ? 'Analysing the file…' : view?.ahead === 'ready' ? 'Triggers: analysed ahead' : '') : 'Triggers: live'}{kind !== 'mic' && view ? ` · output ${view.latencyMs} ms` : ''}</span>
          <span style={{ ...small, marginLeft: 'auto' }}>{audioToolsEngine.status(nodeId)}</span>
        </div>

        {/* Waveform + trim */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={head}>{kind === 'file' ? `Waveform · ${dragMode === 'trim' ? 'drag the yellow handles (or across) to trim: it loops inside' : 'drag across one hit of a sound to learn it'}` : 'Live waveform'}</span>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={head}>Bands · double-click to add one, drag its handle to move it, scroll over it for its width</span>
          {(hearHover || hearing) && <span data-hearing style={{ ...small, color: tk.text.secondary }}>
            {hearing ? `Hearing ${hearing.name ? `${hearing.name}: ` : ''}${Math.round(hearing.lo)}–${Math.round(hearing.hi)} Hz (−3 dB)` : kind === 'file' ? 'Hover the spectrum to hear just those frequencies' : 'Hear hovered works on the File tab'}
          </span>}
          <span style={{ marginLeft: 'auto' }}>
            <Toggle checked={hearHover} onChange={setHearHover} label="Hear hovered" />
          </span>
        </div>
        <BandEqEditor nodeId={nodeId} bands={bands} selected={selected} onSelect={setSelected} patchBand={patchBand} setBands={setBands}
          onAdd={addBand} hearHover={hearHover} onHearing={setHearing} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={small}>Add a band:</span>
          {BAND_QUICK_PRESETS.map(p => (
            <Button key={p.key} size="sm" data-band-preset={p.key} onClick={() => addBand(p.key)}
              title={`${p.name}: ${fmtHz(p.lo)}–${fmtHz(p.hi)} Hz, sends ${p.trigger ? 'a Trigger on each hit' : 'its level'}`}>{p.name}</Button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={small} title="Bands that listen for a kind of sound (their Detect), not just a loudness">Add a detector:</span>
          {BAND_DETECT_PRESETS.map(p => (
            <Button key={p.key} size="sm" data-detect-preset={p.key} onClick={() => addBand(p.key)} title={p.title}>{p.name}</Button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {!bands.length && <span style={small}>No bands yet. Each band you add becomes an output on the Audio Source: its level (Value) or a Trigger on each hit in it.</span>}
          {bands.map(b => (
            <div key={b.id} data-band-row={b.id} onClick={() => setSelected(b.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 8px', borderRadius: radius.md, border: `1px solid ${selected === b.id ? b.color : tk.border.default}`, background: selected === b.id ? `${b.color}1f` : tk.bg.field }}>
              <input type="color" value={b.color} onChange={e => patchBand(b.id, { color: e.target.value })} title="The band's colour" style={{ width: 22, height: 22, border: 0, padding: 0, background: 'none', cursor: 'pointer' }} />
              <input defaultValue={b.name} key={`${b.id}:${b.name}`} aria-label="Band name" title="The band's name: its outputs take it"
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== b.name) patchBand(b.id, { name: v }, true); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                style={{ width: 84, font: `600 12px ${fontFamily.ui}`, color: tk.text.primary, background: 'transparent', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm, padding: '2px 5px' }} />
              {field('Low', b.lo, v => patchBand(b.id, { lo: Math.max(BAND_MIN_HZ, Math.min(v, b.hi - 1)) }), { step: 1, min: BAND_MIN_HZ, max: BAND_MAX_HZ, title: 'The band\'s bottom, in Hz.' })}
              {field('High', b.hi, v => patchBand(b.id, { hi: Math.min(BAND_MAX_HZ, Math.max(v, b.lo + 1)) }), { step: 1, min: BAND_MIN_HZ, max: BAND_MAX_HZ, title: 'The band\'s top, in Hz.' })}
              <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />
              <label data-band-detect={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4, ...small }} title={BAND_DETECTS.find(d => d.key === b.detect)?.title}
                onClick={e => e.stopPropagation()}>
                Detect
                <Select value={b.detect} ariaLabel="Detect" height={24} style={{ minWidth: 118 }}
                  options={BAND_DETECTS.map(d => ({ value: d.key, label: d.label }))}
                  onChange={v => patchBand(b.id, { detect: v as AudioBandDetect })} />
              </label>
              {b.detect !== 'flatness' && b.detect !== 'brightness' && (
                <label data-band-only={b.id} style={{ display: 'flex', alignItems: 'center', gap: 4, ...small, opacity: b.trigger ? 1 : 0.45 }}
                  title="Only: let a hit through when the band is noisy (drums, hats, snares) or tonal (melodic notes) just after it"
                  onClick={e => e.stopPropagation()}>
                  Only
                  <Select value={b.character} ariaLabel="Only" height={24} style={{ minWidth: 70 }}
                    options={BAND_CHARACTERS.map(c => ({ value: c.key, label: c.label }))}
                    onChange={v => patchBand(b.id, { character: v as AudioBandCharacter })} />
                </label>
              )}
              {b.character !== 'any' && b.detect !== 'flatness' && b.detect !== 'brightness' && field('Noisy at', b.charAt, v => patchBand(b.id, { charAt: clamp01(v) }), {
                step: 0.05, min: 0, max: 1, disabled: !b.trigger,
                title: 'Only\'s line on the band\'s flatness (0 a pure tone … 1 noise), averaged over 40 ms after each hit: at or over it is noisy, under it tonal. Pick Detect: Noisy ↔ tonal to see where the band sits.',
              })}
              <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />
              <Toggle checked={b.value} onChange={c => patchBand(b.id, c || b.trigger ? { value: c } : { value: false, trigger: true }, true)} label="Value" />
              {field('Attack', b.attack, v => patchBand(b.id, { attack: Math.max(0, v) }), { step: 0.01, min: 0, title: 'Seconds the Value takes to rise.', disabled: !b.value })}
              {field('Release', b.release, v => patchBand(b.id, { release: Math.max(0, v) }), { step: 0.01, min: 0, title: 'Seconds the Value takes to fall back.', disabled: !b.value })}
              {field('Gain', b.gain, v => patchBand(b.id, { gain: Math.max(0, v) }), { step: 0.05, min: 0, title: 'Scales the Value (it stops at 1).', disabled: !b.value })}
              <span style={{ width: 1, alignSelf: 'stretch', background: tk.border.default }} />
              <Toggle checked={b.trigger} onChange={c => patchBand(b.id, c || b.value ? { trigger: c } : { trigger: false, value: true }, true)} label="Trigger" />
              {field('Threshold', b.threshold, v => patchBand(b.id, { threshold: clamp01(v) }), { step: 0.01, min: 0, max: 1, title: 'Fires when the level (0–1) rises above this line; drag it on the scope below. Lower catches quieter hits.', disabled: !b.trigger })}
              {field('Release ×', b.releaseAt, v => patchBand(b.id, { releaseAt: clamp01(v) }), { step: 0.05, min: 0, max: 1, title: 'Re-arms once the level falls below Threshold × this, so a held note fires once. Nearer 1 re-arms sooner.', disabled: !b.trigger })}
              {field('Gate', b.gate, v => patchBand(b.id, { gate: clamp01(v) }), { step: 0.01, min: 0, max: 1, title: 'Below this level the band is silence: its Value is 0 and noise never fires it. 0 is off.' })}
              {field('Min ms', b.minMs, v => patchBand(b.id, { minMs: Math.max(0, Math.min(500, Math.round(v))) }), { step: 1, min: 0, max: 500, title: 'Milliseconds the level must stay above Threshold to fire: stops a single noisy blip.', disabled: !b.trigger })}
              {field('Cooldown', b.cooldown, v => patchBand(b.id, { cooldown: Math.max(40, v) }), { step: 10, min: 40, title: 'Milliseconds after a hit before the next can count; a rise inside it is ignored.', disabled: !b.trigger })}
              <Button size="sm" data-learn-noise onClick={e => { e.stopPropagation(); learnNoise(b); }}
                title={kind === 'file' ? 'Set the Gate just over the band\'s noise in the selection (Drag: Select a quiet stretch)' : 'Set the Gate just over the band\'s noise in the last two seconds: keep it quiet first'}>Learn noise</Button>
              <canvas ref={c => { if (c) meterRefs.current.set(b.id, c); else meterRefs.current.delete(b.id); }} style={{ width: 84, height: 18, display: 'block', marginLeft: 'auto' }} title="The band now: its level, and a flash on each hit" />
              <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); removeBand(b.id); }} title="Remove the band (and its outputs' wires)">✕</Button>
              {hasScope(b) && (
                <canvas ref={c => { if (c) scopeRefs.current.set(b.id, c); else scopeRefs.current.delete(b.id); }} data-trigger-scope={b.id}
                  onPointerDown={e => onScope(e, b, 'down')} onPointerMove={e => onScope(e, b, 'move')} onPointerUp={() => { scopeDrag.current = null; }}
                  title={b.detect === 'level'
                    ? 'The trigger scope: the level it measures (the last seconds), Threshold (solid), Release (dashed), Gate (grey) and a tick on each hit. Drag a line to move it.'
                    : `The scope: ${detectLabel(b)} (the band's colour) with its level faint behind it, Threshold (solid), Release (dashed), Gate (grey, on the level) and a tick on each hit. Drag a line to move it.`}
                  style={{ flexBasis: '100%', width: '100%', height: 84, display: 'block', borderRadius: radius.sm, cursor: 'ns-resize', touchAction: 'none' }} />
              )}
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
