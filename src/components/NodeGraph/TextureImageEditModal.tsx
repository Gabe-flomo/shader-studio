/**
 * The Texture node's picture editor (docs/texture-node.md): the app's clip editor
 * (components/media/ClipEditor.tsx, the Time Cube's) on a still, with its crop, rotate and
 * flip. Apply saves `params.clip` ({ crop, rotate, flipX, flipY }), which the node's GLSL
 * applies (lib/media/clip.ts clipGlsl); a picture left as it was saves nothing.
 */
import { useMemo, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ClipEditor, type ClipFrameSource } from '../media/ClipEditor';
import { cleanTransform, defaultClip, isIdentity, parseSavedClip, type ClipSettings } from '../../lib/media/clip';

/** The clip a picture keeps: only the transform, and nothing when it changes nothing. */
export function savedPictureClip(v: ClipSettings): Record<string, unknown> | undefined {
  const xf = cleanTransform(v.xf);
  if (isIdentity(xf)) return undefined;
  return { crop: { ...xf.crop }, rotate: xf.rotate, flipX: xf.flipX, flipY: xf.flipY };
}

export function pictureClipSettings(raw: unknown): ClipSettings {
  const c = parseSavedClip(raw);
  return { ...defaultClip(), segments: [{ in: 0, out: 1 }], xf: c ? cleanTransform(c) : defaultClip().xf };
}

export function TextureImageEditModal({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const tex = useNodeGraphStore(s => s.nodeTextures[node.id]);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const [draft, setDraft] = useState<ClipSettings>(() => pictureClipSettings(node.params.clip));
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  const source = useMemo<ClipFrameSource | null>(() => (img ? { kind: 'painted', paint: (g, _t, x, y, w, h) => g.drawImage(img, x, y, w, h) } : null), [img]);
  const small = { fontSize: 11.5, color: tk.text.muted } as const;
  const name = (typeof node.params._imageName === 'string' && node.params._imageName) || 'picture';
  const apply = () => { updateNodeParams(node.id, { clip: savedPictureClip(draft) }, { immediate: true }); onClose(); };
  return (
    <Modal
      title="Edit picture" subtitle={`Texture · ${name}`} icon="edit" width={1000} height={720} onClose={onClose} closeOnScrim={false}
      footer={<>
        <span style={{ ...small, flex: 1, minWidth: 200 }}>Crop, turn and flip the picture. Result shows it as the node samples it; Fit, tiling and filtering are on the card.</span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply} disabled={!source}>Apply</Button>
      </>}
    >
      {source && img
        ? <ClipEditor source={source} meta={{ width: img.width || 1, height: img.height || 1, duration: 1 }} value={draft} onChange={setDraft} host="image" />
        : <p style={{ ...small, padding: 20 }}>Load a picture first.</p>}
    </Modal>
  );
}
