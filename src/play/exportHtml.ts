/**
 * exportHtml.ts — put a Play setup on the web.
 *
 * Two outputs from the same bundle (the compiled fragment shader, the uniform
 * values, the Play record) and the same standalone runtime
 * (runtime/play-runtime.js):
 *
 *   buildPlayHtml     one self-contained page, to download and host or iframe
 *   buildPlaySnippet  a <div> + <script> to paste into any page or site builder
 *
 * and two modes:
 *
 *   player      the picture with its controls panel
 *   background  the picture only: fills its section (or the whole page) behind
 *               your content, never takes clicks or keys from the page, pauses
 *               off-screen, and shows a still frame for reduced motion
 *
 * The runtime runs what the app's canvas does: previous-frame feedback and
 * echo (ping-pong targets), Pass nodes (render to texture, on the app's own
 * schedule: kit/passPlan.js), Agents groups (kit/agentPlan.js, the app's
 * schedule, and the Particles engine's shaders), image, video and audio
 * inputs (carried in the page as data URLs), and GPU particle systems. `unsupportedFeatures` lists what a
 * graph uses that it still can't run, `leftBehind` what stays out of the page,
 * and `mediaCarried` what each image, video or song adds to it.
 */
import { conditionRanges, readsPicture } from './conditionRange';
import runtimeSource from './runtime/play-runtime.js?raw';
import particleSource from './particle-sim.js?raw';
import geometrySource from './kit/geometry.js?raw';
import sketch3dSource from './kit/sketch3d.js?raw';
import p5Source from './kit/p5.js?raw';
import fontsSource from './kit/fonts.js?raw';
import glyphsSource from './kit/glyphs.js?raw';
import layersSource from './kit/layers.js?raw';
import bodiesSource from './kit/bodies.js?raw';
import relationshipSource from './kit/relationship.js?raw';
import agentsSource from './kit/agents.js?raw';
import motionSource from './kit/motion.js?raw';
import handsSource from './kit/hands.js?raw';
import tracksSource from './kit/tracks.js?raw';
import faceSource from './kit/face.js?raw';
import poseSource from './kit/pose.js?raw';
import queueSource from './kit/queue.js?raw';
import mattesSource from './kit/mattes.js?raw';
import displaceSource from './kit/displace.js?raw';
import dataSource from './kit/data.js?raw';
import midiSource from './kit/midi.js?raw';
import kitSource from './kit/kit.js?raw';
import finishGlslSource from './kit/finishGlsl.js?raw';
import finishSource from './kit/finish.js?raw';
import waterLayerSource from './kit/waterLayer.js?raw';
import audioFxSource from './kit/audioFx.js?raw';
import signalsSource from './kit/signals.js?raw';
import incrementSource from './kit/increment.js?raw';
import routesSource from './kit/routes.js?raw';
import fnSource from './kit/fn.js?raw';
import spreadSource from './kit/spread.js?raw';
import drumPadsSource from './kit/drumPads.js?raw';
import granulatorSource from './kit/granulator.js?raw';
import macrosSource from './kit/macros.js?raw';
import jfaSource from './kit/jfa.js?raw';
import gpuParticlesSource from './kit/gpuParticles.js?raw';
import passPlanSource from './kit/passPlan.js?raw';
import passHostSource from './kit/passHost.js?raw';
import agentPlanSource from './kit/agentPlan.js?raw';
import agentShadersSource from './kit/agentShaders.js?raw';
import agentHostSource from './kit/agentHost.js?raw';
import type { AeGrainSample } from '../types/playAudioEngine';
import type { AgentDepositProgram, AgentDrawProgram, AgentGroupProgram, AgentListener, AgentTrailProgram } from '../compiler/types';
import { renderableFinish } from '../types/playFinish';
import { applyGroupVisibility } from '../types/layerGroups';
import { BACKGROUND_VIDEO_KEEP, backgroundLayerOf, usesHands, type PlayRecord } from '../types/play';
import { TRACKER_NAMES, usesFace, usesPose, type TrackerKind } from '../types/playTracking';
import type { HandAssets } from './handExport';
import { PREVIEW_ASPECTS, type PreviewAspect } from '../utils/graphImportPlan';
import { playUses3D, threeSource } from './threeSource';
import { datasetsCarried, type WebDatasets } from './dataExport';
export { playUses3D };

export interface PlayHtmlInput {
  title: string;
  fragmentShader: string;
  /** Uniform name → current value (floats and [r, g, b]). */
  uniforms: Record<string, number | number[]>;
  /** `nodeId::paramKey` → uniform name, from the compile. */
  paramBindings: Record<string, string>;
  play: PlayRecord;
  aspect: PreviewAspect;
  /** Extra passes the picture needs; absent means a single fragment pass. */
  passes?: PlayPasses;
  /** Pass nodes' programs, in drawing order (webInput.ts webPasses); absent without a Pass node. */
  graphPasses?: WebPass[];
  /** The Agents family's programs and settings (webInput.ts webAgents); absent without one. */
  agents?: WebAgents;
  /** The Motion (texture) node's sampler (u_motionMap) when a program reads it; the page fills it from its first Motion layer. */
  motionMap?: string;
  /** The files the graph's inputs read. */
  media?: PlayMedia;
  /** Hand tracking's files (play/handExport.ts), when the author chose to include them. */
  handAssets?: HandAssets;
  /**
   * A Background layer's graph sources other than this graph, compiled (by
   * source id): the page runs each as a program of its own while it shows
   * (play/queueGraphs.ts queueGraphsForWeb).
   */
  backgroundGraphs?: Record<string, { fragmentShader: string; uniforms: Record<string, number | number[]> }>;
  /**
   * The datasets the page reads (play/dataExport.ts): each one's frozen
   * result and name, for Data nodes, Data layers, data mappings and s.data().
   * Never the notebook or the source file.
   */
  datasets?: WebDatasets;
}

