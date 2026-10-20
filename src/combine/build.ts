/**
 * build.ts — a Combine spec as the glue a skilled user would wire by hand between the products (docs/combine.md,
 * docs/combine-plan.md §2). Every glue node is an ordinary node with a note saying what it does and why, and a role
 * (`<layerId>:<part>`), so a rebuild finds it again and keeps its id (wires and Play controls stay on it).
 *
 * Phase 1:
 *
 *  - Place in, picture on a picture: Mix (Normal) or Blend Modes (Screen, Add, Multiply, Overlay), by Amount.
 *  - Place in, picture in a 3D scene:
 *      card: the picture on a Picture Card in a small Scene Group of its own, marched through the scene's March
 *        Camera; where its ray is nearer than the scene's (Compare on the two Distances), Select shows the card;
 *      surroundings: Picture Environment along the camera's rays, where the scene's rays miss (its Hit);
 *      by depth: the picture's Depth node and Depth Composite: the scene's objects go behind and in front of what is
 *        in the picture (the "Add a picture with depth" chain).
 *  - Place in, a 3D scene on a picture: over it by its Hit (Select), or by depth (Depth Composite on the picture).
 *  - Place in, splats in a 3D scene: the Splat Scene seen through the scene's camera and hidden by its surfaces
 *    (its Ray Origin / Ray Dir / Distance / Hit wired from the scene), laid over it by its Alpha.
 *  - Place in, points on a picture or in a 3D scene: Draw agents laid over by their Density (a 3D group sees through
 *    the scene's camera and hides behind its surfaces).
 *  - Replace mask with: a mask layer (a Segment it makes on the picture, or a Segment / Blob Track of the graph) and a
 *    fill layer on it. The fill sticks to every blob (Blob Track → Blob Space, the fill drawn at each blob's Local UV:
 *    a picture chain through Blob Space's Fill field, a texture through Fill texture, a 3D scene through its camera's
 *    UV) or fills the whole mask; Select lays it over the picture under the mask.
 *
 * A few pairs set a wire on a product's own node (a 3D group's camera, a Splat Scene's rays, a 3D fill's camera UV):
 * those are returned as `patches`, which apply.ts sets and puts back. Pure: ids come from `idFor`.
 */
