/**
 * textures.ts — pictures in the scene builders (docs/scene-builder.md, "Textures"), the pure part
 * every builder shares.
 *
 * A builder's spec keeps a list of **texture sources**: each a name (what its recipe and lists call
 * it), the Texture or Shader Texture node in the graph it reads (its `texture` output), and the
 * picture's shape. One real node per source: picking the same picture twice reads the same node.
 * What a builder does with a source (a fill, a layer, a mask, a surface colour, cells…) is its own;
 * this file has the parts they all use:
 *
 *   - the source list: naming, finding, reading one off a node in the graph;
 *   - stand-ins: a Texture node per source for a stand-alone graph (the builders' previews and
 *     tests compile without the user's graph);
 *   - `ensureSources`: on Build, a source that has no node yet (typed in a recipe, from a
 *     template) gets an empty Texture node, named after it, ready for a picture;
 *   - small GLSL helpers: picture coordinates for Sample (texture), the fits, brightness.
 *
 * Pure: no React, no store.
 */
import type { GraphNode } from '../types/nodeGraph';
import { getNodeDefinition } from '../nodes/definitions';

export type TexKind = 'image' | 'shader';

/** A picture a builder reads. */
export interface TexSource {
  /** Its name in the spec and the recipe: a slug, unique in the spec ("brick", "pond-2"). */
  name: string;
  /** The node in the graph (a Texture, a Shader Texture, anything with a `texture` output). Absent: made on Build. */
  node?: string;
  /** The picture's width ÷ height (fits and planar maps keep it). 1 when not known. */
  aspect?: number;
  /** A picture (Texture node) or a Shader Texture. */
  kind?: TexKind;
}

/** How a picture covers the box it is drawn in. */
export const TEX_FITS = ['cover', 'contain', 'stretch', 'tile'] as const;
export type TexFit = typeof TEX_FITS[number];
export const FIT_LABELS: Record<TexFit, { label: string; blurb: string }> = {
  cover: { label: 'Fill', blurb: 'Covers the shape, keeping the picture\'s shape (the edges may be cropped).' },
  contain: { label: 'Fit', blurb: 'The whole picture inside the shape, keeping its shape (the shape\'s own colour shows round it).' },
  stretch: { label: 'Stretch', blurb: 'Stretched to the shape\'s box exactly.' },
  tile: { label: 'Tile', blurb: 'Repeated across the shape, Tiles times up its height.' },
};

/** A picture used somewhere (a fill, a layer, a background). */
export interface TexUse {
  /** The source's name. */
  tex: string;
  fit: TexFit;
  /** Tile: how many times it repeats up the height. Others: a zoom (above 1 closer). */
  scale: number;
}

export const newTexUse = (tex: string, over: Partial<TexUse> = {}): TexUse => ({ tex, fit: 'cover', scale: 1, ...over });

export const readFit = (v: unknown): TexFit => ((TEX_FITS as readonly string[]).includes(v as string) ? v as TexFit : 'cover');

/** A name as recipes write it: lower case, letters, digits and dashes. */
export function texSlug(raw: string): string {
  const s = raw.toLowerCase().replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return /^[a-z]/.test(s) ? s : `pic${s ? `-${s}` : ''}`;
}