/** What ShaderCanvas runs around the fragment shader, from the compile. */
export interface PlayPasses {
  /** Previous Frame and the blur family: ping-pong targets bound to u_prevFrame. */
  stateful: boolean;
  /** Echo nodes: `copies` snapshots `delay` frames apart, bound to u_echo0… */
  echo: { copies: number; delay: number } | null;
}

/**
 * A Pass node's program as the page runs it (kit/passHost.js): compiler/types.ts PassProgram
 * without the node lists, plus the sampler names it fills (nodes/definitions/passes.ts), so the
 * page never builds a uniform name of its own.
 */
export interface WebPass {
  slug: string;
  label: string;
  fragmentShader: string;
  scale: number;
  format: 'half' | 'byte';
  filter: 'linear' | 'nearest';
  wrap: 'clamp' | 'repeat' | 'mirror';
  previous: boolean;
  live: boolean;
  afterAgents?: boolean;
  /** Read by a Particles node: drawn before the particles step (kit/passPlan.js ppStaged part). */
  beforeParticles?: boolean;
  /** u_pass_<slug> and u_passprev_<slug> (each with its `_px`). */
  u: { tex: string; prev: string };
}

/**
 * The Agents family as the page runs it (kit/agentHost.js): compiler/types.ts AgentsSpec without
 * the node lists, each part with the uniform names it fills (nodes/definitions/agents.ts and
 * agentForces.ts), so the page never builds a uniform name of its own.
 */
export interface WebAgents {
  groups: Array<Omit<AgentGroupProgram, 'nodeId' | 'nodeIds' | 'readsTrails' | 'readsPasses' | 'listeners'> & {
    listeners: Array<Omit<AgentListener, 'nodeId'> & { u: { sound: string; shocks: string; levels: string; plateModes: string; plateCount: string; plateShake: string } }>;
    /** State samplers A–D, the step (uint) and the birth window (vec4). */
    u: { A: string; B: string; C: string; D: string; step: string; win: string };
    /** The sensor layer (`ag:<node id>`) the page's Play reads this group's readings as; absent when nothing does. */
    readAs?: string;
  }>;
  deposits: Array<Omit<AgentDepositProgram, 'nodeId'>>;
  trails: Array<Omit<AgentTrailProgram, 'nodeId' | 'stepNodeIds' | 'readsPasses'> & { u: { tex: string; src: string; step: string } }>;
  draws: Array<Omit<AgentDrawProgram, 'nodeId'> & { u: { tex: string } }>;
  /** The round Chladni plate's Bessel table sampler. */
  bessel: string;
}

/** One input's file. `src` is a data URL, or null when none is loaded or it is too big to carry (`bytes` > 0). */
export interface PlayMediaFile {
  /** What the dialog calls it: the node's label, and the file name when known. */
  label: string;
  name: string;
  src: string | null;
  /** The file's size (for a left-out one) or what it adds to the page. */
  bytes: number;
  /** An image scaled down to fit the page: its new longest side. */
  scaledTo?: number | null;
}

export interface PlayMedia {
  /** sampler uniform → its image. */
  textures?: Record<string, PlayMediaFile>;
  /** sampler uniform → its video. */
  videos?: Record<string, PlayMediaFile & { loop: boolean; speed: number }>;
  /** Audio Input nodes: the uniform per band (index = band), and how the bands are read. */
  audio?: (PlayMediaFile & { id: string; uniforms: string[]; bands: number[]; range: number; mode: string })[];
  /** Video layers' files, by layer id (the page puts each in its layer as `src`). */
  layerVideos?: Record<string, PlayMediaFile>;
  /** Drum pad layers' samples, by layer id and pad index (the page puts each in its pad as `src`). */
  layerPads?: Record<string, Record<string, PlayMediaFile>>;
  /** Granulator racks' Library samples, by rack id (the page puts each in the rack's sample as `src`). */
  rackSamples?: Record<string, PlayMediaFile>;
  /**
   * Baked tracks (docs/tracking.md), per tracker that follows a Video layer:
   * the layer, and the stored frames as base64 in `src` (null when they aren't
   * loaded here, or are over TRACK_LIMIT).
   */
  tracks?: Partial<Record<TrackerKind, PlayMediaFile & { layerId: string }>>;
}

export type EmbedMode = 'player' | 'background';
/** Background only: fill the section the snippet sits in, or the whole page behind everything. */
export type EmbedPlacement = 'section' | 'page';

