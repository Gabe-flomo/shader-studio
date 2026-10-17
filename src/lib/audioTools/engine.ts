/**
 * audioToolsEngine — runs the Audio nodes (docs/audio-tools.md, nodes/definitions/audioTools.ts).
 *
 * - `sync(nodes)`: on every graph change. Each Audio Source gets a slot (its sound: a file through lib/audioEngine,
 *   played within its trim, or the microphone through lib/liveAudio), each listening node one too (its state, its texture).
 * - An Audio Source's own bands (lib/audioTools/bands.ts) run on its frame too and write `<id>::<band>_v` / `_t`.
 * - Once per rendered frame the input bus ticks it (`tickInputs`): each playing source's probe analyser (its own,
 *   FFT 2048, no smoothing, connected after the source's analyser) is read once, then every listening node runs its
 *   sums on that frame (dsp.ts) and writes its numbers by channel key (`<id>::level`), or fills its texture.
 * - Textures go to the picture through the store's node textures (`setHost`, ShaderCanvas), as Blob Track's do.
 *
 * - Learned sounds (lib/audioTools/learn.ts) listen on the source's frame too: `<id>::<sound>_t` / `_m`.
 *
 * Nodes inside groups (plain, iterated, nested) are followed too (graphWalk.ts): an `audio` wire through a group's
 * ports reaches its source, and every node is keyed by its own id, as the compiler binds it.
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import type { InputSource, InputWriter } from '../inputBus';
import { inputBus } from '../inputBus';
import { audioEngine } from '../audioEngine';
import { liveAudio } from '../liveAudio';
import {
  AUDIO_BAND_TYPE, AUDIO_HIT_TYPE, AUDIO_SOURCE_TYPE, AUDIO_SPECTROGRAM_TYPE, AUDIO_SPECTRUM_TYPE, AUDIO_TEXTURE_TYPES,
  AUDIO_WAVEFORM_TYPE, audioBandOf, audioSoundsOf, audioSourceKind, audioTextureSize, type AudioSourceKind,
} from '../../nodes/definitions/audioTools';
import { collectAudioNodes } from './graphWalk';
import {
  learnFromRing, learnFromSamples, newLearnListener, soundMatchKey, soundTriggerKey, stepLearn,
  type AudioSoundSpec, type LearnListener, type LearnResult,
} from './learn';
import { bandTriggerKey, bandValueKey, bandsOf, newBandRun, stepBandRun, trimWindow, type AudioBandSpec, type BandRun } from './bands';
import {
  bandLevel, newBandState, newHitState, rmsLevel, scrollRows, spectrumBins, stepBand, stepHit, waveRow, writeRow,
  type BandState, type HitState, type SpectrumLayout,
} from './dsp';

const FFT = 2048;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export interface AudioToolsHost {
  setTexture(nodeId: string, tex: THREE.Texture | null): void;
  requestRender(): void;
}

interface SourceSlot {
  node: GraphNode;
  kind: AudioSourceKind;
  /** A file is loaded into the audio engine under this id. */
  loaded: boolean;
  /** The settings last applied to playback (kind, Play, Loop, trim): a change starts or stops it. */
  applied: string;
  /** The bands' running state, by band id. */
  runs: Map<string, BandRun>;
  bands: AudioBandSpec[];
  /** Learned sounds, and the listener that matches them (and keeps the last seconds for "Learn last hit"). */
  sounds: AudioSoundSpec[];
  learn: LearnListener;
  /** The card's small spectrum: 0..1 on a log layout. */
  row: Float32Array;
  upstream: AnalyserNode | null;
  probe: AnalyserNode | null;
  freq: Float32Array<ArrayBuffer>;
  wave: Float32Array<ArrayBuffer>;
  sampleRate: number;
  active: boolean;
  level: number;
  time: number;
  micSince: number;
  status: string;
}

interface ListenSlot {
  node: GraphNode;
  sourceId: string | null;
  band: BandState;
  hit: HitState;
  row: Float32Array;
  tex: THREE.DataTexture | null;
  w: number;
  h: number;
  /** When the last hit was (performance.now ms), for the card's flash. */
  hitAt: number;
}

