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
 * echo (ping-pong targets), image, video and audio inputs (carried in the page
 * as data URLs), and GPU particle systems. `unsupportedFeatures` lists what a
 * graph uses that it still can't run, `leftBehind` what stays out of the page,
 * and `mediaCarried` what each image, video or song adds to it.
 */
import runtimeSource from './runtime/play-runtime.js?raw';
import particleSource from './particle-sim.js?raw';
import geometrySource from './kit/geometry.js?raw';
import layersSource from './kit/layers.js?raw';
import bodiesSource from './kit/bodies.js?raw';
import handsSource from './kit/hands.js?raw';
import kitSource from './kit/kit.js?raw';
import { usesHands, type PlayRecord } from '../types/play';
import type { HandAssets } from './handExport';
import { PREVIEW_ASPECTS, type PreviewAspect } from '../utils/graphImportPlan';

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
  /** The files the graph's inputs read. */
  media?: PlayMedia;
  /** Hand tracking's files (play/handExport.ts), when the author chose to include them. */
  handAssets?: HandAssets;
}

/** What ShaderCanvas runs around the fragment shader, from the compile. */
export interface PlayPasses {
  /** Previous Frame and the blur family: ping-pong targets bound to u_prevFrame. */
  stateful: boolean;
  /** Echo nodes: `copies` snapshots `delay` frames apart, bound to u_echo0… */
  echo: { copies: number; delay: number } | null;
  /** GPU particle chains, drawn additively over the picture. */
  particles: { vertexShader: string; fragmentShader: string; count: number; shape: number }[];
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
}

/**
 * Human-readable list of things in this graph the standalone page can't run.
 * Feedback, echo, particles and image, video and audio inputs all run there;
 * a MIDI Input node's outputs don't yet (the page's MIDI drives mappings only).
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

/** Does a Play read the camera (a Camera layer, or particles, glyphs or contours reading from it)? As the runtime decides. */
export function playUsesCamera(play: PlayRecord): boolean {
  return play.layers.some(l => l.visible && (l.kind === 'camera' || ((l.kind === 'particles' || l.kind === 'glyphs' || l.kind === 'contours') && l.readFrom === 'camera')));
}

/**
 * What the Play setup has that the exported page won't carry: a video or song
 * too big to put in a page, a loaded song in an audio layer (never saved, even
 * in the app), the MIDI file, audio-layer band mappings (measured by the app's
 * player only) and the notes. Images placed as layers are data URLs and do
 * travel, as do the graph's images and small videos and songs.
 */
export function leftBehind(play: PlayRecord, media?: PlayMedia, opts: { hands?: boolean } = {}): LeftBehind[] {
  const out: LeftBehind[] = [];
  if (usesHands(play) && !opts.hands) out.push({ what: 'Hand tracking', why: `It needs MediaPipe and its hand model (about ${sizeText(HAND_BYTES)}), which stay out of the page unless you tick Include hand tracking. Without them, hand mappings, gestures and nulls that follow a hand stay at rest.` });
  for (const v of Object.values(media?.videos ?? {})) {
    if (!v.src && v.bytes > 0) out.push({ what: `The video “${v.name}” (${sizeText(v.bytes)}) in ${v.label}`, why: `Videos over ${sizeText(VIDEO_LIMIT)} stay out of the page to keep it light, so that input shows black there. Trim or compress it under ${sizeText(VIDEO_LIMIT)} to bring it along.` });
  }
  for (const a of media?.audio ?? []) {
    if (!a.src && a.bytes > 0) out.push({ what: `The song “${a.name}” (${sizeText(a.bytes)}) in ${a.label}`, why: `Songs over ${sizeText(AUDIO_LIMIT)} stay out of the page, so ${a.label} listens to the visitor’s microphone instead, after they click Listen to audio.` });
  }
  for (const l of play.layers) {
    if (l.kind === 'audio' && l.input === 'file') {
      out.push({ what: l.fileName ? `The song “${l.fileName}” (${l.label})` : `The song in ${l.label}`, why: 'Songs aren’t saved with a setup, so the page listens to the visitor’s microphone instead, after they click Enable.' });
    }
  }
  if (play.midiFile) out.push({ what: `The MIDI file “${play.midiFile.name}”`, why: 'The web player doesn’t play MIDI files yet: what it drives stays where you left it. Record a video to keep the performance.' });
  const audioIds = new Set(play.layers.filter(l => l.kind === 'audio').map(l => l.id));
  const bands = play.mappings.filter(m => m.source.kind === 'sensor' && audioIds.has(m.source.layerId) && AUDIO_BAND_READS.has(m.source.read)).length;
  if (bands) out.push({ what: `${bands} mapping${bands === 1 ? '' : 's'} from an audio layer’s bands`, why: 'Band readings come from the app’s player only; use Live audio mappings for the web.' });
  if (play.notes?.trim()) out.push({ what: 'Your notes', why: 'They’re for you and learners in the app; the page never shows them.' });
  return out;
}

