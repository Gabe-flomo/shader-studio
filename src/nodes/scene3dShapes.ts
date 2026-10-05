/**
 * scene3dShapes.ts — how a 3D node is wired into a Scene Group so it shows.
 *
 * Every scene-space node (3D primitives, 3D transforms, 3D boolean ops) plays one
 * of three roles, read from its sockets:
 *
 *   - shape:    position in, distance out (Sphere, Box, Gyroid's Surface…).
 *               Wired Scene Pos → shape → Scene Output.
 *   - warp:     position in, position out (Repeat, Twist, Fold…). On its own it
 *               draws nothing, so a new scene gets a small partner shape after
 *               it (a sphere or a box, with a note) to show what it does; added
 *               to a scene that already has shapes, it bends the whole scene
 *               (it goes between Scene Pos and everything that read it).
 *   - modifier: a distance in and out (Displace 3D, Scale 3D). A new scene gets
 *               a partner shape before it; an existing scene feeds its current
 *               distance through it.
 *
 * A shape added to a scene that already returns a distance is joined to it by
 * a Union (with a note), and moved aside by a Translate 3D (with a note) so it
 * doesn't hide inside what's there. Inside a Scene Group (the user is building
 * by hand) a shape is wired from Scene Pos and into the Union / Scene Output,
 * without the Translate, and warps / modifiers are left for the user to wire.
 *
 * One code path for every way a 3D node arrives: the node browser, quick-add,
 * wire-drop and duplicate all reach the store's addNode / duplicate, which use
 * these. Pure: ids come from the caller.
 */

import type { GraphNode, NodeDefinition, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';
import { instantiateNode } from './scene3dDefaults';

import { SCENE_SPACE_CATEGORIES } from './smart3d';

export type SceneRole =
  | { kind: 'shape'; posInput: string; distOutput: string }
  | { kind: 'warp'; posInput: string; posOutput: string; distInput: string | null; distOutput: string | null }
  | { kind: 'modifier'; posInput: string | null; distInput: string; distOutput: string };

const DIST_OUTPUTS = ['dist', 'distance', 'surface'];
const POS_OUTPUTS = ['pos', 'p', 'cellPos'];

/** What a scene-space node does in a scene, from its sockets. Null for anything else. */
export function sceneRole(def: NodeDefinition): SceneRole | null {
  if (!SCENE_SPACE_CATEGORIES.has(def.category)) return null;
  const posInput = def.inputs.pos?.type === 'vec3' ? 'pos' : def.inputs.p?.type === 'vec3' ? 'p' : null;
  const distInput = def.inputs.dist?.type === 'float' ? 'dist' : null;
  const distOutput = DIST_OUTPUTS.find(k => def.outputs[k]?.type === 'float') ?? null;
  const posOutput = POS_OUTPUTS.find(k => def.outputs[k]?.type === 'vec3')
    ?? Object.keys(def.outputs).find(k => def.outputs[k].type === 'vec3') ?? null;
  if (posInput && posOutput) return { kind: 'warp', posInput, posOutput, distInput, distOutput: distInput ? distOutput : null };
  if (distInput && distOutput) return { kind: 'modifier', posInput, distInput, distOutput };
  if (posInput && distOutput) return { kind: 'shape', posInput, distOutput };
  return null;
}

/**
 * The partner shape a warp or modifier gets in a new scene: small enough to
 * show the effect from the default camera, shifted off the centre where the
 * warp mirrors or spins space round it (a sphere at the centre would look the same).
 */
const PARTNER: Record<string, { type: 'sphereSDF3D' | 'boxSDF3D'; params: Record<string, unknown>; shift?: [number, number, number] }> = {
  repeat3D:        { type: 'sphereSDF3D', params: { radius: 0.35 } },
  mirroredRepeat3D:{ type: 'sphereSDF3D', params: { radius: 0.35 } },
  limitedRepeat3D: { type: 'sphereSDF3D', params: { radius: 0.3 } },
  voxelize:        { type: 'sphereSDF3D', params: { radius: 0.2 } },
  polarRepeat3D:   { type: 'sphereSDF3D', params: { radius: 0.2 }, shift: [0.8, 0, 0] },
  kaleidoscope3D:  { type: 'sphereSDF3D', params: { radius: 0.25 }, shift: [0.6, 0.3, 0.2] },
  fold3D:          { type: 'sphereSDF3D', params: { radius: 0.3 }, shift: [0.5, 0.3, 0.2] },
  mirrorFold3D:    { type: 'sphereSDF3D', params: { radius: 0.3 }, shift: [0.5, 0.3, 0.2] },
  sphereInvert3D:  { type: 'sphereSDF3D', params: { radius: 0.5 }, shift: [1.6, 0, 0] },
  turbulence3D:    { type: 'sphereSDF3D', params: { radius: 0.8 } },
  twist3D:         { type: 'boxSDF3D', params: { sizeX: 0.3, sizeY: 0.8, sizeZ: 0.3 } },
  bend3D:          { type: 'boxSDF3D', params: { sizeX: 0.9, sizeY: 0.15, sizeZ: 0.3 } },
  shear3D:         { type: 'boxSDF3D', params: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4 } },
  helixWarp3D:     { type: 'boxSDF3D', params: { sizeX: 0.25, sizeY: 0.8, sizeZ: 0.25 } },
  rotate3D:        { type: 'boxSDF3D', params: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4 } },
  rotateAxis3D:    { type: 'boxSDF3D', params: { sizeX: 0.4, sizeY: 0.4, sizeZ: 0.4 } },
};
const DEFAULT_PARTNER = { type: 'sphereSDF3D' as const, params: { radius: 0.5 } };

