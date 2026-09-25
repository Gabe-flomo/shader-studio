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
 * `unsupportedFeatures` lists what a graph uses that the runtime can't run.
 */
import runtimeSource from './runtime/play-runtime.js?raw';
import particleSource from './particle-sim.js?raw';
import geometrySource from './kit/geometry.js?raw';
import layersSource from './kit/layers.js?raw';
import bodiesSource from './kit/bodies.js?raw';
import kitSource from './kit/kit.js?raw';
import type { PlayRecord } from '../types/play';
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
}

export const DEFAULT_EMBED: EmbedOptions = { mode: 'player', placement: 'section', fit: 'contain', followPage: true, markers: true, osc: false, height: 560 };

export interface GraphFeatures {
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  audioUniforms: Record<string, string>;
  liveUniforms: Record<string, string>;
  isStateful: boolean;
  particleSystems: unknown[];
  usesEcho: boolean;
  play: PlayRecord;
}

/** Human-readable list of things in this graph the standalone page can't run. */
export function unsupportedFeatures(f: GraphFeatures): string[] {
  const out: string[] = [];
  if (Object.keys(f.textureUniforms).length) out.push('image inputs');
  if (Object.keys(f.videoUniforms).length) out.push('video inputs');
  if (Object.keys(f.audioUniforms).length) out.push('audio inputs');
  if (Object.keys(f.liveUniforms).length) out.push('MIDI Input node outputs');
  if (f.isStateful) out.push('the previous-frame feedback');
  if (f.usesEcho) out.push('echo snapshots');
  if (f.particleSystems.length) out.push('GPU particle systems');
  if (f.play.mappings.some(m => m.source.kind === 'audio')) out.push('audio-band mappings');
  return out;
}

/** Something in the Play setup the web page leaves out, and why. */
export interface LeftBehind { what: string; why: string }

const AUDIO_BAND_READS = new Set(['level', 'bass', 'lowmid', 'highmid', 'treble']);

/**
 * What the Play setup has that the exported page won't carry: a loaded song
 * (never saved, even in the app), the MIDI file, audio-layer band mappings
 * (measured by the app's player only) and the notes. Images placed as layers
 * are data URLs and do travel.
 */
export function leftBehind(play: PlayRecord): LeftBehind[] {
  const out: LeftBehind[] = [];
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

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--').replace(/[\u2028\u2029]/g, c => c === '\u2028' ? '\\u2028' : '\\u2029');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function bundleOf(input: PlayHtmlInput) {
  const aspect = PREVIEW_ASPECTS.find(a => a.id === input.aspect);
  // Notes are for the author and learners in the app; the website player never shows them.
  const play = { ...input.play };
  delete play.notes;
  return {
    title: input.title,
    fragmentShader: input.fragmentShader,
    uniforms: input.uniforms,
    paramBindings: input.paramBindings,
    play,
    aspect: aspect ? { id: aspect.id, ratio: aspect.ratio } : { id: 'free', ratio: null },
    generatedBy: 'Shader Studio',
  };
}

function runtimeOptions(o: EmbedOptions) {
  const bg = o.mode === 'background';
  return { mode: o.mode, fit: bg ? 'cover' : o.fit, followPage: o.followPage, markers: bg ? o.markers : true, osc: o.osc };
}

/**
 * The layer kit as a plain script: its files in dependency order, with their
 * imports and `export`s removed, in one closure that hands the runtime
 * createLayerKit. The kit's files keep their top-level names distinct so
 * they can share this scope.
 */
export const KIT_SOURCES = [particleSource, geometrySource, layersSource, bodiesSource, kitSource];
export function kitScript(): string {
  const body = KIT_SOURCES.map(src => src.replace(/^import .*$/gm, '').replace(/^export /gm, '')).join('\n');
  return `var SSKit = (function () {\n${body}\nreturn { createLayerKit: createLayerKit };\n})();\n`;
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
<script>window.PLAY_BUNDLE = ${scriptJson(bundleOf(input))};
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
  return `<!-- Shader Studio · ${escapeHtml(input.title)} (${bg ? `background, ${options.placement === 'page' ? 'whole page' : 'fills its section'}` : 'player with controls'}) -->
<div data-shader-studio style="${style}"></div>
<script>
${runtimeScript()}
(function(){var e=document.currentScript.previousElementSibling;${hostFix}
ShaderStudioPlay.mount(e, ${scriptJson(bundleOf(input))}, ${scriptJson(runtimeOptions(options))});})();
</script>
`;
}
