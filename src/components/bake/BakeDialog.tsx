/**
 * BakeDialog (docs/bake.md): "Bake…" on a node, "Bake the picture", and
 * Re-bake. Choose how long, from when, how smooth and how sharp; see roughly
 * how big and how slow it will be, and what stops moving once it's frozen.
 * The render runs here with a progress bar and Cancel; the result replaces
 * the node with a Baked node (one undo step).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { Segmented, Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { toast } from '../ui/toastStore';
import { bakeableOutput, hasAlpha, pictureTarget, stashOf } from '../../lib/bake/graphOps';
import { BAKE_LIMITS, DEFAULT_BAKE, estimateBake, type BakeSettings } from '../../lib/bake/plan';
import { bakeFreezes, bakeNode, nodeLabel, prepareBake, previewSize, rebakeNode, type BakeHandle, type BakeProgress } from '../../lib/bake/runner';
import { getPerfSnapshot, subscribePerf } from '../../lib/perfStats';
import { inDesktopApp } from '../../lib/bake/encode';
import type { BakedInfo } from '../../nodes/definitions/baked';
import { useBakeDialog, type BakeRequest } from './bakeDialogStore';

type Request = BakeRequest;

/** The settings the last bake used (this session), as the next one's start. */
let lastSettings: BakeSettings = DEFAULT_BAKE;

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const secs = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

export function BakeDialogHost() {
  const request = useBakeDialog(s => s.request);
  const close = useBakeDialog(s => s.close);
  if (!request) return null;
  return <BakeDialog key={JSON.stringify(request)} request={request} onClose={close} />;
}