type Ref = { nodeId: string; outputKey: string };
const wire = (node: GraphNode, key: string, from: Ref | null): void => {
  if (from && node.inputs[key]) node.inputs[key] = { ...node.inputs[key], connection: { ...from } };
};
const make = (nextId: () => string, type: string, at: { x: number; y: number }, params?: Record<string, unknown>): GraphNode =>
  instantiateNode(nextId(), type, getNodeDefinition(type)!, at, params);

const note = (text: string) => ({ __comment: text });

/**
 * The nodes for one scene-space node in an empty scene, from `pos` (Scene Pos)
 * to the distance it returns. A warp or modifier gets its partner shape.
 */
export function buildShapeChain(
  nextId: () => string, node: GraphNode, role: SceneRole, pos: Ref, at: { x: number; y: number },
): { nodes: GraphNode[]; dist: Ref | null } {
  node.position = { ...at };
  const label = getNodeDefinition(node.type)?.label ?? node.type;
  if (role.kind === 'shape') {
    wire(node, role.posInput, pos);
    if (role.distOutput !== 'surface') return { nodes: [node], dist: { nodeId: node.id, outputKey: role.distOutput } };
    // A surface that fills all of space (Gyroid, Schwarz-P): cut a ball out of it, or the camera
    // sits inside it, and pack a few cells into the ball so its pattern shows.
    node.params = { ...node.params, frequency: 3.5, thickness: 0.3 };
    const ball = make(nextId, 'sphereSDF3D', { x: at.x, y: at.y + 300 }, {
      radius: 1.1,
      __comment: `The ball ${label} is cut to. ${label} goes on forever in every direction, so the camera would be inside it; this keeps a ball of it to look at. Make it bigger, or delete it and the Intersect to fill the scene.`,
    });
    wire(ball, 'pos', pos);
    const cut = make(nextId, 'sdfIntersect', { x: at.x + 440, y: at.y + 150 }, {
      __comment: `Keeps only the part of ${label} inside the ball: the scene is where both are. ${label}'s Frequency was set to 3.5 so a few of its cells fit in the ball; if you see holes or speckles, lower the march loop's Step Scale.`,
    });
    wire(cut, 'a', { nodeId: node.id, outputKey: role.distOutput });
    wire(cut, 'b', { nodeId: ball.id, outputKey: 'dist' });
    return { nodes: [node, ball, cut], dist: { nodeId: cut.id, outputKey: 'dist' } };
  }
  const partnerSpec = PARTNER[node.type] ?? DEFAULT_PARTNER;
  const shapeName = partnerSpec.type === 'boxSDF3D' ? 'box' : 'sphere';
  const partner = make(nextId, partnerSpec.type, { x: at.x + 440, y: at.y }, {
    ...partnerSpec.params,
    ...note(role.kind === 'warp'
      ? `A small ${shapeName} for ${label} to work on. ${label} changes space, not shapes, so on its own it draws nothing; this ${shapeName} shows what it does. Swap it for any shape, or wire more shapes from ${label}'s output.`
      : `A ${shapeName} for ${label} to change. ${label} reshapes a distance it is given; this ${shapeName} gives it one to show what it does. Swap it for any shape.`),
  });
  const out: GraphNode[] = [node];
  if (role.kind === 'warp') {
    wire(node, role.posInput, pos);
    let shapePos: Ref = { nodeId: node.id, outputKey: role.posOutput };
    if (partnerSpec.shift) {
      const [tx, ty, tz] = partnerSpec.shift;
      const shift = make(nextId, 'translate3D', { x: at.x + 440, y: at.y }, {
        tx, ty, tz,
        ...note(`Moves the ${shapeName} off the centre, where ${label} copies or mirrors it, so you can see the copies. Set it to 0 to put the ${shapeName} back on the centre.`),
      });
      wire(shift, 'pos', shapePos);
      shapePos = { nodeId: shift.id, outputKey: 'pos' };
      partner.position = { x: at.x + 880, y: at.y };
      out.push(shift);
    }
    wire(partner, 'pos', shapePos);
    out.push(partner);
    if (role.distInput && role.distOutput) {
      const back = secondHalf(nextId, node, role, { x: partner.position.x + 440, y: at.y });
      wire(back.node, role.distInput, { nodeId: partner.id, outputKey: 'dist' });
      return { nodes: [...out, ...back.extra, back.node], dist: { nodeId: back.node.id, outputKey: role.distOutput } };
    }
    return { nodes: out, dist: { nodeId: partner.id, outputKey: 'dist' } };
  }
  // Modifier: the partner shape first, then the modifier.
  partner.position = { ...at };
  node.position = { x: at.x + 440, y: at.y };
  wire(partner, 'pos', pos);
  if (role.posInput) wire(node, role.posInput, pos);
  wire(node, role.distInput, { nodeId: partner.id, outputKey: 'dist' });
  return { nodes: [partner, ...out], dist: { nodeId: node.id, outputKey: role.distOutput } };
}

