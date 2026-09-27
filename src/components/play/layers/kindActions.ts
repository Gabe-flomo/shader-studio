/**
 * kindActions — what the Kind card (layers/editors.tsx) and Add layer's
 * Your layers both do to a saved layer kind: restyle it, put it in or take it
 * out of your list, take it out of the file. One implementation, two menus.
 */
import type { PlayRecord } from '../../../types/play';
import type { LayerKindDef } from '../../../types/layerKinds';
import { kindUses, layerKindRegistry, removeKind, restyleKind, restyledKind, type KindLook } from '../../../play/layerKinds';
import { askConfirm } from '../../ui/dialogStore';
import { toast } from '../../ui/toastStore';
import { removeItemsFromFolders } from '../../../utils/assetFolders';
import { LAYER_KIND_FOLDER_SCOPE } from './addLayerCatalog';

type ChangePlay = (fn: (p: PlayRecord) => PlayRecord) => void;

/** New name, hint, icon or colour: in the file (when it has the kind) and in your list (when it is there). */
export function applyKindLook(kind: LayerKindDef, inFile: boolean, look: KindLook, changePlay: ChangePlay): void {
  if (inFile) changePlay(p => restyleKind(p, kind.id, look).play);
  if (layerKindRegistry.get(kind.id)) layerKindRegistry.register(restyledKind(kind, look), 'saved');
}

export function addKindToList(kind: LayerKindDef): void {
  layerKindRegistry.register(kind, 'saved');
  toast.success(`“${kind.name}” is in your list`);
}

/**
 * Out of your list. When this file does not have it either, that is the last
 * copy in this browser, so it asks first (and the kind leaves its folder).
 */
export async function removeKindFromList(kind: LayerKindDef, inFile: boolean): Promise<void> {
  if (!inFile) {
    const ok = await askConfirm(`Delete “${kind.name}”?`, { message: 'This file does not use it, so this removes it from Add layer. Files that have layers of it keep their own copy.', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    layerKindRegistry.unregister(kind.id);
    try { removeItemsFromFolders(LAYER_KIND_FOLDER_SCOPE, [kind.id]); } catch { /* storage blocked */ }
    toast.info(`Deleted “${kind.name}”`);
    return;
  }
  layerKindRegistry.unregister(kind.id);
  toast.info(`“${kind.name}” is out of your list`);
}

/** Take the kind out of the file after asking: its layers keep their code as plain Script layers. */
export async function removeKindFromFile(play: PlayRecord, kind: LayerKindDef, changePlay: ChangePlay): Promise<void> {
  const n = kindUses(play, kind.id);
  const ok = await askConfirm(`Remove “${kind.name}” from this file?`, { message: `Its ${n} layer${n === 1 ? '' : 's'} keep their code as plain Script layers.${layerKindRegistry.get(kind.id) ? ' It stays in your list, so Add layer still offers it.' : ''}`, confirmLabel: 'Remove', danger: true });
  if (ok) changePlay(p => removeKind(p, kind.id));
}
