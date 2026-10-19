/**
 * OutputButton — the preview header's way to the output window and its
 * projection mapping (docs/projection.md). A dot says the output is showing.
 * Pro: on Free it carries the Pro badge and opens the Pro sheet.
 *
 * The dialog's open state lives in a store and the dialog in OutputDialogHost (mounted once by App),
 * so the button can sit in a toolbar's "⋯" menu and close with it without closing the dialog
 * (ui/FitToolbar, docs/toolbars.md).
 */
import { create } from 'zustand';
import { Button } from '../ui/Button';
import { ProBadgeFor } from '../account/ProSheet';
import { requireFeature } from '../../lib/plan';
import { useTokens } from '../../theme/themeStore';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { ProjectionDialog as ProjectionDialogT } from './ProjectionDialog';
import { useOutput } from '../../output/outputHost';

const ProjectionDialog = lazyWithSuspense<PropsOf<typeof ProjectionDialogT>>(() => import('./ProjectionDialog').then(m => ({ default: m.ProjectionDialog })));

export const useOutputDialog = create<{ open: boolean; setOpen: (open: boolean) => void }>(set => ({ open: false, setOpen: open => set({ open }) }));

/** Opens the Output dialog (or the Pro sheet on Free). */
export function openOutputDialog() {
  if (requireFeature('play.output')) useOutputDialog.getState().setOpen(true);
}

export function OutputButton() {
  const tk = useTokens();
  const connected = useOutput(s => s.connected);
  return (
    <Button size="sm" variant="ghost" icon="grid" onClick={openOutputDialog}
      title="Output: the picture alone on a projector or second display, with projection mapping">
      Output
      {connected && <span aria-label="The output is showing" style={{ width: 7, height: 7, borderRadius: 4, background: tk.status.success }} />}
      <ProBadgeFor feature="play.output" />
    </Button>
  );
}

/** The Output dialog, wherever its button is (mounted once, beside the app's other drawers). */
export function OutputDialogHost() {
  const open = useOutputDialog(s => s.open);
  return open ? <ProjectionDialog onClose={() => useOutputDialog.getState().setOpen(false)} /> : null;
}
