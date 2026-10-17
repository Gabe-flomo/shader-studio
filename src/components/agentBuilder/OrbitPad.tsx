/**
 * OrbitPad — the Agents builder's 3D viewport under the diagrams: drag to turn the camera round, right-drag /
 * Shift+drag / two fingers to pan, scroll or pinch to come closer, double-click for the starting view
 * (docs/agent-builder.md "Turning the 3D view"). It writes Draw agents' camera (agentBuilder/cameraGestures.ts),
 * the settings the Camera card shows, so the picture is what the graph draws; a drag is one undo step.
 * The diagrams' handles sit over it and keep their own drags.
 */
import { useRef } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { endSetupBurst, setSetupParam } from '../../agentBuilder/actions';
import { type OrbitCam, orbitPatch, panPatch, readOrbitCam, resetViewPatch, zoomPatch } from '../../agentBuilder/cameraGestures';
import { useOrbitGestures } from '../builders/studio/useOrbitGestures';
import { agCamera3 } from '../../play/kit/agentPlan.js';
import { clockNow } from '../../lib/timeTick';
import type { ViewRect } from '../builders/studio/LiveViewport';

const num = (v: unknown, d: number) => (typeof v === 'number' && isFinite(v) ? v : d);

export function OrbitPad({ drawId, image }: { drawId: string; image: ViewRect }) {
  const params = () => (useNodeGraphStore.getState().nodes.find(n => n.id === drawId)?.params ?? {}) as Record<string, unknown>;
  // The camera when the drag began (each move writes from there), and its screen right and up for a pan.
  const start = useRef<{ cam: OrbitCam; right: readonly number[]; up: readonly number[]; lens: number } | null>(null);
  const write = (patch: Partial<OrbitCam>, label: string) => setSetupParam(drawId, patch, `Agent Builder: ${label}`);
  const { ref, handlers } = useOrbitGestures<HTMLDivElement>({
    begin: () => {
      const p = params();
      const c = agCamera3({ params: p, mirror: p.mirror === true }, num, clockNow() ?? 0, image.h);
      start.current = { cam: readOrbitCam(p), right: c.right, up: c.up, lens: c.lens };
    },
    end: () => { start.current = null; endSetupBurst(); },
    orbit: (dx, dy) => { if (start.current) write(orbitPatch(start.current.cam, dx, dy), 'turn the view'); },
    pan: (dx, dy) => { const s = start.current; if (s) write(panPatch(s.cam, s, dx, dy, s.lens, image.h), 'move the view'); },
    zoom: z => write(zoomPatch(readOrbitCam(params()), z), 'zoom the view'),
    // Two fingers: pan and pinch in one write (one undo step for the gesture).
    pinch: (dx, dy, ratio) => {
      const s = start.current;
      if (s) write({ ...panPatch(s.cam, s, dx, dy, s.lens, image.h), ...zoomPatch(s.cam, { ratio }) }, 'move the view');
    },
    reset: () => { endSetupBurst(); write(resetViewPatch(), 'reset the view'); endSetupBurst(); },
  });
  return (
    <div ref={ref} data-orbit-pad={drawId} {...handlers}
      title="Drag to turn the camera · right-drag or Shift+drag to pan · scroll to zoom · double-click for the starting view"
      style={{ position: 'absolute', inset: 0, touchAction: 'none', cursor: 'grab', userSelect: 'none' }} />
  );
}