export interface EmbedOptions {
  mode: EmbedMode;
  placement: EmbedPlacement;
  /** contain keeps the exported shape (letterboxed); cover fills the box. */
  fit: 'contain' | 'cover';
  /** Background: track the mouse over the whole page. */
  followPage: boolean;
  /** Show null markers (and let them be dragged in the player). */
  markers: boolean;
  /** Connect to the OSC bridge on load (background; a player has a button). */
  osc: boolean;
  /** Player snippet height in px. */
  height: number;
  /**
   * The page that frames this one may replace its Script layers' code by
   * postMessage (the Present page's sandboxed canvases). Never set for pages
   * people publish: any page framing them could run code in them.
   */
  host?: boolean;
}

export const DEFAULT_EMBED: EmbedOptions = { mode: 'player', placement: 'section', fit: 'contain', followPage: true, markers: true, osc: false, height: 560 };

export interface GraphFeatures {
  liveUniforms: Record<string, string>;
  /** The shader reads a Data node's textures (src/data/dataGlsl.ts). */
  usesData?: boolean;
}

/**
 * Human-readable list of things in this graph the standalone page can't run.
 * Feedback, echo, Pass nodes, Agents groups, Motion (texture), particles,
 * image, video and audio inputs and Data nodes (the page carries their
 * datasets' results) all run there; a MIDI Input node's
 * outputs don't yet (the page's MIDI drives mappings only).
 */
export function unsupportedFeatures(f: GraphFeatures): string[] {
  const out: string[] = [];
  if (Object.keys(f.liveUniforms).length) out.push('MIDI Input node outputs');
  return out;
}

/** Something in the Play setup the web page leaves out, and why. */
export interface LeftBehind { what: string; why: string }

const AUDIO_BAND_READS = new Set(['level', 'bass', 'lowmid', 'highmid', 'treble']);

const sizeText = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Does a Play read the camera (a Camera layer, or particles, glyphs, contours or a Motion layer reading from it)? As the runtime decides. */
export function playUsesCamera(play: PlayRecord): boolean {
  // A hidden layer still reads the camera when it is another layer's matte; a Motion layer always measures.
  const mattes = new Set(play.layers.map(l => l.trackMatte?.id ?? ''));
  return play.layers.some(l => (l.kind === 'motion' && l.readFrom === 'camera') || ((l.visible || mattes.has(l.id)) && (l.kind === 'camera' || ((l.kind === 'particles' || l.kind === 'glyphs' || l.kind === 'contours') && l.readFrom === 'camera'))));
}

/**
 * What the Play setup has that the exported page won't carry: a video or song
 * too big to put in a page, a loaded song in an audio layer (never saved, even
 * in the app), the MIDI file, audio-layer band mappings (measured by the app's
 * player only) and the notes. Images placed as layers are data URLs and do
 * travel, as do the graph's images and small videos and songs.
 */
