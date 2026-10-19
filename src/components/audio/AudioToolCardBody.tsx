/**
 * The Audio nodes' cards (docs/audio-tools.md): Audio Source's File | Mic | Video tabs, its controls (play, load a sound
 * or pick one kept in the library, start the microphone, pick a video node, Open ↗ for its window: AudioSourceWindow.tsx) and a small live readout on every Audio node —
 * Audio Source's spectrum with its bands, a meter, a hit flash, a mini spectrum, a waterfall or a wave.
 *
 * The readouts draw into a canvas from one shared animation-frame loop (no React render per frame), and only when
 * the engine has read a new frame.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { audioToolsEngine, type AudioReadout } from '../../lib/audioTools/engine';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import {
  AUDIO_BAND_TYPE, AUDIO_FILTER_TYPE, AUDIO_HIT_TYPE, AUDIO_RESONATOR_TYPE, AUDIO_SOURCE_TYPE, AUDIO_SPECTRAL_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_SPECTRUM_TYPE,
  AUDIO_WAVEFORM_TYPE, audioSourceKind, effectSpecOf, isAudioFxType, isAudioVideoNode, type AudioSourceKind,
} from '../../nodes/definitions/audioTools';
import { acBiquadCoeffs, acBiquadMag, acNoteName, acResonatorNotes } from '../../play/kit/audioChain.js';
import { liveAudio } from '../../lib/liveAudio';
import { useCan } from '../../lib/plan';
import { LiveSendPicker, pickSourceTab, sourceTabOptions, useLiveSend } from './LiveSendPicker';
import { bandsOf, type AudioBandSpec } from '../../lib/audioTools/bands';
import { xOfHz } from '../../lib/audioTools/dsp';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { Popover } from '../ui/Popover';
import { addVideoFile, deleteVideo, getVideo, isAudioType, listVideos, subscribe as subscribeLibrary, type LibraryVideoMeta } from '../../lib/backgroundLibrary';
import { collectNodesDeep } from '../../lib/audioTools/graphWalk';
import { AudioSourceWindow } from './AudioSourceWindow';
import { AudioTransport } from './AudioTransport';

import { addDrawer } from './drawLoop';

const ACCENT = '#b4befe', HIT = '#f9e2af', DIM = 'rgba(180,190,254,0.18)', BG = '#11111b';

/** Audio Source's card: the live spectrum (log, 20 Hz–20 kHz) with its bands' ranges under it, and a thin level meter. */
function drawSource(g: CanvasRenderingContext2D, w: number, h: number, r: AudioReadout, bands: readonly AudioBandSpec[], img: { hold?: Float32Array }) {
  const meter = 3, sh = h - meter - 2;
  for (const b of bands) {
    const x0 = xOfHz(b.lo, 'log', 20, 20000) * w, x1 = xOfHz(b.hi, 'log', 20, 20000) * w;
    g.fillStyle = `${b.color}33`; g.fillRect(x0, 0, Math.max(1, x1 - x0), sh);
    g.fillStyle = b.color; g.fillRect(x0, sh - 1, Math.max(1, x1 - x0), 1);
  }
  const row = r.row;
  if (row?.length) {
    // The bars fall back gently (so a short hit stays readable); the live row is drawn over them.
    if (img.hold?.length !== row.length) img.hold = new Float32Array(row.length);
    const hold = img.hold, bw = w / row.length;
    for (let i = 0; i < row.length; i++) {
      hold[i] = Math.max(row[i], hold[i] * 0.92);
      g.fillStyle = 'rgba(180,190,254,0.45)'; g.fillRect(i * bw, sh - hold[i] * (sh - 2), Math.max(1, bw - 1), hold[i] * (sh - 2));
      g.fillStyle = ACCENT; g.fillRect(i * bw, sh - row[i] * (sh - 2), Math.max(1, bw - 1), row[i] * (sh - 2));
    }
  }
  g.fillStyle = DIM; g.fillRect(0, h - meter, w, meter);
  g.fillStyle = ACCENT; g.fillRect(0, h - meter, w * r.level, meter);
}

