/**
 * GroupParamPicker — in-graph overlay for customising which params appear
 * on a group card.
 *
 * Two modes, auto-detected:
 *
 * OUTER GROUP MODE (group contains inner group nodes)
 *   — opt-in: params are hidden by default, check to surface them.
 *   — selection stored in node.params.surfacedParams: SurfacedParam[].
 *
 * REGULAR GROUP MODE (no inner group nodes)
 *   — opt-out: params are visible by default, uncheck to hide them.
 *   — hidden set stored in node.params.hiddenParams: string[] ("nodeId::paramKey").
 */
import { useCallback } from 'react';
import type { SurfacedParam, SubgraphData } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import type { GraphNode } from '../../types/nodeGraph';

interface Props {
  /** The group node whose params we are editing */
  outerNode: GraphNode;
  /** Called when the user clicks outside or hits Escape to close */
  onClose: () => void;
}

// Node types that never show params in the group card
const SKIP_TYPES = new Set(['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'constant', 'loopIndex', 'loopCarry', 'group']);

export function GroupParamPicker({ outerNode, onClose }: Props) {
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const subgraph = outerNode.params.subgraph as SubgraphData | undefined;

  // ── Outer group (inner group) mode ──────────────────────────────────────────
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

  const toggleSurfaced = useCallback(
    (innerGroupId: string, nodeId: string, paramKey: string, label: string) => {
      const already = isSurfaced(innerGroupId, nodeId, paramKey);
      const next: SurfacedParam[] = already
        ? currentSurfaced.filter(
            sp => !(sp.innerGroupId === innerGroupId && sp.nodeId === nodeId && sp.paramKey === paramKey),
          )
        : [...currentSurfaced, { innerGroupId, nodeId, paramKey, label }];
      updateNodeParams(outerNode.id, { surfacedParams: next });
    },
    [currentSurfaced, isSurfaced, outerNode.id, updateNodeParams],
  );

  // ── Regular group mode ───────────────────────────────────────────────────────
  const hiddenParams: string[] = Array.isArray(outerNode.params.hiddenParams)
    ? (outerNode.params.hiddenParams as string[])
    : [];

  const isHidden = useCallback(
    (nodeId: string, paramKey: string) => hiddenParams.includes(`${nodeId}::${paramKey}`),
    [hiddenParams],
  );

  const toggleHidden = useCallback(
    (nodeId: string, paramKey: string) => {
      const key = `${nodeId}::${paramKey}`;
      const next = isHidden(nodeId, paramKey)
        ? hiddenParams.filter(k => k !== key)
        : [...hiddenParams, key];
      updateNodeParams(outerNode.id, { hiddenParams: next });
    },
    [hiddenParams, isHidden, outerNode.id, updateNodeParams],
  );

  if (!subgraph) return null;

  const innerGroups = subgraph.nodes.filter(n => n.type === 'group');
  const isOuterGroupMode = innerGroups.length > 0;

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
          {isOuterGroupMode ? 'SURFACE PARAMS' : 'SHOW / HIDE PARAMS'}
        </div>

        {isOuterGroupMode ? (
          // ── Outer group: opt-in (surface inner-group params) ──────────────────
          innerGroups.map(innerGroup => {
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
                          if (!row.wired) toggleSurfaced(innerGroup.id, row.nodeId, row.paramKey, row.paramLabel);
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
          })
        ) : (
          // ── Regular group: opt-out (hide direct inner node params) ────────────
          subgraph.nodes
            .filter(n => !SKIP_TYPES.has(n.type))
            .map(innerNode => {
              const innerDef = getNodeDefinition(innerNode.type);
              if (!innerDef?.paramDefs) return null;
              const innerLabel = typeof innerNode.params.label === 'string'
                ? innerNode.params.label
                : (innerDef.label ?? innerNode.type);

              type Row = { paramKey: string; paramLabel: string; wired: boolean };
              const rows: Row[] = [];

              for (const [paramKey, paramDef] of Object.entries(innerDef.paramDefs)) {
                if (paramDef.type !== 'float' || paramDef.step === 1) continue;
                // Skip params driven by internal connections
                if (innerNode.inputs[`__param_${paramKey}`]?.connection) continue;
                const matchingInput = Object.entries(innerNode.inputs).find(
                  ([k, inp]) => k.toLowerCase() === paramKey.toLowerCase() && inp.connection
                );
                if (matchingInput) continue;
                // Check if wired via ps_ socket on the group
                const psKey = `ps_${innerNode.id}_${paramKey}`;
                const wired = !!(outerNode.inputs[psKey]?.connection);
                rows.push({ paramKey, paramLabel: paramDef.label, wired });
              }

              if (rows.length === 0) return null;

              return (
                <div key={innerNode.id} style={{ marginTop: '4px' }}>
                  <div style={{ padding: '3px 10px 2px', fontSize: '9px', color: '#6c7086', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {innerLabel}
                  </div>
                  {rows.map(row => {
                    const visible = row.wired || !isHidden(innerNode.id, row.paramKey);
                    return (
                      <label
                        key={row.paramKey}
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
                          checked={visible}
                          disabled={row.wired}
                          onChange={() => {
                            if (!row.wired) toggleHidden(innerNode.id, row.paramKey);
                          }}
                          style={{ accentColor: '#89b4fa', cursor: row.wired ? 'default' : 'pointer', margin: 0 }}
                        />
                        <span style={{ color: '#a6adc8', flexShrink: 0 }}>{row.paramLabel}</span>
                        {row.wired && (
                          <span style={{ color: '#585b70', fontSize: '9px', marginLeft: 'auto' }}>wired</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              );
            })
        )}

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
