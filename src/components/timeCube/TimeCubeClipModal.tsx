/**
 * The Time Cube's clip editor window (docs/time-cube.md, "Editing the clip"):
 * components/media/ClipEditor.tsx in a large modal, editing a draft of the
 * node's segments, ramp and crop / rotate / flip plus its frame budget. Apply
 * writes them to the node, which rebuilds the volume (the card's progress bar
 * and Cancel); Cancel or Esc leaves the node as it was.
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';
import { getVideo } from '../../lib/backgroundLibrary';
import { clipParams, clipSettingsOf, cubeSequence, type ClipSettings } from '../../lib/media/clip';
import { MAX_FRAMES, MIN_FRAMES, capText, formatBytes, planFrameStack, stackSettingsOf } from '../../lib/timeCube/plan';
import { DEMO_LABEL, paintDemoFrame } from '../../lib/timeCube/frames';
import { timeCubeMeta, timeCubeSource, timeCubes } from '../../lib/timeCube/volumes';
import { buildEstimate, combineSettingsOf, frameOrder, orderSettingsOf } from '../../lib/timeCube/order';
import { ClipEditor, explicitSegments, type ClipFrameSource } from '../media/ClipEditor';

const PAINTED: ClipFrameSource = { kind: 'painted', paint: paintDemoFrame };

export function TimeCubeClipModal({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const meta = timeCubeMeta(node);
  const src = timeCubeSource(node);
  const [source, setSource] = useState<ClipFrameSource | 'loading' | 'missing'>(src?.kind === 'library' ? 'loading' : PAINTED);
  useEffect(() => {
    if (src?.kind !== 'library') return;
    let live = true;
    getVideo(src.videoId).then(v => { if (live) setSource(v ? { kind: 'video', blob: v.blob } : 'missing'); }).catch(() => { if (live) setSource('missing'); });
    return () => { live = false; };
  }, [src?.kind, src?.kind === 'library' ? src.videoId : '']); // eslint-disable-line react-hooks/exhaustive-deps

  const [draft, setDraft] = useState<ClipSettings>(() => {
    const c = clipSettingsOf(node.params);
    return { ...c, segments: explicitSegments(c.segments, meta?.duration ?? 0) };
  });
  const settings = stackSettingsOf(node.params);
  const [frames, setFrames] = useState(settings.frames);
  const plan = useMemo(() => (meta ? planFrameStack(meta, { ...settings, frames, clip: draft }) : null), [meta?.width, meta?.height, meta?.duration, frames, draft, settings.width, settings.spacing, settings.step, settings.deep]); // eslint-disable-line react-hooks/exhaustive-deps
  const comb = combineSettingsOf(node.params);
  // Result plays the frames in cube order: Frame order applied (sorting needs the built frames' numbers;
  // until the cube is built with this clip it plays them in time order).
  const sequence = useMemo(() => {
    if (!plan) return null;
    const ord = orderSettingsOf(node.params);
    const stats = timeCubes.frameStats(node.id)?.stats;
    return cubeSequence(plan.times, frameOrder(plan.frames, ord, stats && stats.length === plan.frames ? stats : undefined));
  }, [plan, node.params, node.id]);
  const clipMeta = useMemo(() => (meta ? { width: meta.width, height: meta.height, duration: meta.duration } : null), [meta?.width, meta?.height, meta?.duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = () => {
    updateNodeParams(node.id, { ...clipParams(draft), ...(settings.spacing === 'count' ? { frames } : {}) });
    onClose();
  };

  const name = src?.kind === 'library' ? (typeof node.params.fileName === 'string' && node.params.fileName) || 'A Library video' : DEMO_LABEL;
  const small = { fontSize: 11.5, color: tk.text.muted } as const;
  const est = plan ? buildEstimate(plan.frames, comb.sub, src?.kind !== 'library') : null;

  const side = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ font: `600 10.5px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', color: tk.text.faint }}>Frames</span>
      {settings.spacing === 'count' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="range" min={MIN_FRAMES} max={MAX_FRAMES} step={1} value={frames} onChange={e => setFrames(Number(e.target.value))} style={{ flex: 1 }} aria-label="Frames" />
          <input type="number" min={MIN_FRAMES} max={MAX_FRAMES} value={frames}
            onChange={e => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) setFrames(Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, v))); }}
            style={{ width: 56, height: 26, border: `1px solid ${tk.border.default}`, borderRadius: 6, background: tk.bg.field, color: tk.text.primary, font: `12px ${fontFamily.ui}`, padding: '0 6px' }} />
        </div>
      ) : (
        <span style={small}>{`One frame every ${settings.step.toFixed(2)} s of kept video (Spacing on the card).`}</span>
      )}
    </div>
  );

  const footer = (
    <>
      <span style={{ ...small, flex: 1, minWidth: 220, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {plan && <b style={{ color: tk.text.secondary, fontWeight: 600 }}>{`${plan.frames} frames · ${plan.tileW}×${plan.tileH} · ${formatBytes(plan.bytes)} on the GPU`}</b>}
        {plan && est && <span>{plan.capped ? capText(plan) + ' ' : ''}{`Reads ${est.decoded} frames${src?.kind === 'library' ? `, about ${est.seconds < 90 ? `${Math.max(1, Math.round(est.seconds))} s` : `${Math.round(est.seconds / 60)} min`}` : ''}. Apply rebuilds the cube.`}</span>}
      </span>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={apply} disabled={!plan}>Apply</Button>
    </>
  );

  return (
    <Modal title="Edit clip" subtitle={name} icon="slides" width={1080} height={820} onClose={onClose} footer={footer} closeOnScrim={false}>
      {!meta || !clipMeta ? <p style={{ ...small, padding: 20 }}>Reading the video's size…</p>
        : source === 'loading' ? <p style={{ ...small, padding: 20 }}>Opening the video…</p>
        : source === 'missing' ? <p style={{ ...small, padding: 20, color: tk.status.danger }}>This video is not in this browser's Library. Choose it again on the card.</p>
        : (
          <ClipEditor
            source={source}
            meta={clipMeta}
            value={draft}
            onChange={setDraft}
            plan={plan ? { times: plan.times, segments: plan.segments, frames: plan.frames, every: plan.every } : null}
            side={side}
            host="timeCube"
            sequence={sequence}
            cubeRate={plan && plan.every > 0 ? 1 / plan.every : undefined}
          />
        )}
    </Modal>
  );
}
