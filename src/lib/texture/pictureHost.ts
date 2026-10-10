/**
 * pictureHost.ts — the Texture node's pictures in the app: taking one (upload, drop, URL,
 * library) and getting them back when a graph opens (lib/texture/pictures.ts holds the rules).
 */
import * as THREE from 'three';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { addImage, getImage } from '../backgroundLibrary';
import { createPictureRestorer, decodePicture, embedPicture, thumbPicture, type Decoded } from './pictures';

function textureOf(d: Decoded): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = d.width; c.height = d.height;
  const x = c.getContext('2d');
  if (!x) throw new Error('2D canvas context unavailable');
  x.drawImage(d.el, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

async function blobOf(src: Blob | string): Promise<Blob> {
  return typeof src === 'string' ? (await fetch(src)).blob() : src;
}

export const pictureRestorer = createPictureRestorer<THREE.Texture>({
  getTexture: id => useNodeGraphStore.getState().nodeTextures[id] ?? null,
  setTexture: (id, tex) => {
    const st = useNodeGraphStore.getState();
    const old = st.nodeTextures[id];
    st.setNodeTexture(id, tex);
    if (old && old !== tex) old.dispose();
  },
  libraryBlob: async id => (await getImage(id))?.blob ?? null,
  toTexture: async src => {
    const d = await decodePicture(await blobOf(src));
    if (!d) return null;
    try { return textureOf(d); } finally { d.close(); }
  },
  restored: id => {
    // The card's thumbnail and aspect come with the picture when an older save lacked them.
    const st = useNodeGraphStore.getState();
    const n = st.nodes.find(x => x.id === id);
    const tex = st.nodeTextures[id];
    const img = tex?.image as { width?: number; height?: number } | undefined;
    if (n && img?.width && img.height && !(typeof n.params._imageAspect === 'number' && n.params._imageAspect !== 1)) {
      const aspect = img.width / img.height;
      if (Math.abs(aspect - 1) > 1e-3) {
        const dirty = st.graphDirty;
        st.updateNodeParams(id, { _imageAspect: aspect }, { immediate: true });
        useNodeGraphStore.setState({ graphDirty: dirty });
      }
    }
  },
  filters: { nearest: THREE.NearestFilter, linear: THREE.LinearFilter, linearMipmap: THREE.LinearMipmapLinearFilter },
});

/** Start keeping pictures in step with the graph; returns the stop function. */
export function installPictureRestore(): () => void {
  let st = useNodeGraphStore.getState();
  void pictureRestorer.sync(st.nodes, true);
  return useNodeGraphStore.subscribe((s, prev) => {
    if (s.nodes === prev.nodes && s.graphEpoch === prev.graphEpoch) return;
    st = s;
    void pictureRestorer.sync(st.nodes, s.graphEpoch !== prev.graphEpoch);
  });
}

export interface TakenPicture { libraryId: string; name: string }

/**
 * Show a picture on a Texture node: decoded, uploaded as its texture, kept in the library
 * (unless it came from there) and embedded in the node, so the graph opens with it again.
 */
export async function takePicture(nodeId: string, blob: Blob, o: { name: string; libraryId?: string; url?: string }): Promise<TakenPicture> {
  const d = await decodePicture(blob);
  if (!d) throw new Error('This browser can’t read that picture. Try a PNG, JPEG or WebP.');
  let tex: THREE.Texture, src: string, thumb: string;
  const aspect = d.width / Math.max(1, d.height);
  try {
    tex = textureOf(d);
    src = embedPicture(d);
    thumb = thumbPicture(d);
  } finally { d.close(); }
  let libraryId = o.libraryId ?? '';
  if (!libraryId) {
    try { libraryId = (await addImage(blob, { name: o.name, width: Math.round(aspect * 1000), height: 1000 })).id; } catch { /* no IndexedDB, or full: the embedded copy keeps it */ }
  }
  const st = useNodeGraphStore.getState();
  const node = st.nodes.find(n => n.id === nodeId);
  const filter = node?.params.filter;
  if (filter === 'nearest') { tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; }
  const old = st.nodeTextures[nodeId];
  st.setNodeTexture(nodeId, tex);
  if (old && old !== tex) old.dispose();
  const params: Record<string, unknown> = {
    _thumbnailUrl: thumb, _imageAspect: aspect, _imageName: o.name, _imageSrc: src || undefined,
    libraryId: libraryId || undefined, _imageUrl: o.url || undefined,
    // A new picture starts uncropped.
    clip: undefined,
  };
  // Marked first: the params change below runs the restorer, which must not load it again.
  pictureRestorer.markLoaded(nodeId, { ...(node?.params ?? {}), ...params });
  st.updateNodeParams(nodeId, params, { immediate: true });
  return { libraryId, name: o.name };
}
