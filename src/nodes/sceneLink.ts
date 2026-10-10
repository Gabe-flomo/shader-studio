/**
 * sceneLink.ts — a light linked to an object in a Scene Group (docs/depth-node.md "Link to a scene object").
 *
 * A value inside a Scene Group can't leave it by wire: the group compiles to a distance function. A link adds an
 * output to the Scene Group's card for the object, and the compiler fills it in main() (compileSceneGroupNode):
 *
 *   at_<inner id>   vec3  where the object is: the sum of the Translate 3D offsets on its position chain, from
 *                         Scene Pos up to (and including) a picked Translate, or up to a picked shape. Each offset
 *                         is what the Translate itself reads: its slider (a live uniform, so dragging and Play
 *                         move the light too), a keyframe curve, a wire into the group's face (a pinned setting
 *                         or a port: a main() value), or a chain wired inside the group that doesn't depend on
 *                         the point being measured (Time → Sin → Y), copied into main().
 *   col_<inner id>  vec3  the object's colour when it has one: a Scene Builder shape's colour swatch (its
 *                         Materials), else the scene's glow tint (a Glow to Color after the March Loop that
 *                         draws this scene). A live uniform as well.
 *
 * The Depth Light card wires those into Light position / Light colour; any vec3 input can take them.
 * Not followed: rotations, repeats and other warps on the chain (their offsets are read as if they weren't
 * there), objects inside a nested group in the Scene Group, and a Scene Group inside a March Loop's body.
 *
 * Pure (no store): the card runs these through the store's setNodes with one undo step.
 */
import type { GraphNode, SubgraphData } from '../types/nodeGraph';
import { getNodeDefinition } from './definitions';
import { sceneRole } from './scene3dShapes';

export const LINK_AT = 'at_';
export const LINK_COL = 'col_';
/** The Scene Builder's role key on the nodes it writes (sceneBuilder/build.ts ROLE_KEY). */
const SB_ROLE = '_sbRole';

export interface LinkTarget {
  /** The inner node's id (in the Scene Group's subgraph). */
  id: string;
  kind: 'translate' | 'shape';
  label: string;
}

/** A placeholder the compiler swaps for a node param's live uniform (or its value) once every node is compiled. */
export const linkUniformToken = (nodeId: string, key: string) => `__LINKV3__${nodeId}__${key}__`;
export const LINK_TOKEN_RE = /__LINKV3__([A-Za-z0-9_-]+?)__([A-Za-z0-9]+)__/g;

const subOf = (n: GraphNode): SubgraphData | null => {
  const sg = n.params.subgraph as SubgraphData | undefined;
  return sg && Array.isArray(sg.nodes) ? sg : null;
};

const posInputOf = (n: GraphNode): string | null => (n.inputs.pos?.type === 'vec3' ? 'pos' : n.inputs.p?.type === 'vec3' ? 'p' : null);

/** A readable name: the node's own label, the Scene Builder's name for the shape (‘Sphere 1’), or the type's label. */
function nameOf(n: GraphNode): string {
  const own = typeof n.params.label === 'string' && n.params.label.trim();
  if (own) return own;
  const def = getNodeDefinition(n.type)?.label ?? n.type;
  const quoted = typeof n.params.__comment === 'string' ? /‘([^’]+)’/.exec(n.params.__comment)?.[1] : undefined;
  return quoted ? `${quoted} (${def})` : def;
}

/** The objects a light can follow in a Scene Group: its Translate 3D nodes and its shapes. */
export function linkTargets(scene: GraphNode): LinkTarget[] {
  const sg = subOf(scene);
  if (!sg) return [];
  const out: LinkTarget[] = [];
  for (const n of sg.nodes) {
    if (n.type === 'translate3D') {
      // An unnamed Translate is named after the shape it moves ("Translate 3D (Sphere SDF 3D)").
      const own = nameOf(n);
      const moved = own === 'Translate 3D' ? sg.nodes.find(x => { const k = posInputOf(x); return !!k && x.inputs[k]?.connection?.nodeId === n.id; }) : undefined;
      out.push({ id: n.id, kind: 'translate', label: moved ? `${own} (${nameOf(moved)})` : own });
      continue;
    }
    const def = getNodeDefinition(n.type);
    if (def && sceneRole(def)?.kind === 'shape') out.push({ id: n.id, kind: 'shape', label: nameOf(n) });
  }
  return out;
}

/**
 * The Translate 3D nodes that place `targetId`: up its position chain from the target (itself first when it is a
 * Translate) to Scene Pos. Other warps are passed through. Ids in the subgraph.
 */
export function translateChain(nodes: readonly GraphNode[], targetId: string): string[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out: string[] = [];
  const seen = new Set<string>();
  let cur = byId.get(targetId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.type === 'translate3D') out.push(cur.id);
    const key = posInputOf(cur);
    const from = key ? cur.inputs[key]?.connection?.nodeId : undefined;
    cur = from ? byId.get(from) : undefined;
  }
  return out;
}