export function leftBehind(play: PlayRecord, media?: PlayMedia, opts: { hands?: boolean; graphs?: PlayHtmlInput['backgroundGraphs']; datasets?: WebDatasets } = {}): LeftBehind[] {
  const out: LeftBehind[] = [];
  // Datasets travel as their results: a dataset never run has none, and notebooks and files stay in the app.
  const sets = Object.values(opts.datasets ?? {});
  for (const d of sets) if (!d.result) out.push({ what: `The dataset “${d.name}”`, why: 'It has no result yet (its notebook hasn’t run), so on the page its Data nodes read 0 and its Data layers draw nothing. Open it, press Run all, and export again.' });
  // Live datasets: frozen at their window, or reconnecting (and so needing the network).
  for (const d of sets) if (d.note) out.push(d.note);
  if (sets.some(d => d.result)) out.push({ what: sets.length === 1 ? `The notebook and file of “${sets[0].name}”` : `The notebooks and files of ${sets.length} datasets`, why: 'The page carries each dataset’s result as it is now, not the notebook or the file it came from. Change them in the app and export again to update the page.' });
  // A Background layer: its videos too big to keep, and graphs that weren't compiled (an example still loading, one that doesn't compile).
  const queue = backgroundLayerOf(play);
  for (const s of queue?.sources ?? []) {
    if (s.kind === 'video' && !s.src) out.push({ what: `The background video “${s.name}”${s.bytes ? ` (${sizeText(s.bytes)})` : ''}`, why: `Videos over ${sizeText(BACKGROUND_VIDEO_KEEP)} play in the app for the session only, so the page shows the Background layer’s colour while it would show. Trim or compress it under ${sizeText(BACKGROUND_VIDEO_KEEP)} to bring it along.` });
    if (s.kind === 'graph' && s.graph !== 'this' && opts.graphs && !opts.graphs[s.id]) out.push({ what: `The background graph “${s.name}”`, why: 'It couldn’t be compiled for the page (an example still loading, or a graph with an error), so the page shows the Background layer’s colour while it would show. Open the page again in a moment, or check the graph.' });
  }
  // Trackers on a Video layer: the page reads their analysis (baked track) by the video's time, never a model.
  for (const kind of trackersUsed(play)) {
    const s = kind === 'hands' ? play.hands : play[kind];
    if (!s?.source) {
      if (kind !== 'hands') out.push({ what: `${TRACKER_NAMES[kind]} tracking from the camera`, why: `Pages don’t carry the ${kind === 'face' ? 'face' : 'body'} model yet, so ${kind === 'face' ? 'face' : 'pose'} mappings, gestures and nulls stay at rest there. Track an analysed Video layer instead to bring it along.` });
      continue;
    }
    const t = media?.tracks?.[kind], layer = play.layers.find(l => l.id === s.source);
    if (t?.src) continue;
    out.push(t && t.bytes > TRACK_LIMIT
      ? { what: `${TRACKER_NAMES[kind]} tracking of “${layer?.label ?? 'a video'}” (${sizeText(t.bytes)})`, why: `Analyses over ${sizeText(TRACK_LIMIT)} stay out of the page. Analyse at a lower frame rate (15 or 10 fps), or trim the video.` }
      : { what: `${TRACKER_NAMES[kind]} tracking of “${layer?.label ?? 'a video'}”`, why: 'The page reads a video’s analysis, never a model: this one isn’t analysed (or the analysis isn’t loaded in this browser), so what it drives stays at rest there. Press Analyse video in the tracker’s settings, then export again.' });
  }
  if (usesHands(play) && !play.hands?.source && !opts.hands) out.push({ what: 'Hand tracking', why: `It needs MediaPipe and its hand model (about ${sizeText(HAND_BYTES)}), which stay out of the page unless you tick Include hand tracking. Without them, hand mappings, gestures and nulls that follow a hand stay at rest.` });
  for (const v of Object.values(media?.videos ?? {})) {
    if (!v.src && v.bytes > 0) out.push({ what: `The video “${v.name}” (${sizeText(v.bytes)}) in ${v.label}`, why: `Videos over ${sizeText(VIDEO_LIMIT)} stay out of the page to keep it light, so that input shows black there. Trim or compress it under ${sizeText(VIDEO_LIMIT)} to bring it along.` });
  }
  for (const a of media?.audio ?? []) {
    if (!a.src && a.bytes > 0) out.push({ what: `The song “${a.name}” (${sizeText(a.bytes)}) in ${a.label}`, why: `Songs over ${sizeText(AUDIO_LIMIT)} stay out of the page, so ${a.label} listens to the visitor’s microphone instead, after they click Listen to audio.` });
  }
  // Video layers: a file over the limit, or one not opened in this session, stays out; the layer then draws nothing.
  for (const l of play.layers) {
    if (l.kind !== 'video' || !l.videoId) continue;
    const f = media?.layerVideos?.[l.id];
    if (f?.src) continue;
    const bytes = f?.bytes || l.bytes;
    out.push(bytes > VIDEO_LIMIT
      ? { what: `The video “${l.fileName}” (${sizeText(bytes)}) in ${l.label}`, why: `Videos over ${sizeText(VIDEO_LIMIT)} stay out of the page to keep it light, so that layer draws nothing there${readsVideo(play, l.id) ? ' and its audio readers hear nothing' : ''}. Trim or compress it under ${sizeText(VIDEO_LIMIT)} to bring it along.` }
      : { what: `The video “${l.fileName}” in ${l.label}`, why: 'Its file isn’t open in this session (it is still loading, or this browser’s library doesn’t have it), so that layer draws nothing on the page. Open the Play page until it shows, then export again.' });
  }
  // Granulator racks: a Library sample over the limit, or not opened this session, stays out; that rack is silent on the page.
  for (const r of play.audioEngine?.racks ?? []) {
    const sm = r.instrument?.kind === 'granulator' ? r.instrument.sample : undefined;
    if (!sm?.sampleId || media?.rackSamples?.[r.id]?.src) continue;
    const bytes = media?.rackSamples?.[r.id]?.bytes ?? 0;
    out.push(bytes > AUDIO_LIMIT
      ? { what: `The sound “${sm.name}” (${sizeText(bytes)}) in ${r.name}’s Granulator`, why: `Sounds over ${sizeText(AUDIO_LIMIT)} stay out of the page, so that Granulator is silent there. Trim it, or pick a generated sample.` }
      : { what: `The sound “${sm.name}” in ${r.name}’s Granulator`, why: 'Its file isn’t open in this session (still loading, or this browser’s library doesn’t have it), so that Granulator is silent on the page. Open the Play page until its waveform shows, then export again.' });
  }
  // Drum pads: a sample over the limit, or not opened this session, stays out; that pad is silent on the page.
  for (const l of play.layers) {
    if (l.kind !== 'drumpad') continue;
    l.pads.forEach((p, i) => {
      if (!p.sampleId || media?.layerPads?.[l.id]?.[i]?.src) return;
      const bytes = media?.layerPads?.[l.id]?.[i]?.bytes || p.bytes;
      out.push(bytes > AUDIO_LIMIT
        ? { what: `The sound “${p.fileName}” (${sizeText(bytes)}) on pad ${i + 1} of ${l.label}`, why: `Sounds over ${sizeText(AUDIO_LIMIT)} stay out of the page, so that pad is silent there. Trim it to bring it along.` }
        : { what: `The sound “${p.fileName}” on pad ${i + 1} of ${l.label}`, why: 'Its file isn’t open in this session (still loading, or this browser’s library doesn’t have it), so that pad is silent on the page. Open the Play page until the pad shows, then export again.' });
    });
  }
  for (const l of play.layers) {
    if (l.kind === 'audio' && l.input === 'file') {
      out.push({ what: l.fileName ? `The song “${l.fileName}” (${l.label})` : `The song in ${l.label}`, why: 'Songs aren’t saved with a setup, so the page listens to the visitor’s microphone instead, after they click Enable.' });
    }
  }
  const bgVideo = !queue && play.display?.source === 'video' ? play.display.video : undefined;
  if (bgVideo && !bgVideo.src) out.push({ what: `The background video “${bgVideo.name}” (${sizeText(bgVideo.bytes)})`, why: `Videos over ${sizeText(BACKGROUND_VIDEO_KEEP)} play in the app for the session only, so the page shows the backdrop colour instead. Trim or compress it under ${sizeText(BACKGROUND_VIDEO_KEEP)} to bring it along.` });
  if (play.midiFile) out.push({ what: `The MIDI file “${play.midiFile.name}”`, why: 'The web player doesn’t play MIDI files yet: what it drives stays where you left it. Record a video to keep the performance.' });
  const audioIds = new Set(play.layers.filter(l => l.kind === 'audio').map(l => l.id));
  const bands = play.mappings.filter(m => m.source.kind === 'sensor' && audioIds.has(m.source.layerId) && AUDIO_BAND_READS.has(m.source.read)).length;
  if (bands) out.push({ what: `${bands} mapping${bands === 1 ? '' : 's'} from an audio layer’s bands`, why: 'Band readings come from the app’s player only; use Live audio mappings for the web.' });
  if (play.notes?.trim()) out.push({ what: 'Your notes', why: 'They’re for you and learners in the app; the page never shows them.' });
  return out;
}

