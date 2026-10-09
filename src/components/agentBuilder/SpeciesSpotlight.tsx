/**
 * The picked kind of walker, lit in the viewport (docs/agent-builder.md): the live picture dimmed,
 * and over it only that kind's walkers as bright dots in its colour. The agent runner draws them
 * (lib/agentRunner.ts drawSpotlights: the live state, read back without a stall, every other
 * frame) into a canvas registered here; in 3D through the group's Draw agents camera.
 */
import { useEffect, useRef, useState } from 'react';
import { agentSpotRegistry } from '../../lib/agentRunner';
import type { ViewRect } from '../builders/studio/LiveViewport';
import { fontFamily } from '../../theme/tokens';

export function SpeciesSpotlight({ groupId, species, colour, name, image, onClose }: {
  groupId: string; species: number; colour: [number, number, number]; name: string; image: ViewRect; onClose: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<string>('none');
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    agentSpotRegistry.register(groupId, c);
    // The runner marks the canvas once it has drawn ('live'), or 'flat' when it can't place the walkers.
    const t = setInterval(() => setState(c.dataset.spot ?? 'none'), 400);
    return () => { clearInterval(t); agentSpotRegistry.unregister(groupId); };
  }, [groupId]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.dataset.species = String(species);
    c.dataset.colour = colour.join(',');
  }, [species, colour]);
  return (
    <div data-spotlight={species} data-spotlight-state={state} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(8,8,12,0.62)' }} />
      <canvas ref={ref} width={640} height={360} style={{ position: 'absolute', left: image.x, top: image.y, width: image.w, height: image.h, mixBlendMode: 'screen' }} />
      <button type="button" data-spotlight-close onClick={onClose} title="Show every kind again"
        style={{ position: 'absolute', left: 12, top: 12, pointerEvents: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, height: 26, padding: '0 10px', border: 0, borderRadius: 13, cursor: 'pointer',
          background: 'rgba(13,13,18,0.82)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.18)', font: `600 11.5px ${fontFamily.ui}` }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: `rgb(${colour.map(v => Math.round(v * 255)).join(',')})` }} />
        {state === 'flat' ? `${name}: can't be lit here (no 3D Draw agents)` : `Showing ${name} only`}
        <span style={{ opacity: 0.6 }}>×</span>
      </button>
    </div>
  );
}
