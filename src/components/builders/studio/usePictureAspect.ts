/**
 * usePictureAspect — the shape (width / height) of the picture a builder's viewport shows, so LiveViewport draws the
 * preview at it (`aspect`) instead of stretching it to the window (Texture Lab's source, Combine's base layer).
 *
 * `known` wins (a built-in photo's or clip's size); else the node's: a Texture Input's picture (`_imageAspect`), a Video
 * Input's video once it has loaded; else the main preview's own aspect setting (null on Free: the whole viewport).
 */
import { useEffect, useState } from 'react';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { videoEngine } from '../../../lib/videoEngine';
import { PREVIEW_ASPECTS } from '../../../utils/graphImportPlan';
import type { GraphNode } from '../../../types/nodeGraph';

const positive = (a: unknown): number | null => (typeof a === 'number' && Number.isFinite(a) && a > 0 ? a : null);

/** A Texture Input's picture shape, from its params; null for anything else. Pure. */
export function nodePictureAspect(node: Pick<GraphNode, 'type' | 'params'> | undefined | null): number | null {
  return node?.type === 'textureInput' ? positive(node.params._imageAspect) : null;
}

export function usePictureAspect(nodeId: string | null | undefined, known: number | null = null): number | null {
  const fromNode = useNodeGraphStore(s => (nodeId ? nodePictureAspect(s.nodes.find(x => x.id === nodeId)) : null));
  const videoId = useNodeGraphStore(s => (nodeId && s.nodes.find(x => x.id === nodeId)?.type === 'videoInput' ? nodeId : ''));
  const previewRatio = useNodeGraphStore(s => PREVIEW_ASPECTS.find(a => a.id === s.previewAspect)?.ratio ?? null);
  // The loaded video's shape, kept with the node it is of (another node's doesn't count).
  const [loaded, setLoaded] = useState<{ id: string; aspect: number } | null>(null);
  const video = loaded && loaded.id === videoId ? loaded.aspect : null;
  useEffect(() => {
    if (!videoId) return;
    let el: HTMLVideoElement | null = null;
    const read = () => { if (el && el.videoWidth > 0 && el.videoHeight > 0) setLoaded({ id: videoId, aspect: el.videoWidth / el.videoHeight }); };
    const attach = () => {
      const next = videoEngine.element(videoId);
      if (next === el) return;
      el?.removeEventListener('loadedmetadata', read);
      el = next;
      el?.addEventListener('loadedmetadata', read);
      read();
    };
    attach();
    const off = videoEngine.onChange(attach);
    return () => { off(); el?.removeEventListener('loadedmetadata', read); };
  }, [videoId]);
  return positive(known) ?? fromNode ?? video ?? previewRatio;
}
