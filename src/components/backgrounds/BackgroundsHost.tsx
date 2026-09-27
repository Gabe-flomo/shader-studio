/**
 * BackgroundsHost — renders the windows backgroundsUi.ts opens (the capture
 * window, the backgrounds library), stacked: the library can open a capture
 * on top of itself. Their code loads on first use.
 */
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { CaptureDialog as CaptureDialogT } from './CaptureDialog';
import type { BackgroundsDialog as BackgroundsDialogT } from './BackgroundsDialog';
import { closeBackgroundsWindow, useBackgroundsUi } from './backgroundsUi';

const CaptureDialog = lazyWithSuspense<PropsOf<typeof CaptureDialogT>>(() => import('./CaptureDialog').then(m => ({ default: m.CaptureDialog })));
const BackgroundsDialog = lazyWithSuspense<PropsOf<typeof BackgroundsDialogT>>(() => import('./BackgroundsDialog').then(m => ({ default: m.BackgroundsDialog })));

export function BackgroundsHost() {
  const stack = useBackgroundsUi(s => s.stack);
  return (
    <>
      {stack.map(r => r.kind === 'capture'
        ? <CaptureDialog key={r.key} aspect={r.aspect} size={r.size} from={r.from} onDone={id => { closeBackgroundsWindow(r.key); r.resolve(id); }} />
        : <BackgroundsDialog key={r.key} pick={r.pick} title={r.title} onDone={p => { closeBackgroundsWindow(r.key); r.resolve(p); }} />)}
    </>
  );
}