/** Frequency across a card, log 20 Hz – 20 kHz. */
const hzAtX = (x: number) => 20 * Math.pow(1000, Math.max(0, Math.min(1, x)));
const xOfHzCard = (hz: number) => Math.log(Math.max(20, hz) / 20) / Math.log(1000);
const label = (g: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left') => {
  g.fillStyle = '#cdd6f4'; g.font = '10px system-ui, sans-serif'; g.textAlign = align; g.textBaseline = 'top'; g.fillText(text, x, y);
};

/** Filter's card: its response (0 dB in the middle, ±24 dB), filled as loud as the sound coming out, and its Frequency. */
function drawFilter(g: CanvasRenderingContext2D, w: number, h: number, r: AudioReadout, P: Record<string, unknown>) {
  const spec = effectSpecOf({ id: '', type: AUDIO_FILTER_TYPE, params: P } as unknown as GraphNode);
  const c = acBiquadCoeffs(spec.filterType, spec.frequency, spec.q, spec.gain, 48000);
  const yOf = (db: number) => h / 2 - (Math.max(-24, Math.min(24, db)) / 24) * (h / 2 - 3);
  g.fillStyle = DIM; g.fillRect(0, h / 2, w, 1);
  g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 2) g.lineTo(x, yOf(20 * Math.log10(Math.max(1e-6, acBiquadMag(c, hzAtX(x / w), 48000)))));
  g.lineTo(w, h); g.closePath();
  g.fillStyle = `rgba(180,190,254,${0.12 + 0.6 * r.level})`; g.fill();
  g.beginPath();
  for (let x = 0; x <= w; x += 2) { const y = yOf(20 * Math.log10(Math.max(1e-6, acBiquadMag(c, hzAtX(x / w), 48000)))); if (x) g.lineTo(x, y); else g.moveTo(x, y); }
  g.strokeStyle = ACCENT; g.lineWidth = 1.5; g.stroke();
  const fx = xOfHzCard(spec.frequency) * w;
  g.fillStyle = HIT; g.fillRect(fx - 0.5, 0, 1, h);
  const hz = spec.frequency >= 1000 ? `${(spec.frequency / 1000).toFixed(spec.frequency >= 10000 ? 0 : 1)} kHz` : `${Math.round(spec.frequency)} Hz`;
  label(g, hz, fx > w - 50 ? fx - 4 : fx + 4, 2, fx > w - 50 ? 'right' : 'left');
}

/** Resonator bank's card: a bar per resonator (its note under it), the loudest outlined. */
function drawResonator(g: CanvasRenderingContext2D, w: number, h: number, r: AudioReadout, P: Record<string, unknown>) {
  const spec = effectSpecOf({ id: '', type: AUDIO_RESONATOR_TYPE, params: P } as unknown as GraphNode);
  const notes = acResonatorNotes(spec.root, spec.scale, spec.count), n = notes.length;
  const bw = w / n, bh = h - 13;
  for (let k = 0; k < n; k++) {
    const e = r.row?.[k] ?? 0, x = k * bw;
    g.fillStyle = `hsla(${(k / n) * 300}, 70%, 70%, 0.18)`; g.fillRect(x + 1, 0, bw - 2, bh);
    g.fillStyle = `hsl(${(k / n) * 300}, 70%, ${45 + 25 * e}%)`; g.fillRect(x + 1, bh - e * bh, bw - 2, e * bh);
    if (k === r.count && e > 0.02) { g.strokeStyle = HIT; g.lineWidth = 1.5; g.strokeRect(x + 1.5, 0.75, bw - 3, bh - 1.5); }
    label(g, spec.scale === 'harmonic' ? `×${k + 1}` : acNoteName(notes[k]), x + bw / 2, bh + 2, 'center');
  }
}

