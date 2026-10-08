/**
 * lightRecipes.ts — "Light the scene" for a March Loop Group (3D, and 4D scenes, which march the
 * same way): one click builds a lighting rig after the loop and puts it on the Output
 * (docs/light-scene.md).
 *
 * Every rig is the same chain, tuned differently:
 *
 *   Sun direction → Soft Shadow + SDF AO (the loop's Scene, Hit Pos, Normal, Hit, Stretch)
 *   → Multi-Light (sun, sky, bounce) [+ highlight] [+ rim] [+ subsurface] [→ fog]
 *   → on the background (the loop's own Color where rays missed) → Tone Map → Output.
 *
 * The rig's nodes carry `__lightRig: <loop id>`, so choosing another rig replaces the last one
 * instead of piling up. Without a Scene wired into the loop there is nothing to shadow, so the
 * shadow, AO and subsurface steps are left out.
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { RecipeBuild, RecipeContext, StarterRecipe, Wire } from './types';
import { SELF, col, n, note } from './kit';

type V3 = [number, number, number];

interface Rig {
  id: string;
  label: string;
  description: string;
  base: V3;
  /** A look with its own surface colour (Clay, Neon): ignores the loop's Albedo. */
  ownColour?: boolean;
  sun: V3;
  sunColor: V3;
  sky: V3;
  bounce: V3;
  /** Soft Shadow hardness (8 soft … 32 hard); 0 = no shadows. */
  shadows: number;
  /** SDF AO step; 0 = no AO. */
  ao: number;
  /** Highlight strength and tightness; omit for matt. */
  spec?: { amount: number; shininess: number };
  /** Rim light colour (×strength) and Fresnel power. */
  rim?: { color: V3; power: number };
  /** Subsurface tint and strength. */
  sss?: { color: V3; strength: number };
  /** Fog density and colour. */
  fog?: { density: number; color: V3 };
}

