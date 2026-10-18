/**
 * appLibrary.ts — the app's side of the Library facade (libraryFacade.ts): deleting a graph or a
 * node type the way their stores do it (links, history, the registry), keeping the open graph's
 * name when it is renamed, and the event that opens the Library on a category. Imported once by the Library's UI.
 */
import '../presets/presetKinds';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { reloadUserNodesFromStorage } from '../nodes/userNodes/userNodeRegistry';
import { librarySync, libraryDeleters } from './libraryFacade';
import type { LibraryCategoryId } from './libraryCategories';

libraryDeleters.graph = name => useNodeGraphStore.getState().deleteSavedGraph(name);
libraryDeleters.node = id => useNodeGraphStore.getState().deleteUserNode(id);
librarySync.reloadUserNodes = reloadUserNodesFromStorage;
librarySync.graphRenamed = (from, to) => {
  const st = useNodeGraphStore.getState();
  if (st.currentGraph?.name === from) useNodeGraphStore.setState({ currentGraph: { ...st.currentGraph, name: to } });
};

/** Ask the sidebar to show the Library (opened on a category). detail: { filter?: LibraryCategoryId } */
export const OPEN_LIBRARY = 'open-library';
export function openLibrary(filter?: LibraryCategoryId): void {
  window.dispatchEvent(new CustomEvent(OPEN_LIBRARY, { detail: { filter } }));
}