/** A name not yet in `list` ("pond", "pond-2"…). */
export function freeTexName(list: readonly TexSource[] | undefined, raw: string): string {
  const base = texSlug(raw || 'picture');
  const taken = new Set((list ?? []).map(s => s.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export const findTex = (list: readonly TexSource[] | undefined, name: string | null | undefined): TexSource | undefined =>
  name ? list?.find(s => s.name === name) : undefined;

/** Node types that are a picture source in their own right (their `texture` output is the picture). */
const SOURCE_TYPES = /^(textureInput|videoInput|shaderTexture|baked|timeCube)$/;

/** Does a node hand out a texture a builder can read? */
export function hasTextureOutput(n: GraphNode): boolean {
  return Object.values(n.outputs ?? {}).some(o => o.type === 'texture') && !!n.outputs.texture;
}

/** What a node is called in the picker. */
export function texNodeLabel(n: GraphNode): string {
  const p = n.params;
  const name = typeof p._imageName === 'string' && p._imageName.trim() ? p._imageName.trim() : typeof p._fileName === 'string' && p._fileName.trim() ? p._fileName.trim() : '';
  const label = typeof p.label === 'string' && p.label.trim() ? p.label.trim() : '';
  return label || name || getNodeDefinition(n.type)?.label || n.type;
}

/** The nodes at the top of the graph a builder can read a picture from: sources first. */
export function textureNodes(nodes: readonly GraphNode[]): GraphNode[] {
  const out = nodes.filter(n => hasTextureOutput(n) && !n.params.whereAdapter);
  const rank = (n: GraphNode) => (n.type === 'textureInput' ? 0 : n.type === 'shaderTexture' ? 1 : SOURCE_TYPES.test(n.type) ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** A source for a node of the graph: its name from the node, its aspect and kind. */
export function sourceFromNode(n: GraphNode, list: readonly TexSource[] | undefined): TexSource {
  const already = list?.find(s => s.node === n.id);
  if (already) return { ...already };
  const aspect = typeof n.params._imageAspect === 'number' && n.params._imageAspect > 0 ? n.params._imageAspect : 1;
  return { name: freeTexName(list, texNodeLabel(n)), node: n.id, aspect: Math.round(aspect * 10000) / 10000, kind: n.type === 'shaderTexture' ? 'shader' : 'image' };
}

/** `list` with `src` in it (replacing the one of the same name). */
export function withSource(list: readonly TexSource[] | undefined, src: TexSource): TexSource[] {
  const out = (list ?? []).filter(s => s.name !== src.name);
  out.push({ ...src });
  return out;
}

/** The output a build wires from: the source node's Texture. Null when it has no node yet. */
export function texOut(src: TexSource | undefined): { nodeId: string; outputKey: string } | null {
  return src?.node ? { nodeId: src.node, outputKey: 'texture' } : null;
}

/** The id a stand-in (or a made) Texture node takes for a source with no node. */
export const standInId = (src: TexSource) => src.node ?? `tex_${src.name.replace(/[^A-Za-z0-9]/g, '_')}`;

/** A Texture node for a source: the stand-in a stand-alone graph reads, or the empty node Build makes. */
export function textureNodeFor(src: TexSource, id = standInId(src), at = { x: 0, y: 0 }, note?: string): GraphNode {
  const def = getNodeDefinition('textureInput')!;
  return {
    id, type: 'textureInput', position: { ...at },
    inputs: { uv: { type: def.inputs.uv.type, label: def.inputs.uv.label } },
    outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, o]) => [k, { type: o.type, label: o.label }])),
    params: {
      ...(def.defaultParams ?? {}), _imageAspect: src.aspect ?? 1, label: src.name,
      __comment: note ?? `The picture “${src.name}”, read by a scene builder. Drop a picture on this card (or pick one from the library, or paste a link); the scene reads its Texture output.`,
    },
  };
}

/** Stand-ins for every source (with a node id or not), for a stand-alone graph. */
export function standIns(list: readonly TexSource[] | undefined): GraphNode[] {
  return (list ?? []).map(s => textureNodeFor(s));
}

/**
 * Before a build goes into the graph: every source gets a node. One without a node, or whose node
 * is gone, gets a new empty Texture node named after it, placed left of `at`. Returns the new nodes
 * and the sources pointing at them.
 */
export function ensureSources(graph: readonly GraphNode[], list: readonly TexSource[] | undefined, nextId: () => string, at: { x: number; y: number }): { added: GraphNode[]; sources: TexSource[] } {
  // A node id from another project (a pasted recipe's `node=`) can name some other node here: only a node with a
  // Texture output counts.
  const ids = new Set(graph.filter(n => hasTextureOutput(n) || getNodeDefinition(n.type)?.outputs?.texture?.type === 'texture').map(n => n.id));
  const added: GraphNode[] = [];
  const sources = (list ?? []).map(s => {
    if (s.node && ids.has(s.node)) return s;
    const id = nextId();
    added.push(textureNodeFor(s, id, { x: at.x - 480, y: at.y + added.length * 260 }));
    return { ...s, node: id, kind: 'image' as const };
  });
  return { added, sources };
}

/** The sources a spec's uses name but its list lacks (a recipe used a name it never declared). */
export function missingSources(list: readonly TexSource[] | undefined, used: Iterable<string>): string[] {
  const have = new Set((list ?? []).map(s => s.name));
  return [...new Set(used)].filter(n => n && !have.has(n));
}

// ── GLSL ────────────────────────────────────────────────────────────────────

/** A GLSL float literal. */
export const glf = (n: number): string => {
  const v = Math.round((Number.isFinite(n) ? n : 0) * 1e6) / 1e6;
  const s = String(v);
  return /[.e]/.test(s) ? s : `${s}.0`;
};

/**
 * Picture coordinates (what Sample (texture) reads: the picture's centred UV) for `st`, a 0–1
 * place on the texture. Sample maps them back with the screen's aspect, so this undoes that.
 */
export const picUv = (st: string) => `((${st}) * 2.0 - 1.0) * vec2(u_resolution.x / u_resolution.y, 1.0)`;

/** The Sample (texture) setting a use needs: a tiled picture repeats seamlessly (mipmaps from the unwrapped place). */
export const sampleWrap = (fit: TexFit | 'repeat' | 'once'): Record<string, unknown> => (fit === 'tile' || fit === 'repeat' ? { wrap: 'repeat' } : {});

/** Brightness of a colour (Rec. 601 weights, as the Texture tools' Mask). */
export const LUMA = (c: string) => `dot(${c}, vec3(0.299, 0.587, 0.114))`;

/**
 * The lines that turn `q` (a point in a box of half-size `ext`, centred) into a 0–1 place on the
 * picture for a fit, as Expression Block lines; `st` and `inside` come out. `a` is the picture's
 * aspect, `k` the use's scale (both names of the block's inputs or literals).
 */
export function fitLines(fit: TexFit, q: string, ext: string, a: string, k: string): Array<{ lhs: string; op: string; rhs: string }> {
  const L = (lhs: string, rhs: string) => ({ lhs, op: '=', rhs });
  if (fit === 'tile') {
    return [
      L('vec2 u', `${q} / ${ext}.y * ${k} * 0.5`),
      // Not wrapped here: Sample (texture) with Edges: Repeat wraps it seamlessly (see sampleWrap).
      L('vec2 st', `vec2(u.x / ${a}, u.y) + 0.5`),
      L('float inside', '1.0'),
    ];
  }
  const lines = [L('vec2 u', `${q} / ${ext} / max(${k}, 0.001)`), L('float b', `${ext}.x / ${ext}.y`)];
  if (fit === 'cover') lines.push(L('u', `${a} > b ? vec2(u.x * b / ${a}, u.y) : vec2(u.x, u.y * ${a} / b)`));
  if (fit === 'contain') lines.push(L('u', `${a} > b ? vec2(u.x, u.y * ${a} / b) : vec2(u.x * b / ${a}, u.y)`));
  lines.push(
    L('vec2 st', 'u * 0.5 + 0.5'),
    L('float inside', 'step(0.0, st.x) * step(st.x, 1.0) * step(0.0, st.y) * step(st.y, 1.0)'),
  );
  return lines;
}