function draw(type: string, g: CanvasRenderingContext2D, w: number, h: number, r: AudioReadout, img: { data: ImageData | null; hold?: Float32Array }, bands: readonly AudioBandSpec[], P: Record<string, unknown>) {
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  switch (type) {
    case AUDIO_SOURCE_TYPE: drawSource(g, w, h, r, bands, img); return;
    case AUDIO_FILTER_TYPE: drawFilter(g, w, h, r, P); return;
    case AUDIO_RESONATOR_TYPE: drawResonator(g, w, h, r, P); return;
    case AUDIO_SPECTRAL_TYPE: {
      const row = r.row;
      if (row?.length) {
        g.fillStyle = ACCENT;
        const bw = w / row.length;
        for (let i = 0; i < row.length; i++) { const v = row[i] * (h - 4); g.fillRect(i * bw, h - 3 - v, Math.max(1, bw - (bw > 3 ? 1 : 0)), v); }
      }
      g.fillStyle = DIM; g.fillRect(0, h - 2, w, 2);
      g.fillStyle = ACCENT; g.fillRect(0, h - 2, w * r.level, 2);
      const mode = P.mode === 'blur' ? 'Blur' : P.mode === 'gate' ? 'Gate' : P.freeze === true ? 'Frozen' : 'Freeze off';
      label(g, mode, w - 4, 2, 'right');
      return;
    }
    case AUDIO_BAND_TYPE: {
      g.fillStyle = DIM; g.fillRect(0, 2, w, h - 4);
      g.fillStyle = ACCENT; g.fillRect(0, 2, w * r.level, h - 4);
      if (type === AUDIO_BAND_TYPE) { g.fillStyle = HIT; g.fillRect(Math.min(w - 2, w * r.peak), 0, 2, h); }
      return;
    }
    case AUDIO_HIT_TYPE: {
      const flash = Math.max(0, 1 - (performance.now() - r.hitAt) / 250);
      g.fillStyle = `rgba(249,226,175,${0.15 + 0.85 * flash})`;
      g.beginPath(); g.arc(h / 2, h / 2, h / 2 - 2, 0, Math.PI * 2); g.fill();
      g.fillStyle = DIM; g.fillRect(h + 6, h / 2 - 3, w - h - 60, 6);
      g.fillStyle = ACCENT; g.fillRect(h + 6, h / 2 - 3, (w - h - 60) * r.envelope, 6);
      g.fillStyle = '#cdd6f4'; g.font = '11px system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillText(`${r.count} hit${r.count === 1 ? '' : 's'}`, w - 2, h / 2);
      return;
    }
    case AUDIO_SPECTRUM_TYPE: {
      const row = r.row;
      if (!row?.length) return;
      g.fillStyle = ACCENT;
      const bw = w / row.length;
      for (let i = 0; i < row.length; i++) { const v = row[i] * h; g.fillRect(i * bw, h - v, Math.max(1, bw - (bw > 3 ? 1 : 0)), v); }
      return;
    }
    case AUDIO_WAVEFORM_TYPE: {
      const row = r.row;
      if (!row?.length) return;
      g.strokeStyle = ACCENT; g.lineWidth = 1.5; g.beginPath();
      for (let i = 0; i < row.length; i++) { const x = (i / (row.length - 1)) * w, y = (1 - row[i]) * h; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
      return;
    }
    case AUDIO_SPECTROGRAM_TYPE: {
      if (!r.data || !r.w || !r.h) return;
      if (!img.data || img.data.width !== r.w || img.data.height !== r.h) img.data = new ImageData(r.w, r.h);
      // The texture's row 0 is the bottom: flip it, and tint the grey.
      const out = img.data.data;
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
        const v = r.data[((r.h - 1 - y) * r.w + x) * 4] / 255, o = (y * r.w + x) * 4;
        out[o] = 17 + v * 163; out[o + 1] = 17 + v * 173; out[o + 2] = 27 + v * 227; out[o + 3] = 255;
      }
      const c = scratch(r.w, r.h);
      c.getContext('2d')!.putImageData(img.data, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(c, 0, 0, w, h);
      return;
    }
  }
}

let scratchCanvas: HTMLCanvasElement | null = null;
function scratch(w: number, h: number): HTMLCanvasElement {
  const c = (scratchCanvas ??= document.createElement('canvas'));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

function Readout({ node }: { node: GraphNode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const bands = useMemo(() => (node.type === AUDIO_SOURCE_TYPE ? bandsOf(node.params) : []), [node.type, node.params]);
  const bandsRef = useRef<AudioBandSpec[]>(bands);
  useEffect(() => { bandsRef.current = bands; }, [bands]);
  // Bands moved while nothing plays: draw again.
  const bandsKey = bands.map(b => `${b.lo}-${b.hi}-${b.color}`).join(',');
  // An effect's card draws its settings too (the Filter's curve, the bank's notes): a change draws again.
  const paramsRef = useRef(node.params);
  useEffect(() => { paramsRef.current = node.params; }, [node.params]);
  const fx = isAudioFxType(node.type);
  const paramsKey = fx ? JSON.stringify(node.params) : '';
  const tall = node.type === AUDIO_SOURCE_TYPE || node.type === AUDIO_SPECTRUM_TYPE || node.type === AUDIO_WAVEFORM_TYPE || node.type === AUDIO_SPECTROGRAM_TYPE || fx;
  const height = node.type === AUDIO_SPECTROGRAM_TYPE ? 72 : node.type === AUDIO_FILTER_TYPE || node.type === AUDIO_RESONATOR_TYPE ? 60 : tall ? 48 : node.type === AUDIO_HIT_TYPE ? 22 : 10;
  // The Filter's curve is a log slider: drag across it to sweep Frequency evenly through the octaves.
  const dragFreq = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (node.type !== AUDIO_FILTER_TYPE || (e.type === 'pointermove' && !(e.buttons & 1))) return;
    e.stopPropagation();
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const hz = Math.round(hzAtX((e.clientX - r.left) / Math.max(1, r.width)));
    useNodeGraphStore.getState().updateNodeParams(node.id, { frequency: hz }, { immediate: true });
  };
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let seen = -1, flashing = false;
    const img: { data: ImageData | null; hold?: Float32Array } = { data: null };
    return addDrawer(() => {
      const r = audioToolsEngine.readout(node.id);
      if (!r) return;
      const hitFading = node.type === AUDIO_HIT_TYPE && performance.now() - r.hitAt < 300;
      if (audioToolsEngine.frame === seen && !hitFading && !flashing) return;
      flashing = hitFading;
      seen = audioToolsEngine.frame;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = c.clientWidth, h = height;
      if (!w) return;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext('2d');
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(node.type, g, w, h, r, img, bandsRef.current, paramsRef.current);
    });
  }, [node.id, node.type, height, bandsKey, paramsKey]);
  const filter = node.type === AUDIO_FILTER_TYPE;
  return (
    <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 4, cursor: filter ? 'ew-resize' : undefined, touchAction: filter ? 'none' : undefined }}
      title={filter ? 'Drag across to sweep the Frequency (log: even through the octaves)' : undefined} data-audio-readout={node.type}
      onPointerDown={filter ? dragFreq : undefined} onPointerMove={filter ? dragFreq : undefined} onMouseDown={filter ? e => e.stopPropagation() : undefined} />
  );
}

