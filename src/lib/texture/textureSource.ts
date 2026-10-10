/**
 * textureSource.ts — the Texture node's sources (docs/texture-node.md), as pure functions.
 *
 * One card, two engine types: a picture is a `textureInput` (sampler `u_tex_<slug>`), a video
 * or the webcam is a `videoInput` (sampler `u_vid_<slug>`, `params.source: 'webcam'` for the
 * camera). Both have the same sockets (uv in; color, alpha, uv, texture out), so switching
 * the source swaps the type in place: same id, same position, every wire kept. Saved graphs
 * need no migration: an old Texture Input is the Texture node showing a picture, an old Video
 * Input the same node showing a video.
 */
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';

export type TextureKind = 'image' | 'video' | 'webcam';
export const TEXTURE_TYPES = new Set(['textureInput', 'videoInput']);

export const isTextureNode = (n: Pick<GraphNode, 'type'> | null | undefined): boolean => !!n && TEXTURE_TYPES.has(n.type);

export function textureKindOf(n: Pick<GraphNode, 'type' | 'params'>): TextureKind {
  if (n.type === 'textureInput') return 'image';
  return n.params?.source === 'webcam' ? 'webcam' : 'video';
}

export const KIND_LABEL: Record<TextureKind, string> = { image: 'Image', video: 'Video', webcam: 'Webcam' };

/** Params that belong to one source only: dropped when the source changes, so nothing stale plays. */
const IMAGE_KEYS = ['libraryId', '_imageSrc', '_imageName', '_imageUrl', '_imageAspect', 'fit', 'tile', 'wrap', 'filter'];
const VIDEO_KEYS = ['videoId', '_fileName', '_hasFile', '_isPlaying', '_loop', '_speed', '_videoUrl'];

/**
 * The node with its source switched: the type that source needs, its own params (what the
 * other source kept is put aside under `_other`, so switching back finds it again), and the
 * definition's sockets merged over the node's (wires kept: the keys are the same).
 */
export function switchTextureKind(node: GraphNode, kind: TextureKind): GraphNode {
  if (!isTextureNode(node) || textureKindOf(node) === kind) return node;
  const type = kind === 'image' ? 'textureInput' : 'videoInput';
  const def = getNodeDefinition(type);
  if (!def) return node;
  const p = { ...node.params };
  const stash = (p._other && typeof p._other === 'object' ? { ...(p._other as Record<string, unknown>) } : {}) as Record<string, unknown>;
  delete p._other;
  const from = textureKindOf(node);
  // Put the leaving source's own params aside; bring back what the arriving one had.
  const leaving = from === 'image' ? IMAGE_KEYS : VIDEO_KEYS;
  const arriving = kind === 'image' ? IMAGE_KEYS : VIDEO_KEYS;
  const kept: Record<string, unknown> = {};
  if (from !== 'webcam') {
    for (const k of [...leaving, '_thumbnailUrl', 'clip']) if (k in p) { kept[k] = p[k]; delete p[k]; }
  } else {
    // The webcam's mirror is a clip flip: not carried to a file.
    delete p.clip;
  }
  const back: Record<string, unknown> = {};
  const restoring = kind !== 'webcam' && stash[kind] && typeof stash[kind] === 'object' ? stash[kind] as Record<string, unknown> : null;
  if (restoring) for (const k of [...arriving, '_thumbnailUrl', 'clip']) if (k in restoring) back[k] = restoring[k];
  if (from !== 'webcam') stash[from] = kept;
  delete p.source;
  if (kind === 'webcam') { p.source = 'webcam'; p.clip = { flipX: p.mirror !== false }; }
  const params: Record<string, unknown> = { ...(def.defaultParams ?? {}), ...p, ...back, ...(Object.keys(stash).length ? { _other: stash } : {}) };
  // A file's playback flags are the video's own: a webcam has none.
  if (kind === 'webcam') { delete params._hasFile; delete params._isPlaying; delete params._fileName; }
  const outputs = { ...def.outputs };
  const inputs = Object.fromEntries(Object.entries(def.inputs).map(([k, s]) => [k, { ...s, ...(node.inputs[k]?.connection ? { connection: node.inputs[k].connection } : {}) }]));
  return { ...node, type, params, inputs, outputs };
}

/** Swap one node's source in a node list (pure). */
export function switchTextureKindIn(nodes: GraphNode[], nodeId: string, kind: TextureKind): GraphNode[] {
  return nodes.map(n => (n.id === nodeId ? switchTextureKind(n, kind) : n));
}

/** Webcam Texture nodes in a graph (the camera stays on while there is one). */
export const webcamNodes = (nodes: readonly GraphNode[]): GraphNode[] => nodes.filter(n => n.type === 'videoInput' && n.params.source === 'webcam');

/** What a picture's card says it is: its name, else the URL's last part, else "picture". */
export function imageNameOf(p: Record<string, unknown>): string {
  if (typeof p._imageName === 'string' && p._imageName) return p._imageName;
  if (typeof p._imageUrl === 'string' && p._imageUrl) {
    try { return decodeURIComponent(new URL(p._imageUrl).pathname.split('/').pop() || '') || 'picture'; } catch { return 'picture'; }
  }
  return '';
}