/** What a card draws (live objects: read them, don't keep them). */
export interface AudioReadout {
  level: number;
  peak: number;
  envelope: number;
  count: number;
  hitAt: number;
  row: Float32Array | null;
  data: Uint8Array | null;
  w: number;
  h: number;
  active: boolean;
}

/** What the Audio Source's window draws (live objects: read them, don't keep them). */
export interface AudioSourceView {
  kind: AudioSourceKind;
  active: boolean;
  loaded: boolean;
  freq: Float32Array;
  wave: Float32Array;
  sampleRate: number;
  level: number;
  /** Seconds into the file (or since the mic started). */
  time: number;
  duration: number;
  /** Per band: its Value now, and when its last hit was (performance.now ms). */
  bands: Map<string, { level: number; hitAt: number; count: number }>;
  /** Per learned sound: its Match now (falling), the similarity at the last onset, when it last fired (ms), fires. */
  sounds: Map<string, { match: number; last: number; hitAt: number; count: number }>;
}

/** Bins in the card's spectrum. */
export const CARD_SPECTRUM_BINS = 48;

let blank: HTMLCanvasElement | null = null;
function blankCanvas(): HTMLCanvasElement | undefined {
  if (typeof document === 'undefined') return undefined;
  if (!blank) { blank = document.createElement('canvas'); blank.width = blank.height = 1; const g = blank.getContext('2d'); if (g) { g.fillStyle = '#000'; g.fillRect(0, 0, 1, 1); } }
  return blank;
}

class AudioToolsEngine implements InputSource {
  private host: AudioToolsHost | null = null;
  private sources = new Map<string, SourceSlot>();
  private listeners = new Map<string, ListenSlot>();
  private changeFns = new Set<() => void>();
  private lastTick = 0;
  private offBus: (() => void) | null = null;
  private silentFreq = new Float32Array(FFT / 2).fill(-200);
  private silentWave = new Float32Array(FFT);
  /** Counts ticks, so a card draws only when something new was read. */
  frame = 0;

  setHost(host: AudioToolsHost | null): void {
    this.host = host;
    if (host) {
      for (const [id, l] of this.listeners) if (l.tex) host.setTexture(id, l.tex);
      this.offBus ??= inputBus.addSource(this);
    } else {
      this.offBus?.();
      this.offBus = null;
    }
  }

  onChange(fn: () => void): () => void { this.changeFns.add(fn); return () => { this.changeFns.delete(fn); }; }
  private changed(): void { for (const fn of this.changeFns) fn(); }

  /** The card's status line for a source. */
  status(nodeId: string): string { return this.sources.get(nodeId)?.status ?? ''; }

  readout(nodeId: string): AudioReadout | null {
    const s = this.sources.get(nodeId);
    if (s) return { level: s.level, peak: s.level, envelope: 0, count: 0, hitAt: 0, row: s.row, data: null, w: 0, h: 0, active: s.active };
    const l = this.listeners.get(nodeId);
    if (!l) return null;
    const active = !!(l.sourceId && this.sources.get(l.sourceId)?.active);
    return {
      level: l.node.type === AUDIO_HIT_TYPE ? l.hit.strength : l.band.level, peak: l.band.peak, envelope: l.hit.envelope, count: l.hit.count,
      hitAt: l.hitAt, row: l.row, data: (l.tex?.image.data as Uint8Array | undefined) ?? null, w: l.w, h: l.h, active,
    };
  }

