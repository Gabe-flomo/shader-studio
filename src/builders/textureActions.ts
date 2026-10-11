/**
 * textureActions.ts — the shared "texture source" picker's store side (docs/scene-builder.md,
 * "Textures"): every builder takes a picture the same way, and each way ends in a real node of the
 * graph whose Texture output the builder wires in.
 *
 *   - a file (upload or drop), a pasted picture or link, a picture from the image library: a new
 *     Texture node, the picture loaded into it (lib/texture/pictureHost.ts takePicture: kept in the
 *     library and embedded in the node, so the graph opens with it);
 *   - a Texture, Shader Texture or anything else with a texture output already in the graph: used
 *     as it is (one node per picture: picking it twice reads the same node);
 *   - a new Shader Texture (docs/texture-builder.md).
 *
 * A new node is one undo step ("Added a picture: pond"), placed in view beside the graph. The picture
 * itself loads after (decoding is async); the node and the builder's reference exist at once.
 */
import type { GraphNode } from '../types/nodeGraph';
import { useNodeGraphStore, undoManager } from '../store/useNodeGraphStore';
import { placeSetupInView } from '../store/placement';
import { takePicture } from '../lib/texture/pictureHost';
import { fetchMedia } from '../lib/texture/pictures';
import { nameFromUrl } from '../lib/texture/texturePaste';
import { getImage } from '../lib/backgroundLibrary';
import { makeShaderTexture } from '../nodes/shaderTextureStarters';
import { sourceFromNode, textureNodeFor, texSlug, type TexSource } from './textures';

/** What the picker hands a builder: the node (in the graph now) and a source for its spec. */
export interface PickedTexture { nodeId: string; source: TexSource }

function addNode(node: GraphNode, label: string): GraphNode {
  const st = useNodeGraphStore.getState();
  if (st.activeGroupPath.length) st.exitToRoot();
  const nodes = useNodeGraphStore.getState().nodes;
  const [placed] = placeSetupInView(nodes, [node], st._viewportRectGetter?.() ?? null);
  undoManager.push(nodes, { label });
  useNodeGraphStore.setState({ nodes: [...nodes, placed] });
  return placed;
}

/** A new empty Texture node named `name` (one undo step). */
export function addTextureNode(name: string): GraphNode {
  const id = useNodeGraphStore.getState().newNodeId();
  return addNode(textureNodeFor({ name: texSlug(name) }, id, { x: 0, y: 0 },
    `A picture for a scene builder (${name}). Drop another picture on it, pick one from the library or paste a link: the scene shows it.`), `Added a picture: ${name}`);
}

/** The source for a node of the graph, for a spec whose pictures are `list`. */
export function sourceFor(nodeId: string, list: readonly TexSource[] | undefined): TexSource | null {
  const n = useNodeGraphStore.getState().nodes.find(x => x.id === nodeId);
  return n ? sourceFromNode(n, list) : null;
}

/** A picture (a file, a pasted image, a library blob) on a new Texture node. */
export async function pictureFromBlob(blob: Blob, o: { name: string; libraryId?: string; url?: string }, list: readonly TexSource[] | undefined): Promise<PickedTexture> {
  const node = addTextureNode(o.name);
  await takePicture(node.id, blob, o);
  useNodeGraphStore.getState().compile();
  return { nodeId: node.id, source: sourceFor(node.id, list)! };
}

/** A picture from a link (fetched as the Texture card's Load does). */
export async function pictureFromUrl(url: string, list: readonly TexSource[] | undefined): Promise<PickedTexture> {
  const got = await fetchMedia(url, 'image');
  return pictureFromBlob(got.blob, { name: got.name || nameFromUrl(url) || 'picture', url }, list);
}

/** A picture from the image library. */
export async function pictureFromLibrary(id: string, list: readonly TexSource[] | undefined): Promise<PickedTexture> {
  const img = await getImage(id);
  if (!img) throw new Error('That picture isn’t in the library any more.');
  return pictureFromBlob(img.blob, { name: img.name, libraryId: id }, list);
}

/** A new Shader Texture (Start from: Circles), to edit what it draws later. */
export function newShaderTexture(list: readonly TexSource[] | undefined): PickedTexture {
  const node = makeShaderTexture(() => useNodeGraphStore.getState().newNodeId(), { x: 0, y: 0 }, { starter: 'circles' });
  const placed = addNode(node, 'Added a Shader Texture');
  useNodeGraphStore.getState().compile();
  return { nodeId: placed.id, source: sourceFor(placed.id, list)! };
}