/** The biggest analysis (baked track, as base64) a page carries. */
export const TRACK_LIMIT = 16 * 1024 * 1024;

/** The trackers a setup reads. */
export function trackersUsed(play: PlayRecord): TrackerKind[] {
  return ([['hands', usesHands(play)], ['face', usesFace(play)], ['pose', usesPose(play)]] as const).filter(([, on]) => on).map(([k]) => k);
}

/** The analyses the page carries: per tracker on a Video layer, its layer and base64 frames. */
function bundleTracks(input: PlayHtmlInput): Partial<Record<TrackerKind, { layerId: string; data: string }>> | null {
  const out: Partial<Record<TrackerKind, { layerId: string; data: string }>> = {};
  for (const kind of trackersUsed(input.play)) {
    const s = kind === 'hands' ? input.play.hands : input.play[kind];
    const t = input.media?.tracks?.[kind];
    if (s?.source && t?.src && t.layerId === s.source && t.src.length <= TRACK_LIMIT) out[kind] = { layerId: t.layerId, data: t.src };
  }
  return Object.keys(out).length ? out : null;
}

/** What hand tracking adds to a page (play/handExport.ts: MediaPipe and the model, gzipped, then base64), measured. */
export const HAND_BYTES = 12.2 * 1024 * 1024;

/** Mirrors lib/mediaSources.ts EMBED_LIMIT (this module stays free of browser-only imports). */
const VIDEO_LIMIT = 4 * 1024 * 1024;
const AUDIO_LIMIT = 6 * 1024 * 1024;

/** Do the setup's audio readers listen to this video layer? */
function readsVideo(play: PlayRecord, layerId: string): boolean {
  return !!play.audioReaders?.readers.length && play.audioReaders.input === `video:${layerId}`;
}

