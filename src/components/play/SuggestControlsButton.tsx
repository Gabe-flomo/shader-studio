import { lazy, Suspense, useRef, useState } from 'react';
import { Button, IconButton } from '../ui/Button';

// Loaded on first use: the finder pulls in the compiler and the offscreen renderer.
const SuggestControlsPanel = lazy(() => import('./SuggestControlsPanel'));

/** "Suggest controls" beside Add control on the Play page. */
export function SuggestControlsButton({ compact = false }: { compact?: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span ref={anchor} style={{ display: 'inline-flex' }}>
      {compact
        ? <IconButton icon="spark" label="Suggest controls: the settings that change the picture most" active={open} onClick={() => setOpen(o => !o)} />
        : <Button size="sm" icon="spark" title="Find the settings that change the picture most, smoothly, and add them as controls" onClick={() => setOpen(o => !o)}>Suggest controls</Button>}
      {open && <Suspense fallback={null}><SuggestControlsPanel anchorRef={anchor} onClose={() => setOpen(false)} /></Suspense>}
    </span>
  );
}
