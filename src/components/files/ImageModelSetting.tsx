/**
 * ImageModelSetting — the local image model's status and setting, in App settings (docs/image-model.md):
 * on or off, downloaded, loaded, size, backend and timings, and the one-time download on the web.
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { downloadImageModel, ensureImageModel, IMAGE_MODEL_BYTES, imageModelUsable, setImageModelEnabled, useImageModel } from '../../imageModel/client';
import { IMAGE_MODEL } from '../../imageModel/config';

const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;

function Pill({ children, tone = 'muted', title }: { children: ReactNode; tone?: 'muted' | 'good' | 'bad' | 'accent'; title?: string }) {
  const tk = useTokens();
  const c = tone === 'good' ? tk.status.success : tone === 'bad' ? tk.status.danger : tone === 'accent' ? tk.accent.base : tk.text.muted;
  return <span title={title} style={{ display: 'inline-flex', alignItems: 'center', font: `500 11px ${fontFamily.ui}`, padding: '2px 8px', borderRadius: 999, background: alpha(c, 0.1), color: c, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function ImageModelSetting({ compact = false }: { compact?: boolean }) {
  const tk = useTokens();
  const s = useImageModel();
  const usable = imageModelUsable(s);
  const muted = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const where = s.bundled ? 'Bundled with the app: it works offline from the first launch.' : s.downloaded ? 'Downloaded once; this browser keeps it.' : `A one-time download of ${mb(IMAGE_MODEL_BYTES)} from Hugging Face; then it runs here, offline.`;
  return (
    <div data-image-model-setting style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {!s.bundled && !s.downloaded && !(s.enabled && s.status === 'loading')
          ? <Button size="sm" variant="primary" icon="import" onClick={() => { void downloadImageModel(); }} data-image-model-download>Download the image model ({mb(IMAGE_MODEL_BYTES)})</Button>
          : <Toggle checked={s.enabled} onChange={setImageModelEnabled} label="Use the image model" />}
        {usable && s.status === 'idle' && <Button size="sm" variant="ghost" onClick={() => { void ensureImageModel(); }}>Load it now</Button>}
        {s.status === 'error' && <Button size="sm" variant="ghost" icon="reset" onClick={() => { void ensureImageModel(true); }}>Try again</Button>}
      </div>
      {s.status === 'loading' && (
        <div data-image-model-progress style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, maxWidth: 320, height: 6, borderRadius: 3, background: tk.bg.field, overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${s.progress ? Math.round((100 * s.progress.loaded) / s.progress.total) : 100}%`, background: tk.accent.base, transition: 'width 120ms' }} />
          </span>
          <span style={muted}>{s.progress ? `${mb(s.progress.loaded)} of ${mb(s.progress.total)}` : 'Loading…'}</span>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} data-image-model-status>
        <Pill tone={s.status === 'ready' ? 'good' : s.status === 'error' ? 'bad' : 'muted'}>{s.status === 'ready' ? 'loaded' : s.status === 'loading' ? 'loading' : s.status === 'error' ? 'failed' : usable ? 'loads when needed' : 'off'}</Pill>
        <Pill title={IMAGE_MODEL.repo}>{IMAGE_MODEL.name} · {mb(IMAGE_MODEL_BYTES)}</Pill>
        {s.backend && <Pill tone="accent">{s.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}</Pill>}
        {s.loadMs != null && <Pill>loaded in {(s.loadMs / 1000).toFixed(1)} s</Pill>}
        {s.embedMs != null && <Pill title={`${s.embeds} pictures so far`}>{Math.round(s.embedMs)} ms a picture</Pill>}
      </div>
      <span style={muted}>{where}{compact ? ' It is kept ready for explanations and suggestions; nothing uses it yet. Nothing is sent anywhere.' : ''}</span>
      {s.error && <span style={{ ...muted, color: tk.status.danger }}>{s.error}</span>}
    </div>
  );
}