/** Each image, video and song the page carries (the graph's, and Play's background), and what it adds to the page's size. */
export function mediaCarried(media?: PlayMedia, hands?: HandAssets | 'pending', play?: PlayRecord, datasets?: WebDatasets): { what: string; bytes: number }[] {
  const out: { what: string; bytes: number }[] = [...datasetsCarried(datasets)];
  if (hands) out.push({ what: 'Hand tracking (MediaPipe and its hand model)', bytes: hands === 'pending' ? HAND_BYTES : hands.bundle.length + hands.loader.length + hands.wasm.length + hands.model.length });
  if (play) for (const kind of trackersUsed(play)) { const t = media?.tracks?.[kind]; if (t?.src) out.push({ what: `${TRACKER_NAMES[kind]} tracking of ${t.label} (analysed)`, bytes: t.src.length }); }
  for (const t of Object.values(media?.textures ?? {})) if (t.src) out.push({ what: `Image in ${t.label}${t.scaledTo ? ` (scaled to ${t.scaledTo} px)` : ''}`, bytes: t.src.length });
  for (const v of Object.values(media?.videos ?? {})) if (v.src) out.push({ what: `Video “${v.name}” in ${v.label}`, bytes: v.src.length });
  for (const a of media?.audio ?? []) if (a.src) out.push({ what: `Song “${a.name}” in ${a.label}`, bytes: a.src.length });
  for (const l of play?.layers ?? []) {
    const f = l.kind === 'video' ? media?.layerVideos?.[l.id] : undefined;
    if (f?.src) out.push({ what: `Video “${f.name}” in ${f.label}`, bytes: f.src.length });
    if (l.kind === 'drumpad') for (const s of Object.values(media?.layerPads?.[l.id] ?? {})) if (s.src) out.push({ what: `Sound “${s.name}” in ${s.label}`, bytes: s.src.length });
  }
  for (const s of Object.values(media?.rackSamples ?? {})) if (s.src) out.push({ what: `Sound “${s.name}” in ${s.label}`, bytes: s.src.length });
  const queue = backgroundLayerOf(play);
  const d = queue ? undefined : play?.display;
  if (d?.source === 'image' && d.image) out.push({ what: `Background image “${d.image.name}”`, bytes: d.image.src.length });
  if (d?.source === 'video' && d.video?.src) out.push({ what: `Background video “${d.video.name}”`, bytes: d.video.src.length });
  for (const s of queue?.sources ?? []) {
    if (s.kind === 'image' && s.src) out.push({ what: `Background image “${s.name}”`, bytes: s.src.length });
    if (s.kind === 'video' && s.src) out.push({ what: `Background video “${s.name}”`, bytes: s.src.length });
  }
  return out;
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--').replace(/[\u2028\u2029]/g, c => c === '\u2028' ? '\\u2028' : '\\u2029');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

/** What the runtime reads of the media: the files and how to play them, without the dialog's labels and sizes. */
function runtimeMedia(m: PlayMedia) {
  const file = (f: PlayMediaFile) => ({ src: f.src });
  const map = <T extends PlayMediaFile, R>(r: Record<string, T> | undefined, fn: (f: T) => R) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [k, fn(v)]));
  return {
    textures: map(m.textures, file),
    videos: map(m.videos, v => ({ src: v.src, loop: v.loop, speed: v.speed })),
    audio: (m.audio ?? []).map(a => ({ id: a.id, src: a.src, uniforms: a.uniforms, bands: a.bands, range: a.range, mode: a.mode })),
  };
}

/** What ShaderStudioPlay.mount takes for this input (notes left out: the web player never shows them). */
export function playBundle(input: PlayHtmlInput) {
  const aspect = PREVIEW_ASPECTS.find(a => a.id === input.aspect);
  // Notes are for the author and learners in the app; the website player never shows them.
  // Layer groups are for the list: the page gets their one effect (a hidden group's layers are hidden) and not the groups.
  const play = { ...applyGroupVisibility(input.play) };
  delete play.groups;
  delete play.notes;
  // The credit is printed into the page's HTML where the page shows it (a presentation); the player never reads it.
  delete play.source;
  // Takes are for rendering in the app; the page never plays them back.
  delete play.takes;
  // Percent conditions measure against their value's range; the page has no list of layer properties, so it carries the table.
  const ranges = conditionRanges(play);
  if (Object.keys(ranges).length) (play as PlayRecord & { condRanges?: Record<string, [number, number]> }).condRanges = ranges;
  // Brightness conditions and captures need the kit to sample the picture every frame.
  if (readsPicture(play)) (play as PlayRecord & { readsPicture?: boolean }).readsPicture = true;
  // Projection mapping is for the app's output window (docs/projection.md); a page never warps itself.
  delete play.projection;
  // Custom Finish effects from a sealed pack go in as code: the page compiles them (a shader reaches the GPU as text anyway).
  if (play.finish) {
    const fin = renderableFinish(play.finish)!;
    play.finish = fin === play.finish ? fin : { ...fin, effects: fin.effects.map(e => { if (!e.sealed) return e; const c = { ...e }; delete c.sealed; return c; }) };
  }
  // The background carries only the file it shows: an image kept for later isn't needed with a video (or the shader) showing.
  // A Background layer decides instead of the header's setting, whose files then stay out altogether.
  const queue = backgroundLayerOf(play);
  if (play.display) {
    const d = { ...play.display };
    if (queue) delete d.source;
    if (queue || d.source !== 'image') delete d.image;
    if (queue || d.source !== 'video') delete d.video;
    play.display = d;
  }
  // Video layers carry their file in the page (a data URL, when it came along); the library id means nothing there.
  if (play.layers.some(l => l.kind === 'video')) {
    play.layers = play.layers.map(l => (l.kind === 'video' ? { ...l, src: input.media?.layerVideos?.[l.id]?.src ?? '' } as typeof l : l));
  }
  // Drum pad layers carry their samples in their pads (data URLs, when they came along).
  if (play.layers.some(l => l.kind === 'drumpad')) {
    play.layers = play.layers.map(l => (l.kind === 'drumpad' ? { ...l, pads: l.pads.map((p, i) => ({ ...p, src: input.media?.layerPads?.[l.id]?.[i]?.src ?? '' })) } as typeof l : l));
  }
  // Granulator racks carry a Library sample in their sample (a data URL, when it came along); generated ones need nothing.
  if (play.audioEngine?.racks.some(r => r.instrument?.kind === 'granulator' && r.instrument.sample?.sampleId)) {
    play.audioEngine = { ...play.audioEngine, racks: play.audioEngine.racks.map(r => (r.instrument?.kind === 'granulator' && r.instrument.sample?.sampleId
      ? { ...r, instrument: { ...r.instrument!, sample: { ...r.instrument!.sample!, src: input.media?.rackSamples?.[r.id]?.src ?? '' } as AeGrainSample } }
      : r)) };
  }
  // A saved graph's nodes stay out: the page runs the graph compiled (backgroundGraphs).
  if (queue) play.layers = [{ ...queue, sources: queue.sources.map(s => { if (!s.nodes) return s; const c = { ...s }; delete c.nodes; return c; }) }, ...play.layers.slice(1)];
  const graphs = queue ? Object.fromEntries(Object.entries(input.backgroundGraphs ?? {}).filter(([id]) => queue.sources.some(s => s.id === id))) : {};
  return {
    title: input.title,
    fragmentShader: input.fragmentShader,
    uniforms: input.uniforms,
    paramBindings: input.paramBindings,
    play,
    aspect: aspect ? { id: aspect.id, ratio: aspect.ratio } : { id: 'free', ratio: null },
    ...(input.passes && (input.passes.stateful || input.passes.echo) ? { passes: input.passes } : {}),
    // Only graphs with Pass nodes carry their programs: every other bundle serializes as before.
    ...(input.graphPasses?.length ? { graphPasses: input.graphPasses } : {}),
    ...(input.agents ? { agents: input.agents } : {}),
    ...(input.motionMap ? { motionMap: input.motionMap } : {}),
    ...(input.media ? { media: runtimeMedia(input.media) } : {}),
    ...(input.handAssets && usesHands(input.play) && !input.play.hands?.source ? { hands: input.handAssets } : {}),
    ...(bundleTracks(input) ? { tracks: bundleTracks(input) } : {}),
    ...(Object.keys(graphs).length ? { backgroundGraphs: graphs } : {}),
    ...(input.datasets && Object.keys(input.datasets).length ? { datasets: input.datasets } : {}),
    generatedBy: 'Playfield',
  };
}