/**
 * Scale 3D both changes the position (before the shapes) and corrects their
 * distance (after them). One node can't be on both sides of a shape (that's a
 * loop the compiler refuses), so the second job goes to a copy, and a Constant
 * feeds both their Scale so they can't drift apart.
 */
function secondHalf(nextId: () => string, node: GraphNode, role: Extract<SceneRole, { kind: 'warp' }>, at: { x: number; y: number }): { node: GraphNode; extra: GraphNode[] } {
  const label = getNodeDefinition(node.type)?.label ?? node.type;
  const back = make(nextId, node.type, at, {
    ...node.params,
    __comment: `${label} again, for the distance. The first ${label} changes the size of space before the shapes measure it; this one corrects the distance they return by the same amount, so the march stays accurate. Both read their Scale from the Constant.`,
  });
  const extra: GraphNode[] = [];
  if (node.inputs.scale && back.inputs.scale) {
    const k = make(nextId, 'constant', { x: node.position.x, y: node.position.y - 260 }, {
      value: typeof node.params.scale === 'number' ? node.params.scale : 2,
      __comment: `The Scale for both ${label} nodes: above 1 shrinks the shapes, below 1 grows them. Change it here so the two stay the same.`,
    });
    wire(node, 'scale', { nodeId: k.id, outputKey: 'value' });
    wire(back, 'scale', { nodeId: k.id, outputKey: 'value' });
    extra.push(k);
  }
  void role;
  return { node: back, extra };
}

/**
 * Camera and loop settings a new scene needs for a node that is far bigger than
 * the default view.
 */
export function rigSettingsFor(type: string): { camera?: Record<string, unknown>; loop?: Record<string, unknown> } {
  // Their distance is only an estimate (it runs ahead of the true one), so the loop steps shorter.
  if (type === 'gyroidField' || type === 'schwarzPField') return { loop: { stepScale: 0.4, maxSteps: 160 } };
  return {};
}