/** Where the target sits for fixed offsets (tests and the picker's preview): the sum of its Translates' X/Y/Z. */
export function staticCentre(scene: GraphNode, targetId: string): [number, number, number] {
  const sg = subOf(scene);
  if (!sg) return [0, 0, 0];
  const c: [number, number, number] = [0, 0, 0];
  for (const id of translateChain(sg.nodes, targetId)) {
    const t = sg.nodes.find(n => n.id === id)!;
    const ov = (k: string) => scene.params[`${id}::${k}`];
    ['tx', 'ty', 'tz'].forEach((k, i) => { const v = ov(k) ?? t.params[k]; c[i] += typeof v === 'number' ? v : 0; });
  }
  return c;
}

function walk(nodes: readonly GraphNode[], fn: (n: GraphNode) => void): void {
  for (const n of nodes) { fn(n); const sg = subOf(n); if (sg) walk(sg.nodes, fn); }
}

/** The March Loops (top level) that draw `sceneId`. */
const loopsDrawing = (nodes: readonly GraphNode[], sceneId: string) =>
  nodes.filter(n => (n.type === 'marchLoopGroup' || n.type === 'giLitMarchGroup') && n.inputs.scene?.connection?.nodeId === sceneId);

/**
 * The colour a linked light takes from an object: a Scene Builder shape's colour swatch, else the glow tint of a
 * Glow to Color reading a March Loop that draws this scene. Null when the object has neither.
 */
export function linkColourSource(nodes: readonly GraphNode[], scene: GraphNode, targetId: string): { nodeId: string; key: string; value: number[] } | null {
  const sg = subOf(scene);
  const target = sg?.nodes.find(n => n.id === targetId);
  const role = target && typeof target.params[SB_ROLE] === 'string' ? String(target.params[SB_ROLE]) : '';
  const shape = role.split(':')[0];
  if (shape) {
    let hit: GraphNode | null = null;
    walk(nodes, n => { if (!hit && n.type === 'colorPicker' && n.params[SB_ROLE] === `${shape}:color`) hit = n; });
    const h = hit as GraphNode | null;
    if (h && Array.isArray(h.params.color)) return { nodeId: h.id, key: 'color', value: h.params.color as number[] };
  }
  const loops = new Set(loopsDrawing(nodes, scene.id).map(l => l.id));
  if (loops.size) {
    const glow = nodes.find(n => n.type === 'glowToColor' && n.inputs.glow?.connection && loops.has(n.inputs.glow.connection.nodeId) && !n.inputs.tint?.connection);
    if (glow && Array.isArray(glow.params.tint)) return { nodeId: glow.id, key: 'tint', value: glow.params.tint as number[] };
  }
  return null;
}

/** The Scene Groups a light can link into: those the graph draws (a March Loop's Scene, or wired into the light) first. */
export function linkableScenes(nodes: readonly GraphNode[], light?: GraphNode): GraphNode[] {
  const scenes = nodes.filter(n => n.type === 'sceneGroup' && subOf(n));
  const wiredToLight = new Set(light ? ['glow', 'occluders'].map(k => light.inputs[k]?.connection?.nodeId).filter(Boolean) as string[] : []);
  const drawn = (s: GraphNode) => wiredToLight.has(s.id) || loopsDrawing(nodes, s.id).length > 0;
  return [...scenes.filter(drawn), ...scenes.filter(s => !drawn(s))];
}

const outKey = (prefix: string, innerId: string) => `${prefix}${innerId}`;

/** The Scene Group with the link outputs for one object (its place, and its colour when it has one). */
export function withLinkOutputs(scene: GraphNode, target: LinkTarget, colour: boolean): GraphNode {
  const outputs = { ...scene.outputs, [outKey(LINK_AT, target.id)]: { type: 'vec3' as const, label: `${target.label}: position` } };
  if (colour) outputs[outKey(LINK_COL, target.id)] = { type: 'vec3' as const, label: `${target.label}: colour` };
  return { ...scene, outputs };
}

export interface LightLink { scene: string; object: string; label: string }
export const lightLinkOf = (n: GraphNode): LightLink | null => {
  const l = n.params.link as LightLink | undefined;
  return l && typeof l === 'object' && typeof l.scene === 'string' && typeof l.object === 'string' ? l : null;
};

const connect = (n: GraphNode, key: string, nodeId: string, outputKey: string): GraphNode =>
  n.inputs[key] ? { ...n, inputs: { ...n.inputs, [key]: { ...n.inputs[key], connection: { nodeId, outputKey } } } } : n;

/**
 * Link light `lightId` to object `objectId` of Scene Group `sceneId`: the group gains the object's outputs and the
 * light's Light position (and Light colour, when the object has one) are wired from them. Null when something is
 * missing.
 */
