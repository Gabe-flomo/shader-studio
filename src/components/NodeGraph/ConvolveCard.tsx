/**
 * Convolve's card body (nodes/definitions/convolve.ts, docs/convolve.md): where its neighbours come from, and the
 * kernel as a grid of numbers. On Custom every cell is a box to type a weight into (a live uniform: no recompile).
 * On a preset the grid shows the preset's weights; typing into one copies them to Custom with that cell changed.
 */
import type React from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore, getActiveNodes } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { CONVOLVE_PRESET_LABELS, convolveKernel, convolveSourceNote, kernelCells, kernelKey, kernelSizeOf, presetOf } from '../../nodes/definitions/convolve';
import { NumberInput } from './NumberInput';

const fmt = (w: number) => {
  if (Math.abs(w) < 5e-4) return '0';
  const r = Math.round(w * 1000) / 1000;
  return String(r);
};

export function ConvolveCard({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const note = useNodeGraphStore(s => {
    const path = s.activeGroupPath;
    const here = (path.length ? getActiveNodes(s.nodes, path) : s.nodes) ?? s.nodes;
    return convolveSourceNote(here.find(n => n.id === node.id) ?? node, here, getNodeDefinitionFor);
  });
  const preset = presetOf(node.params.preset);
  const size = kernelSizeOf(node.params.size);
  const kernel = convolveKernel(node.params);
  const cells = kernelCells(size);
  const custom = preset === 'custom';
  const sum = cells.reduce((s, i) => s + kernel[i], 0);

  const commit = (i: number, value: number) => {
    if (custom) { updateNodeParams(node.id, { [kernelKey(i)]: value }, { immediate: true }); return; }
    // From a preset: its weights become Custom's, with this cell changed (a recompile, once).
    const patch: Record<string, unknown> = { preset: 'custom', normalize: false };
    for (let k = 0; k < 25; k++) patch[kernelKey(k)] = Math.round(kernel[k] * 1e6) / 1e6;
    patch[kernelKey(i)] = value;
    updateNodeParams(node.id, patch, { immediate: true });
  };

  const cellStyle: React.CSSProperties = {
    width: '100%', padding: '2px 2px', background: custom ? tk.bg.field : 'transparent',
    border: `1px solid ${tk.border.subtle}`, borderRadius: 3,
    color: custom ? tk.text.primary : tk.text.secondary, fontSize: 11, textAlign: 'center',
    outline: 'none', boxSizing: 'border-box', fontFamily: 'monospace',
  };
  return (
    <div onMouseDown={e => e.stopPropagation()} style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 5 }} data-convolve-card>
      <span style={{ color: tk.text.secondary, fontSize: 12 }}>
        Kernel{custom ? '' : ` (${CONVOLVE_PRESET_LABELS[preset]}: type a number to edit it as Custom)`}
      </span>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${size}, 1fr)`, gap: 3 }}>
        {cells.map(i => (
          <NumberInput
            key={i}
            step={0.1}
            value={kernel[i]}
            format={fmt}
            title={`Weight of the read ${i === 12 ? 'here' : 'at this neighbour'}`}
            onCommit={v => commit(i, v)}
            style={{ ...cellStyle, ...(i === 12 ? { fontWeight: 600 } : {}) }}
          />
        ))}
      </div>
      <span style={{ color: tk.text.faint, fontSize: 11 }}>Weights add up to {fmt(sum)}.</span>
      <span style={{ color: tk.text.faint, fontSize: 11, lineHeight: 1.4 }}>{note}</span>
    </div>
  );
}