/** Scene Pos → the node's chain → Scene Output: the inside of a new Scene Group. */
export function buildSceneSubgraphFor(nextId: () => string, node: GraphNode, role: SceneRole): SubgraphData {
  const scenePos = make(nextId, 'scenePos', { x: 0, y: 200 }, { _groupOriginal: true });
  const chain = buildShapeChain(nextId, node, role, { nodeId: scenePos.id, outputKey: 'pos' }, { x: 440, y: 200 });
  const right = Math.max(...chain.nodes.map(n => n.position.x)) + 440;
  const sceneOut = make(nextId, 'sceneOutput', { x: right, y: 200 }, { _groupOriginal: true });
  wire(sceneOut, 'dist', chain.dist);
  return { nodes: [scenePos, ...chain.nodes, sceneOut], inputPorts: [], outputPorts: [] };
}

/** How many shapes a scene already holds (so the next one can be moved aside by a different amount). */
function shapeCount(nodes: GraphNode[]): number {
  return nodes.filter(n => n.params._autoShift === true).length;
}

/**
 * Add a scene-space node to a Scene Group's inside, wired so it shows.
 * `byHand` is the inside-the-group case: a shape is wired in without being
 * moved aside, and a warp or modifier is left for the user to wire.
 * Null when the scene has no Scene Pos / Scene Output to wire to.
 */
export function addToScene(
  nextId: () => string, sub: SubgraphData, node: GraphNode, role: SceneRole,
  opts: { byHand: boolean; at?: { x: number; y: number } },
): { subgraph: SubgraphData; summary: string; spread?: number } | null {
  const nodes = sub.nodes.map(n => ({ ...n, inputs: { ...n.inputs } }));
  const scenePos = nodes.find(n => n.type === 'scenePos');
  const sceneOut = nodes.find(n => n.type === 'sceneOutput');
  if (!scenePos || !sceneOut) return null;
  const label = getNodeDefinition(node.type)?.label ?? node.type;
  const pos: Ref = { nodeId: scenePos.id, outputKey: 'pos' };
  const current = sceneOut.inputs.dist?.connection ?? null;
  const below = nodes.length ? Math.max(...nodes.map(n => n.position.y)) + 320 : 200;
  const at = opts.at ?? { x: scenePos.position.x + 440, y: below };
  const done = (added: GraphNode[], summary: string, spread?: number) => ({ subgraph: { ...sub, nodes: [...nodes, ...added] }, summary, spread });

  // An empty scene: the whole chain, straight into Scene Output.
  if (!current) {
    if (opts.byHand && role.kind !== 'shape') { node.position = at; return done([node], `${label} was added; wire it between Scene Pos and a shape.`); }
    const chain = buildShapeChain(nextId, node, role, pos, at);
    wire(sceneOut, 'dist', chain.dist);
    return done(chain.nodes, `${label} is wired into the scene's output.`);
  }

  if (role.kind === 'shape') {
    let from: Ref = pos;
    const added: GraphNode[] = [];
    if (!opts.byHand) {
      // Beside what's there: right, left, further right, further left…
      const k = shapeCount(nodes) + 1;
      const tx = Math.round(1.3 * Math.ceil(k / 2) * (k % 2 ? 1 : -1) * 100) / 100;
      const shift = make(nextId, 'translate3D', at, {
        tx, ty: 0, tz: 0, _autoShift: true,
        ...note(`Moves ${label} ${Math.abs(tx)} to the ${tx > 0 ? 'right' : 'left'} so it sits beside the shapes already in the scene instead of inside them. Change X, Y and Z to place it, or delete this to put it back on the centre.`),
      });
      wire(shift, 'pos', pos);
      from = { nodeId: shift.id, outputKey: 'pos' };
      added.push(shift);
    }
    const chain = buildShapeChain(nextId, node, role, from, { x: at.x + (opts.byHand ? 0 : 440), y: at.y });
    added.push(...chain.nodes);
    const right = Math.max(...chain.nodes.map(n => n.position.x));
    const union = make(nextId, 'sdfUnion', { x: right + 440, y: at.y }, {
      ...note(`Joins ${label} to the rest of the scene: the scene is wherever either one is (the nearer surface wins). Raise Blend radius to melt them together, or swap this for Subtract / Intersect to cut ${label} out or keep only the overlap.`),
    });
    wire(union, 'a', current);
    wire(union, 'b', chain.dist);
    wire(sceneOut, 'dist', { nodeId: union.id, outputKey: 'dist' });
    const spread = added.find(n => n.params._autoShift === true)?.params.tx as number | undefined;
    return done([...added, union], `${label} is joined to the scene with a Union${opts.byHand ? '' : ' and moved beside what was there'}.`, spread === undefined ? undefined : Math.abs(spread));
  }

  if (opts.byHand) { node.position = at; return done([node], `${label} was added; wire it between Scene Pos and a shape.`); }

  // A warp or modifier on a scene with shapes in it: it applies to the whole scene.
  node.position = { x: scenePos.position.x, y: below };
  if (role.kind === 'warp') {
    const warped: Ref = { nodeId: node.id, outputKey: role.posOutput };
    for (const n of nodes) {
      for (const [k, inp] of Object.entries(n.inputs)) {
        if (inp.connection?.nodeId === scenePos.id && inp.connection.outputKey === 'pos') n.inputs[k] = { ...inp, connection: { ...warped } };
      }
    }
    wire(node, role.posInput, pos);
    if (role.distInput && role.distOutput) {
      const back = secondHalf(nextId, node, role, { x: sceneOut.position.x, y: below });
      wire(back.node, role.distInput, current);
      wire(sceneOut, 'dist', { nodeId: back.node.id, outputKey: role.distOutput });
      return done([node, ...back.extra, back.node], `${label} now scales the whole scene.`);
    }
    return done([node], `${label} now bends the whole scene: everything that read Scene Pos reads ${label} instead.`);
  }
  if (role.posInput) wire(node, role.posInput, pos);
  wire(node, role.distInput, current);
  wire(sceneOut, 'dist', { nodeId: node.id, outputKey: role.distOutput });
  return done([node], `${label} now reshapes the whole scene's distance.`);
}

