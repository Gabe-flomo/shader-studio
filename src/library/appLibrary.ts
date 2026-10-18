/**
 * appLibrary.ts — the app's side of the Library facade (libraryFacade.ts): deleting a graph or a
 * node type the way their stores do it (links, history, the registry), keeping the open graph's
 * name when it is renamed, opening a shader on the Code page, and the event that opens the
 * Library on a filter. Imported once by the Library's UI.
 */
import '../presets/presetKinds';
import { useNodeGraphStore } from '../store/useNodeGraphStore';
import { reloadUserNodesFromStorage } from '../nodes/userNodes/userNodeRegistry';
import { librarySync, libraryDeleters, OPEN_SAVED_SHADER, type LibraryItem, type LibraryType } from './libraryFacade';
import { requestPage } from '../components/page';

libraryDeleters.graph = name => useNodeGraphStore.getState().deleteSavedGraph(name);
libraryDeleters.node = id => useNodeGraphStore.getState().deleteUserNode(id);
librarySync.reloadUserNodes = reloadUserNodesFromStorage;
librarySync.graphRenamed = (from, to) => {
  const st = useNodeGraphStore.getState();
  if (st.currentGraph?.name === from) useNodeGraphStore.setState({ currentGraph: { ...st.currentGraph, name: to } });
};

/** Ask the sidebar to show the Library (on a filter). detail: { filter?: LibraryType } */
export const OPEN_LIBRARY = 'open-library';
export function openLibrary(filter?: LibraryType): void {
  window.dispatchEvent(new CustomEvent(OPEN_LIBRARY, { detail: { filter } }));
}

/** The Code page reads these when it mounts; an open Shader tab listens for OPEN_SAVED_SHADER. */
const GLSL_EDITOR_KEY = 'shader-studio:glsl-editor';
const GLSL_OPEN_KEY = 'glsl-editor:open-shader';

/** Open a saved shader on the Code page's Shader tab. */
export function openShaderItem(item: LibraryItem): void {
  const code = typeof item.record?.code === 'string' ? item.record.code : '';
  try { localStorage.setItem(GLSL_EDITOR_KEY, code); localStorage.setItem(GLSL_OPEN_KEY, item.id); } catch { /* the page falls back to its own text */ }
  window.dispatchEvent(new CustomEvent(OPEN_SAVED_SHADER, { detail: { id: item.id } }));
  requestPage('glsl');
}
