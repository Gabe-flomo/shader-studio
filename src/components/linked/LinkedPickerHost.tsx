/**
 * LinkedPickerHost — renders the linked-folder pickers openLinkedPicker asks
 * for (linkedUi.ts), stacked. Mounted once, next to the BackgroundsHost; the
 * window's code loads on first use.
 */
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import type { LinkedPickerWindow as LinkedPickerWindowT } from './LinkedPickerWindow';
import { closeLinkedPicker, useLinkedPickerUi } from './linkedUi';

const LinkedPickerWindow = lazyWithSuspense<PropsOf<typeof LinkedPickerWindowT>>(() => import('./LinkedPickerWindow').then(m => ({ default: m.LinkedPickerWindow })));

export function LinkedPickerHost() {
  const stack = useLinkedPickerUi(s => s.stack);
  return <>{stack.map(r => <LinkedPickerWindow key={r.key} req={r} onDone={p => { closeLinkedPicker(r.key); r.resolve(p); }} />)}</>;
}
