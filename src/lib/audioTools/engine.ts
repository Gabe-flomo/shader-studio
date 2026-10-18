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
 * - The per-frame sums (a source's bands and learned sounds, every listening node) are play/kit/audioTools.js
 *   (atStepSource, atStepListener): an exported page runs the same code on the same frames.
 * - File: a picked file is kept in the media library (lib/backgroundLibrary.ts, with the videos; the node keeps its
 *   `sampleId`), so `sync` opens it again after a reload. Video: a Video node's element (lib/videoEngine.ts, or a
 *   Baked node's, lib/bakedVideos.ts) is routed through a MediaElementSource into the probe and on to the speakers.
 *
 * - Effects (Filter, Resonator bank, Spectral: play/kit/audioChain.js) take the sound of the node wired into them (a
 *   source or another effect), built in its context; a listener wired to an effect hears what the effect made. What
 *   plays: graphWalk.ts audioHearing (the last effect with Listen on in each chain; its source goes quiet).
 *
 * - Stems (lib/audioTools/stems.ts, docs/stems.md): a File source with a Stem picked plays that stem in step with the
 *   song (lib/audioEngine.ts setStem); its analyser is what the bands, learned sounds, listeners and effects take.
 *   Hear: Full mix (the default) keeps the song on the speakers, This stem plays the stem instead.
 *
 * Nodes inside groups (plain, iterated, nested) are followed too (graphWalk.ts): an `audio` wire through a group
 * ports reaches its source, and every node is keyed by its own id, as the compiler binds it.
 */
import * as THREE from 'three';
import type { GraphNode } from '../../types/nodeGraph';
import type { InputSource, InputWriter } from '../inputBus';
import { inputBus } from '../inputBus';
import { audioEngine, trackChainId } from '../audioEngine';
import { audioFxHost } from '../audioFx';
import { liveAudio } from '../liveAudio';
import { videoEngine } from '../videoEngine';
import { bakedVideos } from '../bakedVideos';
import { mediaElementSourceOf } from '../videoSound';
import { getVideo } from '../backgroundLibrary';
import {
  AUDIO_HIT_TYPE, AUDIO_SOURCE_TYPE, AUDIO_TEXTURE_TYPES, audioSoundsOf, audioSourceKind, audioTextureSize, effectSpecOf, isAudioFxType, listenerSpecOf,
  type AudioSourceKind,
} from '../../nodes/definitions/audioTools';
import { audioHearing, collectAudioNodes, findNodeDeep } from './graphWalk';
import { acBuild, acNewRun, acStepEffect, acTextureSize, type AcEffect, type AcRun, type AcSpec } from '../../play/kit/audioChain.js';
import { learnFromRing, learnFromSamples, newLearnListener, type AudioSoundSpec, type LearnListener, type LearnResult } from './learn';
import { bandsOf, newBandRun, trimWindow, type AudioBandSpec, type BandRun } from './bands';
import { analysedStem, analysedStemId, hearsStem, stemsOf, type StemChoice } from './stems';
import { forgetMedia, rememberMedia } from '../mediaSources';
import { STEM_LABELS } from '../../stemModel/config';
import { atApplyGain, atNewListener, atStepListener, atStepSource, type AtListener } from '../../play/kit/audioTools.js';

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
  /** File: the library id being (or last) opened, and whether the library had it. */
  restoring: string;
  missing: boolean;
  /** Video: the element whose sound is routed here, its inlet (the probe's upstream) and the gain to the speakers. */
  videoEl: HTMLMediaElement | null;
  videoIn: GainNode | null;
  videoOut: GainNode | null;
  videoUnplug: (() => void) | null;
  upstream: AudioNode | null;
  probe: AnalyserNode | null;
  freq: Float32Array<ArrayBuffer>;
  wave: Float32Array<ArrayBuffer>;
  sampleRate: number;
  active: boolean;
  level: number;
  time: number;
  micSince: number;
  status: string;
  /** The stem the analysis reads: its library id when loaded, the one being opened, and whether the library lacks it. */
  stemHave: string;
  stemLoading: string;
  stemMissing: boolean;
}

/**
 * An effect (Filter, Resonator bank, Spectral: play/kit/audioChain.js): its Web Audio nodes, built in the context of
 * the sound it takes (`upstreamId`: a source or another effect), and its numbers and texture.
 */
