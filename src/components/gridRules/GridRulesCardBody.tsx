/**
 * The Grid Rules card's own lines: the rule in one line (opens the editor), a few presets of the
 * rule's type, and Open as nodes. The card's sliders (Speed, Reset, the brush) are its usual
 * param rows; everything else is in the editor window (GridRulesEditor).
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { Icon } from '../ui/Icon';
import { BOARD_SIZES, COUNT_PRESETS, GRID_DEFAULTS, SMOOTH_PRESETS, STAGES_PRESETS, gridShape, matchingPreset, presetPatch, ruleSummary } from '../../gridRules/spec';
import { gridAsNodesProblem } from '../../store/gridRulesAsNodes';

const QUICK: Record<string, string[]> = { count: ['life', 'highLife', 'dayNight', 'maze'], stages: ['briansBrain', 'starWars', 'sticks'], smooth: ['heat', 'ripples', 'mitosis'] };

export function GridRulesCardBody({ node, onOpen, touch = false }: { node: GraphNode; onOpen: () => void; touch?: boolean }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const openAsNodes = useNodeGraphStore(s => s.openGridRulesAsNodes);
  const P = { ...GRID_DEFAULTS, ...node.params };
  const s = gridShape(P);
  const table = s.type === 'stages' ? STAGES_PRESETS : s.type === 'smooth' ? SMOOTH_PRESETS : COUNT_PRESETS;
  const current = matchingPreset(P);
  const board = BOARD_SIZES.find(b => b.scale === s.scale)?.label.split(' (')[0] ?? '';
  const problem = gridAsNodesProblem(node);
  return (
    <div style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 7 }} onMouseDown={e => e.stopPropagation()}>
      <button type="button" onClick={onOpen} title="Open the Grid Rules editor: the rule, the start, the brush, the colours"
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: touch ? '10px 10px' : '8px 10px', border: 0, borderRadius: radius.md,
          background: tk.bg.field, color: tk.text.primary, cursor: 'pointer', textAlign: 'left', font: `12.5px ${fontFamily.ui}`,
        }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: alpha(tk.accent.base, 0.12), color: tk.accent.base }}>
          <Icon name="grid" size={15} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, flex: 1 }}>
          <b style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? table[current].label : ruleSummary(P)}</b>
          <span style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? `${ruleSummary(P)} · ` : ''}{board} board</span>
        </span>
        <Icon name="chevR" size={14} style={{ color: tk.text.faint, flexShrink: 0 }} />
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
        {(QUICK[s.type] ?? []).map(k => (
          <button key={k} type="button" title={table[k].hint} aria-pressed={k === current} onClick={() => updateNodeParams(node.id, presetPatch(table[k]), { immediate: true })}
            style={{
              border: 0, cursor: 'pointer', padding: '3px 8px', borderRadius: radius.md, font: `500 11.5px ${fontFamily.ui}`,
              background: k === current ? tk.bg.selected : tk.bg.field, color: k === current ? tk.accent.text : tk.text.primary,
              boxShadow: `inset 0 0 0 1px ${k === current ? tk.accent.base : tk.border.subtle}`,
            }}>
            {table[k].label}
          </button>
        ))}
      </div>
      <button type="button" disabled={!!problem}
        title={problem ?? 'Builds the same simulation from ordinary nodes under this one (a Pass that reads its Previous, Sample reads, the rule as Expression Blocks), every node with a note, and wires it where this node was. This node is left as it is.'}
        onClick={() => openAsNodes(node.id)}
        style={{
          alignSelf: 'flex-start', border: 0, cursor: problem ? 'default' : 'pointer', padding: '4px 9px', borderRadius: radius.md, background: 'transparent',
          color: problem ? tk.text.disabled : tk.accent.base, font: `500 11.5px ${fontFamily.ui}`, boxShadow: `inset 0 0 0 1px ${tk.border.default}`,
        }}>
        Open as nodes ↗
      </button>
    </div>
  );
}