  /** The Audio Source's window: its spectrum, wave, file and bands now. */
  sourceView(nodeId: string): AudioSourceView | null {
    const s = this.sources.get(nodeId);
    if (!s) return null;
    const bands = new Map<string, { level: number; hitAt: number; count: number }>();
    for (const [id, r] of s.runs) bands.set(id, { level: r.band.level, hitAt: Number.isFinite(r.hitAt) ? r.hitAt * 1000 : -Infinity, count: r.hit.count });
    const sounds = new Map<string, { match: number; last: number; hitAt: number; count: number }>();
    for (const [id, r] of s.learn.runs) sounds.set(id, { match: r.match, last: r.last, hitAt: Number.isFinite(r.hitAt) ? r.hitAt * 1000 : -Infinity, count: r.count });
    return {
      kind: s.kind, active: s.active, loaded: s.loaded, freq: s.freq, wave: s.wave, sampleRate: s.sampleRate, level: s.level, time: s.time,
      duration: s.loaded ? audioEngine.duration(nodeId) : 0, bands, sounds,
    };
  }

  // ── The graph ────────────────────────────────────────────────────────────────────────────────────────────

  /** The graph changed: every Audio node at any depth (groups too) gets its slot; a removed one's goes. */
  sync(nodes: readonly GraphNode[]): void {
    const audio = collectAudioNodes(nodes);
    const srcIds = new Set(audio.filter(r => r.node.type === AUDIO_SOURCE_TYPE).map(r => r.node.id));
    for (const [id, s] of this.sources) if (!srcIds.has(id)) this.dropSource(id, s);
    for (const [id, l] of this.listeners) if (!audio.some(r => r.node.id === id && r.node.type !== AUDIO_SOURCE_TYPE)) this.dropListener(id, l);
    // Sources first, so a listener finds its source's slot.
    for (const r of audio) if (r.node.type === AUDIO_SOURCE_TYPE) this.syncSource(r.node);
    for (const r of audio) if (r.node.type !== AUDIO_SOURCE_TYPE) this.syncListener(r.node, r.sourceId);
  }

  /** The ids of the nodes the engine runs now (for tests and checks): sources, and listeners with their source. */
  slots(): { sources: string[]; listeners: Array<{ id: string; sourceId: string | null; texture: boolean }> } {
    return {
      sources: [...this.sources.keys()],
      listeners: [...this.listeners].map(([id, l]) => ({ id, sourceId: l.sourceId, texture: !!l.tex })),
    };
  }

  private syncSource(n: GraphNode): void {
    let s = this.sources.get(n.id);
    if (!s) {
      s = {
        node: n, kind: audioSourceKind(n), loaded: false, applied: '', upstream: null, probe: null, runs: new Map(), bands: [],
        sounds: [], learn: newLearnListener(),
        row: new Float32Array(CARD_SPECTRUM_BINS),
        freq: new Float32Array(FFT / 2), wave: new Float32Array(FFT), sampleRate: 48000, active: false, level: 0, time: 0, micSince: 0, status: '',
      };
      this.sources.set(n.id, s);
    }
    s.node = n;
    s.kind = audioSourceKind(n);
    s.bands = bandsOf(n.params);
    // A band's state stays while it is edited; a removed band's goes.
    for (const id of [...s.runs.keys()]) if (!s.bands.some(b => b.id === id)) s.runs.delete(id);
    for (const b of s.bands) if (!s.runs.has(b.id)) s.runs.set(b.id, newBandRun());
    s.sounds = audioSoundsOf(n.params);
    // Released by someone else (lib/audioSync.ts stops every song when another graph opens): it has to be loaded again.
    if (s.loaded && !audioEngine.isLoaded(n.id)) { s.loaded = false; s.applied = ''; }
    this.applyPlayback(s);
  }

  /** Start or stop the sound when its kind, Play or Loop changed (not every sync: a file that played to its end stays stopped). */
  private applyPlayback(s: SourceSlot): void {
    const id = s.node.id, playing = s.node.params.playing !== false, loop = s.node.params.loop !== false;
    const win = s.loaded ? trimWindow(audioEngine.duration(id), s.node.params.trimIn, s.node.params.trimOut) : null;
    const key = `${s.kind}:${playing}:${loop}:${s.loaded}:${win ? `${win.start.toFixed(4)}-${win.end.toFixed(4)}` : ''}`;
    if (key === s.applied) { this.refreshStatus(s); return; }
    s.applied = key;
    if (s.kind === 'mic') {
      if (audioEngine.isPlaying(id)) audioEngine.stopAudio(id);
      if (playing && !s.micSince) s.micSince = performance.now();
      if (!playing) s.micSince = 0;
    } else if (s.loaded) {
      const want = playing && !audioEngine.isMasterPaused();
      if (want) audioEngine.startAudio(id, audioEngine.position(id) ?? 0, loop, win ?? undefined); // started, or Loop / the trim changed while playing
      else if (audioEngine.isPlaying(id)) audioEngine.stopAudio(id);
    }
    this.host?.requestRender();
    this.refreshStatus(s);
  }

