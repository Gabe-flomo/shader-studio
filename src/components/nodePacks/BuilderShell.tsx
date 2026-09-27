/**
 * The Builder: the Function Builder and the node pack workspace under one
 * header. Drawn in the Builder page (docked) or in the floating window
 * (popped out); both read the same stores, so it's one builder either way.
 *
 *   BuilderPage   the page: the builder with a "Pop out" button, or, while
 *                 it's popped out, a note saying where it went and "Dock"
 *   BuilderShell  the header (tabs, actions) and the body
 */
import type { ReactNode } from 'react';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Segmented } from '../ui/Choice';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
import { dockBuilder, popOutBuilder, setBuilderTab, useBuilderWindow, type BuilderTab } from './builderWindow';
import type { FunctionBuilder as FunctionBuilderT } from '../FunctionBuilder/FunctionBuilder';
import type { PackWorkspace as PackWorkspaceT } from './PackWorkspace';

const FunctionBuilder = lazyWithSuspense<PropsOf<typeof FunctionBuilderT>>(() => import('../FunctionBuilder/FunctionBuilder').then(m => ({ default: m.FunctionBuilder })));
const PackWorkspace = lazyWithSuspense<PropsOf<typeof PackWorkspaceT>>(() => import('./PackWorkspace').then(m => ({ default: m.PackWorkspace })));

export function BuilderShell({ actions, onNavigateToStudio, compact = false }: {
  /** The header's right side: "Pop out" in the page, the window's own buttons in the window. */
  actions?: ReactNode;
  onNavigateToStudio?: () => void;
  compact?: boolean;
}) {
  const tk = useTokens();
  const tab = useBuilderWindow(s => s.tab);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden', background: tk.bg.panel, color: tk.text.primary, fontFamily: fontFamily.ui }}>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '0 8px' : '0 10px 0 12px', borderBottom: `1px solid ${tk.border.default}` }}>
        <Segmented<BuilderTab> size="sm" ariaLabel="Builder" value={tab} onChange={setBuilderTab}
          options={[{ value: 'functions', label: 'Functions' }, { value: 'packs', label: 'Node packs' }]} />
        <span style={{ flex: 1 }} />
        {actions}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {tab === 'functions'
          ? <FunctionBuilder onNavigateToStudio={onNavigateToStudio} />
          : <PackWorkspace />}
      </div>
    </div>
  );
}

/** The Builder page. */
export function BuilderPage({ onNavigateToStudio }: { onNavigateToStudio?: () => void }) {
  const tk = useTokens();
  const popped = useBuilderWindow(s => s.popped);
  if (popped) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: tk.bg.subtle }}>
        <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', padding: 24, borderRadius: radius.modal, background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
          <span style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.field, color: tk.text.secondary }}><Icon name="popout" size={20} /></span>
          <b style={{ fontSize: 15 }}>The builder is in its own window</b>
          <span style={{ fontSize: 12.5, color: tk.text.muted, lineHeight: 1.5 }}>It floats over every page, so you can build nodes next to the graph that uses them. Dock it to bring it back here.</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <Button icon="panelLeft" variant="primary" onClick={dockBuilder}>Dock</Button>
            <Button onClick={() => popOutBuilder()}>Show the window</Button>
          </span>
        </div>
      </div>
    );
  }
  return (
    <BuilderShell onNavigateToStudio={onNavigateToStudio}
      actions={<Button size="sm" icon="popout" title="Open the builder in a window that floats over every page" onClick={() => popOutBuilder()}>Pop out</Button>} />
  );
}