function runtimeOptions(o: EmbedOptions) {
  const bg = o.mode === 'background';
  return { mode: o.mode, fit: bg ? 'cover' : o.fit, followPage: o.followPage, markers: bg ? o.markers : true, osc: o.osc, ...(o.host ? { host: true } : {}) };
}

/**
 * The layer kit as a plain script: its files in dependency order, with their
 * imports and `export`s removed, in one closure that hands the runtime
 * createLayerKit. The kit's files keep their top-level names distinct so
 * they can share this scope.
 */
export const KIT_SOURCES = [particleSource, geometrySource, sketch3dSource, p5Source, fontsSource, glyphsSource, layersSource, displaceSource, mattesSource, bodiesSource, relationshipSource, agentsSource, motionSource, handsSource, tracksSource, faceSource, poseSource, queueSource, dataSource, midiSource, kitSource, finishGlslSource, finishSource, waterLayerSource, signalsSource, routesSource, incrementSource, audioFxSource, drumPadsSource, granulatorSource, macrosSource, fnSource, spreadSource, jfaSource, gpuParticlesSource, passPlanSource, passHostSource, agentPlanSource, agentShadersSource, agentHostSource];
export function kitScript(): string {
  const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
  return `var SSKit = (function () {\n${body}\nreturn { createLayerKit: createLayerKit, anchor: geoAnchor, hands: { create: hdCreate, update: hdUpdate, age: hdAge, read: hdRead, gate: hdGate, point: hdPoint, placement: hdPlacement, options: hdTrackerOptions }, tracks: { decode: tkDecode, fromBase64: tkFromBase64, driver: tkDriver, drive: tkDrive, handsFrame: tkHandsFrame, videoTime: tkVideoTime, subjectAge: tkSubjectAge }, face: { create: fcCreate, update: fcUpdate, read: fcRead, gate: fcGate, point: fcPoint }, pose: { create: psCreate, update: psUpdate, read: psRead, gate: psGate, point: psPoint }, data: { unit: kdUnit, column: kdColumn }, midi: { lockRecord: kmLockRecord, lockRead: kmLockRead, rangeRead: kmRangeRead, noteUnit: kmNoteUnit, gridFit: kmGridFit, gridMessage: kmGridMessage, gridFill: kmGridFill, gridRead: kmGridRead }, finish: { create: fnCreate, active: fnActive, mapLayers: fnMapLayers, usesMotion: fnUsesMotion, looks: { create: fnLookNew, act: fnLookAct, step: fnLookStep, value: fnLookValue, reset: fnLookReset, is: fnLookIs } }, audioFx: { chain: afCreateChain, loadWorklet: afLoadWorklet, needsWorklet: afNeedsWorklet }, drumPads: { sampler: dpCreateSampler, numbers: dpHitNumbers, key: dpKey, synth: dpSynthBuffer, padOfKey: dpPadOfKey, padOfNote: dpPadOfNote, padOfCell: dpPadOfCell, slots: dpSlots, pick: dpPickPad, hash: dpHash01 }, granulator: { create: grCreate, settings: grSettings, summary: grSummary, synth: grSynthBuffer, params: GR_PARAMS, fromPoints: grFromPoints }, macros: { curve: mcCurve, value: mcTargetValue }, signals: { gate: sgGate, condNew: sgCondNew, condStep: sgCondStep, condRewind: sgCondRewind, logic: sgLogic, order: sgSignalOrder, signalPlan: sgSignalPlan, levelDeps: sgLevelDeps, pulseLinks: sgPulseLinks, reactions: sgReactions, shapeNew: sgShapeNew, shapeRewind: sgShapeRewind, shaped: sgShaped, shapeStep: sgShapeStep, lagNew: sgLagNew, lagStep: sgLagStep, linkPlan: sgLinkPlan, linkNew: sgLinkNew, linkClear: sgLinkClear, linkFire: sgLinkFire, linkDue: sgLinkDue, runActions: sgRunActions, swapNew: sgSwapNew, swapStep: sgSwapStep, parseRef: sgParseValueRef, point: sgScreenPoint, valueKey: sgValueKey, depth: SG_DEPTH }, routes: { state: rtNew, sourcesOf: rtSourcesOf, frame: rtFrame, rewind: rtRewind, curve: rtCurve, map: rtMap, triggersOf: rtTriggersOf }, increment: { create: incNew, range: incRange, fold: incFold, threshold: incThreshold, repeat: incRepeat, advance: incAdvance, reset: incReset, glide: incGlide }, fn: { eval: fnEval }, spread: { weight: spWeight, weights: spWeights, value: spValue }, jfa: { create: jfCreate }, gpuParticles: { host: gpHost, readback: gpReadback, slots: gpProbeSlots, probeField: gpProbeField, vol: GP_VOL, volTiles: GP_VOL_TILES }, passes: { create: phCreate, steps: ppFrameSteps }, agents: { create: ahCreate, unsupported: ahUnsupported } };\n})();\n`;
}