/** What hand tracking adds to a page (play/handExport.ts: MediaPipe and the model, gzipped, then base64), measured. */
export const HAND_BYTES = 12.2 * 1024 * 1024;

/** Mirrors lib/mediaSources.ts EMBED_LIMIT (this module stays free of browser-only imports). */
const VIDEO_LIMIT = 4 * 1024 * 1024;
const AUDIO_LIMIT = 6 * 1024 * 1024;

/** Each image, video and song the page carries, and what it adds to the page's size. */
export function mediaCarried(media?: PlayMedia, hands?: HandAssets | 'pending'): { what: string; bytes: number }[] {
  const out: { what: string; bytes: number }[] = [];
  if (hands) out.push({ what: 'Hand tracking (MediaPipe and its hand model)', bytes: hands === 'pending' ? HAND_BYTES : hands.bundle.length + hands.loader.length + hands.wasm.length + hands.model.length });
  for (const t of Object.values(media?.textures ?? {})) if (t.src) out.push({ what: `Image in ${t.label}${t.scaledTo ? ` (scaled to ${t.scaledTo} px)` : ''}`, bytes: t.src.length });
  for (const v of Object.values(media?.videos ?? {})) if (v.src) out.push({ what: `Video “${v.name}” in ${v.label}`, bytes: v.src.length });
  for (const a of media?.audio ?? []) if (a.src) out.push({ what: `Song “${a.name}” in ${a.label}`, bytes: a.src.length });
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
  const play = { ...input.play };
  delete play.notes;
  // The credit is printed into the page's HTML where the page shows it (a presentation); the player never reads it.
  delete play.source;
  // Takes are for rendering in the app; the page never plays them back.
  delete play.takes;
  return {
    title: input.title,
    fragmentShader: input.fragmentShader,
    uniforms: input.uniforms,
    paramBindings: input.paramBindings,
    play,
    aspect: aspect ? { id: aspect.id, ratio: aspect.ratio } : { id: 'free', ratio: null },
    ...(input.passes && (input.passes.stateful || input.passes.echo || input.passes.particles.length) ? { passes: input.passes } : {}),
    ...(input.media ? { media: runtimeMedia(input.media) } : {}),
    ...(input.handAssets && usesHands(input.play) ? { hands: input.handAssets } : {}),
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
export const KIT_SOURCES = [particleSource, geometrySource, layersSource, bodiesSource, handsSource, kitSource];
export function kitScript(): string {
  const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
  return `var SSKit = (function () {\n${body}\nreturn { createLayerKit: createLayerKit, anchor: geoAnchor, hands: { create: hdCreate, update: hdUpdate, age: hdAge, read: hdRead, gate: hdGate, point: hdPoint, placement: hdPlacement } };\n})();\n`;
}

const runtimeScript = () => (kitScript() + runtimeSource).replace(/<\/script/gi, '<\\/script');

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
<script>${runtimeScript()}</script>
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
${runtimeScript()}
(function(){var e=document.currentScript.previousElementSibling;${hostFix}
ShaderStudioPlay.mount(e, ${scriptJson(playBundle(input))}, ${scriptJson(runtimeOptions(options))});})();
</script>
`;
}
