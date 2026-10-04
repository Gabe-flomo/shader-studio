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
import { unsupportedFeatures, type GraphFeatures, type PlayHtmlInput, type PlayMedia, type WebAgents, type WebPass } from './exportHtml';
import type { AgentsSpec, PassProgram } from '../compiler/types';
import { passPrevUniform, passUniform } from '../nodes/definitions/passes';
import { agentDrawUniform, agentStateUniform, agentStepUniform, agentWindowUniform, trailStepUniforms, trailUniform } from '../nodes/definitions/agents';
import { AG_BESSEL_UNIFORM, listenUniforms } from '../nodes/definitions/agentForces';
import { MOTION_MAP_UNIFORM } from '../nodes/definitions/motionMap';
import { agentReadLayer } from '../lib/agentReadings';
import { bakeLayerValues } from './playControls';
import type { PlayRecord } from '../types/play';
import type { PreviewAspect } from '../utils/graphImportPlan';
import type { DatasetResult, DatasetsRecord } from '../data/types';
import { datasetsForWeb } from './dataExport';

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
  /** Pass nodes' programs (compiler/passGraph.ts); absent or null without Pass nodes. */
  passes?: readonly PassProgram[] | null;
  /** The Agents family's programs (compiler/agentGraph.ts); absent or null without one. */
  agents?: AgentsSpec | null;
}

/** What unsupportedFeatures reads, from a compile (a superset, so it keeps working as the runtime learns more). */
export function graphFeatures(c: CompiledForWeb, play: PlayRecord): GraphFeatures {
  const f = {
    textureUniforms: c.textureUniforms, videoUniforms: c.videoUniforms, audioUniforms: c.audioUniforms, liveUniforms: c.liveUniforms,
    isStateful: c.isStateful, usesEcho: /\bu_echo0\b/.test(c.fragmentShader), usesData: /\bu_ds_\w+/.test(c.fragmentShader), play,
  };
  return f;
}

/** Pass programs as the page runs them (kit/passHost.js): what it draws, with their sampler names. */
export function webPasses(passes: readonly PassProgram[]): WebPass[] {
  return passes.map(p => ({
    slug: p.slug, label: p.label, fragmentShader: p.fragmentShader, scale: p.scale, format: p.format, filter: p.filter, wrap: p.wrap,
    previous: p.previous, live: p.live, ...(p.afterAgents ? { afterAgents: true } : {}),
    u: { tex: passUniform(p.slug), prev: passPrevUniform(p.slug) },
  }));
}

/** The Agents family as the page runs it (kit/agentHost.js): what it runs, with its uniform names. */
export function webAgents(a: AgentsSpec, play?: PlayRecord): WebAgents {
  // Groups the page's Play reads (sensors on `ag:<node id>`: a mapping, a source or a rule): the page sums their walkers.
  const setup = play ? JSON.stringify(play) : '';
  const reads = (id: string) => !!setup && (setup.includes(`"${agentReadLayer(id)}"`) || setup.includes(`read:${agentReadLayer(id)}::`));
  return {
    groups: a.groups.map(({ nodeId, nodeIds: _ids, readsTrails: _t, readsPasses: _p, listeners, ...g }) => ({
      ...g,
      ...(reads(nodeId) ? { readAs: agentReadLayer(nodeId) } : {}),
      listeners: listeners.map(({ nodeId: _l, ...l }) => ({ ...l, u: listenUniforms(l.slug) })),
      u: {
        A: agentStateUniform(g.slug, 'A'), B: agentStateUniform(g.slug, 'B'), C: agentStateUniform(g.slug, 'C'), D: agentStateUniform(g.slug, 'D'),
        step: agentStepUniform(g.slug), win: agentWindowUniform(g.slug),
      },
    })),
    deposits: a.deposits.map(({ nodeId: _n, ...d }) => d),
    trails: a.trails.map(({ nodeId: _n, stepNodeIds: _s, readsPasses: _p, ...t }) => ({ ...t, u: { tex: trailUniform(t.slug), ...trailStepUniforms(t.slug) } })),
    draws: a.draws.map(({ nodeId: _n, ...d }) => ({ ...d, u: { tex: agentDrawUniform(d.slug) } })),
    bessel: AG_BESSEL_UNIFORM,
  };
}

/** Every program a compile draws: the picture's, the passes', the update shaders and the Trails' own steps. */
export function webShaders(c: CompiledForWeb): string[] {
  return [
    c.fragmentShader, ...(c.passes ?? []).map(p => p.fragmentShader),
    ...(c.agents?.groups ?? []).map(g => g.fragmentShader), ...(c.agents?.trails ?? []).flatMap(t => (t.stepShader ? [t.stepShader] : [])),
  ];
}

/**
 * The web page's input. `live` holds values mappings are giving controls right
 * now (control id → value): driven uniforms and layer values are baked at them.
 * `media` is the graph's input files, when they're loaded (the open graph).
 */
export function webInputFrom(c: CompiledForWeb, play: PlayRecord, opts: { title: string; aspect: PreviewAspect; live?: ReadonlyMap<string, number | number[]>; media?: PlayMedia; backgroundGraphs?: PlayHtmlInput['backgroundGraphs']; datasets?: DatasetsRecord; liveData?: (id: string) => DatasetResult | null }): { input: PlayHtmlInput; missing: string[] } {
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
    },
  };
  if (c.passes?.length) input.graphPasses = webPasses(c.passes);
  if (c.agents && c.agents.groups.length + c.agents.trails.length + c.agents.draws.length > 0) input.agents = webAgents(c.agents, play);
  // The Motion (texture) node, read by any program: the page fills its sampler from its first Motion layer.
  if (webShaders(c).some(s => s.includes(MOTION_MAP_UNIFORM))) input.motionMap = MOTION_MAP_UNIFORM;
  if (opts.media) input.media = opts.media;
  if (opts.backgroundGraphs && Object.keys(opts.backgroundGraphs).length) input.backgroundGraphs = opts.backgroundGraphs;
  // The datasets the page reads (Data nodes in the shader, Data layers, data mappings, s.data()): their results only.
  if (opts.datasets) {
    const sets = datasetsForWeb(opts.datasets, play, webShaders(c), { live: opts.liveData });
    if (Object.keys(sets).length) input.datasets = sets;
  }
  return { input, missing: unsupportedFeatures(graphFeatures(c, play)) };
}