// ── Audio Source's controls ────────────────────────────────────────────────────────────────────────────────

function useEngineText(nodeId: string): string {
  const sub = useMemo(() => (fn: () => void) => {
    const a = audioToolsEngine.onChange(fn), b = liveAudio.onStatus(fn);
    return () => { a(); b(); };
  }, []);
  return useSyncExternalStore(sub, () => audioToolsEngine.status(nodeId));
}

/** Load a sound into an Audio Source and keep it in the library (so it comes back after a reload). An error, or null. */
async function loadSound(nodeId: string, f: File): Promise<string | null> {
  const err = await audioToolsEngine.loadFile(nodeId, f);
  if (err) return err;
  const meta = await addVideoFile(f).catch(() => null);
  // A new file starts untrimmed.
  useNodeGraphStore.getState().updateNodeParams(nodeId, { _fileName: f.name, sampleId: meta?.id ?? '', trimIn: 0, trimOut: 0 }, { immediate: true });
  return null;
}

/** Open a sound kept in the library in an Audio Source. An error, or null. */
async function loadLibrarySound(nodeId: string, id: string): Promise<string | null> {
  const got = await getVideo(id).catch(() => null);
  if (!got) return 'That sound isn\'t in this browser\'s library any more.';
  const err = await audioToolsEngine.loadFile(nodeId, new File([got.blob], got.name, { type: got.type || got.blob.type }));
  if (err) return err;
  useNodeGraphStore.getState().updateNodeParams(nodeId, { _fileName: got.name, sampleId: id, trimIn: 0, trimOut: 0 }, { immediate: true });
  return null;
}

