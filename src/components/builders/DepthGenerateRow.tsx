/**
 * DepthGenerateRow — "Generate depth" in the scene builders (builders/depthPicture.ts, docs/depth-mix.md): the state
 * of a picture's depth (generated, live on the canvas, or the picture's brightness standing in for the preview), the
 * one-time model download when it's needed, and the button that runs the model once on this device.
 */
import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { BuilderNote } from './BuilderWindow';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import { useDepthModels } from '../../depthModel/client';
import type { DepthBakeInfo } from '../../nodes/definitions/depth';
import { depthModelOffer, depthModelReady, downloadGenerateModel, generateModel, generatePictureDepth } from '../../builders/depthPicture';
import { previewDepthKind } from './previewTextures';

const PREVIEW_WORDS = {
  baked: 'The preview shows the generated depth.',
  live: 'The preview shows the depth the Depth node on the canvas worked out for this picture.',
  'stand-in': 'Until depth is generated, the preview uses the picture’s brightness as a stand-in (bright is near). The built scene’s Depth node works out the real depth once the model is downloaded.',
  none: 'The preview shows a checker until the picture loads.',
} as const;

export function DepthGenerateRow({ pictureNode, source, bake, onBake }: {
  /** The Texture node the picture is on. */
  pictureNode: string | undefined;
  /** The picture's name (the baked image is named after it). */
  source: string;
  bake: DepthBakeInfo | null | undefined;
  onBake: (info: DepthBakeInfo | null) => void;
}) {
  const tk = useTokens();
  const entry = useDepthModels(s => s.models[generateModel()]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // The preview's depth changes on its own (a bake loads, the canvas's Depth node runs): look again now and then.
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 1000); return () => clearInterval(t); }, []);
  const ready = !!entry?.downloaded || depthModelReady();
  const loading = entry?.status === 'loading';
  const pct = entry?.progress && entry.progress.total ? Math.round((entry.progress.loaded / entry.progress.total) * 100) : null;
  const offer = depthModelOffer();

  const run = async () => {
    setBusy(true); setMsg('');
    try {
      if (!depthModelReady() && !(await downloadGenerateModel())) throw new Error('The model couldn’t be downloaded (see the console).');
      const info = await generatePictureDepth(pictureNode, source);
      onBake(info);
      setMsg(`Generated in ${info.width} × ${info.height}, kept in the image library.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };

  return (
    <div data-depth-generate style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle }}>
      <BuilderNote style={{ color: tk.text.primary }}>
        {bake ? `Depth: generated (${bake.width} × ${bake.height}), kept with the scene. Build puts it on the Depth node (Update: Baked).`
          : ready ? 'Depth: not generated yet. Generate depth works it out now, on this device; or Build and the Depth node works it out live.'
            : `Depth runs on this device with ${offer.name}, a one-time ${offer.mb} MB download the browser keeps. Nothing is sent anywhere.`}
      </BuilderNote>
      {loading && pct !== null && (
        <div style={{ height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }} aria-label={`Downloading ${pct}%`}>
          <div style={{ width: `${pct}%`, height: '100%', background: tk.accent.base }} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant={bake ? undefined : 'primary'} disabled={busy || !pictureNode} onClick={() => { void run(); }}
          title="Run the depth model once on this picture, here, and keep the result">
          {busy ? (loading ? 'Downloading the model…' : 'Working out the depth…') : bake ? 'Generate again' : ready ? 'Generate depth' : `Download (${offer.mb} MB) and generate depth`}
        </Button>
        {bake && <Button size="sm" variant="ghost" onClick={() => onBake(null)} title="Forget the generated depth: the Depth node works it out live">Use live depth</Button>}
      </div>
      {msg && <BuilderNote>{msg}</BuilderNote>}
      <BuilderNote>{PREVIEW_WORDS[previewDepthKind(pictureNode, bake)]}</BuilderNote>
    </div>
  );
}
