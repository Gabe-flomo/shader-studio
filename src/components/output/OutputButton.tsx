/**
 * OutputButton — the preview header's way to the output window and its
 * projection mapping (docs/projection.md). A dot says the output is showing.
 * Pro: on Free it carries the Pro badge and opens the Pro sheet.
 */
import { useState } from 'react';
import { Button } from '../ui/Button';
import { ProBadgeFor } from '../account/ProSheet';
import { requireFeature } from '../../lib/plan';
import { useTokens } from '../../theme/themeStore';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { ProjectionDialog as ProjectionDialogT } from './ProjectionDialog';
import { useOutput } from '../../output/outputHost';

const ProjectionDialog = lazyWithSuspense<PropsOf<typeof ProjectionDialogT>>(() => import('./ProjectionDialog').then(m => ({ default: m.ProjectionDialog })));

export function OutputButton() {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const connected = useOutput(s => s.connected);
  return (
    <>
      <Button size="sm" variant="ghost" icon="grid" onClick={() => { if (requireFeature('play.output')) setOpen(true); }}
        title="Output: the picture alone on a projector or second display, with projection mapping">
        Output
        {connected && <span aria-label="The output is showing" style={{ width: 7, height: 7, borderRadius: 4, background: tk.status.success }} />}
        <ProBadgeFor feature="play.output" />
      </Button>
      {open && <ProjectionDialog onClose={() => setOpen(false)} />}
    </>
  );
}