const fmtLen = (s?: number) => (s && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');

/** The sounds kept in the library: use one, or remove it. */
function SoundLibrary({ anchorRef, current, onPick, onClose }: { anchorRef: React.RefObject<HTMLElement | null>; current: string; onPick: (id: string) => void; onClose: () => void }) {
  const tk = useTokens();
  const [items, setItems] = useState<LibraryVideoMeta[] | null>(null);
  useEffect(() => {
    let live = true;
    // Stems from the retired Separate (ids `stem_…`) stay in the library but aren't offered.
    const load = () => listVideos().then(l => { if (live) setItems(l.filter(v => isAudioType(v.type) && !v.id.startsWith('stem_'))); }, () => { if (live) setItems([]); });
    load();
    const off = subscribeLibrary(load);
    return () => { live = false; off(); };
  }, []);
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={300} padding={8}>
      <div data-sound-library style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto', fontSize: 11.5 }} onKeyDown={e => e.stopPropagation()}>
        <span style={{ color: tk.text.faint, fontSize: 11 }}>Sounds in the library (every sound you load is kept here)</span>
        {items === null && <span style={{ color: tk.text.muted }}>Loading…</span>}
        {items?.length === 0 && <span style={{ color: tk.text.muted }}>Nothing here yet. Sounds you load are kept here.</span>}
        {items?.map(i => (
          <div key={i.id} data-sound-item={i.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 3, borderRadius: 4, border: `1px solid ${i.id === current ? tk.accent.base : tk.border.default}` }}>
            {i.thumb ? <img src={i.thumb} alt="" style={{ width: 48, height: 24, objectFit: 'cover', borderRadius: 3 }} /> : <span style={{ width: 48 }} />}
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: tk.text.secondary }} title={i.name}>{i.name}</span>
            <span style={{ color: tk.text.faint }}>{fmtLen(i.duration)}</span>
            <Button size="sm" onClick={() => onPick(i.id)} title="Play this sound in the Audio Source">Use</Button>
            <Button size="sm" variant="ghost" onClick={() => { void deleteVideo(i.id); }} title="Remove it from the library (graphs that use it will ask for it again)">✕</Button>
          </div>
        ))}
      </div>
    </Popover>
  );
}

