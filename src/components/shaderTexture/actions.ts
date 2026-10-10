/**
 * The app's Shader Texture edits (docs/texture-builder.md), each one undo step through
 * rewriteTopLevel: turning a selection or a plain group into one, and a Texture node's
 * "Create a new texture".
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { selectionToShaderTexture, textureNodeToShaderTexture } from '../../nodes/shaderTextureStarters';
import { toast } from '../ui/toastStore';

/** Selected nodes (or one plain group) at the top level → a Shader Texture holding them. Says why when it can't. */
export function turnIntoShaderTexture(ids: string[]): string | null {
  let made: string | null = null;
  let problem: string | null = null;
  useNodeGraphStore.getState().rewriteTopLevel((nodes, nextId) => {
    const r = selectionToShaderTexture(nodes, ids, nextId);
    if ('error' in r) { problem = r.error; return null; }
    made = r.id;
    return r.nodes;
  }, 'Turned into a Shader Texture');
  if (problem) toast.warning('Can\'t turn this into a Shader Texture', { message: problem });
  if (made) useNodeGraphStore.getState().selectNodes([made]);
  return made;
}

/** A Texture node's "Create a new texture": a Shader Texture in its place, wired where it was. */
export function textureToShaderTexture(nodeId: string): void {
  useNodeGraphStore.getState().rewriteTopLevel((nodes, nextId) => textureNodeToShaderTexture(nodes, nodeId, nextId), 'Made a new Shader Texture');
}