  private refreshStatus(s: SourceSlot): void {
    const playing = s.node.params.playing !== false;
    let text: string;
    if (s.kind === 'mic') {
      const st = liveAudio.getStatus();
      text = st === 'on' ? `Listening: ${liveAudio.getLabel() || 'input'}${playing ? '' : ' (Play is off)'}`
        : st === 'requesting' ? 'Asking for the microphone…'
        : st === 'denied' ? 'The microphone was refused (or is busy).'
        : st === 'unsupported' ? 'This browser has no microphone input.'
        : 'Microphone off: press Start.';
    } else if (!s.loaded) {
      const was = typeof s.node.params._fileName === 'string' ? s.node.params._fileName : '';
      text = was ? `Load "${was}" again (files aren't kept after a reload), or switch to Mic.` : 'Load a sound, or switch to Mic.';
    }
    else text = `${audioEngine.getFileName(s.node.id) || 'Sound'} · ${audioEngine.isPlaying(s.node.id) ? 'playing' : 'stopped'}`;
    this.setStatus(s, text);
  }

  private setStatus(s: SourceSlot, text: string): void {
    if (s.status === text) return;
    s.status = text;
    this.changed();
  }

  private syncListener(n: GraphNode, sourceId: string | null): void {
    let l = this.listeners.get(n.id);
    if (!l) {
      l = { node: n, sourceId: null, band: newBandState(), hit: newHitState(), row: new Float32Array(0), tex: null, w: 0, h: 0, hitAt: 0 };
      this.listeners.set(n.id, l);
    }
    l.node = n;
    l.sourceId = sourceId && this.sources.has(sourceId) ? sourceId : null;
    if (AUDIO_TEXTURE_TYPES.has(n.type)) {
      const { w, h } = audioTextureSize(n);
      if (w !== l.w || h !== l.h || !l.tex) {
        l.tex?.dispose();
        const tex = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
        const d = tex.image.data as Uint8Array;
        // Silence: 0 for a spectrum, 0.5 (the middle) for a waveform.
        const quiet = n.type === AUDIO_WAVEFORM_TYPE ? 128 : 0;
        for (let i = 0; i < d.length; i += 4) { d[i] = d[i + 1] = d[i + 2] = quiet; d[i + 3] = 255; }
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.flipY = false;
        tex.needsUpdate = true;
        // Web pages don't run the Audio nodes yet (docs/audio-tools-plan.md): the export encodes this blank.
        tex.userData.canvas8 = blankCanvas();
        l.tex = tex; l.w = w; l.h = h;
        l.row = new Float32Array(w);
        this.host?.setTexture(n.id, tex);
      }
    }
  }

  private dropSource(id: string, s: SourceSlot): void {
    try { s.probe?.disconnect(); } catch { /* gone */ }
    try { if (s.upstream && s.probe) s.upstream.disconnect(s.probe); } catch { /* gone */ }
    if (s.loaded) audioEngine.removeAudio(id);
    this.sources.delete(id);
  }

  private dropListener(id: string, l: ListenSlot): void {
    l.tex?.dispose();
    if (l.tex) this.host?.setTexture(id, null);
    this.listeners.delete(id);
  }

  // ── Card actions ─────────────────────────────────────────────────────────────────────────────────────────

