/**
 * InputsBoard — controls and sources on one page (implementation guide 7.1):
 * the controls column (each slider with what drives it) beside the sources
 * column (each source card with its routes). Map on a source card, then
 * click controls. Below WIDE_PANEL_PX the two columns are tabs.
 */
import { useState, type ReactNode } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { Segmented } from '../../ui/Choice';
import { useMapMode } from './mapMode';

export function InputsBoard({ wide, controls, sources, counts }: { wide: boolean; controls: ReactNode; sources: ReactNode; counts: { controls: number; sources: number } }) {
  const tk = useTokens();
  const [tab, setTab] = useState<'controls' | 'sources'>('controls');
  // Mapping on a phone: the controls are what to click.
  const mapping = useMapMode(m => m.sourceId !== null);
  if (!wide) {
    const shown = mapping ? 'controls' : tab;
    return (
      <div data-inputs-board="tabs" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '8px 12px 4px', flexShrink: 0 }}>
          <Segmented fill size="sm" ariaLabel="Inputs" value={shown} onChange={setTab} options={[
            { value: 'controls', label: `Controls${counts.controls ? ` · ${counts.controls}` : ''}` },
            { value: 'sources', label: `Sources${counts.sources ? ` · ${counts.sources}` : ''}` },
          ]} />
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{shown === 'controls' ? controls : sources}</div>
      </div>
    );
  }
  return (
    <div data-inputs-board="columns" style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div data-column="controls" style={{ flex: '1.3 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', borderRight: `1px solid ${tk.border.default}` }}>{controls}</div>
      <div data-column="sources" style={{ flex: '1 1 0', minWidth: 340, maxWidth: 560, display: 'flex', flexDirection: 'column', background: tk.bg.subtle }}>{sources}</div>
    </div>
  );
}
