import { Suspense, useRef, useState, type RefObject } from 'react';
import { lazySafe } from '../lazyWithSuspense';
import { Button, IconButton } from '../ui/Button';

// Loaded on first use: the finder pulls in the compiler and the offscreen renderer.
const SuggestControlsPanel = lazySafe(() => import('./SuggestControlsPanel'));

/**
 * "Suggest controls" beside Add control on the Play page. Given `open` and
 * `onOpenChange` it has no button of its own: a phone opens it from the
 * Controls ⋯ (Play audit P20), the panel then hanging off `anchorRef`.
 */
export function SuggestControlsButton({ compact = false, open: openGiven, onOpenChange, anchorRef }: {
  compact?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  anchorRef?: RefObject<HTMLElement | null>;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [openOwn, setOpenOwn] = useState(false);
  const controlled = openGiven !== undefined;
  const open = controlled ? openGiven : openOwn;
  const setOpen = (next: boolean) => (controlled ? onOpenChange?.(next) : setOpenOwn(next));
  const panel = open && <Suspense fallback={null}><SuggestControlsPanel anchorRef={anchorRef ?? anchor} onClose={() => setOpen(false)} /></Suspense>;
  if (controlled) return <>{panel}</>;
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      {compact
        ? <IconButton icon="spark" label="Suggest controls: the settings that change the picture most" active={open} onClick={() => setOpen(!open)} />
        : <Button size="sm" icon="spark" title="Find the settings that change the picture most, smoothly, and add them as controls" onClick={() => setOpen(!open)}>Suggest controls</Button>}
      {panel}
    </span>
  );
}
