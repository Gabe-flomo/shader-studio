/**
 * LayerContextMenu — right-click a layer on the picture: open it in the
 * Layers tab, duplicate, reset, restack, hide or delete it, plus a quick
 * action or two for its kind.
 */
import { useEffect, useState } from 'react';
import { playOverlay } from '../../play/overlay';
import type { PlayLayer, PlayRecord } from '../../types/play';
import { Menu } from '../ui/Menu';
import { duplicateLayer, layerMenuItems, moveLayer, removeLayer, resetLayer } from './layerOps';
import { usePlayUi } from './playUi';

export function LayerContextMenu({ play, onChange }: { play: PlayRecord; onChange: (fn: (p: PlayRecord) => PlayRecord) => void }) {
  const [at, setAt] = useState<{ layerId: string; x: number; y: number } | null>(null);
  const reveal = usePlayUi(s => s.reveal);
  useEffect(() => playOverlay.onContextMenu(m => setAt(m)), []);
  const l = at ? play.layers.find(x => x.id === at.layerId) : undefined;
  if (!at || !l) return null;
  const id = l.id, i = play.layers.indexOf(l);
  const patch = (p: Record<string, unknown>) => onChange(r => ({ ...r, layers: r.layers.map(x => (x.id === id ? ({ ...x, ...p } as PlayLayer) : x)) }));
  const quick: Array<{ label: string; hint?: string; onSelect: () => void }> = [];
  if (l.kind === 'null') quick.push(l.follow === 'mouse' ? { label: 'Stop following the mouse', onSelect: () => patch({ follow: 'none' }) } : { label: 'Follow the mouse', hint: 'On a spring', onSelect: () => patch({ follow: 'mouse' }) });
  if (l.kind === 'shape') quick.push(l.show ? { label: 'Make it invisible', hint: 'Still acts on particles', onSelect: () => patch({ show: false }) } : { label: 'Show it', onSelect: () => patch({ show: true }) });
  if (l.kind === 'text' && l.sequence) quick.push({ label: 'Next line', onSelect: () => playOverlay.act({ do: 'next', layerId: id, amount: 1 }) });
  if (l.kind === 'text' || l.kind === 'image' || l.kind === 'shape') quick.push({ label: 'Straighten', hint: 'Rotation 0°', onSelect: () => patch({ rotation: 0 }) });
  return (
    <Menu
      x={at.x}
      y={at.y}
      minWidth={230}
      onClose={() => setAt(null)}
      items={[
        { label: `Edit “${l.label}”`, hint: 'In the Layers tab', onSelect: () => reveal(id) },
        ...quick,
        { label: 'Bring forward', hint: 'Drawn later, on top', disabled: i === play.layers.length - 1, onSelect: () => onChange(p => moveLayer(p, id, 1)) },
        { label: 'Send backward', disabled: i === 0, onSelect: () => onChange(p => moveLayer(p, id, -1)) },
        { label: 'Hide', hint: 'Its switch in the Layers tab brings it back', onSelect: () => patch({ visible: false }) },
        ...layerMenuItems({
          onDuplicate: () => { let made = ''; onChange(p => { const r = duplicateLayer(p, id); made = r.id; return r.play; }); if (made) reveal(made); },
          onReset: () => onChange(p => resetLayer(p, id)),
          onRemove: () => onChange(p => removeLayer(p, id)),
        }),
      ]}
    />
  );
}
