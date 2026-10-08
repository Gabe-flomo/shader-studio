/**
 * The Code Explorer as a dialog, opened by "How is this used?" from anywhere (explorerStore.ts).
 * Two views: Code (how written GLSL uses a function) and Patterns (multi-node techniques, lazy).
 */
import { lazy, Suspense } from 'react';
import { useTokens } from '../../theme/themeStore';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Choice';
import { CodeExplorerPanel } from './CodeExplorerPanel';
import { closeCodeExplorer, setExplorerTab, useCodeExplorer, type ExplorerTab } from './explorerStore';

const PatternsPanel = lazy(() => import('./PatternsPanel'));

export function CodeExplorerDialog() {
  const tk = useTokens();
  const query = useCodeExplorer(s => s.query);
  const n = useCodeExplorer(s => s.n);
  const tab = useCodeExplorer(s => s.tab);
  const patternNode = useCodeExplorer(s => s.patternNode);
  return (
    <Modal title="Code Explorer" subtitle={tab === 'patterns' ? 'Multi-node techniques across the examples and your graphs' : 'How written GLSL uses a function, across your code and the examples'} icon="search" iconColor={tk.accent.base} width={760} height={720} onClose={closeCodeExplorer}>
      <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 16px 0', background: tk.bg.panel }}>
          <Segmented<ExplorerTab> size="sm" ariaLabel="Explorer view" value={tab} onChange={setExplorerTab} options={[{ value: 'code', label: 'Code' }, { value: 'patterns', label: 'Patterns' }]} />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          {tab === 'code'
            ? <CodeExplorerPanel initialQuery={query} queryKey={n} autoFocus />
            : <Suspense fallback={null}><PatternsPanel patternNode={patternNode} /></Suspense>}
        </div>
      </div>
    </Modal>
  );
}

export default CodeExplorerDialog;
