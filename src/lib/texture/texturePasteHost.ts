/**
 * texturePasteHost.ts — the app side of pasting a picture (lib/texture/texturePaste.ts holds the
 * rules): onto a Texture node, or as a new Texture node in view.
 */
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { toast } from '../../components/ui/toastStore';
import { fetchMedia } from './pictures';
import { takePicture } from './pictureHost';
import { textureKindOf } from './textureSource';
import { pasteTarget, runOnCard, type ClipboardPicture } from './texturePaste';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The picture's bytes, name and source link (a link is fetched: CORS on the web, any link in the desktop app). */
async function bytesOf(p: ClipboardPicture): Promise<{ blob: Blob; name: string; url?: string }> {
  if (p.kind === 'image') return { blob: p.blob, name: p.name, url: p.url };
  const got = await fetchMedia(p.url, 'image');
  return { blob: got.blob, name: got.name, url: /^https?:/i.test(p.url) ? p.url : undefined };
}

/** Show a pasted picture on a Texture node (a Video or Webcam one switches to Image, as a dropped picture does). */
export async function pasteOntoNode(nodeId: string, p: ClipboardPicture): Promise<void> {
  const label = p.kind === 'image' ? 'Reading the pasted picture…' : 'Downloading the picture…';
  await runOnCard(nodeId, label, async () => {
    const got = await bytesOf(p);
    const st = useNodeGraphStore.getState();
    const node = (getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes).find(n => n.id === nodeId);
    if (node && textureKindOf(node) !== 'image') st.switchTextureSource(nodeId, 'image');
    await takePicture(nodeId, got.blob, { name: got.name, url: got.url });
  }, e => toast.error('Couldn’t paste the picture', { message: message(e) }));
}

/** A new Texture node at `at`, showing the pasted picture (a link that can't be read adds nothing). */
export async function pasteAsNewNode(p: ClipboardPicture, at: { x: number; y: number }): Promise<string | null> {
  let got: { blob: Blob; name: string; url?: string };
  try { got = await bytesOf(p); } catch (e) {
    toast.error('Couldn’t paste the picture', { message: message(e) });
    return null;
  }
  const st = useNodeGraphStore.getState();
  const id = st.addNode('textureInput', at);
  if (!id) return null;
  st.setSelectedNodeId(id);
  st.selectNode(id);
  try {
    await takePicture(id, got.blob, { name: got.name, url: got.url });
    toast.success('Added a Texture node with the pasted picture', got.url ? { message: got.url } : undefined);
  } catch (e) {
    toast.error('Couldn’t read the pasted picture', { message: message(e) });
  }
  return id;
}

/**
 * A paste on the canvas: onto the Texture node under the pointer or selected, else a new one at
 * `spawn()`. Returns false when the paste isn't for us (nothing to do).
 */
export function pasteIntoGraph(p: ClipboardPicture | null, hoveredId: string | null, spawn: () => { x: number; y: number }): boolean {
  if (!p) return false;
  const st = useNodeGraphStore.getState();
  const nodes = getActiveNodes(st.nodes, st.activeGroupPath) ?? st.nodes;
  const target = pasteTarget(nodes, hoveredId, st.selectedNodeIds, st.selectedNodeId);
  if (target) void pasteOntoNode(target, p);
  else void pasteAsNewNode(p, spawn());
  return true;
}
