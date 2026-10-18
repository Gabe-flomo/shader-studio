/**
 * The windows behind AppDialogs.tsx: App settings and the Nodes reference, each the Files view it
 * used to be (AppSettingsView, NodesListView and NodePage) in a Modal over any page.
 */
import { APP_SETTINGS_ID } from '../../files/inventory';
import { getNodeDefinition } from '../../nodes/definitions';
import { useTokens } from '../../theme/themeStore';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { useEffect } from 'react';
import { NAVIGATE_EVENT, requestPage } from '../page';
import { useFilesInventory } from '../files/useFilesInventory';
import { AppSettingsView } from '../files/AppSettingsView';
import { NodesListView } from '../files/NodesListView';
import { NodePage } from '../files/NodePage';

function Loading() {
  const tk = useTokens();
  return <div style={{ padding: '28px 24px', color: tk.text.faint, fontSize: 12.5 }}>Reading what’s saved…</div>;
}

/** A page switch from inside the window (its Keyboard shortcuts button, say) closes it. */
function useCloseOnNavigate(onClose: () => void) {
  useEffect(() => {
    window.addEventListener(NAVIGATE_EVENT, onClose);
    return () => window.removeEventListener(NAVIGATE_EVENT, onClose);
  }, [onClose]);
}

export function AppSettingsWindow({ compact = false, onClose }: { compact?: boolean; onClose: () => void }) {
  const { inv } = useFilesInventory();
  useCloseOnNavigate(onClose);
  const node = inv?.byId.get(APP_SETTINGS_ID) ?? null;
  return (
    <Modal title="App settings" icon="sliders" onClose={onClose} width={compact ? 420 : 900}>
      <div data-app-settings="" style={{ maxHeight: 'min(72vh, 760px)', overflow: 'auto' }}>
        {inv && node ? <AppSettingsView inv={inv} node={node} compact={compact} /> : <Loading />}
      </div>
    </Modal>
  );
}

export function NodesReferenceWindow({ compact = false, type, onPick, onClose }: {
  compact?: boolean;
  /** The node type whose page is shown; null: the list. */
  type: string | null;
  onPick: (type: string | null) => void;
  onClose: () => void;
}) {
  const { inv } = useFilesInventory();
  const label = type ? getNodeDefinition(type)?.label ?? type : null;
  return (
    <Modal
      title={label ?? 'Nodes reference'}
      subtitle={label ? 'Its sockets, a live picture, its GLSL and the graphs that use it' : 'Every node type: what it does, its sockets, a live picture, its GLSL'}
      icon="nodes"
      onClose={onClose}
      width={compact ? 420 : 980}
      headerActions={type ? <Button size="sm" icon="chevL" onClick={() => onPick(null)}>All nodes</Button> : undefined}
    >
      <div data-nodes-reference="" style={{ maxHeight: 'min(74vh, 800px)', overflow: 'auto' }}>
        {type
          ? (inv ? <NodePage type={type} compact={compact} inv={inv} onOpen={() => { onClose(); requestPage('files'); }} onNavigate={p => { onClose(); requestPage(p); }} /> : <Loading />)
          : <NodesListView compact={compact} onOpenNode={t => onPick(t)} />}
      </div>
    </Modal>
  );
}