/**
 * The page's scripts: three.js first when a 3D Script layer needs it (a
 * global `SSThree` the runtime hands the kit), then the kit and the player.
 * Without the three.js script loaded (loadThreeSource) a 3D layer draws
 * nothing in the page and says why.
 */
export function runtimeScript(play: PlayRecord): string {
  const three = playUses3D(play) ? threeSource() ?? '' : '';
  return (three + (three ? '\n' : '') + kitScript() + runtimeSource).replace(/<\/script/gi, '<\\/script');
}

/** What three.js adds to the page, for the export dialogs; null when no layer needs it. Before it loads, about how much. */
export function threeCarried(play: PlayRecord): { what: string; bytes: number } | null {
  if (!playUses3D(play)) return null;
  return { what: 'three.js, for the 3D Script layers', bytes: threeSource()?.length ?? THREE_BYTES };
}
/** The three.js script's size as built (three 0.182, three-slim.js), for the dialog until the real one loads. */
const THREE_BYTES = 562_600;

/** The complete page. Pure: same input, same string. */
export function buildPlayHtml(input: PlayHtmlInput, options: EmbedOptions = DEFAULT_EMBED): string {
  const bg = options.mode === 'background';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(input.title)}</title>
<style>html,body{margin:0;height:100%;background:${bg ? '#000' : '#0d0d12'}}#play{width:100%;height:100%}</style>
</head>
<body>
<div id="play"></div>
<script>window.PLAY_BUNDLE = ${scriptJson(playBundle(input))};
window.PLAY_OPTIONS = ${scriptJson(runtimeOptions(options))};</script>
<script>${runtimeScript(input.play)}</script>
</body>
</html>
`;
}

/**
 * A paste-in snippet. Background + section: the div fills the element it is
 * pasted into (the runtime gives that element `position: relative` and its own
 * stacking context so the picture sits behind its other children). Background
 * + page: a fixed layer behind the whole page. Player: a block of `height` px.
 */
export function buildPlaySnippet(input: PlayHtmlInput, options: EmbedOptions = DEFAULT_EMBED): string {
  const bg = options.mode === 'background';
  const style = !bg
    ? `position:relative;width:100%;height:${Math.max(200, Math.round(options.height))}px;overflow:hidden;border-radius:12px`
    : options.placement === 'page'
      ? 'position:fixed;inset:0;z-index:-1;overflow:hidden;pointer-events:none'
      : 'position:absolute;inset:0;z-index:-1;overflow:hidden;pointer-events:none';
  const hostFix = bg && options.placement === 'section'
    ? "var h=e.parentElement;if(h){var cs=getComputedStyle(h);if(cs.position==='static')h.style.position='relative';h.style.isolation='isolate';}"
    : '';
  return `<!-- Playfield · ${escapeHtml(input.title)} (${bg ? `background, ${options.placement === 'page' ? 'whole page' : 'fills its section'}` : 'player with controls'}) -->
<div data-shader-studio style="${style}"></div>
<script>
${runtimeScript(input.play)}
(function(){var e=document.currentScript.previousElementSibling;${hostFix}
ShaderStudioPlay.mount(e, ${scriptJson(playBundle(input))}, ${scriptJson(runtimeOptions(options))});})();
</script>
`;
}
