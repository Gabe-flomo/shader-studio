/**
 * CodeTabs — the Code page's tab strip (docs/glossary.md): Shader · Convert · Functions · Node
 * packs. Shader and Convert are the old GLSL and Convert pages; Functions and Node packs are the
 * old Builder page's two tabs (the builder keeps its own tab state, so popping it out still works).
 * On a phone Functions and Node packs open the builder full screen, as before.
 */
import { useTokens } from '../../theme/themeStore';
import { fontFamily } from '../../theme/tokens';
import { useCan } from '../../lib/plan';
import { CODE_TABS, type CodeTab, type Page } from '../page';
import { Segmented } from '../ui/Choice';
import { useBuilderWindow } from '../nodePacks/builderWindow';
import { codeTabOf, openCodeTab } from './codeTabNav';

export function CodeTabs({ page, onPageChange, phone = false }: { page: Page; onPageChange: (p: Page) => void; phone?: boolean }) {
  const tk = useTokens();
  const builderTab = useBuilderWindow(s => s.tab);
  const convertOk = useCan('convert');
  const current = codeTabOf(page, builderTab) ?? 'shader';
  return (
    <div data-code-tabs="" style={{
      flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, height: phone ? 46 : 42, padding: phone ? '0 10px' : '0 14px 0 18px', boxSizing: 'border-box',
      background: tk.bg.panel, borderBottom: `1px solid ${tk.border.default}`, font: `12.5px ${fontFamily.ui}`, minWidth: 0,
    }}>
      {!phone && <span style={{ font: `650 13px ${fontFamily.ui}`, color: tk.text.primary, flexShrink: 0 }}>Code</span>}
      <div style={{ minWidth: 0, flex: phone ? 1 : '0 1 auto' }}>
        <Segmented<CodeTab>
          size="sm"
          fill={phone}
          ariaLabel="Code"
          value={current}
          onChange={t => openCodeTab(t, onPageChange, phone)}
          options={CODE_TABS.map(t => ({ value: t.id, label: t.id === 'convert' && !convertOk ? `${t.label} · Pro` : t.label, title: t.hint }))}
        />
      </div>
    </div>
  );
}
