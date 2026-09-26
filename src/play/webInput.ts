/**
 * webInput.ts — what the web export needs from a compiled graph and its Play
 * record: the shader, the uniforms at their values, the param bindings and
 * the record, plus the list of things the standalone runtime can't run.
 *
 * Pure, so the open graph (the store's playWebInput, with the live values
 * mappings are giving it) and a saved graph compiled off-screen (a Present
 * snapshot, with none) go through the same code and produce the same page.
 */
import { unsupportedFeatures, type GraphFeatures, type PlayHtmlInput } from './exportHtml';
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
  particleSystems: unknown[];
}

/** The feature summary unsupportedFeatures reads, from a compile and a record. */
export function graphFeatures(c: CompiledForWeb, play: PlayRecord): GraphFeatures {
  return {
    textureUniforms: c.textureUniforms, videoUniforms: c.videoUniforms, audioUniforms: c.audioUniforms, liveUniforms: c.liveUniforms,
    isStateful: c.isStateful, particleSystems: c.particleSystems, usesEcho: /\bu_echo0\b/.test(c.fragmentShader), play,
  };
}

/**
 * The web page's input. `live` holds values mappings are giving controls right
 * now (control id → value): driven uniforms and layer values are baked at them.
 */
export function webInputFrom(c: CompiledForWeb, play: PlayRecord, opts: { title: string; aspect: PreviewAspect; live?: ReadonlyMap<string, number | number[]> }): { input: PlayHtmlInput; missing: string[] } {
  const live = opts.live ?? new Map<string, number | number[]>();
  // Uniforms at their current values, with driven ones at their live value.
  const uniforms: Record<string, number | number[]> = { ...c.paramUniforms };
  for (const ctl of play.controls) {
    const v = live.get(ctl.id);
    const u = c.paramBindings[ctl.target.split('::').slice(-2).join('::')];
    if (v !== undefined && u && !ctl.target.startsWith('layer:')) uniforms[u] = Array.isArray(v) ? [...v] : v;
  }
  return {
    input: { title: opts.title.trim() || 'Playfield', fragmentShader: c.fragmentShader, uniforms, paramBindings: c.paramBindings, play: bakeLayerValues(play, new Map(live)), aspect: opts.aspect },
    missing: unsupportedFeatures(graphFeatures(c, play)),
  };
}