/**
 * The cameras to move back so shapes set `spread` units from the centre stay in
 * view: those looking at the loops that draw `sceneId`, still at their default
 * distance (one the user set is left alone). Returns the new distance for each.
 */
export function camerasToWiden(topLevel: GraphNode[], sceneId: string, spread: number): Array<{ id: string; camDist: number }> {
  const def = getNodeDefinition('marchCamera');
  const dflt = (def?.defaultParams?.camDist as number | undefined) ?? 3;
  const want = Math.round((2.4 + 1.6 * spread) * 10) / 10;
  const out: Array<{ id: string; camDist: number }> = [];
  for (const loop of topLevel) {
    if (loop.inputs.scene?.connection?.nodeId !== sceneId) continue;
    const camId = loop.inputs.ro?.connection?.nodeId;
    const cam = topLevel.find(n => n.id === camId && n.type === 'marchCamera');
    if (!cam || cam.inputs.camDist?.connection) continue;
    const cur = typeof cam.params.camDist === 'number' ? cam.params.camDist : dflt;
    const ours = cam.params._autoCamDist === cur;
    if ((cur === dflt || ours) && want > cur && !out.some(o => o.id === cam.id)) out.push({ id: cam.id, camDist: want });
  }
  return out;
}

/**
 * The Scene Group a new shape on the top level should go into: the one nearest
 * `position` among those something reads (a march loop, Glass Scene…). Null when
 * there is none, and a new scene is made instead.
 */
export function targetScene(topLevel: GraphNode[], position: { x: number; y: number }): GraphNode | null {
  const read = new Set<string>();
  for (const n of topLevel) for (const inp of Object.values(n.inputs)) if (inp.connection) read.add(inp.connection.nodeId);
  let best: GraphNode | null = null; let bestD = Infinity;
  for (const n of topLevel) {
    if (n.type !== 'sceneGroup' || !read.has(n.id)) continue;
    const d = (n.position.x - position.x) ** 2 + (n.position.y - position.y) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}
