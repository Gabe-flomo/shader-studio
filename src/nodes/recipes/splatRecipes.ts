/**
 * splatRecipes.ts — putting a splat scan in a ray-marched scene (docs/splat-scene.md "Add to scene").
 *
 *  - On a March Loop (or GI Lit) card, "Add a splat scan" (an offer, like "Add a picture with depth"): a Splat Scene
 *    wired to the loop's camera and to what the Output shows, its Color on the Output.
 *  - On a Splat Scene card, "Add to scene": the same wiring for the scan that is already there, into the graph's first
 *    March Loop (wireSplatIntoScene, a pure function the card runs through rewriteTopLevel).
 *
 * Wiring: Ray Origin / Ray Dir from the loop's camera (what feeds the loop's own ro / rd), Scene from what the Output
 * shows now (the loop's Color, or the lighting after it), Scene distance / hit from the loop.
 */
import type { GraphNode } from '../../types/nodeGraph';
import type { RecipeContext, StarterRecipe, Wire } from './types';
import { SELF, n, note } from './kit';
import { graphOutput } from '../scene3dDefaults';
import { SPLAT_SCENE_TYPE } from '../definitions/splatScene';

/** The offer's key in STARTER_RECIPES (opened from the March Loop card). */
export const SPLAT_SCENE_SET = 'splatSceneOffer';
export const LOOP_TYPES = ['marchLoopGroup', 'giLitMarchGroup'] as const;

const wireOf = (node: GraphNode, key: string): Wire | null => {
  const c = node.inputs[key]?.connection;
  return c ? [c.nodeId, c.outputKey] : null;
};

/** What the scan composites over: what the Output shows (unless it is a Splat Scene already), else the loop's Color. */
function sceneUnder(nodes: GraphNode[], loop: GraphNode, self: string): Wire {
  let w = wireOf(graphOutput(nodes) ?? n('output', 'x', 0, 0), 'color');
  // Shown through Splat Scenes already: the scene under the last of them.
  for (let guard = 0; w && guard < 8; guard++) {
    const at = nodes.find(x => x.id === w![0]);
    if (!at || at.type !== SPLAT_SCENE_TYPE) break;
    w = wireOf(at, 'scene');
  }
  if (!w || w[0] === self) return [loop.id, 'color'];
  return w;
}

function wiresFor(nodes: GraphNode[], loop: GraphNode, self: string): Record<string, Wire> {
  const ro = wireOf(loop, 'ro'), rd = wireOf(loop, 'rd');
  return {
    ...(ro ? { ro } : {}), ...(rd ? { rd } : {}),
    scene: sceneUnder(nodes, loop, self), dist: [loop.id, 'dist'], hit: [loop.id, 'hit'],
  };
}

const NOTE = note(
  'Splat Scene: a Gaussian splat scan (drop a .ply, .splat or .spz on this card, or Load…). It is seen through the March Camera, so it sits among the ray-marched shapes.',
  'Why: Scene, Scene distance and Scene hit come from the March Loop, so at each pixel the nearer one wins: a shape passes through the scan.',
);

function build(ctx: RecipeContext) {
  const loop = ctx.self;
  const scan = n(SPLAT_SCENE_TYPE, 'scan', 0, 560, { ...NOTE, __splatScene: loop.id });
  const w = wiresFor(ctx.nodes, loop, 'scan');
  scan.inputs = Object.fromEntries(Object.entries(scan.inputs).map(([k, i]) => {
    const src = w[k];
    return [k, src ? { ...i, connection: { nodeId: src[0] === loop.id ? SELF : src[0], outputKey: src[1] } } : i];
  }));
  return {
    nodes: [scan],
    remove: ctx.nodes.filter(x => x.params.__splatScene === loop.id).map(x => x.id),
    show: ['scan', 'color'] as Wire,
  };
}

export const SPLAT_SCENE_RECIPES: StarterRecipe[] = [
  { id: 'splat-scene', label: 'A splat scan in the scene', description: 'A Splat Scene seen through this loop\'s camera, put together with the scene by distance: drop a .ply, .splat or .spz scan on it.', build },
];

/**
 * "Add to scene" on a Splat Scene card: wire it to the graph's first March Loop (its camera, what the Output shows,
 * its distance and hit) and show its Color. Null when there is no March Loop or nothing would change.
 */
export function wireSplatIntoScene(nodes: GraphNode[], splatId: string, nextId: () => string): GraphNode[] | null {
  const splat = nodes.find(x => x.id === splatId && x.type === SPLAT_SCENE_TYPE);
  const loop = nodes.find(x => (LOOP_TYPES as readonly string[]).includes(x.type));
  if (!splat || !loop) return null;
  const w = wiresFor(nodes, loop, splatId);
  const inputs = { ...splat.inputs };
  for (const [k, src] of Object.entries(w)) if (inputs[k]) inputs[k] = { ...inputs[k], connection: { nodeId: src[0], outputKey: src[1] } };
  let out = graphOutput(nodes);
  const added: GraphNode[] = [];
  if (!out) {
    out = n('output', nextId(), splat.position.x + 420, splat.position.y, { __comment: 'Output: what the canvas shows. Added by "Add to scene", since the graph had none.' });
    added.push(out);
  }
  const outId = out.id;
  const next = nodes.map(x => {
    if (x.id === splatId) return { ...x, inputs };
    if (x.id === outId) return { ...x, inputs: { ...x.inputs, color: { ...x.inputs.color, connection: { nodeId: splatId, outputKey: 'color' } } } };
    return x;
  });
  return [...next, ...added.map(o => ({ ...o, inputs: { ...o.inputs, color: { ...o.inputs.color, connection: { nodeId: splatId, outputKey: 'color' } } } }))];
}

/** Is there a March Loop for "Add to scene" to wire into? */
export const hasMarchLoop = (nodes: readonly GraphNode[]) => nodes.some(x => (LOOP_TYPES as readonly string[]).includes(x.type));
