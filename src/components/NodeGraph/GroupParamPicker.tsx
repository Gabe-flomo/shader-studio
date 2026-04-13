/**
 * GroupParamPicker — in-graph overlay for customising which params from
 * nested inner-group nodes are surfaced on the outer group card.
 *
 * Opens when the user clicks the "⊕ params" button on an outer group card.
 * Shows every float param from every inner-group node, grouped by inner group,
 * with checkboxes.  Already-automated params (ps_ socket wired) are shown
 * greyed-out and cannot be toggled.  The selection persists in
 * node.params.surfacedParams.
 */
import { useCallback } from 'react';
import type { SurfacedParam, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';

interface Props {
  /** The outer group node whose surfaced params we are editing */
  outerNode: GraphNode;
  /** Called when the user clicks outside or hits Escape to close */
  onClose: () => void;
}

export function GroupParamPicker({ outerNode, onClose }: Props) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const subgraph = outerNode.params.subgraph as SubgraphData | undefined;
  const currentSurfaced: SurfacedParam[] = Array.isArray(outerNode.params.surfacedParams)
    ? (outerNode.params.surfacedParams as SurfacedParam[])
    : [];

  const isSurfaced = useCallback(
    (innerGroupId: string, nodeId: string, paramKey: string) =>
      currentSurfaced.some(
        sp => sp.innerGroupId === innerGroupId && sp.nodeId === nodeId && sp.paramKey === paramKey,
      ),
    [currentSurfaced],
  );

  const toggle = useCallback(
    (innerGroupId: string, nodeId: string, paramKey: string, label: string) => {
      const already = isSurfaced(innerGroupId, nodeId, paramKey);
      let next: SurfacedParam[];
      if (already) {
        next = currentSurfaced.filter(
          sp => !(sp.innerGroupId === innerGroupId && sp.nodeId === nodeId && sp.paramKey === paramKey),
        );
      } else {
        next = [...currentSurfaced, { innerGroupId, nodeId, paramKey, label }];
      }
      updateNodeParams(outerNode.id, { surfacedParams: next });
    },
    [currentSurfaced, isSurfaced, outerNode.id, updateNodeParams],
  );

  if (!subgraph) return null;

  const innerGroups = subgraph.nodes.filter(n => n.type === 'group');
  if (innerGroups.length === 0) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 999 }}
        onMouseDown={e => { e.stopPropagation(); onClose(); }}
      />
      {/* Panel */}
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 1000,
          background: '#181825',
          border: '1px solid #45475a',
          borderRadius: '6px',
          minWidth: '220px',
          maxWidth: '280px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
          padding: '8px 0 6px',
          fontSize: '11px',
          color: '#cdd6f4',
        }}
      >
        <div style={{ padding: '0 10px 6px', fontSize: '10px', color: '#585b70', letterSpacing: '0.08em', borderBottom: '1px solid #313244' }}>
          SURFACE PARAMS
        </div>

        {innerGroups.map(innerGroup => {
          const innerSub = innerGroup.params.subgraph as SubgraphData | undefined;
          const innerLabel = typeof innerGroup.params.label === 'string' ? innerGroup.params.label : 'Inner Group';
          if (!innerSub) return null;

          type Row = { nodeId: string; nodeLabel: string; paramKey: string; paramLabel: string; wired: boolean };
          const rows: Row[] = [];

          for (const inn of innerSub.nodes) {
            if (inn.type === 'loopIndex' || inn.type === 'loopCarry') continue;
            const innDef = getNodeDefinition(inn.type);
            if (!innDef?.paramDefs) continue;
            const innLabel = typeof inn.params.label === 'string' ? inn.params.label : (innDef.label ?? inn.type);

            for (const [paramKey, paramDef] of Object.entries(innDef.paramDefs)) {
              if (paramDef.type !== 'float' || paramDef.step === 1) continue;
              // Check if the outer group has a ps_ socket wired for this inner-group node
              const psKey = `ps_${innerGroup.id}_${inn.id}_${paramKey}`;
              const wired = !!(outerNode.inputs[psKey]?.connection);
              rows.push({ nodeId: inn.id, nodeLabel: innLabel, paramKey, paramLabel: paramDef.label, wired });
            }
          }

          if (rows.length === 0) return null;

          return (
            <div key={innerGroup.id} style={{ marginTop: '4px' }}>
              <div style={{ padding: '3px 10px 2px', fontSize: '9px', color: '#6c7086', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {innerLabel}
              </div>
              {rows.map(row => {
                const checked = row.wired || isSurfaced(innerGroup.id, row.nodeId, row.paramKey);
                return (
                  <label
                    key={`${row.nodeId}::${row.paramKey}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '7px',
                      padding: '3px 10px',
                      cursor: row.wired ? 'default' : 'pointer',
                      opacity: row.wired ? 0.45 : 1,
                      userSelect: 'none',
                    }}
                    onMouseEnter={e => { if (!row.wired) (e.currentTarget as HTMLLabelElement).style.background = '#313244'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLLabelElement).style.background = ''; }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={row.wired}
                      onChange={() => {
                        if (!row.wired) toggle(innerGroup.id, row.nodeId, row.paramKey, row.paramLabel);
                      }}
                      style={{ accentColor: '#cba6f7', cursor: row.wired ? 'default' : 'pointer', margin: 0 }}
                    />
                    <span style={{ color: '#a6adc8', flexShrink: 0, minWidth: '55px' }}>{row.paramLabel}</span>
                    <span style={{ color: '#585b70', fontSize: '9px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.nodeLabel}
                    </span>
                    {row.wired && (
                      <span style={{ color: '#585b70', fontSize: '9px', marginLeft: 'auto' }}>wired</span>
                    )}
                  </label>
                );
              })}
            </div>
          );
        })}

        <div style={{ borderTop: '1px solid #313244', marginTop: '6px', padding: '5px 10px 0' }}>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={onClose}
            style={{ fontSize: '10px', color: '#585b70', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Done
          </button>
        </div>
      </div>
    </>
  );
}
