/**
 * AppDialogs — App settings and the Nodes reference as windows over any page (appDialogStore.ts).
 * Both read the same inventory Files does, built when the window opens.
 */
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import { useViewport } from '../../lib/viewport';
import { useAppDialogs, closeAppSettings, closeNodesReference, openNodesReference } from './appDialogStore';
import type { AppSettingsWindow as AppSettingsWindowT, NodesReferenceWindow as NodesReferenceWindowT } from './AppDialogWindows';

// The windows pull in the Files views (inventory, node pages): loaded on first open.
const AppSettingsWindow = lazyWithSuspense<PropsOf<typeof AppSettingsWindowT>>(() => import('./AppDialogWindows').then(m => ({ default: m.AppSettingsWindow })));
const NodesReferenceWindow = lazyWithSuspense<PropsOf<typeof NodesReferenceWindowT>>(() => import('./AppDialogWindows').then(m => ({ default: m.NodesReferenceWindow })));

export function AppDialogs() {
  const compact = useViewport(s => s.phone);
  const settings = useAppDialogs(s => s.settings);
  const nodes = useAppDialogs(s => s.nodes);
  return (
    <>
      {settings && <AppSettingsWindow compact={compact} onClose={closeAppSettings} />}
      {nodes && <NodesReferenceWindow compact={compact} type={nodes.type} onPick={t => openNodesReference(t)} onClose={closeNodesReference} />}
    </>
  );
}
