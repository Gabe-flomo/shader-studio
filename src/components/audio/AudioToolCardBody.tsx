/**
 * The Audio nodes' cards (docs/audio-tools.md): Audio Source's controls (play, pick a file, start the microphone)
 * and a small live readout on every Audio node — a meter, a hit flash, a mini spectrum, a waterfall or a wave.
 *
 * The readouts draw into a canvas from one shared animation-frame loop (no React render per frame), and only when
 * the engine has read a new frame.
 */
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useTokens } from '../../theme/themeStore';
import type { GraphNode } from '../../types/nodeGraph';
import { audioToolsEngine, type AudioReadout } from '../../lib/audioTools/engine';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import {
  AUDIO_BAND_TYPE, AUDIO_HIT_TYPE, AUDIO_SOURCE_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_SPECTRUM_TYPE, AUDIO_WAVEFORM_TYPE, audioSourceKind,
} from '../../nodes/definitions/audioTools';
import { liveAudio } from '../../lib/liveAudio';
import { Button } from '../ui/Button';

// ── One loop for every readout ─────────────────────────────────────────────────────────────────────────────

const drawers = new Set<() => void>();
let raf = 0;
function loop() {
  for (const d of drawers) d();
  raf = drawers.size ? requestAnimationFrame(loop) : 0;
}
function addDrawer(d: () => void): () => void {
  drawers.add(d);
  if (!raf && typeof requestAnimationFrame !== 'undefined') raf = requestAnimationFrame(loop);
  return () => { drawers.delete(d); };
}

const ACCENT = '#b4befe', HIT = '#f9e2af', DIM = 'rgba(180,190,254,0.18)', BG = '#11111b';

function draw(type: string, g: CanvasRenderingContext2D, w: number, h: number, r: AudioReadout, img: { data: ImageData | null }) {
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  switch (type) {
    case AUDIO_SOURCE_TYPE:
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
  const tall = node.type === AUDIO_SPECTRUM_TYPE || node.type === AUDIO_WAVEFORM_TYPE || node.type === AUDIO_SPECTROGRAM_TYPE;
  const height = node.type === AUDIO_SPECTROGRAM_TYPE ? 72 : tall ? 48 : node.type === AUDIO_HIT_TYPE ? 22 : 10;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let seen = -1, flashing = false;
    const img = { data: null as ImageData | null };
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
      draw(node.type, g, w, h, r, img);
    });
  }, [node.id, node.type, height]);
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

function SourceControls({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const text = useEngineText(node.id);
  const fileRef = useRef<HTMLInputElement>(null);
  const kind = audioSourceKind(node);
  const playing = node.params.playing !== false;
  const set = (p: Record<string, unknown>) => useNodeGraphStore.getState().updateNodeParams(node.id, p, { immediate: true });
  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    const err = await audioToolsEngine.loadFile(node.id, f);
    if (!err) set({ _fileName: f.name });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0 4px', flexWrap: 'wrap' }} onPointerDown={e => e.stopPropagation()}>
      <Button size="sm" onClick={() => set({ playing: !playing })} title={playing ? 'Stop' : 'Play'}>{playing ? 'Pause' : 'Play'}</Button>
      {kind === 'file' && <>
        <Button size="sm" onClick={() => fileRef.current?.click()} title="Pick an audio file (mp3, wav, ogg, m4a…)">Pick file…</Button>
        <input ref={fileRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
      </>}
      {kind === 'mic' && !liveAudio.isOn() && <Button size="sm" onClick={() => { void audioToolsEngine.startMic(node.id); }} title="Open the microphone or audio input (the browser asks first)">Start</Button>}
      <div style={{ flex: 1, minWidth: 120, fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 }}>{text}</div>
    </div>
  );
}

export function AudioToolCardBody({ node }: { node: GraphNode }) {
  return (
    <div style={{ padding: '2px 0 4px' }}>
      {node.type === AUDIO_SOURCE_TYPE && <SourceControls node={node} />}
      <Readout node={node} />
    </div>
  );
}