interface FxSlot {
  node: GraphNode;
  upstreamId: string | null;
  /** The Audio Source its chain starts at. */
  rootId: string | null;
  fx: AcEffect | null;
  /** The upstream node the effect's input is connected to now. */
  from: AudioNode | null;
  /** Plays through the speakers (graphWalk audioHearing), and the way to take it off them. */
  heard: boolean;
  unplugOut: (() => void) | null;
  spec: AcSpec;
  run: AcRun;
  tex: THREE.DataTexture | null;
  active: boolean;
}

interface ListenSlot {
  node: GraphNode;
  sourceId: string | null;
  /** Its running state (play/kit/audioTools.js): band, hit, row, texture bytes, size, last hit (performance.now ms). */
  run: AtListener;
  tex: THREE.DataTexture | null;
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
  /** The stem the analysis reads now ('mix' while none is loaded). */
  stem: StemChoice;
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
  private effects = new Map<string, FxSlot>();
  /** Sources whose own sound is quiet because an effect after them is heard, and the file chains diverted for it. */
  private dryMuted = new Set<string>();
  private diverted = new Set<string>();
  private sinks = new WeakMap<BaseAudioContext, GainNode>();
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
      for (const [id, f] of this.effects) if (f.tex) host.setTexture(id, f.tex);
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
    const f = this.effects.get(nodeId);
    if (f) { const r = f.run; return { level: r.level, peak: r.peak, envelope: 0, count: r.loudest, hitAt: 0, row: r.row, data: r.data, w: r.w, h: r.h, active: f.active }; }
    const l = this.listeners.get(nodeId);
    if (!l) return null;
    const active = !!(l.sourceId && (this.sources.get(l.sourceId)?.active || this.effects.get(l.sourceId)?.active));
    const r = l.run;
    return {
      level: l.node.type === AUDIO_HIT_TYPE ? r.hit.strength : r.band.level, peak: r.band.peak, envelope: r.hit.envelope, count: r.hit.count,
      hitAt: r.hitAt, row: r.row, data: r.data, w: r.w, h: r.h, active,
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
      duration: s.kind === 'file' && s.loaded ? audioEngine.duration(nodeId) : 0, bands, sounds, stem: this.stemReady(s) ? analysedStem(s.node.params) : 'mix',
    };
  }

  // ── The graph ────────────────────────────────────────────────────────────────────────────────────────────

  /** The graph changed: every Audio node at any depth (groups too) gets its slot; a removed one's goes. */
  sync(nodes: readonly GraphNode[]): void {
    this.graph = nodes;
    const audio = collectAudioNodes(nodes);
    const srcIds = new Set(audio.filter(r => r.node.type === AUDIO_SOURCE_TYPE).map(r => r.node.id));
    for (const [id, s] of this.sources) if (!srcIds.has(id)) this.dropSource(id, s);
    const isListener = (t: string) => t !== AUDIO_SOURCE_TYPE && !isAudioFxType(t);
    for (const [id, l] of this.listeners) if (!audio.some(r => r.node.id === id && isListener(r.node.type))) this.dropListener(id, l);
    for (const [id, f] of this.effects) if (!audio.some(r => r.node.id === id && isAudioFxType(r.node.type))) this.dropEffect(id, f);
    // Sources first, then effects, so a listener finds the slot of the sound it takes.
    for (const r of audio) if (r.node.type === AUDIO_SOURCE_TYPE) this.syncSource(r.node);
    const hearing = audioHearing(audio, id => this.sources.get(id)?.kind ?? null);
    this.dryMuted = hearing.dryMuted;
    for (const r of audio) if (isAudioFxType(r.node.type)) this.syncEffect(r.node, r.sourceId, hearing.rootOf.get(r.node.id) ?? null, hearing.heard.has(r.node.id));
    for (const r of audio) if (isListener(r.node.type)) this.syncListener(r.node, r.sourceId);
  }

  /** The graph last synced (the Video tab finds its video node in it). */
  private graph: readonly GraphNode[] = [];

  /** The ids of the nodes the engine runs now (for tests and checks): sources, and listeners with their source. */
  slots(): {
    sources: string[]; listeners: Array<{ id: string; sourceId: string | null; texture: boolean }>;
    effects: Array<{ id: string; upstreamId: string | null; rootId: string | null; heard: boolean; texture: boolean }>; dryMuted: string[];
  } {
    return {
      sources: [...this.sources.keys()],
      listeners: [...this.listeners].map(([id, l]) => ({ id, sourceId: l.sourceId, texture: !!l.tex })),
      effects: [...this.effects].map(([id, f]) => ({ id, upstreamId: f.upstreamId, rootId: f.rootId, heard: f.heard, texture: !!f.tex })),
      dryMuted: [...this.dryMuted],
    };
  }

  private syncSource(n: GraphNode): void {
    let s = this.sources.get(n.id);
    if (!s) {
      s = {
        node: n, kind: audioSourceKind(n), loaded: false, applied: '', upstream: null, probe: null, runs: new Map(), bands: [],
        sounds: [], learn: newLearnListener(),
        row: new Float32Array(CARD_SPECTRUM_BINS), restoring: '', missing: false, videoEl: null, videoIn: null, videoOut: null, videoUnplug: null,
        freq: new Float32Array(FFT / 2), wave: new Float32Array(FFT), sampleRate: 48000, active: false, level: 0, time: 0, micSince: 0, status: '',
        stemHave: '', stemLoading: '', stemMissing: false,
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
    if (s.kind !== 'video' && s.videoEl) this.unplugVideo(s);
    this.restoreFile(s);
    this.applyPlayback(s);
    this.syncStem(s);
  }

  // ── Stems ────────────────────────────────────────────────────────────────────────────────────────────────

  /** The picked stem is loaded and plays with the song: the analysis reads it. */
  private stemReady(s: SourceSlot): boolean {
    return s.kind === 'file' && s.loaded && !!s.stemHave && s.stemHave === analysedStemId(s.node.params) && !!audioEngine.stemAnalyser(s.node.id);
  }

  /** Load the picked stem (from the library) into the song's track, or take it away; and what the speakers play. */
  private syncStem(s: SourceSlot): void {
    const id = s.node.id;
    const want = s.kind === 'file' && s.loaded ? analysedStemId(s.node.params) : '';
    // The track was loaded again (a new file, or reopened): its stem went with the old one.
    if (s.stemHave && !audioEngine.stemAnalyser(id)) s.stemHave = '';
    if (!want) {
      if (s.stemHave || audioEngine.stemAnalyser(id)) { audioEngine.setStem(id, null); forgetMedia(`${id}::stem`); }
      s.stemHave = ''; s.stemLoading = ''; s.stemMissing = false;
    } else if (want !== s.stemHave && want !== s.stemLoading) {
      s.stemLoading = want;
      s.stemMissing = false;
      void (async () => {
        const got = await getVideo(want).catch(() => null);
        const still = () => this.sources.get(id) === s && analysedStemId(s.node.params) === want && s.loaded;
        if (!still()) { if (s.stemLoading === want) s.stemLoading = ''; return; }
        if (!got) { s.stemLoading = ''; s.stemMissing = true; this.refreshStatus(s); this.changed(); return; }
        try {
          // Kept for a web page (as the song is), then decoded in the song's context.
          rememberMedia(`${id}::stem`, 'audio', got.name, got.type, got.blob);
          const buf = await audioEngine.context().decodeAudioData(await got.blob.arrayBuffer());
          if (!still()) { if (s.stemLoading === want) s.stemLoading = ''; return; }
          audioEngine.setStem(id, buf);
          s.stemHave = want;
        } catch (e) {
          console.warn('[audio tools] stem', e);
          s.stemMissing = true;
        }
        s.stemLoading = '';
        audioEngine.setHearStem(id, hearsStem(s.node.params) && s.stemHave === want);
        this.refreshStatus(s);
        this.changed();
      })();
    }
    if (s.loaded) audioEngine.setHearStem(id, hearsStem(s.node.params) && !!s.stemHave && s.stemHave === want);
  }

  /** A File source whose sound isn't open but is kept in the library (`sampleId`): open it (a reload, a graph loaded). */
  private restoreFile(s: SourceSlot): void {
    const id = s.node.id, sampleId = typeof s.node.params.sampleId === 'string' ? s.node.params.sampleId : '';
    if (s.kind !== 'file' || s.loaded || !sampleId || s.restoring === sampleId) return;
    s.restoring = sampleId;
    s.missing = false;
    void (async () => {
      const got = await getVideo(sampleId).catch(() => null);
      // Replaced or gone meanwhile.
      if (this.sources.get(id) !== s || s.node.params.sampleId !== sampleId || s.loaded) return;
      if (!got) { s.missing = true; this.refreshStatus(s); return; }
      const err = await this.loadFile(id, new File([got.blob], got.name, { type: got.type || got.blob.type }));
      if (err) { s.missing = true; this.refreshStatus(s); }
    })();
  }

  /** Is a File source's kept sound being opened from the library right now (for tests and the card)? */
  restoringFrom(nodeId: string): string { const s = this.sources.get(nodeId); return s && !s.loaded && !s.missing ? s.restoring : ''; }

  /** Start or stop the sound when its kind, Play or Loop changed (not every sync: a file that played to its end stays stopped). */
  private applyPlayback(s: SourceSlot): void {
    const id = s.node.id, playing = s.node.params.playing !== false, loop = s.node.params.loop !== false;
    const win = s.loaded ? trimWindow(audioEngine.duration(id), s.node.params.trimIn, s.node.params.trimOut) : null;
    const key = `${s.kind}:${playing}:${loop}:${s.loaded}:${win ? `${win.start.toFixed(4)}-${win.end.toFixed(4)}` : ''}`;
    if (key === s.applied) { this.refreshStatus(s); return; }
    s.applied = key;
    if (s.kind !== 'file') {
      if (audioEngine.isPlaying(id)) audioEngine.stopAudio(id);
      if (s.kind === 'mic' && playing && !s.micSince) s.micSince = performance.now();
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
    } else if (s.kind === 'video') {
      text = this.videoStatus(s);
    } else if (!s.loaded) {
      const was = typeof s.node.params._fileName === 'string' ? s.node.params._fileName : '';
      const kept = typeof s.node.params.sampleId === 'string' && s.node.params.sampleId;
      text = kept && !s.missing ? `Opening "${was || 'the sound'}" from the library…`
        : was ? `"${was}" isn't in this browser's library: load it again, or switch to Mic.` : 'Load a sound, or switch to Mic.';
    }
    else {
      text = `${audioEngine.getFileName(s.node.id) || 'Sound'} · ${audioEngine.isPlaying(s.node.id) ? 'playing' : 'stopped'}`;
      const stem = analysedStem(s.node.params);
      if (s.stemMissing) text += ' · the stems aren\'t in this browser\'s library: Separate again';
      else if (stem !== 'mix') text += s.stemHave ? ` · analysing ${STEM_LABELS[stem]}${hearsStem(s.node.params) ? ' (heard)' : ''}` : ` · opening the ${STEM_LABELS[stem]} stem…`;
      else if (!stemsOf(s.node.params) && s.node.params.stems) text += ' · its stems are for another song';
    }
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
      l = { node: n, sourceId: null, run: atNewListener(n.type, 0, 0), tex: null };
      this.listeners.set(n.id, l);
    }
    l.node = n;
    l.sourceId = sourceId && (this.sources.has(sourceId) || this.effects.has(sourceId)) ? sourceId : null;
    if (AUDIO_TEXTURE_TYPES.has(n.type)) {
      const { w, h } = audioTextureSize(n);
      if (w !== l.run.w || h !== l.run.h || !l.tex) {
        l.tex?.dispose();
        // Silence: 0 for a spectrum, 0.5 (the middle) for a waveform (atNewListener fills it).
        l.run = atNewListener(n.type, w, h);
        const tex = new THREE.DataTexture(l.run.data!, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.generateMipmaps = false;
        tex.flipY = false;
        tex.needsUpdate = true;
        // An exported page fills its own (runtime/play-runtime.js, the same kit sums): the export encodes this blank.
        tex.userData.canvas8 = blankCanvas();
        l.tex = tex;
        this.host?.setTexture(n.id, tex);
      }
    }
  }

  /** An effect's slot: settings, where it sits in its chain, whether it is heard; a texture sized for its spec. */
  private syncEffect(n: GraphNode, upstreamId: string | null, rootId: string | null, heard: boolean): void {
    const spec = effectSpecOf(n);
    let f = this.effects.get(n.id);
    if (!f) {
      f = { node: n, upstreamId, rootId, fx: null, from: null, heard, unplugOut: null, spec, run: acNewRun(spec), tex: null, active: false };
      this.effects.set(n.id, f);
    }
    f.node = n; f.upstreamId = upstreamId; f.rootId = rootId; f.heard = heard; f.spec = spec;
    const { w, h } = acTextureSize(spec);
    if (w !== f.run.w || h !== f.run.h) f.run = acNewRun(spec);
    if (f.run.data && (!f.tex || f.tex.image.data !== f.run.data)) {
      f.tex?.dispose();
      const tex = new THREE.DataTexture(f.run.data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.NearestFilter; tex.magFilter = THREE.NearestFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.flipY = false;
      tex.needsUpdate = true;
      // An exported page fills its own (runtime/play-runtime.js, the same kit): the export encodes this blank.
      tex.userData.canvas8 = blankCanvas();
      f.tex = tex;
      this.host?.setTexture(n.id, tex);
    }
  }

  private dropEffect(id: string, f: FxSlot): void {
    f.unplugOut?.();
    try { if (f.from && f.fx) f.from.disconnect(f.fx.input); } catch { /* gone */ }
    f.fx?.dispose();
    f.tex?.dispose();
    if (f.tex) this.host?.setTexture(id, null);
    this.effects.delete(id);
  }

  private dropSource(id: string, s: SourceSlot): void {
    this.setDry(id, s, false);
    this.unplugVideo(s);
    try { s.probe?.disconnect(); } catch { /* gone */ }
    try { if (s.upstream && s.probe) s.upstream.disconnect(s.probe); } catch { /* gone */ }
    if (s.loaded) audioEngine.removeAudio(id);
    forgetMedia(`${id}::stem`);
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
    if (s) { s.loaded = true; s.applied = ''; s.stemHave = ''; s.stemLoading = ''; this.applyPlayback(s); this.syncStem(s); }
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
    // The stem the analysis reads, when one is picked (Learn a kick on Drums).
    const buf = (this.stemReady(s) ? audioEngine.stemBuffer(nodeId) : null) ?? audioEngine.buffer(nodeId);
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
    return this.sources.size > 0 || this.listeners.size > 0 || this.effects.size > 0;
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
      // The card's spectrum, the bands' Value / Trigger, the learned sounds' Trigger / Match (play/kit/audioTools.js).
      atStepSource(s, s.bands, s.sounds, s.freq, s.sampleRate, nowMs / 1000, dt, (ch, v) => write(`${id}::${ch}`, v));
      this.setDry(id, s, this.dryMuted.has(id));
    }
    for (const [id, f] of this.effects) this.runEffect(id, f, dt, write);
    for (const [id, l] of this.listeners) this.runListener(id, l, nowMs, dt, write);
  }

  // ── Effects ──────────────────────────────────────────────────────────────────────────────────────────────

  /** The Web Audio node a producer's sound comes out of (a source's, or an effect's output), or null with none now. */
  private outOf(id: string | null): AudioNode | null {
    if (!id) return null;
    const f = this.effects.get(id);
    if (f) return f.fx?.output ?? null;
    const s = this.sources.get(id);
    if (!s || s.node.params.playing === false) return null;
    if (s.kind === 'mic') return liveAudio.tapNode();
    if (s.kind === 'video') return s.videoIn;
    // The picked stem, when there is one: the effects work on it.
    return s.loaded ? (this.stemReady(s) ? audioEngine.stemAnalyser(id) : audioEngine.getAnalyser(id)) : null;
  }

  /**
   * One frame of an effect: built in the context its sound lives in, joined to it, its numbers moved (a Play control
   * driving one wins, through the input bus), joined to the speakers when it is heard, then its numbers and texture.
   */
  private runEffect(id: string, f: FxSlot, dt: number, write: InputWriter): void {
    const from = this.outOf(f.upstreamId);
    if (f.fx && from && f.fx.ctx !== from.context) {
      f.unplugOut?.(); f.unplugOut = null;
      try { if (f.from) f.from.disconnect(f.fx.input); } catch { /* gone */ }
      f.fx.dispose(); f.fx = null; f.from = null;
    }
    const spec = effectSpecOf(f.node, key => inputBus.paramValue(`${id}::${key}`));
    f.spec = spec;
    if (!f.fx && from) f.fx = acBuild(from.context, spec);
    if (from !== f.from) {
      if (f.from && f.fx) { try { f.from.disconnect(f.fx.input); } catch { /* gone */ } }
      if (from && f.fx) from.connect(f.fx.input);
      f.from = from;
    }
    f.fx?.update(spec);
    // Heard: through the master volume and the recording bus, as the songs are (a Mic's context never is).
    const audible = !!(f.heard && f.fx && f.rootId && this.sources.get(f.rootId)?.kind !== 'mic');
    if (audible && !f.unplugOut) f.unplugOut = audioEngine.connectOutside(f.fx!.output);
    else if (!audible && f.unplugOut) { f.unplugOut(); f.unplugOut = null; }
    const root = f.rootId ? this.sources.get(f.rootId) : undefined;
    f.active = !!(root?.active && f.fx && from);
    const changed = acStepEffect(f.run, f.fx, spec, f.active, dt, (ch, v) => write(`${id}::${ch}`, v));
    if (changed && f.tex) f.tex.needsUpdate = true;
  }

  /** A gain to nowhere in a context: a diverted chain goes there (its analyser still reads it). */
  private sinkOf(ctx: BaseAudioContext): GainNode {
    let g = this.sinks.get(ctx);
    if (!g) { g = ctx.createGain(); g.gain.value = 0; this.sinks.set(ctx, g); }
    return g;
  }

  /** Quiet a source's own sound (an effect after it is heard) or let it play again. */
  private setDry(id: string, s: SourceSlot, mute: boolean): void {
    if (s.videoOut) s.videoOut.gain.value = mute ? 0 : 1;
    // A file's chain goes to a sink instead of the mix (its analyser, which the effects take, still reads it).
    if (mute && s.kind === 'file' && s.loaded && !this.diverted.has(id) && !audioFxHost.isDiverted(trackChainId(id))) {
      const ctx = audioEngine.context();
      audioFxHost.divert(ctx, trackChainId(id), this.sinkOf(ctx));
      this.diverted.add(id);
    } else if ((!mute || s.kind !== 'file') && this.diverted.has(id)) {
      audioFxHost.divert(audioEngine.context(), trackChainId(id), null);
      this.diverted.delete(id);
    }
  }

  private readSource(s: SourceSlot): void {
    const id = s.node.id, playing = s.node.params.playing !== false;
    if (s.loaded && !audioEngine.isLoaded(id)) this.syncSource(s.node);
    if (s.kind === 'video' && !playing) this.unplugVideo(s);
    const upstream = !playing ? null
      : s.kind === 'mic' ? liveAudio.tapNode()
      : s.kind === 'video' ? this.videoUpstream(s)
      : (audioEngine.isPlaying(id) ? (this.stemReady(s) ? audioEngine.stemAnalyser(id) : audioEngine.getAnalyser(id)) : null);
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
    // A video that is paused or still opening sounds nothing: silence, not its last frame.
    s.active = !!upstream && !!s.probe && !(s.kind === 'video' && (!s.videoEl || s.videoEl.paused));
    if (s.active) {
      s.probe!.getFloatFrequencyData(s.freq);
      s.probe!.getFloatTimeDomainData(s.wave);
      s.level = atApplyGain(s.freq, s.wave, num(s.node.params.gain, 1));
    } else {
      s.freq.fill(-200);
      s.wave.fill(0);
      s.level = 0;
    }
    s.time = s.kind === 'mic' ? (s.micSince && s.active ? (performance.now() - s.micSince) / 1000 : 0)
      : s.kind === 'video' ? (s.videoEl?.currentTime ?? 0) : audioEngine.position(id) ?? 0;
    if (s.kind === 'video') this.refreshStatus(s);
    // A file that played to its end: the card says so.
    if (s.kind === 'file' && s.loaded && !audioEngine.isPlaying(id) && s.status.endsWith('playing')) this.refreshStatus(s);
  }

  private runListener(id: string, l: ListenSlot, nowMs: number, dt: number, write: InputWriter): void {
    const src = l.sourceId ? this.sources.get(l.sourceId) : undefined;
    const f = l.sourceId && !src ? this.effects.get(l.sourceId) : undefined;
    // The sound it takes: a source's frame, or an effect's (what the effect made).
    const s = src ?? (f ? { active: f.active, freq: f.run.freq, wave: f.run.wave, sampleRate: f.run.sr } : undefined);
    const freq = s?.active ? s.freq : this.silentFreq, wave = s?.active ? s.wave : this.silentWave, sr = s?.sampleRate ?? 48000;
    // Band level, Hit, or a texture (play/kit/audioTools.js): a silent Spectrogram holds what it had (no upload).
    const changed = atStepListener(l.run, listenerSpecOf(l.node), freq, wave, sr, !!s?.active, nowMs, dt, (ch, v) => write(`${id}::${ch}`, v));
    if (changed && l.tex) l.tex.needsUpdate = true;
  }

  // ── The Video tab ────────────────────────────────────────────────────────────────────────────────────────

  /** The video node a Video source listens to, and its element (null while it has none open). */
  private videoOf(s: SourceSlot): { node: GraphNode | null; el: HTMLMediaElement | null } {
    const vid = typeof s.node.params.videoNode === 'string' ? s.node.params.videoNode : '';
    const node = vid ? findNodeDeep(this.graph, vid) ?? null : null;
    if (!node) return { node: null, el: null };
    return { node, el: (node.type === 'baked' ? bakedVideos.element(vid) : videoEngine.element(vid)) ?? null };
  }

  /** Route the video node's element into the probe (once per element) and on to the speakers; the probe's upstream. */
  private videoUpstream(s: SourceSlot): AudioNode | null {
    const { el } = this.videoOf(s);
    if (el !== s.videoEl) {
      this.unplugVideo(s);
      if (el) this.plugVideo(s, el);
    }
    return s.videoIn;
  }

  private plugVideo(s: SourceSlot, el: HTMLMediaElement): void {
    let ctx: AudioContext;
    try { ctx = audioEngine.context(); } catch { return; }
    const src = mediaElementSourceOf(ctx, el);
    if (!src) return;
    const inlet = ctx.createGain(), out = ctx.createGain();
    src.connect(inlet);
    inlet.connect(out);
    out.gain.value = 1;
    const unOut = audioEngine.connectOutside(out);
    s.videoEl = el; s.videoIn = inlet; s.videoOut = out;
    s.videoUnplug = () => {
      unOut();
      try { src.disconnect(inlet); } catch { /* gone */ }
      try { inlet.disconnect(); out.disconnect(); } catch { /* gone */ }
    };
    // The video node plays muted: its sound now goes through here instead (a browser may want a click first).
    unmuteWhenAllowed(el);
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }

  private unplugVideo(s: SourceSlot): void {
    if (!s.videoEl) return;
    s.videoUnplug?.();
    s.videoEl.muted = true;
    if (s.upstream && s.upstream === s.videoIn) {
      if (s.probe) { try { s.upstream.disconnect(s.probe); } catch { /* gone */ } }
      s.upstream = null;
    }
    s.videoEl = null; s.videoIn = null; s.videoOut = null; s.videoUnplug = null;
  }

  private videoStatus(s: SourceSlot): string {
    const { node, el } = this.videoOf(s);
    if (!node) {
      return typeof s.node.params.videoNode === 'string' && s.node.params.videoNode
        ? 'That video node is gone: pick another video.' : 'Pick a video node (a Texture node playing a video, or a Baked node).';
    }
    const P = node.params;
    const label = (typeof P.label === 'string' && P.label.trim()) || (typeof P._fileName === 'string' && P._fileName) || (typeof P.fileName === 'string' && P.fileName) || 'the video';
    if (!el) return `Waiting for ${label} to open its video.`;
    if (s.node.params.playing === false) return `${label} · Play is off`;
    return `${label} · ${el.paused ? 'paused' : 'playing'} (a video without sound reads silence)`;
  }

  /** Is a Video source routed to its video's element now (for tests)? */
  videoRouted(nodeId: string): HTMLMediaElement | null { return this.sources.get(nodeId)?.videoEl ?? null; }
}

/** Unmute a video element now if the page has had a click, else on the next one (browsers block sound before). */
function unmuteWhenAllowed(el: HTMLMediaElement): void {
  const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation : undefined;
  if (!ua || ua.hasBeenActive || typeof window === 'undefined') { el.muted = false; return; }
  const go = () => { window.removeEventListener('pointerdown', go, true); window.removeEventListener('keydown', go, true); el.muted = false; };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

export const audioToolsEngine = new AudioToolsEngine();

/** For checking in dev: `window.__audioTools`. */
if (import.meta.env?.DEV && typeof window !== 'undefined') (window as unknown as { __audioTools?: unknown }).__audioTools = audioToolsEngine;