export function linkLight(nodes: GraphNode[], lightId: string, sceneId: string, objectId: string): GraphNode[] | null {
  const scene = nodes.find(n => n.id === sceneId);
  const light = nodes.find(n => n.id === lightId);
  const target = scene ? linkTargets(scene).find(t => t.id === objectId) : undefined;
  if (!scene || !light || !target) return null;
  const colour = linkColourSource(nodes, scene, objectId);
  const linkedScene = withLinkOutputs(scene, target, !!colour);
  let linked = connect(light, 'lightPos', sceneId, outKey(LINK_AT, objectId));
  if (colour) linked = connect(linked, 'lightColor', sceneId, outKey(LINK_COL, objectId));
  linked = { ...linked, params: { ...linked.params, link: { scene: sceneId, object: objectId, label: target.label } satisfies LightLink } };
  return nodes.map(n => (n.id === sceneId ? linkedScene : n.id === lightId ? linked : n));
}

/** Undo a link: the light's position and colour wires from the Scene Group go (its sliders apply again); outputs nothing else reads go too. */
export function unlinkLight(nodes: GraphNode[], lightId: string): GraphNode[] {
  const light = nodes.find(n => n.id === lightId);
  const link = light && lightLinkOf(light);
  if (!light || !link) return nodes;
  const fromScene = (k: string) => light.inputs[k]?.connection?.nodeId === link.scene;
  const inputs = Object.fromEntries(Object.entries(light.inputs).map(([k, i]) => [k, (k === 'lightPos' || k === 'lightColor') && fromScene(k) ? { ...i, connection: undefined } : i]));
  const params = { ...light.params };
  delete params.link;
  let next = nodes.map(n => (n.id === lightId ? { ...n, inputs, params } : n));
  next = pruneLinkOutputs(next, link.scene);
  return next;
}

/** A Scene Group's link outputs that nothing reads any more, taken off its card. */
export function pruneLinkOutputs(nodes: GraphNode[], sceneId: string): GraphNode[] {
  const read = new Set<string>();
  for (const n of nodes) for (const i of Object.values(n.inputs)) if (i.connection?.nodeId === sceneId) read.add(i.connection.outputKey);
  return nodes.map(n => {
    if (n.id !== sceneId) return n;
    const outputs = Object.fromEntries(Object.entries(n.outputs).filter(([k]) => !(k.startsWith(LINK_AT) || k.startsWith(LINK_COL)) || read.has(k)));
    return { ...n, outputs };
  });
}

/**
 * "Add a light": a second Depth Light after `lightId`, linked to `objectId`. It takes the first light's picture
 * (chained: its Color), depth, rays, mask, scenes and calibration, and whatever read the first light's Color now
 * reads the new one. Returns the new nodes and the new light's id, or null.
 */
export function addLinkedLight(nodes: GraphNode[], lightId: string, sceneId: string, objectId: string, newId: string): { nodes: GraphNode[]; id: string } | null {
  const light = nodes.find(n => n.id === lightId);
  if (!light) return null;
  const copyKeys = ['nearness', 'distance', 'ro', 'rd', 'mask', 'glow', 'occluders'];
  const inputs: GraphNode['inputs'] = {};
  for (const [k, i] of Object.entries(light.inputs)) {
    inputs[k] = { ...i, connection: copyKeys.includes(k) ? i.connection : undefined };
  }
  inputs.picture = { ...light.inputs.picture, connection: { nodeId: lightId, outputKey: 'color' } };
  const params = { ...light.params };
  delete params.link;
  delete params.__comment;
  // The glowing scene lights the picture once: the chained light adds only its own point light.
  if (light.inputs.glow?.connection) inputs.glow = { ...inputs.glow, connection: undefined };
  const fresh: GraphNode = { ...light, id: newId, inputs, outputs: { ...light.outputs }, params, position: { x: light.position.x + 420, y: light.position.y } };
  // Readers of the first light's Color now read the new light's
  let next = nodes.map(n => {
    let changed = false;
    const ins = Object.fromEntries(Object.entries(n.inputs).map(([k, i]) => {
      if (i.connection?.nodeId === lightId && i.connection.outputKey === 'color') { changed = true; return [k, { ...i, connection: { nodeId: newId, outputKey: 'color' } }]; }
      return [k, i];
    }));
    return changed ? { ...n, inputs: ins } : n;
  });
  next = [...next, fresh];
  const linked = linkLight(next, newId, sceneId, objectId);
  return linked ? { nodes: linked, id: newId } : null;
}

/** Objects in a scene that no light in `nodes` is linked to yet (the next "Add a light" picks the first). */
export function unlinkedTargets(nodes: readonly GraphNode[], scene: GraphNode): LinkTarget[] {
  const used = new Set(nodes.map(lightLinkOf).filter((l): l is LightLink => !!l && l.scene === scene.id).map(l => l.object));
  return linkTargets(scene).filter(t => !used.has(t.id));
}