  /** Load a picked file (or any audio Blob with a name) into a source. Resolves with an error message, or null. */
  async loadFile(nodeId: string, file: Blob & { name: string }): Promise<string | null> {
    try {
      await audioEngine.loadAudio(nodeId, await file.arrayBuffer(), file.name);
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    const s = this.sources.get(nodeId);
    if (s) { s.loaded = true; s.applied = ''; this.applyPlayback(s); }
    this.changed();
    return null;
  }

  /**
   * Learn a sound from the loaded file between `from` and `to` seconds (the strongest hit in there), or, with no
   * range (the Mic), from the last couple of seconds heard ("Learn last hit"). The fingerprint, or why not.
   */
  learn(nodeId: string, range?: { from: number; to: number }): LearnResult {
    const s = this.sources.get(nodeId);
    if (!s) return { error: 'This Audio Source isn\'t running.' };
    if (!range) return learnFromRing(s.learn);
    const buf = audioEngine.buffer(nodeId);
    if (!buf) return { error: 'Load a sound first.' };
    // Mono: the channels' average.
    const a = Math.max(0, Math.floor(range.from * buf.sampleRate) - 4096), b = Math.min(buf.length, Math.ceil(range.to * buf.sampleRate) + 8192);
    const mono = new Float32Array(Math.max(0, b - a));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[a + i] / buf.numberOfChannels;
    }
    const off = a / buf.sampleRate;
    const r = learnFromSamples(mono, buf.sampleRate, range.from - off, range.to - off);
    return 'error' in r ? r : { ...r, at: r.at + off };
  }

  /** Open the microphone (call from a click: the browser asks). */
  async startMic(nodeId: string): Promise<void> {
    const s = this.sources.get(nodeId);
    if (s) this.setStatus(s, 'Asking for the microphone…');
    await liveAudio.start();
    if (s) { s.micSince = performance.now(); this.refreshStatus(s); }
  }

  // ── Every frame ──────────────────────────────────────────────────────────────────────────────────────────

  wantsTick(): boolean {
    return this.sources.size > 0 || this.listeners.size > 0;
  }

  tickInputs(_dt: number, _time: number, write: InputWriter): void {
    const nowMs = performance.now();
    const dt = this.lastTick ? Math.min(0.1, (nowMs - this.lastTick) / 1000) : 1 / 60;
    this.lastTick = nowMs;
    this.frame++;
    for (const [id, s] of this.sources) {
      this.readSource(s);
      write(`${id}::level`, s.level);
      write(`${id}::time`, s.time);
      spectrumBins(s.freq, s.sampleRate, s.row, 'log', -90, -20, 0.5);
      for (const b of s.bands) {
        const run = s.runs.get(b.id);
        if (!run) continue;
        stepBandRun(run, b, s.freq, s.sampleRate, nowMs / 1000, dt);
        if (b.value) write(`${id}::${bandValueKey(b.id)}`, run.band.level);
        if (b.trigger) write(`${id}::${bandTriggerKey(b.id)}`, run.hit.trigger);
      }
      stepLearn(s.learn, s.sounds, s.freq, s.sampleRate, nowMs / 1000, dt);
      for (const snd of s.sounds) {
        const r = s.learn.runs.get(snd.id);
        if (!r) continue;
        if (snd.trigger) write(`${id}::${soundTriggerKey(snd.id)}`, r.trigger);
        if (snd.matchOut) write(`${id}::${soundMatchKey(snd.id)}`, r.match);
      }
    }
    for (const [id, l] of this.listeners) this.runListener(id, l, nowMs, dt, write);
  }