const RIGS: Rig[] = [
  {
    id: 'light-daylight', label: 'Daylight', description: 'A warm sun with soft shadows, a blue sky from above and a little bounce from below. The all-rounder.',
    base: [0.6, 0.6, 0.62], sun: [0.6, 0.7, 0.4], sunColor: [1.3, 1.15, 0.95], sky: [0.25, 0.4, 0.6], bounce: [0.12, 0.1, 0.08],
    shadows: 16, ao: 0.06, spec: { amount: 0.4, shininess: 48 },
  },
  {
    id: 'light-studio', label: 'Studio', description: 'A neutral key light, a grey fill and a white rim that picks the shape out from the background. Product-shot look.',
    base: [0.7, 0.7, 0.72], sun: [-0.5, 0.8, 0.6], sunColor: [1.1, 1.1, 1.1], sky: [0.35, 0.35, 0.37], bounce: [0.08, 0.08, 0.08],
    shadows: 8, ao: 0.05, spec: { amount: 0.6, shininess: 64 }, rim: { color: [0.6, 0.6, 0.65], power: 3 },
  },
  {
    id: 'light-golden', label: 'Golden hour', description: 'A low orange sun with long shadows, a violet sky and a warm haze in the distance.',
    base: [0.65, 0.6, 0.55], sun: [0.85, 0.22, 0.3], sunColor: [1.7, 0.95, 0.5], sky: [0.22, 0.24, 0.42], bounce: [0.14, 0.08, 0.05],
    shadows: 12, ao: 0.06, spec: { amount: 0.35, shininess: 32 }, fog: { density: 0.6, color: [0.95, 0.65, 0.45] },
  },
  {
    id: 'light-night', label: 'Moonlight', description: 'A cool, dim moon with crisp shadows, a dark blue sky, a cold rim and blue fog.',
    base: [0.55, 0.58, 0.65], sun: [-0.4, 0.8, 0.35], sunColor: [0.45, 0.55, 0.85], sky: [0.04, 0.06, 0.13], bounce: [0.02, 0.02, 0.04],
    shadows: 32, ao: 0.06, spec: { amount: 0.5, shininess: 96 }, rim: { color: [0.2, 0.35, 0.7], power: 4 }, fog: { density: 0.8, color: [0.03, 0.05, 0.12] },
  },
  {
    id: 'light-clay', label: 'Clay', description: 'Matt white with very soft shadows and deep ambient occlusion: shows the shape, nothing else.',
    base: [0.82, 0.8, 0.78], sun: [0.4, 0.9, 0.5], sunColor: [0.7, 0.7, 0.7], sky: [0.6, 0.6, 0.62], bounce: [0.1, 0.1, 0.1],
    shadows: 6, ao: 0.09, ownColour: true,
  },
  {
    id: 'light-neon', label: 'Neon rim', description: 'A near-black surface lit only at its edges by a bright magenta rim, with a faint cyan fill. Good on dark backgrounds.',
    base: [0.05, 0.05, 0.07], sun: [0.3, 0.6, -0.7], sunColor: [0.15, 0.6, 0.8], sky: [0.02, 0.02, 0.04], bounce: [0, 0, 0],
    shadows: 0, ao: 0.05, spec: { amount: 0.8, shininess: 128 }, rim: { color: [1.6, 0.25, 1.2], power: 4 }, ownColour: true,
  },
  {
    id: 'light-wax', label: 'Wax / skin', description: 'Daylight plus subsurface scattering: thin parts glow warm, as if light passes through them.',
    base: [0.85, 0.62, 0.52], sun: [0.5, 0.7, -0.4], sunColor: [1.2, 1.05, 0.9], sky: [0.25, 0.3, 0.4], bounce: [0.12, 0.08, 0.06],
    shadows: 10, ao: 0.05, spec: { amount: 0.25, shininess: 24 }, sss: { color: [0.9, 0.3, 0.15], strength: 1.2 },
  },
  {
    id: 'light-quick', label: 'Quick (no shadows)', description: 'Sun, sky and bounce only: no shadow or AO rays, so it stays fast on big or heavily warped scenes.',
    base: [0.65, 0.65, 0.68], sun: [0.6, 0.7, 0.4], sunColor: [1.2, 1.1, 0.95], sky: [0.3, 0.42, 0.6], bounce: [0.12, 0.1, 0.08],
    shadows: 0, ao: 0,
  },
];

/** An Expression Block (vec3 result) with inputs wired from `ins` and optional sliders. */
function expr(id: string, x: number, y: number, label: string, ins: Array<[name: string, type: 'vec3' | 'float', from: Wire | { value: number; min: number; max: number }]>, result: string, comment: string): GraphNode {
  const slider = (f: Wire | { value: number; min: number; max: number }) => (Array.isArray(f) ? null : f);
  const e = n('exprNode', id, x, y, {
    label, outputType: 'vec3', lines: [], result, expr: result, __comment: comment,
    inputs: ins.map(([name, type, from]) => ({ name, type, slider: slider(from) ? { min: slider(from)!.min, max: slider(from)!.max } : null })),
    ...Object.fromEntries(ins.filter(([, , from]) => slider(from)).map(([name, , from]) => [name, slider(from)!.value])),
  });
  e.inputs = Object.fromEntries(ins.map(([name, type, from]) => [name, { type, label: name, ...(Array.isArray(from) ? { connection: { nodeId: from[0], outputKey: from[1] } } : {}) }]));
  e.outputs = { result: { type: 'vec3', label: 'Result' } };
  return e;
}

const wireOf = (node: GraphNode, key: string): Wire | null => {
  const c = node.inputs[key]?.connection;
  return c ? [c.nodeId, c.outputKey] : null;
};

