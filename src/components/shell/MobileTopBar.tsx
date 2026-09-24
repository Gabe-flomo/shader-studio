import { useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useThemeStore, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { Page } from '../page';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Menu } from '../ui/Menu';
import { LoadGraphButton, SaveGraphButton } from './DesktopTopNav';
import { reportFileResult } from './reportFileResult';

/**
 * Phone top bar (Mobile board): logo (back to Studio), undo/redo, save/load, and a ⋯ menu with
 * the rest — Keys, Record, Import, Export and the theme. Grows by the status-bar inset.
 */
export function MobileTopBar({ page, onPageChange, onRecord, onClear }: {
  page: Page;
  onPageChange: (page: Page) => void;
  onRecord: () => void;
  /** Studio only: start over from a blank graph (asks first). */
  onClear?: () => void;
}) {
  const tk = useTokens();
  const mode = useThemeStore(s => s.mode);
  const toggleTheme = useThemeStore(s => s.toggle);
  const undo = useNodeGraphStore(s => s.undo);
  const redo = useNodeGraphStore(s => s.redo);
  const exportGraph = useNodeGraphStore(s => s.exportGraph);
  const importGraphFromFile = useNodeGraphStore(s => s.importGraphFromFile);
  const moreRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div style={{
      flexShrink: 0, boxSizing: 'border-box', height: 'calc(56px + env(safe-area-inset-top, 0px))',
      paddingTop: 'env(safe-area-inset-top, 0px)', paddingLeft: 'max(14px, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(10px, env(safe-area-inset-right, 0px))',
      display: 'flex', alignItems: 'center', gap: 2, background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`,
      color: tk.text.primary, font: `13px ${fontFamily.ui}`, userSelect: 'none', position: 'relative', zIndex: 30,
    }}>
      <button
        type="button"
        aria-label={page === 'studio' ? 'Shader Studio' : 'Back to the Studio'}
        onClick={() => onPageChange('studio')}
        style={{
          width: 28, height: 28, padding: 0, border: 0, borderRadius: radius.md, cursor: 'pointer',
          background: tk.ink.base, color: tk.ink.text, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name="presets" size={13} />
      </button>
      {page !== 'studio' && (
        <span style={{ marginLeft: 10, fontWeight: 650, fontSize: 15 }}>{page === 'shortcuts' ? 'Keys' : page === 'glsl' ? 'GLSL' : 'Builder'}</span>
      )}
      <span style={{ flex: 1 }} />
      <IconButton icon="undo" label="Undo" tooltip={false} onClick={undo} style={{ width: 40, height: 40 }} />
      <IconButton icon="redo" label="Redo" tooltip={false} onClick={redo} style={{ width: 40, height: 40 }} />
      <span style={{ width: 1, height: 20, background: tk.border.default, margin: '0 4px' }} />
      <SaveGraphButton />
      <LoadGraphButton />
      <span ref={moreRef} style={{ display: 'inline-flex' }}>
        <IconButton
          icon="more"
          label="More"
          tooltip={false}
          active={!!menu}
          style={{ width: 40, height: 40 }}
          onClick={() => {
            const r = moreRef.current?.getBoundingClientRect();
            setMenu(r ? { x: r.right - 220, y: r.bottom + 6 } : null);
          }}
        />
      </span>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          minWidth={220}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Record', icon: 'record', onSelect: onRecord },
            'separator',
            { label: 'Import a graph', icon: 'import', onSelect: async () => { reportFileResult(await importGraphFromFile(), { failTitle: 'Couldn’t import that file' }); } },
            { label: 'Export this graph', icon: 'export', onSelect: async () => { reportFileResult(await exportGraph(), { failTitle: 'Couldn’t export the graph', success: 'Graph exported' }); } },
            'separator',
            page === 'shortcuts'
              ? { label: 'Back to the Studio', icon: 'nodes', onSelect: () => onPageChange('studio') }
              : { label: 'Keyboard shortcuts', icon: 'hash', onSelect: () => onPageChange('shortcuts') },
            { label: mode === 'light' ? 'Dark theme' : 'Light theme', icon: mode === 'light' ? 'moon' : 'sun', onSelect: toggleTheme },
            ...(onClear ? ['separator' as const, { label: 'Clear the graph…', icon: 'trash' as const, danger: true, onSelect: onClear }] : []),
          ]}
        />
      )}
    </div>
  );
}