function BakeDialog({ request, onClose }: { request: Request; onClose: () => void }) {
  const tk = useTokens();
  const nodes = useNodeGraphStore(s => s.nodes);
  const rebake = request.kind === 'rebake';
  const targetId = request.kind === 'picture' ? pictureTarget(nodes)?.nodeId ?? null : request.kind === 'node' ? request.nodeId : null;
  const pictureKey = request.kind === 'picture' ? pictureTarget(nodes)?.outputKey : undefined;
  const target = targetId ? nodes.find(n => n.id === targetId) : undefined;
  const bakedNode = rebake ? nodes.find(n => n.id === request.nodeId) : undefined;
  const choices = useMemo(() => (target ? Object.entries(target.outputs).filter(([k]) => bakeableOutput(target, k)?.key === k) : []), [target]);
  const [outputKey, setOutputKey] = useState(() => pictureKey ?? (target ? bakeableOutput(target)?.key : undefined) ?? '');
  const [s, setS] = useState<BakeSettings>(() => ({ ...lastSettings, alpha: false }));
  const [startText, setStartText] = useState(String(s.start));
  const [durText, setDurText] = useState(String(s.duration));
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');
  const [progress, setProgress] = useState<BakeProgress | null>(null);
  const [error, setError] = useState('');
  const handle = useRef<BakeHandle>({ cancelled: false });
  const source = request.kind === 'picture' ? 'the picture' : rebake ? (bakedNode?.params.bakeInfo as BakedInfo | undefined)?.source ?? 'a node' : nodeLabel(target);

  const out = target ? bakeableOutput(target, outputKey) : null;
  const canAlpha = !!(target && out && hasAlpha(target, out.type));
  const prep = useMemo(() => {
    if (rebake || !target || !out) return null;
    try { return prepareBake({ nodeId: target.id, outputKey: out.key, settings: s, source }); } catch { return null; }
  }, [rebake, target, out, s, source]);
  const frozen = useMemo(() => (prep ? bakeFreezes(prep.graph, prep.tucked) : []), [prep]);
  const preview = previewSize();
  // Listening turns the preview's GPU timers on: the estimate follows what this graph really costs a frame.
  const [, setPerfTick] = useState(0);
  useEffect(() => subscribePerf(() => setPerfTick(t => t + 1)), []);
  const perf = getPerfSnapshot();
  // The preview's measured frame: every GPU pass (agents, particles, passes and the picture) when timed, else the CPU's time.
  const gpuAll = perf.passes.reduce((a, p) => a + p.avg, 0);
  const msPerFrame = gpuAll > 0 ? gpuAll + (perf.cpu.avg ?? 0) : (perf.cpu.avg ?? undefined);
  const scaledMs = msPerFrame !== undefined && perf.width > 0 && prep ? msPerFrame * (prep.plan.width * prep.plan.height) / (perf.width * perf.height) : undefined;
  const est = prep ? estimateBake(prep.plan, scaledMs) : null;

  // Re-bake starts straight away with the settings it was baked with.
  const started = useRef(false);
  useEffect(() => {
    if (!rebake || started.current) return;
    started.current = true;
    void run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebake]);
  // Leaving mid-render cancels it (the render puts the preview back itself).
  useEffect(() => () => { handle.current.cancelled = true; }, []);

  const unbakeable = !rebake && (!target ? (request.kind === 'picture' ? 'Nothing is wired into the Output to bake.' : 'That node is gone.') : !out ? 'This node has no colour, colour-with-alpha or value output to bake.' : null);

  async function run() {
    handle.current = { cancelled: false };
    setState('running'); setError(''); setProgress(null);
    try {
      if (rebake) {
        await rebakeNode(request.nodeId, handle.current, setProgress);
        toast.success(`Re-baked ${source}`, { message: 'A new video is in the Library; the old one stays until Clean up.' });
      } else {
        lastSettings = { ...s, alpha: false };
        await bakeNode({ nodeId: target!.id, outputKey: out!.key, settings: { ...s, alpha: s.alpha && canAlpha }, source }, handle.current, setProgress);
        toast.success(`Baked ${source}`, { message: 'It plays from a video now. Unbake on its card brings the live nodes back; Undo works too.' });
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === 'cancelled') { if (rebake) onClose(); else setState('idle'); return; }
      setError(msg); setState('error');
    }
  }

  const label = (text: string) => <span style={{ color: tk.text.muted, font: `600 11px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase', minWidth: 86 }}>{text}</span>;
  const row = (name: string, control: React.ReactNode) => <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>{label(name)}{control}</div>;
  const stat = (n: string, what: string) => (
    <div style={{ padding: '6px 10px', borderRadius: radius.md, background: tk.bg.field, minWidth: 72 }}>
      <div style={{ font: `700 14px ${fontFamily.ui}` }}>{n}</div>
      <div style={{ color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{what}</div>
    </div>
  );
  const num = (text: string, set: (t: string) => void, apply: (v: number) => void, suffix: string, aria: string) => (
    <Field value={text} aria-label={aria} suffix={suffix} mono style={{ width: 96 }} height={30}
      onChange={e => { set(e.target.value); const v = parseFloat(e.target.value); if (Number.isFinite(v)) apply(v); }} />
  );
  const running = state === 'running';
  const pct = progress && progress.total ? progress.done / progress.total : 0;
  const left = progress && progress.done > 2 && progress.elapsed > 0 ? progress.elapsed / progress.done * (progress.total - progress.done) : null;

  return (
    <Modal
      title={rebake ? `Re-bake ${source}` : `Bake ${source}`}
      subtitle={rebake ? 'Rendering the live nodes again with the same settings.' : 'Render it once to a video and play that in its place: far lighter to draw. Unbake brings the live nodes back.'}
      icon="record"
      width={560}
      closeOnScrim={!running}
      onClose={() => { if (running) handle.current.cancelled = true; else onClose(); }}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%', alignItems: 'center' }}>
          <span style={{ color: tk.text.muted, fontSize: 12 }}>{inDesktopApp() ? 'H.264 video (FFmpeg)' : 'WebM video (VP8)'} · kept in the Library’s Videos</span>
          <span style={{ flex: 1 }} />
          {running
            ? <Button size="sm" variant="secondary" onClick={() => { handle.current.cancelled = true; }}>Cancel</Button>
            : <>
              <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
              {!rebake && <Button size="sm" variant="primary" icon="record" disabled={!!unbakeable || !prep} onClick={() => void run()}>Bake</Button>}
            </>}
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 20px' }}>
        {unbakeable && <Callout tone="warning" title="Nothing to bake here">{unbakeable}</Callout>}
        {!rebake && !unbakeable && (
          <>
            {choices.length > 1 && row('Output', <Select ariaLabel="Output to bake" value={outputKey} onChange={setOutputKey} options={choices.map(([k, sock]) => ({ value: k, label: `${sock.label} (${sock.type === 'vec3' ? 'colour' : sock.type === 'vec4' ? 'colour + alpha' : 'value'})` }))} style={{ minWidth: 180 }} />)}
            {row('Time', <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ color: tk.text.secondary, fontSize: 12 }}>from</span>
              {num(startText, setStartText, v => setS(p => ({ ...p, start: Math.max(0, v) })), 's', 'Start time in seconds')}
              <span style={{ color: tk.text.secondary, fontSize: 12 }}>for</span>
              {num(durText, setDurText, v => setS(p => ({ ...p, duration: Math.min(BAKE_LIMITS.maxDuration, Math.max(BAKE_LIMITS.minDuration, v)) })), 's', 'Duration in seconds')}
            </div>)}
            {row('Frame rate', <Segmented size="sm" ariaLabel="Frames per second" value={String(s.fps) as '24' | '30' | '60'} onChange={v => setS(p => ({ ...p, fps: Number(v) }))} options={[{ value: '24', label: '24 fps' }, { value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }]} />)}
            {row('Resolution', <Segmented size="sm" ariaLabel="Resolution" value={String(s.resolution)} onChange={v => setS(p => ({ ...p, resolution: v === 'full' || v === 'half' ? v : Number(v) }))}
              options={[{ value: 'full', label: `Full ${preview.width}×${preview.height}` }, { value: 'half', label: '½' }, { value: '720', label: '720p' }, { value: '1080', label: '1080p' }]} />)}
            {row('At the end', <Segmented size="sm" ariaLabel="Loop" value={s.loop} onChange={v => setS(p => ({ ...p, loop: v }))} options={[{ value: 'seamless', label: 'Loop seamlessly' }, { value: 'none', label: 'Hold the last frame' }]} />)}
            {canAlpha && row('Alpha', <Toggle checked={s.alpha} onChange={v => setS(p => ({ ...p, alpha: v }))} label="Keep transparency (stored under the colour in the same video)" />)}
            {prep && est && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {stat(`${prep.plan.frames}`, 'frames')}
                {stat(`${prep.plan.width}×${prep.plan.height}`, 'pixels')}
                {stat(`≈ ${mb(est.bytes)}`, 'file')}
                {stat(`≈ ${secs(est.seconds)}`, 'to render')}
                {stat(`${prep.tucked.length}`, prep.tucked.length === 1 ? 'node frozen' : 'nodes frozen')}
              </div>
            )}
            {s.loop === 'seamless' && prep && prep.plan.fadeFrames > 0 && <div style={{ color: tk.text.muted, fontSize: 12, lineHeight: 1.5 }}>The last {+(prep.plan.fadeFrames / prep.plan.fps).toFixed(2)} s crossfade into the first frame, so it loops without a jump.</div>}
            {frozen.length > 0 && <Callout tone="warning" title={`Once baked, ${frozen.join(', ')} ${frozen.length === 1 ? 'no longer moves' : 'no longer move'} it`}>The video keeps what they did while it rendered. Unbake to make it live again.</Callout>}
            {prep && prep.dropped.length > 0 && <Callout tone="info" title="Only one output is baked">{`These wires wait unconnected while it's baked (Unbake puts them back): ${prep.dropped.join('; ')}`}</Callout>}
            {est && est.bytes > 4 * 1024 * 1024 && <div style={{ color: tk.text.faint, fontSize: 11.5, lineHeight: 1.5 }}>Web page exports carry videos up to 4 MB; a bigger bake shows black on an exported page (the export dialog says so). Shorter, smaller or ½ keeps it light.</div>}
          </>
        )}
        {(running || (rebake && state !== 'error')) && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)} style={{ background: tk.bg.field, borderRadius: 4, height: 8, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(pct * 100)}%`, background: tk.accent.base, borderRadius: 4, transition: 'width 0.15s linear' }} />
            </div>
            <span style={{ color: tk.text.muted, fontSize: 12 }}>
              {!progress || progress.phase === 'preparing' ? 'Getting the shader ready…' : progress.phase === 'saving' ? 'Finishing the video and keeping it in the Library…' : `Frame ${progress.done} of ${progress.total}${left !== null ? ` · about ${secs(left)} left` : ''}`}
            </span>
          </div>
        )}
        {state === 'error' && <Callout tone="danger" title="The bake didn’t finish" details={error}>{error.split('\n')[0]}</Callout>}
        {rebake && bakedNode && !stashOf(bakedNode) && <Callout tone="warning" title="Nothing to re-bake">This Baked node has no live nodes kept with it.</Callout>}
      </div>
    </Modal>
  );
}
