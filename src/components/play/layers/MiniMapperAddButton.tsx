/**
 * MiniMapperAddButton — a layer property's + (fields.tsx): opens the mini
 * mapper (picking "Control only" adds it outright, as the + used to do
 * alone). Its own file so fields.tsx exports no components (fast refresh).
 */
import { useRef, useState } from 'react';
import { IconButton } from '../../ui/Button';
import { MiniMapper } from '../MiniMapper';

export function MiniMapperAddButton({ exposed, label, layerLabel, layerId, propKey }: { exposed: boolean; label: string; layerLabel: string; layerId: string; propKey: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  // Once wired, `exposed` flips true while the popover may still be open showing its done state
  // (the mapping's summary, Open in Mappings) — only the closed face swaps to the plain check.
  if (exposed && !open) return <IconButton icon="check" label="Already a control (right-click for more)" size="sm" active disabled />;
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      <IconButton icon={exposed ? 'check' : 'plus'} active={exposed} label={`Map ${label} onto a source, or add it as a control (right-click for more)`} size="sm" onClick={() => setOpen(o => !o)} />
      {open && <MiniMapper anchorRef={anchor} target={{ layerId, key: propKey }} label={`${layerLabel} · ${label}`} onClose={() => setOpen(false)} />}
    </span>
  );
}