import type { GraphNode, InputSocket, OutputSocket, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';
import { startingSockets } from '../nodes/definitions/transformAny';
import { blobFitOf } from '../nodes/definitions/blobSpace';
import { CB_ROLE } from './meta';
import { resolveProduct, type Resolved } from './products';
import {
  MASK_DEFAULTS, PLACE_DEFAULTS, REPLACE_DEFAULTS, num, settingsOf, str, targetOf,
  type Blend, type CombineLayer, type CombineSpec, type NodeRef, type PlaceHow3d, type PlaceHowPic, type ProductKind, type Stick,
} from './spec';

/** A wire the build sets on a product's own node (null: unwire it). */
export interface Patch { nodeId: string; input: string; from: NodeRef | null; note: string }

/** What a layer is, built: its picture and, for 3D and masks, what the layers above it wire from. */
export interface LayerOut {
  id: string;
  kind: ProductKind;
  label: string;
  colour: NodeRef | null;
  texture: NodeRef | null;
  cam?: string;
  loop?: { id: string; dist: boolean; hit: boolean };
  sceneGroup?: string;
  /** A mask layer: its mask, texture, Blob data (when it has some), and the picture it masks. */
  mask?: { mask: NodeRef; texture: NodeRef | null; blobs: NodeRef | null; under: LayerOut; maxBlobs?: number };
}

export interface LayerBuilt {
  out: LayerOut | null;
  /** The glue nodes this layer made (ids). */
  glue: string[];
  /** Passes this layer adds (its Pass nodes). */
  passes: number;
  /** Why it isn't built (a missing product, a pair it can't join). */
  problem?: string;
}

export interface CombineBuild {
  glue: GraphNode[];
  patches: Patch[];
  /** The stack's picture: what the Output shows. */
  result: NodeRef | null;
  layers: Record<string, LayerBuilt>;
  warnings: string[];
}

const ref = (n: GraphNode, outputKey: string): NodeRef => ({ nodeId: n.id, outputKey });

interface Ctx {
  graph: readonly GraphNode[];
  idFor: (role: string) => string;
  glue: GraphNode[];
  patches: Patch[];
  warnings: string[];
  /** The layer being built: its glue ids. */
  mine: string[];
}

/** A glue node of `type`: sockets from its definition, params = defaults + `params`, its role and note. */
function mk(ctx: Ctx, layer: string, part: string, type: string, params: Record<string, unknown>, wires: Record<string, NodeRef | null | undefined>, note: string): GraphNode {
  const def = getNodeDefinition(type);
  if (!def) throw new Error(`Combine: unknown node type ${type}`);
  const sockets = startingSockets(type, def, { ...(def.defaultParams ?? {}), ...params });
  const inputs: Record<string, InputSocket> = {};
  for (const [k, s] of Object.entries({ ...def.inputs, ...sockets.inputs })) {
    const w = wires[k];
    if (!(k in sockets.inputs) && !w) continue;
    inputs[k] = { type: s.type, label: s.label, ...(w ? { connection: { ...w } } : {}) };
  }
  const outputs: Record<string, OutputSocket> = {};
  for (const [k, s] of Object.entries(sockets.outputs)) outputs[k] = { type: s.type, label: s.label };
  const role = `${layer}:${part}`;
  const node: GraphNode = { id: ctx.idFor(role), type, position: { x: 0, y: 0 }, inputs, outputs, params: { ...(def.defaultParams ?? {}), ...params, __comment: note, [CB_ROLE]: role } };
  ctx.glue.push(node);
  ctx.mine.push(node.id);
  return node;
}

/** A math node (Mix, Select) set to vec3, its sockets retyped as the card's type picker leaves them. */
function mkVec3(ctx: Ctx, layer: string, part: string, type: 'mix' | 'select', wires: Record<string, NodeRef | null | undefined>, note: string, params: Record<string, unknown> = {}): GraphNode {
  const node = mk(ctx, layer, part, type, { outputType: 'vec3', ...params }, wires, note);
  for (const k of Object.keys(node.inputs)) if (!(type === 'mix' && k === 't') && !(type === 'select' && k === 'mask')) node.inputs[k] = { ...node.inputs[k], type: 'vec3' };
  for (const k of Object.keys(node.outputs)) node.outputs[k] = { ...node.outputs[k], type: 'vec3' };
  return node;
}

/** A Simple Expression with named inputs (their types follow the wires when the graph compiles). */
function simple(ctx: Ctx, layer: string, part: string, label: string, expr: string, outputType: 'float' | 'vec3', ins: Array<[string, NodeRef]>, note: string): GraphNode {
  const vars = ins.map(([name], i) => ({ key: `in${i + 1}`, name }));
  const node = mk(ctx, layer, part, 'simpleExpr', { label, vars, expr, outputType }, {}, note);
  node.inputs = Object.fromEntries(ins.map(([name, from], i) => [`in${i + 1}`, { type: 'float', label: name, connection: { ...from } }]));
  node.outputs = { result: { type: outputType, label: 'Result' } };
  return node;
}

/** The picture as a texture: its own when it has one, else a Pass (one pass) that renders it into one. */
function textureFor(ctx: Ctx, layer: string, out: { texture: NodeRef | null; colour: NodeRef | null; label: string }, why: string): NodeRef | null {
  if (out.texture) return out.texture;
  if (!out.colour) return null;
  const pass = mk(ctx, layer, 'pass', 'pass', {}, { color: out.colour },
    `Pass: ${out.label} drawn into a texture (one pass), because ${why} reads a picture as a texture, not a colour worked out per pixel.`);
  return ref(pass, 'texture');
}

const asOut = (layerId: string, r: Resolved): LayerOut => ({
  id: layerId, kind: r.kind, label: r.label, colour: r.colour, texture: r.texture, cam: r.cam, loop: r.loop, sceneGroup: r.sceneGroup,
  ...(r.mask ? { mask: { ...r.mask, under: { id: '', kind: 'picture', label: '', colour: null, texture: null } } } : {}),
});

const isPic = (k: ProductKind) => k === 'picture' || k === 'pictureDepth';

// ── Place in ─────────────────────────────────────────────────────────────────

function placeIn(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut): LayerOut | string {
  const S = settingsOf(layer, PLACE_DEFAULTS);
  const L = layer.id;
  if (!a.colour) return `${a.label} has no picture to place.`;
  if (!b.colour) return 'The layer below has no picture.';
  // A picture on a picture.
  if (isPic(a.kind) && isPic(b.kind)) {
    const blend = str<Blend>(S.blend, ['normal', 'screen', 'add', 'multiply', 'overlay'], 'normal');
    const amount = num(S.amount, 1);
    const top = blend === 'normal'
      ? mkVec3(ctx, L, 'blend', 'mix', { a: b.colour, b: a.colour }, `Mix: ${a.label} over ${b.label}, by Amount (Blend ${amount}: 0 only the picture below, 1 only ${a.label}).`, { t: amount })
      : mk(ctx, L, 'blend', 'blendModes', { mode: blend === 'add' ? 'additive' : blend, opacity: amount }, { base: b.colour, blend: a.colour },
        `Blend Modes (${blend}): ${a.label} blended onto ${b.label}; Opacity is the Amount.`);
    return { ...b, id: L, colour: ref(top, 'result'), texture: null };
  }
  // A picture in a 3D scene.
  if (isPic(a.kind) && b.kind === 'scene3d') {
    if (!b.cam || !b.loop) return 'The 3D scene has no camera and March Loop to place it with.';
    const how = str<PlaceHow3d>(S.how3d, ['card', 'surroundings', 'depth'], 'card');
    const tex = textureFor(ctx, L, a, how === 'depth' ? 'the Depth node' : how === 'card' ? 'the Picture Card' : 'Picture Environment');
    if (!tex) return `${a.label} has no picture.`;
    if (how === 'surroundings') {
      const env = mk(ctx, L, 'env', 'pictureEnvironment', { fov: 1.5 }, { picture: tex, dir: { nodeId: b.cam, outputKey: 'rd' }, forward: { nodeId: b.cam, outputKey: 'forward' }, right: { nodeId: b.cam, outputKey: 'right' }, up: { nodeId: b.cam, outputKey: 'up' } },
        `Picture Environment: ${a.label} as the world round the scene. Each pixel reads the picture the way the scene's camera ray points (March Camera's Ray Dir and axes), so it turns with the camera; past the frame's edge the picture is mirrored.`);
      if (!b.loop.hit) {
        const sc = mk(ctx, L, 'surround', 'blendModes', { mode: 'screen', opacity: 1 }, { base: ref(env, 'color'), blend: b.colour }, `Blend Modes (Screen): the scene's light over ${a.label} (this scene's march has no Hit to cut it out by).`);
        return { ...b, id: L, colour: ref(sc, 'result') };
      }
      const sel = mkVec3(ctx, L, 'surround', 'select', { mask: { nodeId: b.loop.id, outputKey: 'hit' }, ifTrue: b.colour, ifFalse: ref(env, 'color') },
        `Select: the scene where its rays hit something (the March Loop's Hit), ${a.label} where they miss: the picture is what you see round the objects.`);
      return { ...b, id: L, colour: ref(sel, 'result') };
    }
    if (how === 'depth') {
      if (!b.loop.dist) return 'This 3D scene\'s march gives no Distance to compare the picture\'s depth with.';
      const depth = depthNode(ctx, layer, tex, a.label);
      const comp = mk(ctx, L, 'composite', 'depthComposite', { nearD: num(S.near, 1.5), farD: num(S.far, 8), softness: num(S.soft, 0.08) },
        { picture: a.colour, nearness: ref(depth, 'depth'), scene: b.colour, dist: { nodeId: b.loop.id, outputKey: 'dist' }, hit: b.loop.hit ? { nodeId: b.loop.id, outputKey: 'hit' } : null },
        `Depth Composite: ${a.label} and the scene put together by distance: at each pixel the nearer one shows, so the scene's objects go behind and in front of what is in the picture. Nearest and Farthest say where the picture's near and far things sit, in scene units (Show: Picture distance helps set them).`);
      return { ...b, id: L, colour: ref(comp, 'color') };
    }
    // A card: its own little scene, marched through the same camera, shown where it is nearer.
    const card = cardParams(S);
    const inner: GraphNode[] = [];
    const sub: Ctx = { ...ctx, glue: inner, mine: [] };
    const sp = mk(sub, L, 'card:pos', 'scenePos', { _groupOriginal: true }, {}, 'Scene Pos: the point being measured.');
    const shape = mk(sub, L, 'card:shape', 'pictureCard', card, { pos: ref(sp, 'pos') },
      `Picture Card: ${a.label} as a thin card, its shape from the picture. Only its Distance is used in here, so the march never reads the picture; the colour is read once, after the loop. Its picture comes in through the group's Picture port.`);
    mk(sub, L, 'card:out', 'sceneOutput', { _groupOriginal: true }, { dist: ref(shape, 'dist') }, 'Scene Output: the card\'s distance.');
    tidy(inner);
    const group = mk(ctx, L, 'card:scene', 'sceneGroup', {
      label: 'Card', subgraph: { nodes: inner, inputPorts: [{ key: 'picture', type: 'texture', label: 'Picture', toNodeId: shape.id, toInputKey: 'picture' }], outputPorts: [] } satisfies SubgraphData,
    }, {}, `Scene Group "Card": the card on its own, as a distance. It is marched apart from the scene (the scene stays as its builder made it), and the two are put together by which is nearer.`);
    group.inputs = { ...group.inputs, picture: { type: 'texture', label: 'Picture', connection: { ...tex } } };
    const loop = mk(ctx, L, 'card:march', 'marchLoopGroup', { maxSteps: 64, maxDist: 30, jitter: 0, bg: [0, 0, 0], subgraph: loopBody(ctx, L) },
      { ro: { nodeId: b.cam, outputKey: 'ro' }, rd: { nodeId: b.cam, outputKey: 'rd' }, scene: ref(group, 'scene') },
      'March Loop: walks each pixel\'s ray from the scene\'s own camera (its March Camera\'s Ray Origin and Ray Dir) to the card. Distance says how far the card is; Hit where it was found. 64 steps: a card is a box, quick to find.');
    const at = mk(ctx, L, 'card:hit', 'pictureCard', card, { pos: ref(loop, 'pos'), picture: tex },
      `Picture Card at Hit Pos: the same card, same settings, measured where the ray stopped. Glow is ${a.label} there (Emissive 1: it shows as it is, a screen in the scene; Glow brightness sets how bright).`);
    let on: NodeRef = ref(loop, 'hit');
    if (b.loop.dist) {
      const nearer = mk(ctx, L, 'card:nearer', 'compare', { operator: '<' }, { a: ref(loop, 'dist'), b: { nodeId: b.loop.id, outputKey: 'dist' } },
        'Compare: 1 where the card is nearer than the scene\'s surface (the two March Loops\' Distances), so the scene\'s objects in front of the card hide it.');
      on = ref(mk(ctx, L, 'card:on', 'multiply', {}, { a: ref(loop, 'hit'), b: ref(nearer, 'mask') }, 'Multiply: where the card was hit AND is nearer: where it shows.'), 'result');
    }
    const show = mkVec3(ctx, L, 'card:show', 'select', { mask: on, ifTrue: ref(at, 'glow'), ifFalse: b.colour },
      `Select: the card's picture where it shows, the scene everywhere else.`);
    return { ...b, id: L, colour: ref(show, 'result') };
  }
  // Splats in a 3D scene.
  if (a.kind === 'scene3d' && b.kind === 'scene3d') {
    if (!a.splat) return 'Two 3D scenes join in the 3D builder: open one and add the other\'s shapes.';
    if (!b.cam || !b.loop) return 'The 3D scene has no camera and March Loop to place the splats with.';
    const at = (nodeId: string, outputKey: string): NodeRef => ({ nodeId, outputKey });
    ctx.patches.push(
      { nodeId: a.splat, input: 'ro', from: at(b.cam, 'ro'), note: 'the scene\'s camera' },
      { nodeId: a.splat, input: 'rd', from: at(b.cam, 'rd'), note: 'the scene\'s camera' },
      { nodeId: a.splat, input: 'scene', from: null, note: 'over black: Combine lays it over the scene' },
      { nodeId: a.splat, input: 'dist', from: b.loop.dist ? at(b.loop.id, 'dist') : null, note: 'hidden behind the scene\'s surfaces' },
      { nodeId: a.splat, input: 'hit', from: b.loop.hit ? at(b.loop.id, 'hit') : null, note: 'hidden behind the scene\'s surfaces' },
    );
    const over = simple(ctx, L, 'over', 'Splats over the scene', 's * (1.0 - a) + c', 'vec3',
      [['s', b.colour], ['c', { nodeId: a.splat, outputKey: 'color' }], ['a', { nodeId: a.splat, outputKey: 'alpha' }]],
      `Simple Expression: the splats laid over the scene. The Splat Scene now sees through the scene's March Camera and stops at its surfaces (its Ray Origin, Ray Dir, Distance and Hit are wired from the scene), so its Color is the splats over black and Alpha how much of them shows: scene × (1 − alpha) + splats.`);
    return { ...b, id: L, colour: ref(over, 'result') };
  }
  // A 3D scene on a picture.
  if (a.kind === 'scene3d' && isPic(b.kind)) {
    if (!a.loop) return `${a.label} has no March Loop.`;
    const how = str<PlaceHowPic>(S.howPic, ['over', 'depth'], 'over');
    if (how === 'depth') {
      if (!a.loop.dist) return 'This 3D scene\'s march gives no Distance to compare with the picture\'s depth.';
      const tex = textureFor(ctx, L, b, 'the Depth node');
      if (!tex) return 'The picture below has no texture for its depth.';
      const depth = depthNode(ctx, layer, tex, b.label);
      const comp = mk(ctx, L, 'composite', 'depthComposite', { nearD: num(S.near, 1.5), farD: num(S.far, 8), softness: num(S.soft, 0.08) },
        { picture: b.colour, nearness: ref(depth, 'depth'), scene: a.colour, dist: { nodeId: a.loop.id, outputKey: 'dist' }, hit: a.loop.hit ? { nodeId: a.loop.id, outputKey: 'hit' } : null },
        `Depth Composite: ${a.label} placed in ${b.label} by distance: where the picture is nearer (its Depth, calibrated by Nearest and Farthest in scene units) it hides the objects.`);
      return { ...b, id: L, colour: ref(comp, 'color') };
    }
    const hit: NodeRef | null = a.loop.hit ? { nodeId: a.loop.id, outputKey: 'hit' } : null;
    const amount = mk(ctx, L, 'amount', 'multiply', { b: num(S.amount, 1) }, { a: hit }, `Multiply: where the scene's rays hit something (Hit), times Amount: how much of the scene shows over ${b.label}.${hit ? '' : ' This scene\'s march has no Hit, so A is 0 until you wire one.'}`);
    if (!hit) amount.params.a = 1;
    const sel = mkVec3(ctx, L, 'over', 'select', { mask: ref(amount, 'result'), ifTrue: a.colour, ifFalse: b.colour },
      `Select: ${a.label} where it has something (its Hit), ${b.label} round it.`);
    return { ...b, id: L, colour: ref(sel, 'result') };
  }
  // Points on a picture or in a 3D scene.
  if (a.kind === 'points') {
    if (!a.draw) return `${a.label} has no Draw agents.`;
    const notes: string[] = [];
    if (b.kind === 'scene3d' && a.draw.d3 && b.cam) {
      ctx.patches.push(
        { nodeId: a.draw.id, input: 'camOrigin', from: { nodeId: b.cam, outputKey: 'ro' }, note: 'seen through the scene\'s camera' },
        { nodeId: a.draw.id, input: 'camRay', from: { nodeId: b.cam, outputKey: 'rd' }, note: 'seen through the scene\'s camera' },
        ...(b.loop?.dist ? [{ nodeId: a.draw.id, input: 'depth', from: { nodeId: b.loop.id, outputKey: 'dist' }, note: 'hidden behind the scene\'s surfaces' }] : []),
      );
      notes.push(' Its Draw agents sees through the scene\'s March Camera and hides walkers behind the scene\'s surfaces (Camera from, Camera ray and Depth are wired from the scene).');
    } else if (b.kind === 'scene3d') ctx.warnings.push(`${a.label} is a 2D Agents group: it is laid over the scene, not in it.`);
    const amount = mk(ctx, L, 'amount', 'multiply', { b: num(S.amount, 1) }, { a: { nodeId: a.draw.id, outputKey: 'density' } },
      `Multiply: Draw agents' Density (how much walker is here) times Amount: how strongly the walkers cover ${b.label}.`);
    const sel = mkVec3(ctx, L, 'over', 'select', { mask: ref(amount, 'result'), ifTrue: a.colour, ifFalse: b.colour },
      `Select: the walkers (Draw agents' Color) where they are, ${b.label} elsewhere.${notes.join('')}`);
    return { ...b, id: L, colour: ref(sel, 'result') };
  }
  return `${a.label} can't be placed in ${b.label}.`;
}

/** The Picture Card's settings from the layer's: where, how turned, how big; it shows its picture as it is. */
function cardParams(S: Record<string, unknown>): Record<string, unknown> {
  return {
    center: [num(S.x as number, 0), num(S.y as number, 0.1), num(S.z as number, -0.6)], rotation: [0, num(S.turn as number, 0), 0], size: num(S.size as number, 1.6),
    thickness: 0.02, cutout: 'alpha', threshold: 0.5, back: 'readable', emissive: 1, brightness: num(S.glow as number, 1),
  };
}

/** A March Loop's inside: the ray's point handed straight to the scene. */
function loopBody(ctx: Ctx, L: string): SubgraphData {
  const inner: GraphNode[] = [];
  const sub: Ctx = { ...ctx, glue: inner, mine: [] };
  const gi = mk(sub, L, 'card:march:in', 'marchLoopInputs', { _groupOriginal: true }, {}, 'Group Inputs: the ray at this step.');
  mk(sub, L, 'card:march:out', 'marchLoopOutput', { _groupOriginal: true }, { pos: ref(gi, 'marchPos') }, 'Group Output: the point handed to the scene, unchanged.');
  tidy(inner);
  return { nodes: inner, inputPorts: [], outputPorts: [] };
}

/** The picture's Depth node: baked when Generate depth ran on the layer, else live once its model is downloaded. */
function depthNode(ctx: Ctx, layer: CombineLayer, tex: NodeRef, label: string): GraphNode {
  const bake = layer.depthBake;
  return mk(ctx, layer.id, 'depth', 'depth', bake ? { update: 'baked', depthBake: structuredClone(bake) } : {}, { texture: tex },
    `Depth: how far each part of ${label} is, worked out on this device by a small model. `
      + (bake ? 'Generate depth ran it once in Combine and kept it as an image (Update: Baked).' : 'It runs once the model is downloaded (Combine\'s Generate depth, or the card, offers it); nothing downloads until you press it.'));
}

// ── Replace mask with ────────────────────────────────────────────────────────

/** A mask layer on a picture: the Segment it makes (or the graph's mask), and a preview that dims what isn't found. */
function maskLayer(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut): LayerOut | string {
  const L = layer.id;
  if (!b.colour) return 'The layer below has no picture to find things in.';
  let mask: NonNullable<LayerOut['mask']>;
  if (layer.product.kind === 'mask') {
    const S = settingsOf(layer, MASK_DEFAULTS);
    const tex = textureFor(ctx, L, b, 'Segment');
    if (!tex) return 'The picture below has no texture to find things in.';
    const find = layer.product.find;
    const classes = typeof layer.product.classes === 'string' && layer.product.classes ? layer.product.classes : String(S.classes || 'person');
    const seg = mk(ctx, L, 'find', 'segment', { mode: find, classes, threshold: num(S.threshold, 0.5), softness: num(S.softness, 0.1), grow: num(S.grow, 0), invert: S.invert === true },
      { texture: tex },
      `Segment (${find === 'people' ? 'People' : find === 'objects' ? `Objects: ${classes}` : 'Click'}): finds ${find === 'people' ? 'everyone' : find === 'objects' ? `the ${classes.split(',').join(', ')}` : 'what is under the point you pick'} in ${b.label}, on this device (the model ships with the app). Mask is 1 on it; Mask texture feeds Blob Track.`);
    mask = { mask: ref(seg, 'mask'), texture: ref(seg, 'texture'), blobs: null, under: b, maxBlobs: Math.round(num(S.maxBlobs, 4)) };
  } else {
    if (!a.mask) return `${a.label} is not a mask.`;
    mask = { ...a.mask, under: b, maxBlobs: Math.round(num(settingsOf(layer, MASK_DEFAULTS).maxBlobs, 4)) };
  }
  const dim = mkVec3(ctx, L, 'dim', 'mix', { b: b.colour }, `Mix: ${b.label} at 30%, for what the mask doesn't find (the preview of the mask until a fill goes on it).`, { t: 0.3 });
  const show = mkVec3(ctx, L, 'show', 'select', { mask: mask.mask, ifTrue: b.colour, ifFalse: ref(dim, 'result') },
    `Select: ${b.label} as it is where the mask finds something, dimmed elsewhere: what a fill on this layer will replace.`);
  return { id: L, kind: 'mask', label: a.label, colour: ref(show, 'result'), texture: null, mask };
}

/** A fill on a mask layer: on every blob (Blob Track → Blob Space) or the whole mask, over the picture under it. */
function fillLayer(ctx: Ctx, layer: CombineLayer, a: Resolved, b: LayerOut): LayerOut | string {
  const L = layer.id;
  const m = b.mask;
  if (!m) return 'A fill goes on a mask layer.';
  const pic = m.under;
  if (!pic.colour) return 'The picture under the mask is missing.';
  if (!a.colour) return `${a.label} has no picture to fill with.`;
  if (layer.fills?.mode === 'perBlob') ctx.warnings.push('Per-blob fills come in a later phase: every blob shows this fill for now.');
  const S = settingsOf(layer, REPLACE_DEFAULTS);
  const stick = str<Stick>(S.stick, ['blobs', 'frame'], 'blobs');
  let fill: NodeRef = a.colour;
  let where: NodeRef = m.mask;
  if (stick === 'blobs') {
    let blobs = m.blobs;
    if (!blobs) {
      if (!m.texture) return 'The mask has no texture for Blob Track to read.';
      const bt = mk(ctx, L, 'blobs', 'blobTrack', { maxBlobs: Math.max(1, Math.min(16, m.maxBlobs ?? 4)), channel: 'red', minSize: 0.004, maxSize: 0.95, smoothing: 0.5, boxStyle: 'none', marker: 'none' }, { texture: m.texture },
        'Blob Track: splits the mask into separate blobs (one per person or thing) and follows each, keeping its ID. It reads the red channel (the Segment confidence); Max size 0.95, so a person filling most of the frame still counts. Its Blob data (centre, size, ID of each, smoothed by Smoothing) tells Blob Space where they are.');
      blobs = ref(bt, 'texture');
    }
    const fitWords = { box: 'stretched to each box', square: 'keeping its shape', circle: 'cut round' }[blobFitOf(S.fit)];
    const wires: Record<string, NodeRef | null> = { blobs, mask: m.mask };
    let how: string;
    let threeD = false;
    if (a.kind === 'scene3d' && a.cam && !a.splat) {
      threeD = true;
      how = `the 3D scene renders inside each blob: its March Camera's UV is wired from Local UV (a full march per pixel the blobs cover)`;
    } else if (a.texture) {
      wires.fillTexture = a.texture;
      how = `${a.label} (a texture) is read in each blob at its 0–1 UV (Fill texture)`;
    } else {
      wires.fill = a.colour;
      how = `${a.label}'s chain is drawn again in each blob at its Local UV (Fill is a field socket: no pass)`;
    }
    const space = mk(ctx, L, 'space', 'blobSpace', { fit: blobFitOf(S.fit), padding: num(S.padding, 0.15), scale: num(S.scale, 1), spin: num(S.spin, 0) }, wires,
      `Blob Space: each pixel's place in the blob it is on, from Blob Track's data. The fill sticks to every blob, ${fitWords}, and follows it: ${how}. Alpha is Inside times the mask, so the fill takes the blob's shape.`);
    if (threeD) ctx.patches.push({ nodeId: a.cam!, input: 'uv', from: ref(space, 'localUv'), note: 'renders inside each blob' });
    fill = threeD ? a.colour : ref(space, 'color');
    where = ref(space, 'alpha');
  }
  const amount = mk(ctx, L, 'amount', 'multiply', { b: num(S.amount, 1) }, { a: where },
    stick === 'blobs' ? 'Multiply: where the fill shows (Blob Space\'s Alpha) times Amount.' : 'Multiply: the mask times Amount: how much of the fill replaces what was found.');
  const sel = mkVec3(ctx, L, 'replace', 'select', { mask: ref(amount, 'result'), ifTrue: fill, ifFalse: pic.colour },
    `Select: ${a.label} where the mask found something, ${pic.label} everywhere else.`);
  return { id: L, kind: 'picture', label: `${pic.label} (replaced)`, colour: ref(sel, 'result'), texture: null };
}

// ── The stack ────────────────────────────────────────────────────────────────

/** Lay `nodes` out in a row, left to right in the order made (a group's inside). */
function tidy(nodes: GraphNode[]): void {
  nodes.forEach((n, i) => { n.position = { x: i * 300, y: 120 }; });
}

export const defaultCombineId = (role: string) => `cb_${role.replace(/[^A-Za-z0-9]/g, '_')}`;

/** The glue for `spec` over the products in `graph` (no Output: `result` is what it shows). Pure. */
export function buildCombine(spec: CombineSpec, graph: readonly GraphNode[], idFor: (role: string) => string = defaultCombineId): CombineBuild {
  const ctx: Ctx = { graph, idFor, glue: [], patches: [], warnings: [], mine: [] };
  const layers: Record<string, LayerBuilt> = {};
  const outs = new Map<string, LayerOut>();
  let result: NodeRef | null = null;
  for (const layer of spec.layers) {
    ctx.mine = [];
    const before = ctx.glue.length, patchesBefore = ctx.patches.length;
    const a = resolveProduct(layer.product, graph);
    const target = targetOf(spec, layer);
    const b = target ? outs.get(target.id) ?? null : null;
    let out: LayerOut | string;
    if (layer.verb === 'base') out = a.missing ? a.missing : asOut(layer.id, a);
    else if (!target) out = 'Nothing below to go on.';
    else if (!b) out = 'The layer it goes on isn\'t built.';
    else if (layer.muted) out = { ...b, id: layer.id };
    else if (a.missing) out = a.missing;
    else if (layer.verb === 'placeIn') out = placeIn(ctx, layer, a, b);
    else if (layer.verb === 'replaceMask') out = a.kind === 'mask' ? (isPic(b.kind) ? maskLayer(ctx, layer, a, b) : 'A mask goes on a picture.') : fillLayer(ctx, layer, a, b);
    else out = 'This verb comes in a later phase.';
    if (typeof out === 'string') {
      // Nothing half-made: a layer that can't be built leaves no glue, and the layers above see the one below it.
      ctx.glue.splice(before);
      ctx.patches.splice(patchesBefore);
      layers[layer.id] = { out: b ? { ...b, id: layer.id } : null, glue: [], passes: 0, problem: out };
      if (b) outs.set(layer.id, { ...b, id: layer.id });
      if (layer.verb !== 'base') ctx.warnings.push(`${a.label}: ${out}`);
      continue;
    }
    outs.set(layer.id, out);
    const mine = ctx.glue.slice(before);
    layers[layer.id] = { out, glue: mine.map(n => n.id), passes: mine.filter(n => n.type === 'pass').length };
    result = out.colour;
  }
  // The top of the stack (a muted or failed top layer: the one below it).
  const top = spec.layers[spec.layers.length - 1];
  if (top) result = layers[top.id]?.out?.colour ?? result;
  return { glue: ctx.glue, patches: ctx.patches, result, layers, warnings: ctx.warnings };
}