/** The rig `r` round loop `ctx.self`. */
export function buildRig(ctx: RecipeContext, r: Rig): RecipeBuild {
  const self = ctx.self;
  const scene = wireOf(self, 'scene');
  const rd = wireOf(self, 'rd');
  const hasStretch = !!self.outputs.stretch;
  const tag = { __lightRig: self.id };
  const out: GraphNode[] = [];
  const add = (nd: GraphNode) => { nd.params = { ...nd.params, ...tag }; out.push(nd); return nd; };
  const pos: Wire = [SELF, 'pos'], normal: Wire = [SELF, 'normal'], hit: Wire = [SELF, 'hit'];
  const stretch: Record<string, Wire> = hasStretch ? { stretch: [SELF, 'stretch'] } : {};
  const y0 = 0;

  add(n('makeVec3', 'sun', col(1), y0 - 220, { r: r.sun[0], g: r.sun[1], b: r.sun[2], ...note(
    `Sun direction (${r.sun.join(', ')}): which way the light comes from, pointing toward it. Only the direction matters.`,
    'Why: the shadows, the light and the highlight all read it, so they always agree. Change it here to move the light.',
  ) }));
  const shadow = scene && r.shadows > 0 ? add(n('softShadow', 'shadow', col(1), y0, { k: r.shadows, tmax: 20, ...note(
    `Soft Shadow: from each hit point, marches toward the sun; Hardness ${r.shadows} (8 soft … 32 hard).`,
    hasStretch ? 'Why: shadows ground the shape. Stretch comes from the loop, so the shadow ray steps safely when Warp safety is on.' : 'Why: shadows ground the shape.',
  ) }, { scene, pos, normal, hit, lightDir: ['sun', 'rgb'], ...stretch })) : null;
  const ao = scene && r.ao > 0 ? add(n('sdfAo', 'ao', col(1), y0 + 300, { stepDist: r.ao, ...note(
    'SDF AO (ambient occlusion): steps out along the normal and darkens creases and corners where other surfaces are close.',
    'Why: it dims the sky and bounce light where little of the sky can reach.',
  ) }, { scene, pos, normal, hit, ...stretch })) : null;
  // The surface colour: the loop's Albedo (its wire, or its colour) unless the look brings its own.
  const albedoWire = r.ownColour ? null : wireOf(self, 'albedo');
  const albedo = Array.isArray(self.params.albedo) && self.params.albedo.length === 3 ? self.params.albedo as V3 : null;
  const baseRef: Wire = albedoWire ?? ['base', 'rgb'];
  if (!albedoWire) add(n('colorPicker', 'base', col(1), y0 + 560, { color: [...(!r.ownColour && albedo ? albedo : r.base)], ...note(
    r.ownColour ? `Surface colour for the ${r.label} look.` : 'Surface colour (the March Loop\'s Albedo when the rig was added).',
    'Keep it between about 0.2 and 0.8 and let the lights make it bright or dark.',
  ) }));
  const light = add(n('multiLight', 'light', col(2), y0, {
    sunR: r.sunColor[0], sunG: r.sunColor[1], sunB: r.sunColor[2], skyR: r.sky[0], skyG: r.sky[1], skyB: r.sky[2], bounceR: r.bounce[0], bounceG: r.bounce[1], bounceB: r.bounce[2],
    ...note(
      `${r.label}: the light rig. A sun (shadowed), a sky from above and a bounce from below (both dimmed by AO).`,
      'Why: three lights read as natural. The colours set the mood; values above 1 are fine, Tone Map brings them back.',
    ),
  }, { baseColor: baseRef, normal, hit, sunDir: ['sun', 'rgb'], ...(ao ? { ao: ['ao', 'ao'] as Wire } : {}), ...(shadow ? { shadow: ['shadow', 'shadow'] as Wire } : {}) }));
  let lit: Wire = [light.id, 'color'];
  let x = 3;

  if (r.spec) {
    add(n('blinnPhong', 'spec', col(2), y0 + 360, { shininess: r.spec.shininess, diffuseness: 0, ...note(
      'Blinn-Phong (highlight only): where the surface mirrors the sun toward the camera.',
    ) }, { normal, lightDir: ['sun', 'rgb'], ...(rd ? { viewDir: rd } : {}) }));
    add(expr('addSpec', col(x++), y0, 'Add highlight', [['lit', 'vec3', lit], ['spec', 'float', ['spec', 'light']], ['shadow', 'float', shadow ? ['shadow', 'shadow'] : { value: 1, min: 0, max: 1 }], ['amount', 'float', { value: r.spec.amount, min: 0, max: 2 }]],
      'lit + r_sunColor * spec * shadow * amount'.replace('r_sunColor', `vec3(${r.sunColor.map(v => v.toFixed(2)).join(', ')})`),
      'Add highlight: the sun\'s sparkle on top of the lit colour, only where the sun isn\'t shadowed.\nWhy: Amount is how glossy the surface looks (0 matt … 2 polished).'));
    lit = ['addSpec', 'result'];
  }
  if (r.rim) {
    add(n('fresnel3d', 'rimEdge', col(2), y0 + 620, { power: r.rim.power, ...note(
      'Fresnel: 0 facing the camera, 1 at the silhouette edge.',
      'Why: the rim light lives at the edges.',
    ) }, { normal, ...(rd ? { viewDir: rd } : {}) }));
    add(expr('addRim', col(x++), y0, 'Add rim light', [['lit', 'vec3', lit], ['edge', 'float', ['rimEdge', 'fresnel']], ['normal', 'vec3', normal], ['hit', 'float', hit], ['strength', 'float', { value: 1, min: 0, max: 3 }]],
      `lit + vec3(${r.rim.color.map(v => v.toFixed(2)).join(', ')}) * edge * hit * strength * (1.0 - smoothstep(0.75, 1.0, normal.y))`,
      'Add rim light: a coloured glow round the silhouette.\nWhy: it separates the shape from the background. Change the colour in the line, Strength for how much. It fades on floors and other upward-facing surfaces (normal.y near 1), which would otherwise glow all over at a low camera.'));
    lit = ['addRim', 'result'];
  }
  if (r.sss && scene) {
    add(n('fakeSSS', 'sss', col(2), y0 + 880, { strength: r.sss.strength, sssR: r.sss.color[0], sssG: r.sss.color[1], sssB: r.sss.color[2], ...note(
      'Subsurface (fake): how thin the shape is toward the light; thin parts let light through.',
    ) }, { scene, pos, normal, hit, lightDir: ['sun', 'rgb'] }));
    add(expr('addSss', col(x++), y0, 'Add subsurface', [['lit', 'vec3', lit], ['sss', 'vec3', ['sss', 'sss']]], 'lit + sss',
      'Add subsurface: the glow through thin parts, on top of the lit colour.'));
    lit = ['addSss', 'result'];
  }
  if (r.fog) {
    add(n('volumetricFog', 'fog', col(x++), y0, { density: r.fog.density, fogR: r.fog.color[0], fogG: r.fog.color[1], fogB: r.fog.color[2], ...note(
      `Fog: far surfaces fade into the fog colour (density ${r.fog.density}).`,
      'Why: depth. Distant things go soft and take the air\'s colour.',
    ) }, { color: lit, depth: [SELF, 'depth'], hit }));
    lit = ['fog', 'color'];
  }
  add(expr('compose', col(x++), y0, 'On the background', [['background', 'vec3', [SELF, 'color']], ['lit', 'vec3', lit], ['hit', 'float', hit]], 'mix(background, lit, hit)',
    'The lit surface where a ray hit, the loop\'s own Color (its Background) where it missed.\nWhy: change the background on the March Loop as before.'));
  add(n('toneMap', 'tone', col(x), y0, { mode: 'aces', ...note(
    'Tone Map (ACES): brings bright light (above 1) back into range smoothly, like film.',
  ) }, { color: ['compose', 'result'] }));

  return {
    nodes: out,
    remove: ctx.nodes.filter(nd => nd.params.__lightRig === self.id).map(nd => nd.id),
    show: ['tone', 'color'],
  };
}

export const LIGHT_RECIPES: StarterRecipe[] = RIGS.map(r => ({
  id: r.id, label: r.label, description: r.description, build: (ctx: RecipeContext) => buildRig(ctx, r),
}));

/** Node types whose offer is "Light the scene" rather than "Set up". */
export const LIGHT_SCENE_TYPES = new Set(['marchLoopGroup']);
