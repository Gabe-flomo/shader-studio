/**
 * presets.ts — Combine's built-in starting points (docs/combine-plan.md §3.2, the presets strip): each makes its
 * products the way their builders would (a 3D build from a recipe, a 2D build, a photo's Texture node) and the stack
 * that joins them. Only the user's own photos ship with the app (lib/builtinImages.ts), so the presets use those.
 *
 * Pure: `presetGraph` returns the graph with the products added and the spec; actions apply it to the draft. The
 * Combine examples (store/combineExamples.ts) are the same graphs with the glue built.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { applyScene } from '../sceneBuilder/apply';
import { parseRecipe } from '../sceneBuilder/recipe';
import { applyScene2D } from '../sceneBuilder2d/apply';
import { parseRecipe2D } from '../sceneBuilder2d/recipe';
import { builtinImageParams, ROOM_AND_CAT_ID, WALKWAY_CAT_ID } from '../lib/builtinImages';
import { rulesTemplateNodes } from '../agentRules/templates';
import { agents3dStarter, remapMarks } from '../agentRules/space3d';
import { freshIds } from '../store/agentSetup';
import type { CombineSpec } from './spec';

export interface CombinePreset {
  key: string;
  label: string;
  /** One line for the card's tooltip. */
  hint: string;
  /** The card's picture: an icon over a colour wash. */
  icon: 'cube' | 'mask' | 'image' | 'layers' | 'swarm';
}

export const COMBINE_PRESETS: readonly CombinePreset[] = [
  { key: 'photoInRoom', label: 'Photo in a room', hint: 'Room and cat on a card standing in a small 3D scene (Place in · card).', icon: 'cube' },
  { key: 'peopleRings', label: 'People → rings', hint: 'The person in Walkway cat found by Segment and filled with a 2D kaleidoscope that sticks to them (Replace mask with).', icon: 'mask' },
  { key: 'photoWorld', label: 'Photo as the world', hint: 'A 3D scene with Room and cat all round it (Place in · surroundings).', icon: 'image' },
  { key: 'sceneOnPhoto', label: 'Shapes on a photo', hint: 'A 3D scene\'s shapes laid over Room and cat (Place in · over).', icon: 'layers' },
  { key: 'sparksTrace', label: 'Sparks trace a star', hint: 'A swarm of walkers riding a glowing 2D star\'s outline (Follow the shape · trace).', icon: 'swarm' },
  { key: 'dustSettles', label: 'Dust settles on shapes', hint: '3D walkers falling onto a ball and a block and piling up there (Collide with · settle).', icon: 'cube' },
];

/** A small surface-lit 3D scene: a floor, a ball, a block (the 3D builder's own recipe words). */
export const ROOM_RECIPE = [
  'plane y=-1 name=Floor color=(0.32,0.29,0.27)',
  'sphere r=0.42 at=(-1.15,-0.58,0.35) name=Ball color=(0.85,0.32,0.22)',
  'box size=(0.32,0.5,0.32) round=0.03 at=(1.15,-0.5,0.15) rot=(0,25,0) name=Block color=(0.25,0.55,0.85)',
  'sun dir=(0.45,0.85,0.6)',
  'background top=(0.16,0.18,0.24) bottom=(0.05,0.05,0.07)',
  'camera dist=4 angle=8 elev=10',
].join('\n');

/** Floating shapes, no floor: for a picture round them or under them. */
export const SHAPES_RECIPE = [
  'torus R=0.55 r=0.16 at=(-0.7,0.1,0) rot=(70,0,20) name=Ring color=(0.95,0.75,0.3) shine=0.8',
  'sphere r=0.38 at=(0.75,-0.05,0.2) name=Ball color=(0.9,0.9,0.95) shine=1',
  'camera dist=3.6 angle=0 elev=6 orbit=6',
].join('\n');

/** A kaleidoscope of rings (no bloom: it is drawn again in every blob, so no pass). */
export const RINGS_RECIPE_2D = 'rotate 0 spin=0.03 · kaleidoscope 8 · ring r=0.42 th=0.05 at=(0.5,0.1) color=cyan @orbit(0.1 speed=0.12) · ring r=0.22 th=0.04 at=(0.25,0.45) color=magenta @pulse(0.3 speed=0.25) · circle r=0.1 at=(0.75,0.3) color=gold · glow 0.012 falloff=1.1 · tone aces · background night';

