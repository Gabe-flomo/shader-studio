/** The Code Explorer as a dialog, opened by "How is this used?" from anywhere (explorerStore.ts). */
import { useTokens } from '../../theme/themeStore';
import { Modal } from '../ui/Modal';
import { CodeExplorerPanel } from './CodeExplorerPanel';
import { closeCodeExplorer, useCodeExplorer } from './explorerStore';

export function CodeExplorerDialog() {
  const tk = useTokens();
  const { query, n } = useCodeExplorer();
  return (
    <Modal title="Code Explorer" subtitle="How written GLSL uses a function, across your code and the examples" icon="search" iconColor={tk.accent.base} width={760} height={720} onClose={closeCodeExplorer}>
      <div style={{ height: '100%', minHeight: 0 }}>
        <CodeExplorerPanel initialQuery={query} queryKey={n} autoFocus />
      </div>
    </Modal>
  );
}

export default CodeExplorerDialog;
