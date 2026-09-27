/**
 * webInput.ts — what the web export needs from a compiled graph and its Play
 * record: the shader and its extra passes (feedback, echo, particles), the
 * uniforms at their values, the param bindings, the record and the input
 * files, plus the list of things the standalone runtime can't run.
 *
 * Pure, so the open graph (the store's playWebInput, with the live values
 * mappings are giving it and the files loaded into it) and a saved graph
 * compiled off-screen (a Present snapshot) go through the same code and
 * produce the same page.
 */
import { unsupportedFeatures, type GraphFeatures, type PlayHtmlInput, type PlayMedia } from './exportHtml';
import { bakeLayerValues } from './playControls';
import type { PlayRecord } from '../types/play';
import type { PreviewAspect } from '../utils/graphImportPlan';

/** The parts of a compile the web page uses. */
export interface CompiledForWeb {
  fragmentShader: string;
  paramUniforms: Record<string, number | number[]>;
  paramBindings: Record<string, string>;
  textureUniforms: Record<string, string>;
  videoUniforms: Record<string, string>;
  audioUniforms: Record<string, string>;
  liveUniforms: Record<string, string>;
  isStateful: boolean;
  /** The compile's echo config (the store keeps it as echoConfig). */
  echo?: { copies: number; delay: number } | null;
  echoConfig?: { copies: number; delay: number } | null;
  particleSystems: { vertexShader: string; fragmentShader: string; count: number; shape: number }[];
}

/** What unsupportedFeatures reads, from a compile (a superset, so it keeps working as the runtime learns more). */
export function graphFeatures(c: CompiledForWeb, play: PlayRecord): GraphFeatures {
  const f = {
    textureUniforms: c.textureUniforms, videoUniforms: c.videoUniforms, audioUniforms: c.audioUniforms, liveUniforms: c.liveUniforms,
    isStateful: c.isStateful, particleSystems: c.particleSystems, usesEcho: /\bu_echo0\b/.test(c.fragmentShader), play,
  };
  return f;
}

/**
 * The web page's input. `live` holds values mappings are giving controls right
 * now (control id → value): driven uniforms and layer values are baked at them.
 * `media` is the graph's input files, when they're loaded (the open graph).
 */
export function webInputFrom(c: CompiledForWeb, play: PlayRecord, opts: { title: string; aspect: PreviewAspect; live?: ReadonlyMap<string, number | number[]>; media?: PlayMedia; backgroundGraphs?: PlayHtmlInput['backgroundGraphs'] }): { input: PlayHtmlInput; missing: string[] } {
  const live = opts.live ?? new Map<string, number | number[]>();
  // Uniforms at their current values, with driven ones at their live value.
  const uniforms: Record<string, number | number[]> = { ...c.paramUniforms };
  for (const ctl of play.controls) {
    const v = live.get(ctl.id);
    const u = c.paramBindings[ctl.target.split('::').slice(-2).join('::')];
    if (v !== undefined && u && !ctl.target.startsWith('layer:')) uniforms[u] = Array.isArray(v) ? [...v] : v;
  }
  const input: PlayHtmlInput = {
    title: opts.title.trim() || 'Playfield', fragmentShader: c.fragmentShader, uniforms, paramBindings: c.paramBindings, play: bakeLayerValues(play, new Map(live)), aspect: opts.aspect,
    passes: {
      stateful: c.isStateful,
      echo: c.echoConfig ?? c.echo ?? null,
      particles: c.particleSystems.map(p => ({ vertexShader: p.vertexShader, fragmentShader: p.fragmentShader, count: p.count, shape: p.shape })),
    },
  };
  if (opts.media) input.media = opts.media;
  if (opts.backgroundGraphs && Object.keys(opts.backgroundGraphs).length) input.backgroundGraphs = opts.backgroundGraphs;
  return { input, missing: unsupportedFeatures(graphFeatures(c, play)) };
}
