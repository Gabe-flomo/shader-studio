/**
 * Separate and the Stem picker on an Audio Source (docs/audio-tools.md "Stems", docs/stems.md), on its card
 * (`compact`) and in its window:
 *
 * - **Separate** (a File with a song): the first time, it offers the model's download (its size and licence; nothing
 *   downloads until the person says yes), then runs (stemModel/job.ts: the picture pauses, the progress screen shows).
 *   The window also offers the 6-stem model (guitar and piano, with its warning), Re-separate and Remove stems.
 * - **Stem**: Full mix or one of the stems: what the bands, Hit, Learn a sound, the effects and every listening node hear.
 * - **Hear**: Full mix (the default: you hear the song, the analysis hears the stem) or This stem.
 */
import { useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { DEFAULT_STEM_MODEL_ID, STEM_MODELS, formatStemBytes, stemDownloadBytes, stemModelById } from '../../stemModel/config';
import { downloadStemModel, useStemModels } from '../../stemModel/client';
import { defaultStemJobDeps, fmtDuration, runStemJob, useStemJob } from '../../stemModel/job';
import { analysedStem, removeStems, stemOptions, stemsBytes, stemsOf, type StemChoice } from '../../lib/audioTools/stems';
import { Button } from '../ui/Button';
import { Segmented } from '../ui/Choice';
import { Select } from '../ui/Select';
import { mountStemProgress } from './StemProgressScreen';

/** Start a Separate run for a node (the model is downloaded, or the person just said yes). */
export async function separateNode(node: GraphNode, model: string): Promise<void> {
  mountStemProgress();
  const P = node.params;
  const songId = typeof P.sampleId === 'string' ? P.sampleId : '';
  const songName = (typeof P._fileName === 'string' && P._fileName) || 'Song';
  const deps = await defaultStemJobDeps((nodeId, bake) => useNodeGraphStore.getState().updateNodeParams(nodeId, { stems: bake }, { immediate: true, live: true }));
  await runStemJob({ nodeId: node.id, songId, songName, model, previous: stemsOf(P) }, deps);
}

export function StemControls({ node, compact = false, loaded }: { node: GraphNode; compact?: boolean; loaded: boolean }) {
  const tk = useTokens();
  const P = node.params;
  const bake = stemsOf(P);
  const running = useStemJob(s => s.job);
  const last = useStemJob(s => (s.last?.nodeId === node.id ? s.last : null));
  const models = useStemModels(s => s.models);
  const [offer, setOffer] = useState<string | null>(null);
  const [model, setModel] = useState<string>(bake?.model && STEM_MODELS.some(m => m.id === bake.model) ? bake.model : DEFAULT_STEM_MODEL_ID);
  const set = (p: Record<string, unknown>) => useNodeGraphStore.getState().updateNodeParams(node.id, p, { immediate: true, live: true });
  const line = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  const warn = { ...line, color: tk.status.warning } as const;
  if (!loaded || !(typeof P.sampleId === 'string' && P.sampleId)) {
    return compact ? null : <span style={line}>Separate works on a song loaded on the File tab.</span>;
  }
  const busy = !!running;
  const stem = analysedStem(P);
  const separate = (id: string) => {
    if (models[id]?.downloaded) { setOffer(null); void separateNode(node, id); }
    else setOffer(id);
  };
  const spec = stemModelById(offer ?? model);
  const offerPanel = offer && (
    <div data-stem-offer style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: radius.md, background: tk.bg.subtle }}>
      <span style={{ ...line, color: tk.text.primary }}>{spec.name} runs on this device and is downloaded once ({formatStemBytes(stemDownloadBytes(spec))}). Nothing is sent anywhere.</span>
      <span style={line}>Licence: {spec.licence} (Demucs by Meta AI).</span>
      {spec.warning && <span style={warn}>{spec.warning}</span>}
      {models[spec.id]?.status === 'error' && <span style={warn}>{models[spec.id]?.error}</span>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="primary" data-stem-download onClick={() => { setOffer(null); void downloadStemModel(spec.id); void separateNode(node, spec.id); }}>
          Download ({formatStemBytes(stemDownloadBytes(spec))}) and separate
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOffer(null)}>Not now</Button>
      </div>
    </div>
  );
  const lastLine = last && <span style={last.kind === 'error' ? { ...line, color: tk.status.danger } : line} data-stem-last>{last.message}</span>;

  if (!bake) {
    return (
      <div data-stem-controls style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Button size="sm" data-stem-separate disabled={busy} onClick={() => separate(model)}
            title="Split the song into stems (drums, bass, vocals, other) on this device, once; then pick one for everything listening to hear">Separate</Button>
          {!compact && (
            <div style={{ width: 300 }}>
              <Segmented<string> size="sm" fill ariaLabel="Stem model" value={model} onChange={setModel}
                options={STEM_MODELS.map(m => ({ value: m.id, label: m.stems.length === 4 ? '4 stems' : '6 stems (+ guitar, piano)' }))} />
            </div>
          )}
          {compact && <span style={line}>Split into stems</span>}
        </div>
        {!compact && !offer && stemModelById(model).warning && <span style={warn}>{stemModelById(model).warning}</span>}
        {offerPanel}
        {lastLine}
      </div>
    );
  }

  const options = stemOptions(bake);
  const bakeSpec = stemModelById(bake.model);
  return (
    <div data-stem-controls style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={line}>Stem</span>
        <div style={{ minWidth: 120, flex: compact ? 1 : undefined }} data-stem-picker>
          <Select ariaLabel="Stem" value={stem} onChange={v => set({ stem: v as StemChoice })} options={options} height={compact ? 26 : 30} />
        </div>
        <span style={line}>Hear</span>
        <div style={{ width: compact ? 150 : 190 }} data-stem-hear>
          <Segmented<'mix' | 'stem'> size="sm" fill ariaLabel="Hear" value={P.hear === 'stem' ? 'stem' : 'mix'} onChange={v => set({ hear: v })}
            options={[{ value: 'mix', label: 'Full mix' }, { value: 'stem', label: 'This stem' }]} />
        </div>
      </div>
      {stem === 'piano' && <span style={warn}>Piano bleeds: other instruments leak into it.</span>}
      {!compact && (
        <>
          <span style={line}>
            {bake.tracks.length} stems from {bakeSpec.name} · {formatStemBytes(stemsBytes(bake))} kept in the library
            {bake.ms ? ` · took ${fmtDuration(bake.ms / 1000)}${bake.backend ? ` on ${bake.backend === 'webgpu' ? 'WebGPU' : 'WebAssembly'}` : ''}` : ''}.
            {' '}The analysis hears the Stem; {P.hear === 'stem' ? 'you hear it too.' : 'you hear the whole song.'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ width: 300 }}>
              <Segmented<string> size="sm" fill ariaLabel="Stem model" value={model} onChange={setModel}
                options={STEM_MODELS.map(m => ({ value: m.id, label: m.stems.length === 4 ? '4 stems' : '6 stems (+ guitar, piano)' }))} />
            </div>
            <Button size="sm" disabled={busy} data-stem-reseparate onClick={() => separate(model)} title="Separate the song again (with the model picked here); the stems it has now go once the new ones are kept">Re-separate</Button>
            <Button size="sm" variant="ghost" disabled={busy} data-stem-remove
              onClick={() => { void removeStems(bake).then(() => set({ stems: null, stem: 'mix', hear: 'mix' })); }}
              title="Remove the stems from the library (the song stays)">Remove stems</Button>
          </div>
          {!offer && model !== bake.model && stemModelById(model).warning && <span style={warn}>{stemModelById(model).warning}</span>}
          {offerPanel}
        </>
      )}
      {compact && offerPanel}
      {lastLine}
    </div>
  );
}