/** A five-point star drawn as a glowing outline (Burst: the Star SDF with any number of points), for walkers to trace. */
export const STAR_RECIPE_2D = 'burst r=0.62 points=5 sharp=2.4 color=(1,0.62,0.25) style=outline · background night';

/** A floor, a ball and a block inside the walkers' box (x ±aspect, y and z ±1), for dust to settle on. */
export const DUST_RECIPE = [
  'plane y=-1 name=Floor color=(0.3,0.28,0.26)',
  'sphere r=0.42 at=(-0.5,-0.58,0) name=Ball color=(0.85,0.32,0.22)',
  'box size=(0.32,0.32,0.32) round=0.03 at=(0.55,-0.68,0.05) rot=(0,25,0) name=Block color=(0.25,0.55,0.85)',
  'sun dir=(0.45,0.85,0.6)',
  'background top=(0.12,0.13,0.18) bottom=(0.04,0.04,0.05)',
  'camera dist=3.4 angle=12 elev=14',
].join('\n');

/** A sculpture for fireflies to circle: a torus round a ball, slowly orbited. */
export const SCULPTURE_RECIPE = [
  'torus R=0.62 r=0.14 at=(0,0,0) rot=(30,0,20) name="Bronze ring" color=(0.75,0.6,0.4) shine=0.6',
  'sphere r=0.3 at=(0,0,0) name="Steel core" color=(0.3,0.32,0.38)',
  'background top=(0.03,0.04,0.07) bottom=(0.01,0.01,0.02)',
  'camera dist=3 angle=0 elev=22 orbit=5',
].join('\n');

/**
 * An Agent build as the Agent Builder makes one (its template's whole setup: Emit → the rules group → Draw agents),
 * with fresh ids: 2D from a rules template (the Swarm: walkers that live for ever), 3D from a 3D template. `emit` sets
 * its Emit (where they are born) and `draw` its Draw agents (how they look) on the way.
 */
export function agentsBuildNodes(space: '2d' | '3d', nextId: () => string, o: { template?: string; emit?: Record<string, unknown>; draw?: Record<string, unknown>; at?: { x: number; y: number } } = {}): { nodes: GraphNode[]; groupId: string } {
  const made = space === '3d' ? agents3dStarter(o.template ?? 'orbiters3d') : null;
  const raw = made ? made.nodes : rulesTemplateNodes(o.template ?? 'swarm', 'cbA', 0, 0, false);
  const group0 = made ? made.groupId : 'cbAAgents';
  const fresh = freshIds(raw, nextId);
  const nodes = (made ? remapMarks(fresh.nodes, fresh.idOf) : fresh.nodes).map(nd => ({
    ...nd,
    position: { x: nd.position.x + (o.at?.x ?? 0), y: nd.position.y + (o.at?.y ?? 0) },
    ...(o.emit && nd.type === 'agentEmit' ? { params: { ...nd.params, ...o.emit } } : {}),
    ...(o.draw && nd.type === 'drawAgents' ? { params: { ...nd.params, ...o.draw } } : {}),
  }));
  return { nodes, groupId: fresh.idOf(group0) };
}

const note = (lines: string[]) => ({ __comment: lines.join('\n') });

/** A Texture node with one of the built-in photos. */
function photo(id: string, which: 'room' | 'walkway', at: { x: number; y: number }): GraphNode {
  const def = getNodeDefinition('textureInput')!;
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { type: s.type, label: s.label }]));
  const outputs = Object.fromEntries(Object.entries(def.outputs).map(([k, s]) => [k, { type: s.type, label: s.label }]));
  const name = which === 'room' ? 'Room and cat' : 'Walkway cat';
  return {
    id, type: 'textureInput', position: at, inputs, outputs,
    params: {
      ...(def.defaultParams ?? {}), fit: which === 'room' ? 'stretch' : 'cover', ...builtinImageParams(which === 'room' ? ROOM_AND_CAT_ID : WALKWAY_CAT_ID),
      ...note([`Texture: the built-in ${name} photo. Pick your own picture or video on this card: the layers above it follow.`]),
    },
  };
}

