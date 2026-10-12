/**
 * QuickControls — the 2D Scene Builder's Quick controls, under the preview (docs/scene-builder-2d.md, "Quick
 * controls"; sceneBuilder2d/quick.ts): builder sliders pinned with the pin on their row (or right-click → Add to
 * quick controls), as mini sliders that change the value live. Up / down reorders, × removes. Each is a Play
 * control on the param it builds once the scene is built (before, it waits: Build and Done attach it), and
 * Open in Play builds what isn't built and opens Play on its Controls page.
 */
import { useMemo } from 'react';
import { useSceneBuilder2D, probeEdit } from '../../sceneBuilder2d/store';
import { addPin, findTarget, movePin, pathId, pinValue, removePin, setPinValue, type QuickPin } from '../../sceneBuilder2d/quick';
import { attachQuickControls, openPlayControls, quickPinStatus } from '../../sceneBuilder2d/quickPlay';
import { findItem, itemName } from '../../sceneBuilder2d/spec';
import { scene2dBuilder } from '../../sceneBuilder2d/actions';
import { doneBuilding } from '../../builders/finish';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { QuickPinContext, type QuickPinApi, type QuickPinRequest } from '../builders/quickPinContext';
import { BuilderSlider } from '../builders/BuilderSlider';
import { BuilderNote } from '../builders/BuilderWindow';
import { Button, IconButton } from '../ui/Button';
import { toast } from '../ui/toastStore';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';

/** What a play lookup reads, when the builder tagged it (SceneBuilder2DModal play2dAny). */
type Tagged = { target?: { role: string; keys: string[] } };

/** Pins a builder slider: finds the value it sets (by trying it on a copy) and keeps it on the scene. */
export function pinSlider(req: QuickPinRequest): QuickPin | null {
  const sb = useSceneBuilder2D.getState();
  const scene = sb.scene;
  const t = findTarget(scene, v => probeEdit(() => req.onChange(v)), req);
  if (!t) {
    toast.warning('This slider can\'t be a quick control', { message: 'It sets more than one value, or none: change it where it is.' });
    return null;
  }
  const itemSeg = t.path.find((s): s is { id: string } => typeof s === 'object' && !!findItem(scene, s.id));
  const item = itemSeg ? findItem(scene, itemSeg.id)?.item : null;
  const label = item ? `${itemName(scene, item)} · ${req.label}` : req.label;
  const target = (req.lazyParam as Tagged | undefined)?.target;
  const id = pathId(t.path);
  if (scene.quick?.some(p => p.id === id)) { toast.info(`“${label}” is already a quick control`); return null; }
  const pin: QuickPin = {
    id, label, path: t.path, scale: t.scale, offset: t.offset, min: req.min, max: req.max,
    ...(req.step ? { step: req.step } : {}), ...(req.integer ? { integer: true } : {}),
    play: target ? { role: target.role, keys: [...target.keys] } : null,
  };
  sb.edit(d => { d.quick = addPin(d.quick, pin); });
  // Already built: it is a Play control now (when its node is there; else on the next Build).
  attachQuickControls([pin]);
  return pin;
}

export const QUICK_PIN_API: QuickPinApi = { pin: req => { pinSlider(req); } };

export function QuickControls() {
  const tk = useTokens();
  const pins = useSceneBuilder2D(s => s.scene.quick);
  const scene = useSceneBuilder2D(s => s.scene);
  const target = useSceneBuilder2D(s => s.targetSceneId);
  // Re-read where each one is when Play or the graph changes.
  const controls = useNodeGraphStore(s => s.play.controls);
  const graph = useNodeGraphStore(s => s.nodes);
  const status = useMemo(() => new Map((pins ?? []).map(p => [p.id, quickPinStatus(p)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores it reads
    [pins, controls, graph, target]);
  const list = pins ?? [];
  const edit = useSceneBuilder2D.getState().edit;
  const openInPlay = async () => {
    // Done builds what isn't built (and closes); then every pin is a Play control and Play opens on its controls.
    if (!(await doneBuilding(scene2dBuilder))) return;
    attachQuickControls(list);
    openPlayControls();
  };
  return (
    <div data-quick-controls style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {!list.length && <BuilderNote>Pin any slider here: the pin at the end of its row, or right-click → Add to quick controls. Each one is a Play control once the scene is built.</BuilderNote>}
      {/* The quick sliders have no pin of their own. */}
      <QuickPinContext.Provider value={null}>
        {list.map((p, i) => {
          const v = pinValue(scene, p);
          const st = status.get(p.id) ?? 'none';
          return (
            <div key={p.id} data-quick-control={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '6px 8px', borderRadius: radius.md, background: tk.bg.subtle, boxShadow: `inset 0 0 0 1px ${tk.border.subtle}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: v === null ? tk.text.faint : tk.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.label}>{p.label}</span>
                <span data-quick-status={st} title={st === 'play' ? 'A Play control' : st === 'queued' ? 'Becomes a Play control when you Build (Done builds)' : 'Built into the shader: it can\'t be a Play control'}
                  style={{ fontSize: 10.5, color: st === 'play' ? tk.accent.base : tk.text.faint, whiteSpace: 'nowrap' }}>{st === 'play' ? 'Play' : st === 'queued' ? 'on Build' : 'builder only'}</span>
                <IconButton icon="chevU" size="sm" label="Move up" disabled={i === 0} onClick={() => edit(d => { d.quick = movePin(d.quick, p.id, -1); })} data-quick-up />
                <IconButton icon="chevD" size="sm" label="Move down" disabled={i === list.length - 1} onClick={() => edit(d => { d.quick = movePin(d.quick, p.id, 1); })} data-quick-down />
                <IconButton icon="close" size="sm" label={`Remove ${p.label} from quick controls (its Play control stays)`} onClick={() => edit(d => { d.quick = removePin(d.quick, p.id); if (!d.quick.length) delete d.quick; })} data-quick-remove />
              </div>
              {v === null
                ? <span style={{ fontSize: 11.5, color: tk.text.faint }}>Its setting is gone (the shape or block was removed).</span>
                : <BuilderSlider value={v} min={p.min} max={p.max} step={p.step} integer={p.integer} ariaLabel={p.label}
                    onChange={x => edit(d => { setPinValue(d, p, x); }, `quick:${p.id}`)} />}
            </div>
          );
        })}
      </QuickPinContext.Provider>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button size="sm" icon="play" data-quick-open-play disabled={!list.length} onClick={() => void openInPlay()}
          title="Build what isn't built, make each quick control a Play control and open Play on its Controls page">Open in Play</Button>
      </div>
    </div>
  );
}
