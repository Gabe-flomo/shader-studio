/**
 * The Data node card's own lines: which dataset, its size, how it's used,
 * and the button to the editor. Everything else (import, notebook, outputs)
 * lives in the editor window; the sockets and sliders are the card's usual.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { Icon } from '../ui/Icon';
import { dataDataset, dataMode, dataUsedColumns } from '../../nodes/definitions/data';

const MODE_LABEL = { values: 'Values', points: 'Points', keyframes: 'Keyframes' } as const;

export function DataCardBody({ node, onOpen, touch = false }: { node: GraphNode; onOpen: () => void; touch?: boolean }) {
  const tk = useTokens();
  const id = dataDataset(node);
  const ds = useNodeGraphStore(s => (id ? s.datasets[id] : undefined));
  const r = ds?.result;
  const missing = r?.kind === 'table' ? dataUsedColumns(node).filter(c => !r.columns.some(x => x.name === c)) : [];
  const detail = !id ? 'No data yet'
    : !ds ? 'Its dataset is missing from this graph'
    : !r ? 'Not run yet'
    : r.kind === 'table' ? `${r.rows.toLocaleString()} rows · ${r.columns.length} columns${ds.normalize ? ' · 0–1' : ''}`
    : r.kind === 'text' ? 'Text: split it into rows in the notebook'
    : 'JSON value: make records in the notebook';
  return (
    <div style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <button type="button" onClick={onOpen} title="Open the data editor: import, notebook, outputs"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: touch ? '10px 10px' : '8px 10px', border: 0, borderRadius: radius.md,
          background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', textAlign: 'left', font: `12.5px ${fontFamily.ui}`,
        }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
          <Icon name="grid" size={15} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds ? ds.name : id ? id : 'Choose data…'}</b>
          <span style={{ fontSize: 11.5, color: !ds && id ? tk.status.danger : tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
        </span>
        {ds && <span style={{ flexShrink: 0, font: `600 10.5px ${fontFamily.ui}`, color: tk.text.faint, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{MODE_LABEL[dataMode(node)]}</span>}
        <Icon name="chevR" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      </button>
      {missing.length > 0 && (
        <span style={{ fontSize: 11.5, lineHeight: 1.4, color: tk.status.danger }}>
          Not in the data any more: {missing.join(', ')} (read as 0).
        </span>
      )}
    </div>
  );
}
