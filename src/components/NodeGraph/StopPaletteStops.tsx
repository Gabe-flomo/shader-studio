/**
 * StopPaletteStops — the Stops Palette card's colours as one gradient bar with
 * the stops built in (ui/GradientStopsEditor.tsx), in place of the Stops count
 * and a swatch row per stop: a palette of 32 colours is as tall as one of 3.
 * Click the bar to add a stop, drag to reorder, click a handle for its colour.
 *
 * Writes the same params the old rows did (stopPaletteModel.ts), so saves,
 * undo and the shader are untouched. Only the store's updater is subscribed.
 */
import { useRef } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { STOP_PALETTE_MAX } from '../../nodes/definitions/color';
import { GradientStopsEditor } from '../ui/GradientStopsEditor';
import { stopParamsOf, stopsOfNode } from './stopPaletteModel';

export function StopPaletteStops({ node, touch }: { node: GraphNode; touch: boolean }) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const cardRef = useRef<HTMLElement | null>(null);
  const stops = stopsOfNode(node);
  const style = node.params.blend === 'bands' ? 'bands' : 'gradient';
  return (
    <div
      ref={el => { cardRef.current = el?.closest<HTMLElement>('[data-node-id]') ?? null; }}
      style={{ padding: '6px 12px 2px 16px' }}
      onMouseDown={e => e.stopPropagation()}
    >
      <GradientStopsEditor
        stops={stops} max={STOP_PALETTE_MAX} style={style} fixedSpacing touch={touch} clearRef={cardRef}
        onChange={next => updateNodeParams(node.id, stopParamsOf(next), { immediate: true })}
      />
    </div>
  );
}
