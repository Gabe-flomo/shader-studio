/**
 * surpriseBias.ts — "a little inspired by" the graphs that exist (docs/surprise.md).
 *
 * The Do bar's random line picks shapes, space steps, light steps, post steps, colour drivers and
 * palettes (2D) or modes, shapes and warps (3D) from weighted lists. This reads how many graphs
 * (the bundled examples and the user's saved ones) use each of those words, and nudges the lists
 * toward them: a word found in every graph is up to about 3 times as likely as one found in none.
 * Nothing is ever ruled out, so plenty of randomness stays. Pure; the same graphs and seed make the
 * same line.
 *
 * A word is found by the node types (and the settings) that make it: "star" is a Shape SDF set to
 * star, "twist" is a swirl or twist node, "fire" is a Palette node set to the Fire preset. A graph
 * counts once per word, however many nodes use it, so one big graph can't dominate.
 */
import type { GraphNode } from '../types/nodeGraph';
import { PALETTES } from '../sceneBuilder/output';

/** How many graphs use each word, by `group:word`. */
export type SurpriseBias = Readonly<Record<string, number>>;

type Test = (n: GraphNode) => boolean;
const types = (...t: string[]): Test => n => t.includes(n.type);
const shapeIs = (word: string, ...t: string[]): Test => n => t.includes(n.type) || (typeof n.params?.shape === 'string' && n.params.shape === word);

/** group → word → what finds it in a node. */
const WORDS: Record<string, Record<string, Test>> = {
  shape: {
    circle: shapeIs('circle', 'circleSDF'), ring: shapeIs('ring', 'ringSDF'), box: shapeIs('box', 'boxSDF'),
    star: shapeIs('star'), hexagon: shapeIs('hexagon'), heart: shapeIs('heart'), triangle: shapeIs('triangle'), moon: shapeIs('moon'),
    cross: shapeIs('cross', 'sdCross3D'), diamond: shapeIs('diamond'), pentagon: shapeIs('pentagon'), octagon: shapeIs('octagon'),
  },
  space: {
    twist: types('twist3D', 'helixWarp3D'), swirl: types('swirlSpace', 'swirlWarp'), 'polar-repeat': types('angularRepeat2D', 'kaleidoSpace', 'polarRepeat3D'),
    repeat: types('infiniteRepeatSpace', 'limitedRepeat2D', 'repeat3D'), mirror: types('mirroredRepeat2D', 'mirrorFold3D'),
    warp: types('domainWarp', 'uvWarp', 'smoothWarp', 'curlWarp', 'turbulence'), 'zoom-rotate': types('rotate2d', 'uvTransform2d'),
  },
  shapeIt: {
    glow: types('light', 'glowLayer', 'deepGlow', 'glowToColor'), rings: n => n.type === 'light' && n.params?.mode === 'ring' || n.type === 'rippleSpace', outline: types('sdfSharpen', 'sobel', 'edgesTexture'),
  },
  post: { 'tone-map': types('toneMap'), grain: types('grain'), brighten: types('brightnessContrast', 'liftGammaGain') },
  driver: { length: types('length'), angle: types('vec2Angle', 'polarSpace'), x: types('splitVec2'), y: types('splitVec2'), time: types('time') },
  mode: {
    surface: types('rayMarch', 'raymarch3d', 'marchOutput', 'blinnPhong'), gi: types('giLitMarchGroup', 'radianceCascadesApprox'),
    volumetric: types('volumetricScene', 'volumeGlow', 'volumeClouds', 'volumetricFog'), glass: types('glass3d', 'glassScene'),
  },
  scene: {
    sphere: types('sphereSDF3D'), box: types('boxSDF3D', 'roundedBoxSDF3D'), torus: types('torusSDF3D', 'linkSDF3D'), capsule: types('capsuleSDF3D', 'verticalCapsuleSDF3D'),
    cylinder: types('cylinderSDF3D', 'roundedCylinderSDF3D'), cone: types('coneSDF3D', 'cappedConeSDF3D'), octahedron: types('octahedronSDF3D'),
    'capped-torus': types('cappedTorusSDF3D'), 'box-frame': types('boxFrameSDF3D'), pyramid: types('pyramidSDF3D'), ellipsoid: types('ellipsoidSDF3D'),
  },
  warp3: {
    twist: types('twist3D'), bend: types('bend3D'), 'polar-repeat': types('polarRepeat3D'), sine: types('sinWarp3D'), fold: types('fold3D', 'mirrorFold3D'),
    warp: types('domainWarp3D', 'turbulence3D'), kaleido: types('kaleidoscope3D'),
  },
};

/** Palette key → the Palette node preset index it names (ramps have none, so they are never counted). */
const PALETTE_INDEX = new Map(PALETTES.filter(p => p.kind === 'palette').map(p => [String(p.preset), p.key]));

/** Count, per `group:word`, the graphs that use it. */
export function countWords(graphs: Iterable<readonly GraphNode[]>): SurpriseBias {
  const out: Record<string, number> = {};
  for (const nodes of graphs) {
    const seen = new Set<string>();
    for (const n of nodes ?? []) {
      for (const [group, words] of Object.entries(WORDS)) for (const [word, test] of Object.entries(words)) {
        const k = `${group}:${word}`;
        if (!seen.has(k) && test(n)) seen.add(k);
      }
      if (n.type === 'palette') {
        const key = PALETTE_INDEX.get(String(n.params?.preset));
        if (key) seen.add(`palette:${key}`);
      }
    }
    for (const k of seen) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** The lowest and highest nudge: a word in every graph is `MAX_LEAN / MIN_LEAN` (about 3.3) times as likely as one in none. */
const MIN_LEAN = 0.6, MAX_LEAN = 2;

/**
 * A weighted list with its weights nudged toward the words the graphs use, within `group`. With no
 * bias (or no counts for this group) the list is returned as it is.
 */
export function leanWeights<T extends string>(group: string, list: ReadonlyArray<readonly [T, number]>, bias?: SurpriseBias): Array<readonly [T, number]> {
  if (!bias) return list as Array<readonly [T, number]>;
  const count = (w: string) => bias[`${group}:${w}`] ?? 0;
  const max = Math.max(0, ...list.map(([w]) => count(w)));
  if (!max) return list as Array<readonly [T, number]>;
  return list.map(([w, weight]) => [w, weight * (MIN_LEAN + (MAX_LEAN - MIN_LEAN) * (count(w) / max))] as const);
}

/** Same for a plain list of words (each starting equally likely). */
export const leanList = <T extends string>(group: string, words: readonly T[], bias?: SurpriseBias) => leanWeights(group, words.map(w => [w, 1] as const), bias);
