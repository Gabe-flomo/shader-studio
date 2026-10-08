/**
 * TasteLooks — "How things look" on the Taste page (docs/taste.md): the small local image model's status
 * (on or off, downloaded, loaded, size, backend, timings), what the taste model learned about looks (the
 * liked and disliked centroids' evidence), and the most-liked looks: kept surprises, Evolve picks and the
 * bundled examples, ranked by how close they are to the looks you like.
 *
 * `ImageModelSetting` is the same toggle and status in App settings.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { useTaste } from '../../taste/store';
import { lookScore, type LookState } from '../../taste/look';
import { downloadImageModel, EMBEDDER_ID, ensureImageModel, IMAGE_MODEL_BYTES, imageModelUsable, setImageModelEnabled, useImageModel } from '../../imageModel/client';
import { IMAGE_MODEL } from '../../imageModel/config';
import { Card, Pill } from './tasteUi';
import { plural, signed } from './tasteWords';

const mb = (b: number) => `${(b / 1048576).toFixed(0)} MB`;

/** One line on the model's state, for summaries. */
export function useImageModelLine(): string {
  const s = useImageModel();
  if (!s.enabled) return s.downloaded ? 'image model off' : 'image model not downloaded';
  if (!s.bundled && !s.downloaded) return 'image model not downloaded';
  if (s.status === 'loading') return s.progress ? `downloading ${Math.round((100 * s.progress.loaded) / s.progress.total)}%` : 'loading the image model';
  if (s.status === 'ready') return `${IMAGE_MODEL.name} on ${s.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}`;
  if (s.status === 'error') return 'image model failed to load';
  return `${IMAGE_MODEL.name} on, loads when needed`;
}

/** The setting and the model's status (the Taste page and App settings). */
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
      {!compact && <span style={muted}>{where} It turns a candidate’s picture into numbers, so Deep, Surprise and Evolve can learn the looks you keep and tell near-identical pictures apart, and so words like “underwater” or “stained glass” can steer by look. Nothing is sent anywhere.</span>}
      {s.error && <span style={{ ...muted, color: tk.status.danger }}>{s.error}</span>}
    </div>
  );
}

interface Shown { id: string; thumb: string; label: string; score: number; kind: 'kept' | 'example' }

/** The section on the Taste page. */
export function TasteLooks() {
  const tk = useTokens();
  const model = useTaste(s => s.model);
  const local = useTaste(s => s.local);
  const prior = useTaste(s => s.prior);
  const usable = useImageModel(imageModelUsable);
  const [records, setRecords] = useState<Array<{ id: string; thumb: string; label: string; proj: number[]; kind: 'kept' | 'example' }>>([]);
  useEffect(() => {
    if (!usable) return;
    let live = true;
    let off: (() => void) | undefined;
    void import('../../imageModel/gallery').then(g => {
      const read = () => { void Promise.all([g.keptLooks(), g.exampleLooks()]).then(([kept, ex]) => { if (live) setRecords([...kept, ...ex.values()]); }); };
      read();
      off = g.onGalleryChange(read);
    });
    return () => { live = false; off?.(); };
  }, [usable]);
  const look: LookState | undefined = model.look && model.look.embedder === EMBEDDER_ID ? model.look : undefined;
  const top: Shown[] = useMemo(() => {
    if (!look || look.likeW <= 0) return [];
    return records.filter(r => r.thumb).map(r => ({ id: r.id, thumb: r.thumb, label: r.label, kind: r.kind, score: lookScore(look, r.proj) }))
      .sort((a, b) => b.score - a.score).slice(0, 6);
  }, [records, look]);
  const muted = { fontSize: 12, color: tk.text.muted, lineHeight: 1.5 } as const;
  const stale = model.look && model.look.embedder !== EMBEDDER_ID;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Card pad={12}><ImageModelSetting /></Card>
      <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>What it learned about looks</span>
        {look ? (
          <div data-taste-look-stats style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill tone="good" title="Evidence behind the liked-look centroid">liked looks: {look.likeW.toFixed(1)}</Pill>
            <Pill tone="bad" title="Evidence behind the disliked-look centroid">disliked looks: {look.dislikeW.toFixed(1)}</Pill>
            <Pill>{plural(Math.round(look.seenW), 'look')} learned from</Pill>
            {prior.look && <Pill tone="accent">imported: {prior.look.likeW.toFixed(1)} liked</Pill>}
            {local.look && <Pill tone="good">this install: {local.look.likeW.toFixed(1)} liked</Pill>}
            <Pill title={EMBEDDER_ID}>{look.dims} dims</Pill>
          </div>
        ) : (
          <span style={muted}>{stale ? `The looks it learned came from another image model (${model.look!.embedder}); they count for nothing now and start again.` : usable ? 'Nothing yet: keep a surprise, pick in Evolve or like an example, and its look counts.' : 'The image model is off: the taste model learns from techniques, palettes, settings and Deep’s metrics only.'}</span>
        )}
        <span style={{ ...muted, fontSize: 11.5 }}>Each picture becomes a 512-number vector, projected to 64 with a fixed random projection. The taste model keeps the average of the looks you liked and of the ones you didn’t (per layer: imported and this install), and a look’s score is how much closer it is to the first than to the second. Exported profiles carry these averages, never pictures.</span>
      </Card>
      {usable && (
        <Card pad={12} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ font: `650 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Most-liked looks</span>
          {top.length ? (
            <div data-taste-looks style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 10 }}>
              {top.map(t => (
                <figure key={t.id} style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }} title={`${t.label} · look ${signed(t.score, 2)}`}>
                  <img src={t.thumb} alt={t.label} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: radius.md, background: tk.bg.field, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }} />
                  <figcaption style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: tk.text.secondary, minWidth: 0 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                    <span style={{ font: `500 10.5px ${fontFamily.mono}`, color: t.score >= 0 ? tk.status.success : tk.status.danger }}>{signed(t.score, 2)}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : <span style={muted}>{look ? `No pictures to show yet (${plural(records.length, 'look')} on this device). Examples are embedded in the background after the model loads.` : 'None yet.'}</span>}
        </Card>
      )}
    </div>
  );
}