  private readSource(s: SourceSlot): void {
    const id = s.node.id, playing = s.node.params.playing !== false;
    if (s.loaded && !audioEngine.isLoaded(id)) this.syncSource(s.node);
    const upstream = !playing ? null : s.kind === 'mic' ? liveAudio.tapNode() : (audioEngine.isPlaying(id) ? audioEngine.getAnalyser(id) : null);
    if (upstream !== s.upstream) {
      if (s.upstream && s.probe) { try { s.upstream.disconnect(s.probe); } catch { /* gone */ } }
      s.upstream = upstream;
      if (upstream) {
        if (!s.probe || s.probe.context !== upstream.context) {
          s.probe = upstream.context.createAnalyser();
          s.probe.fftSize = FFT;
          s.probe.smoothingTimeConstant = 0;
        }
        upstream.connect(s.probe);
        s.sampleRate = upstream.context.sampleRate;
      }
      if (s.kind === 'mic') this.refreshStatus(s);
    }
    s.active = !!upstream && !!s.probe;
    if (s.active) {
      s.probe!.getFloatFrequencyData(s.freq);
      s.probe!.getFloatTimeDomainData(s.wave);
      const gain = Math.max(0, num(s.node.params.gain, 1));
      if (gain !== 1) {
        const db = 20 * Math.log10(Math.max(1e-6, gain));
        for (let i = 0; i < s.freq.length; i++) s.freq[i] += db;
        for (let i = 0; i < s.wave.length; i++) s.wave[i] *= gain;
      }
      s.level = rmsLevel(s.wave);
    } else {
      s.freq.fill(-200);
      s.wave.fill(0);
      s.level = 0;
    }
    s.time = s.kind === 'mic' ? (s.micSince && s.active ? (performance.now() - s.micSince) / 1000 : 0) : audioEngine.position(id) ?? 0;
    // A file that played to its end: the card says so.
    if (s.kind !== 'mic' && s.loaded && !audioEngine.isPlaying(id) && s.status.endsWith('playing')) this.refreshStatus(s);
  }

  private runListener(id: string, l: ListenSlot, nowMs: number, dt: number, write: InputWriter): void {
    const s = l.sourceId ? this.sources.get(l.sourceId) : undefined;
    const freq = s?.active ? s.freq : this.silentFreq, wave = s?.active ? s.wave : this.silentWave, sr = s?.sampleRate ?? 48000;
    const P = l.node.params;
    switch (l.node.type) {
      case AUDIO_BAND_TYPE: {
        const { lo, hi } = audioBandOf(l.node);
        l.band = stepBand(l.band, bandLevel(freq, sr, lo, hi), dt, num(P.attack, 0.01), num(P.release, 0.15), Math.max(0, num(P.gain, 1)));
        write(`${id}::level`, l.band.level);
        write(`${id}::peak`, l.band.peak);
        return;
      }
      case AUDIO_HIT_TYPE: {
        const { lo, hi } = audioBandOf(l.node);
        stepHit(l.hit, freq, sr, nowMs / 1000, dt, { lo, hi, sensitivity: num(P.sensitivity, 0.5), cooldownMs: num(P.cooldown, 120), decay: num(P.decay, 0.3) });
        if (l.hit.trigger) l.hitAt = nowMs;
        write(`${id}::trigger`, l.hit.trigger);
        write(`${id}::envelope`, l.hit.envelope);
        write(`${id}::count`, l.hit.count);
        write(`${id}::strength`, l.hit.strength);
        return;
      }
    }
    if (!l.tex) return;
    // A silent source leaves the picture as it was (no upload) once it has gone quiet.
    const data = l.tex.image.data as Uint8Array;
    const layout: SpectrumLayout = P.layout === 'linear' ? 'linear' : 'log';
    switch (l.node.type) {
      case AUDIO_SPECTRUM_TYPE:
        spectrumBins(freq, sr, l.row, layout, num(P.minDb, -90), num(P.maxDb, -20), num(P.smoothing, 0.5));
        writeRow(data, 0, l.row, l.w);
        break;
      case AUDIO_SPECTROGRAM_TYPE:
        if (!s?.active) return; // the history holds while nothing plays
        spectrumBins(freq, sr, l.row, layout, num(P.minDb, -90), num(P.maxDb, -20));
        scrollRows(data, l.w, l.h, l.row);
        break;
      case AUDIO_WAVEFORM_TYPE:
        waveRow(wave, l.row);
        writeRow(data, 0, l.row, l.w);
        break;
    }
    l.tex.needsUpdate = true;
  }
}

export const audioToolsEngine = new AudioToolsEngine();

/** For checking in dev: `window.__audioTools`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __audioTools?: unknown }).__audioTools = audioToolsEngine;
