/**
 * generateDepth.ts — the Texture card's **Generate depth** (docs/texture-node.md), and where
 * nodes made from a card go. Pure: ids come from the caller, the store pushes the undo step.
 *
 * - **2D:** a Depth node with this texture wired into its Texture.
 * - **3D** (a March Loop on the top level): that Depth node, plus a Depth Composite with the
 *   picture's Color, the Depth node's Depth and the loop's Color, Distance and Hit. When the
 *   Output showed the loop's Color, it shows the composite now.
 * - **Video:** the Depth node starts on Update: Baked (a video's depth is baked first; the
 *   card then offers Bake depth). Webcam: Live, every 4th frame (nothing to bake).
 */
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { graphOutput, instantiateNode } from '../../nodes/scene3dDefaults';
import { MARCH_GROUP_TYPES } from '../../nodes/smart3d';
import { isTextureNode, textureKindOf } from './textureSource';

export interface Rect { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number };

/** A card's size as placement assumes it (most cards are 360 wide). */
export const CARD_W = 360, CARD_H = 220, GAP = 40;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const boxOf = (n: GraphNode): Rect => ({ x: n.position.x, y: n.position.y, w: CARD_W, h: CARD_H });

/** The Texture card's own height (its picture, source and settings): taller than most cards. */
export const TEXTURE_CARD_H = 400;

/**
 * Where `count` new cards made from `card` go: a column beside it (right, else left, else
 * below), the first spot that is inside the part of the graph on screen and on no other card.
 * Stepped down past cards in the way. Without a view, to the right.
 */
export function placeBesideCard(card: GraphNode, count: number, nodes: readonly GraphNode[], view: Rect | null): Pt[] {
  const cardBox: Rect = { x: card.position.x, y: card.position.y, w: CARD_W, h: TEXTURE_CARD_H };
  const others = nodes.filter(n => n.id !== card.id).map(boxOf);
  const columnAt = (x: number, y0: number): Rect[] => {
    const taken = [...others, cardBox];
    const out: Rect[] = [];
    let y = y0;
    for (let i = 0; i < count; i++) {
      const b: Rect = { x, y, w: CARD_W, h: CARD_H };
      for (let guard = 0, moved = true; moved && guard < 200; guard++) {
        moved = false;
        for (const t of taken) if (overlaps(b, t)) { b.y = t.y + t.h + 20; moved = true; }
      }
      taken.push(b);
      out.push(b);
      y = b.y + CARD_H + 20;
    }
    return out;
  };
  const inView = (bs: Rect[]) => !view || bs.every(b => b.x >= view.x && b.x + b.w <= view.x + view.w && b.y >= view.y && b.y + b.h <= view.y + view.h);
  const right = columnAt(cardBox.x + CARD_W + GAP, cardBox.y);
  const tries = [right, columnAt(cardBox.x - CARD_W - GAP, cardBox.y), columnAt(cardBox.x, cardBox.y + TEXTURE_CARD_H + GAP)];
  const pick = tries.find(inView) ?? (view
    // Nothing fits whole: the right-hand column moved into the view as far as it goes (it may sit lower, off the cards).
    ? columnAt(Math.max(view.x + 10, Math.min(cardBox.x + CARD_W + GAP, view.x + view.w - CARD_W - 10)), Math.max(view.y + 10, cardBox.y))
    : right);
  return pick.map(b => ({ x: Math.round(b.x), y: Math.round(b.y) }));
}

const wire = (n: GraphNode, key: string, from: string, outputKey: string): GraphNode =>
  n.inputs[key] ? { ...n, inputs: { ...n.inputs, [key]: { ...n.inputs[key], connection: { nodeId: from, outputKey } } } } : n;

export interface DepthPlan {
  nodes: GraphNode[];
  depthId: string;
  compositeId: string | null;
  /** A video: its depth must be baked before it shows. */
  bake: boolean;
  message: string;
}

export function planGenerateDepth(nodes: GraphNode[], sourceId: string, nextId: () => string, view: Rect | null): DepthPlan | null {
  const src = nodes.find(n => n.id === sourceId);
  const depthDef = getNodeDefinition('depth');
  if (!src || !isTextureNode(src) || !depthDef) return null;
  const kind = textureKindOf(src);
  const loop = nodes.find(n => MARCH_GROUP_TYPES.has(n.type)) ?? null;
  const compDef = loop ? getNodeDefinition('depthComposite') : undefined;
  const spots = placeBesideCard(src, compDef ? 2 : 1, nodes, view);
  const params: Record<string, unknown> = kind === 'video' ? { update: 'baked' } : kind === 'webcam' ? { update: 'every', every: 4 } : {};
  const depth = wire(instantiateNode(nextId(), 'depth', depthDef, spots[0], params), 'texture', src.id, 'texture');
  let out = [...nodes, depth];
  const said = [`a Depth node reads ${kind === 'image' ? 'the picture' : kind === 'video' ? 'the video' : 'the webcam'}`];
  let compositeId: string | null = null;
  if (loop && compDef) {
    let comp = instantiateNode(nextId(), 'depthComposite', compDef, spots[1]);
    comp = wire(comp, 'picture', src.id, 'color');
    comp = wire(comp, 'nearness', depth.id, 'depth');
    for (const [key, outKey] of [['scene', 'color'], ['dist', 'dist'], ['hit', 'hit']] as const) {
      if (loop.outputs[outKey]) comp = wire(comp, key, loop.id, outKey);
    }
    compositeId = comp.id;
    out.push(comp);
    said.push('a Depth Composite puts the 3D scene in front of or behind it');
    const output = graphOutput(out);
    const fed = output?.inputs.color?.connection;
    if (output && fed && fed.nodeId === loop.id && fed.outputKey === 'color') {
      out = out.map(n => (n.id === output.id ? wire(n, 'color', comp.id, 'color') : n));
      said.push('the Output shows the two together');
    }
  }
  if (kind === 'video') said.push('a video’s depth is baked first: press Bake depth');
  return { nodes: out, depthId: depth.id, compositeId, bake: kind === 'video', message: `${said.join('; ')}.` };
}
