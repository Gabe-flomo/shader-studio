/**
 * The Audio nodes' cards (docs/audio-tools.md): Audio Source's File | Mic tabs, its controls (play, load a sound,
 * start the microphone, Open ↗ for its window: AudioSourceWindow.tsx) and a small live readout on every Audio node —
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
  AUDIO_BAND_TYPE, AUDIO_HIT_TYPE, AUDIO_SOURCE_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_SPECTRUM_TYPE, AUDIO_WAVEFORM_TYPE, audioSourceKind,
  type AudioSourceKind,
} from '../../nodes/definitions/audioTools';
import { liveAudio } from '../../lib/liveAudio';
import { bandsOf, type AudioBandSpec } from '../../lib/audioTools/bands';
import { xOfHz } from '../../lib/audioTools/dsp';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { AudioSourceWindow } from './AudioSourceWindow';

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

function draw(type: string, g: CanvasRenderingContext2D, w: number, h: number, r: AudioReadout, img: { data: ImageData | null; hold?: Float32Array }, bands: readonly AudioBandSpec[]) {
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  switch (type) {
    case AUDIO_SOURCE_TYPE: drawSource(g, w, h, r, bands, img); return;
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
  const tall = node.type === AUDIO_SOURCE_TYPE || node.type === AUDIO_SPECTRUM_TYPE || node.type === AUDIO_WAVEFORM_TYPE || node.type === AUDIO_SPECTROGRAM_TYPE;
  const height = node.type === AUDIO_SPECTROGRAM_TYPE ? 72 : tall ? 48 : node.type === AUDIO_HIT_TYPE ? 22 : 10;
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
      draw(node.type, g, w, h, r, img, bandsRef.current);
    });
  }, [node.id, node.type, height, bandsKey]);
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 4 }} />;
}

// ── Audio Source's controls ────────────────────────────────────────────────────────────────────────────────

function useEngineText(nodeId: string): string {
  const sub = useMemo(() => (fn: () => void) => {
    const a = audioToolsEngine.onChange(fn), b = liveAudio.onStatus(fn);
    return () => { a(); b(); };
  }, []);
  return useSyncExternalStore(sub, () => audioToolsEngine.status(nodeId));
}

const TABS: Array<{ value: AudioSourceKind; label: string }> = [{ value: 'file', label: 'File' }, { value: 'mic', label: 'Mic' }];

/** Audio Source's card: File | Mic tabs (as the Texture node's Image | Video | Webcam), Play, Load / Start, Open ↗. */
function SourceControls({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const text = useEngineText(node.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const kind = audioSourceKind(node);
  const playing = node.params.playing !== false;
  const set = (p: Record<string, unknown>) => useNodeGraphStore.getState().updateNodeParams(node.id, p, { immediate: true });
  const loaded = useSyncExternalStore(useMemo(() => (fn: () => void) => audioToolsEngine.onChange(fn), []), () => !!audioToolsEngine.sourceView(node.id)?.loaded);
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const err = await audioToolsEngine.loadFile(node.id, f);
    // A new file starts untrimmed.
    if (!err) set({ _fileName: f.name, trimIn: 0, trimOut: 0 });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '2px 0 6px' }} onPointerDown={stop} onMouseDown={stop} data-audio-source-card={kind}>
      <Segmented<AudioSourceKind> size="sm" fill ariaLabel="Source" value={kind} onChange={v => set({ source: v })} options={TABS} />
      <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => set({ playing: !playing })} title={playing ? 'Stop' : 'Play'}>{playing ? 'Pause' : 'Play'}</Button>
        {kind === 'file' && <Button size="sm" onClick={() => fileRef.current?.click()} title="Load an audio file (mp3, wav, ogg, m4a…)">{loaded ? 'Replace…' : 'Load a sound…'}</Button>}
        {kind === 'mic' && !liveAudio.isOn() && <Button size="sm" onClick={() => { void audioToolsEngine.startMic(node.id); }} title="Open the microphone or audio input (the browser asks first)">Start</Button>}
        <Button size="sm" onClick={() => setOpen(true)} title="Open the big window: the whole file to trim, and the spectrum to pick bands on">Open ↗</Button>
      </div>
      <div style={{ fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>{text}</div>
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