/** `key`'s products added to `graph`, and the stack joining them. Null for an unknown key. */
export function presetGraph(key: string, graph: readonly GraphNode[], nextId: () => string): { nodes: GraphNode[]; spec: CombineSpec; made: string[] } | null {
  let nodes = [...graph];
  const before = new Set(nodes.map(n => n.id));
  const left = nodes.length ? Math.min(...nodes.map(n => n.position.x)) : 0;
  const low = nodes.length ? Math.max(...nodes.map(n => n.position.y)) + 300 : 0;
  const scene3d = (recipe: string) => {
    const r = applyScene(nodes, parseRecipe(recipe).spec, { nextId, asNew: true, at: { x: left, y: low } });
    nodes = r.nodes;
    return r.sceneId;
  };
  const scene2d = (recipe: string) => {
    const r = applyScene2D(nodes, parseRecipe2D(recipe).scene, { nextId, asNew: true, at: { x: left, y: low + 900 } });
    nodes = r.nodes;
    return r.sceneId;
  };
  const addPhoto = (which: 'room' | 'walkway') => {
    const id = nextId();
    nodes.push(photo(id, which, { x: left - 420, y: low }));
    return id;
  };
  let spec: CombineSpec;
  if (key === 'photoInRoom') {
    const s = scene3d(ROOM_RECIPE);
    const p = addPhoto('room');
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'build', scene: '3d', id: s }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'node', nodeId: p, output: 'color' }, verb: 'placeIn', settings: { how3d: 'card', x: 0, y: -0.05, z: 0.05, turn: -10, size: 2, glow: 1 } },
    ] };
  } else if (key === 'peopleRings') {
    const p = addPhoto('walkway');
    const r = scene2d(RINGS_RECIPE_2D);
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'node', nodeId: p, output: 'color' }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'mask', find: 'people' }, verb: 'replaceMask', settings: { maxBlobs: 2 } },
      { id: 'L3', product: { kind: 'build', scene: '2d', id: r }, verb: 'replaceMask', settings: { stick: 'blobs', fit: 'square', padding: 0.2 } },
    ] };
  } else if (key === 'photoWorld') {
    const s = scene3d(SHAPES_RECIPE);
    const p = addPhoto('room');
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'build', scene: '3d', id: s }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'node', nodeId: p, output: 'color' }, verb: 'placeIn', settings: { how3d: 'surroundings' } },
    ] };
  } else if (key === 'sceneOnPhoto') {
    const p = addPhoto('room');
    const s = scene3d(SHAPES_RECIPE);
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'node', nodeId: p, output: 'color' }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'build', scene: '3d', id: s }, verb: 'placeIn', settings: { howPic: 'over' } },
    ] };
  } else if (key === 'sparksTrace') {
    const s = scene2d(STAR_RECIPE_2D);
    // Warm sparks, dim each, so the band reads as streaks rather than a solid line.
    const a = agentsBuildNodes('2d', nextId, { draw: { colorBy: 'heading', colorA: [1, 0.5, 0.15], colorB: [1, 0.85, 0.45], brightness: 0.05, glow: 0.6 }, at: { x: left, y: low + 1800 } });
    nodes = [...nodes, ...a.nodes];
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'build', scene: '2d', id: s }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'build', scene: 'agents', id: a.groupId }, verb: 'follow', settings: { how: 'trace', speed: 0.3, offset: 0.07, width: 0.02 } },
    ] };
  } else if (key === 'firefliesSculpture') {
    // Not on the strip: the Combine example of Follow surface (3D Scene).
    const s = scene3d(SCULPTURE_RECIPE);
    const a = agentsBuildNodes('3d', nextId, { template: 'orbiters3d', emit: { shape: 'ball', size: 1 }, at: { x: left, y: low + 1800 } });
    nodes = [...nodes, ...a.nodes];
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'build', scene: '3d', id: s }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'build', scene: 'agents', id: a.groupId }, verb: 'follow', settings: { how: 'orbit', orbit: 0.1, speed: 0.5, axis: 'y', reach: 1.6 } },
    ] };
  } else if (key === 'dustSettles') {
    const s = scene3d(DUST_RECIPE);
    // The dust: born at once all through the box (Whole picture), so it rains down onto the shapes.
    const a = agentsBuildNodes('3d', nextId, { template: 'orbiters3d', emit: { shape: 'screen', size: 1 }, at: { x: left, y: low + 1800 } });
    nodes = [...nodes, ...a.nodes];
    spec = { v: 1, layers: [
      { id: 'L1', product: { kind: 'build', scene: '3d', id: s }, verb: 'base', settings: {} },
      { id: 'L2', product: { kind: 'build', scene: 'agents', id: a.groupId }, verb: 'collide', settings: { mode: 'settle', gravity: 0.8, friction: 0.6, reach: 1.8 } },
    ] };
  } else return null;
  return { nodes, spec, made: nodes.filter(n => !before.has(n.id)).map(n => n.id) };
}