/** The graph's video nodes, for the Video tab. */
function useVideoNodes(): Array<{ value: string; label: string }> {
  const nodes = useNodeGraphStore(s => s.nodes);
  return useMemo(() => collectNodesDeep(nodes, isAudioVideoNode).map(n => {
    const P = n.params;
    const name = (typeof P.label === 'string' && P.label.trim()) || (typeof P._fileName === 'string' && P._fileName) || (typeof P.fileName === 'string' && P.fileName) || '';
    return { value: n.id, label: `${n.type === 'baked' ? 'Baked' : 'Texture (video)'}${name ? `: ${name}` : ` ${n.id}`}` };
  }), [nodes]);
}

/** Audio Source's card: File | Mic | Video (| Live, desktop) tabs (as the Texture node's Image | Video | Webcam), the transport, Load / Library / Start / a video / a Live track, Open ↗. */
function SourceControls({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const text = useEngineText(node.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [err, setErr] = useState('');
  const kind = audioSourceKind(node);
  const videos = useVideoNodes();
  useLiveSend();
  const liveOk = useCan('audio.liveSend');
  const set = (p: Record<string, unknown>) => useNodeGraphStore.getState().updateNodeParams(node.id, p, { immediate: true });
  const loaded = useSyncExternalStore(useMemo(() => (fn: () => void) => audioToolsEngine.onChange(fn), []), () => !!audioToolsEngine.sourceView(node.id)?.loaded);
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setErr((await loadSound(node.id, f)) ?? '');
  };
  const videoNode = typeof node.params.videoNode === 'string' ? node.params.videoNode : '';
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0 6px' }} onPointerDown={stop} onMouseDown={stop} data-audio-source-card={kind}>
      <Segmented<AudioSourceKind> size="sm" fill ariaLabel="Source" value={kind} onChange={v => pickSourceTab(node.id, v)} options={sourceTabOptions(kind, liveOk)} />
      <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      {kind === 'video' && (
        <Select ariaLabel="Video node" value={videoNode} onChange={v => set({ videoNode: v })}
          options={[{ value: '', label: videos.length ? 'Pick a video node…' : 'No video in the graph yet' }, ...videos]} />
      )}
      {kind === 'send' && <LiveSendPicker node={node} />}
      <AudioTransport node={node} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {kind === 'file' && <Button size="sm" onClick={() => fileRef.current?.click()} title="Load an audio file (mp3, wav, ogg, m4a…); it is kept in the library">{loaded ? 'Replace…' : 'Load a sound…'}</Button>}
        {kind === 'file' && <span ref={libRef}><Button size="sm" onClick={() => setLibOpen(o => !o)} aria-expanded={libOpen} title="Sounds kept in the library: use one, or remove it">Library</Button></span>}
        {kind === 'mic' && !liveAudio.isOn() && <Button size="sm" onClick={() => { void audioToolsEngine.startMic(node.id); }} title="Open the microphone or audio input (the browser asks first)">Start</Button>}
        <Button size="sm" onClick={() => setOpen(true)} title="Open the big window: the whole file to trim, and the spectrum to pick bands on">Open ↗</Button>
      </div>
      <div style={{ fontSize: 11.5, color: err ? tk.status.danger : tk.text.muted, lineHeight: 1.45 }}>{err || text}</div>
      {libOpen && <SoundLibrary anchorRef={libRef} current={typeof node.params.sampleId === 'string' ? node.params.sampleId : ''} onClose={() => setLibOpen(false)}
        onPick={id => { setLibOpen(false); void loadLibrarySound(node.id, id).then(e => setErr(e ?? '')); }} />}
      {open && createPortal(<AudioSourceWindow nodeId={node.id} onClose={() => setOpen(false)} onLoad={() => fileRef.current?.click()} />, document.body)}
    </div>
  );
}

export function AudioToolCardBody({ node }: { node: GraphNode }) {
  return (
    <div style={{ padding: node.type === AUDIO_SOURCE_TYPE ? '6px 10px 8px' : '2px 0 4px' }}>
      {node.type === AUDIO_SOURCE_TYPE && <SourceControls node={node} />}
      <Readout node={node} />
    </div>
  );
}
