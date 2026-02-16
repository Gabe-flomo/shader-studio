import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';

const TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];

const TYPE_COLORS: Record<string, string> = {
  float: '#f0a',
  vec2:  '#0af',
  vec3:  '#0fa',
  vec4:  '#fa0',
};

const BTN: React.CSSProperties = {
  background: '#313244',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  borderRadius: '4px',
  padding: '3px 8px',
  fontSize: '11px',
  fontFamily: 'monospace',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const SECTION_LABEL: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#585b70',
  margin: '10px 0 4px',
};

interface Props {
  node: GraphNode;
  onClose: () => void;
}

export function LoopModal({ node, onClose }: Props) {
  const { updateNodeParams, updateNodeSockets, nodes } = useNodeGraphStore();

  const carryType  = ((node.params.carryType as DataType) ?? 'vec2') as DataType;
  const iterations = typeof node.params.iterations === 'number' ? node.params.iterations : 4;
  const steps      = (node.params.steps as string[]) ?? [];

  // Local state for the "add step" dropdown
  const [selectedAdd, setSelectedAdd] = useState<string>('');

  // Commit carry type change → also update the node's carry socket type
  const changeCarryType = (type: DataType) => {
    updateNodeParams(node.id, { carryType: type });
    // Rebuild carry input + result output with new type
    updateNodeSockets(
      node.id,
      [{ name: 'carry', type }],
      type,
    );
  };

  const changeIterations = (n: number) => {
    updateNodeParams(node.id, { iterations: Math.max(1, Math.min(16, Math.round(n))) });
  };

  const addStep = (stepId: string) => {
    if (!stepId || steps.includes(stepId)) return;
    updateNodeParams(node.id, { steps: [...steps, stepId] });
    setSelectedAdd('');
  };

  const removeStep = (idx: number) => {
    updateNodeParams(node.id, { steps: steps.filter((_, i) => i !== idx) });
  };

  const moveStep = (idx: number, dir: -1 | 1) => {
    const next = [...steps];
    const to = idx + dir;
    if (to < 0 || to >= next.length) return;
    [next[idx], next[to]] = [next[to], next[idx]];
    updateNodeParams(node.id, { steps: next });
  };

  // Nodes eligible to be steps: any graph node (not this loop node, not already a step,
  // and whose primary output type matches the carry type)
  const eligible = nodes.filter(n => {
    if (n.id === node.id) return false;
    if (steps.includes(n.id)) return false;
    // Check if node has at least one output matching carryType
    const def = getNodeDefinition(n.type);
    const outputs = Object.values(n.outputs).length > 0
      ? Object.values(n.outputs)
      : Object.values(def?.outputs ?? {});
    return outputs.some(o => o.type === carryType);
  });

  // Get a display label for a node by ID
  const nodeLabel = (id: string) => {
    const n = nodes.find(nd => nd.id === id);
    if (!n) return `[deleted: ${id}]`;
    const label = typeof n.params.label === 'string' ? n.params.label
      : getNodeDefinition(n.type)?.label ?? n.type;
    return label;
  };

  const nodeOutputType = (id: string): string => {
    const n = nodes.find(nd => nd.id === id);
    if (!n) return '?';
    const outputs = Object.values(n.outputs);
    return outputs[0]?.type ?? '?';
  };

  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: '#1e1e2e',
          border: '1px solid #45475a',
          borderRadius: '10px',
          width: '540px',
          maxHeight: '82vh',
          overflowY: 'auto',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0',
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
          color: '#cdd6f4',
          fontSize: '12px',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#89dceb' }}>⟳ Loop</span>
          <button
            onClick={onClose}
            style={{ ...BTN, background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', padding: '0 4px' }}
          >
            ✕
          </button>
        </div>

        {/* Carry type + Iterations */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#6c7086', fontSize: '11px' }}>Carry type</span>
            <select
              value={carryType}
              onChange={e => changeCarryType(e.target.value as DataType)}
              style={{
                background: '#181825', border: '1px solid #45475a', color: '#cdd6f4',
                borderRadius: '3px', fontSize: '11px', padding: '2px 6px',
                outline: 'none', cursor: 'pointer',
              }}
            >
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ color: '#6c7086', fontSize: '11px' }}>Iterations</span>
            <input
              type="range"
              min={1} max={16} step={1}
              value={iterations}
              onChange={e => changeIterations(Number(e.target.value))}
              style={{ width: '80px', accentColor: '#89dceb' }}
            />
            <span style={{ color: '#cdd6f4', fontSize: '11px', minWidth: '16px' }}>{iterations}</span>
          </div>
        </div>

        {/* Steps list */}
        <div style={SECTION_LABEL as React.CSSProperties}>Steps (executed in order, {iterations}×)</div>
        {steps.length === 0 ? (
          <div style={{ color: '#45475a', fontSize: '10px', fontStyle: 'italic', padding: '4px 0 8px' }}>
            No steps yet — add nodes below whose primary output is <strong>{carryType}</strong>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
            {steps.map((stepId, idx) => {
              const outType = nodeOutputType(stepId);
              const deleted = !nodes.find(n => n.id === stepId);
              return (
                <div
                  key={stepId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: deleted ? '#2a1a1a' : '#181825',
                    border: `1px solid ${deleted ? '#f38ba833' : '#313244'}`,
                    borderRadius: '5px', padding: '5px 8px',
                  }}
                >
                  {/* Order */}
                  <span style={{ color: '#585b70', fontSize: '10px', minWidth: '16px' }}>{idx + 1}</span>
                  {/* Move up/down */}
                  <button
                    onClick={() => moveStep(idx, -1)}
                    disabled={idx === 0}
                    style={{ ...BTN, padding: '1px 5px', fontSize: '10px', opacity: idx === 0 ? 0.3 : 1 }}
                  >↑</button>
                  <button
                    onClick={() => moveStep(idx, 1)}
                    disabled={idx === steps.length - 1}
                    style={{ ...BTN, padding: '1px 5px', fontSize: '10px', opacity: idx === steps.length - 1 ? 0.3 : 1 }}
                  >↓</button>
                  {/* Label */}
                  <span style={{ flex: 1, color: deleted ? '#f38ba8' : '#cdd6f4', fontFamily: 'monospace', fontSize: '11px' }}>
                    {deleted ? '⚠ ' : ''}{nodeLabel(stepId)}
                  </span>
                  {/* Output type badge */}
                  <span style={{
                    fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                    background: (TYPE_COLORS[outType] ?? '#888') + '22',
                    color: TYPE_COLORS[outType] ?? '#888',
                    border: `1px solid ${(TYPE_COLORS[outType] ?? '#888')}55`,
                  }}>
                    {outType}
                  </span>
                  {/* Remove */}
                  <button
                    onClick={() => removeStep(idx)}
                    style={{ ...BTN, background: 'none', border: 'none', color: '#f38ba8', padding: '1px 4px', fontSize: '13px' }}
                  >×</button>
                </div>
              );
            })}
          </div>
        )}

        {/* Add step */}
        <div style={SECTION_LABEL as React.CSSProperties}>Add Step</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {eligible.length === 0 ? (
            <span style={{ color: '#45475a', fontSize: '10px', fontStyle: 'italic' }}>
              No eligible nodes — add nodes with a <strong>{carryType}</strong> output to the graph
            </span>
          ) : (
            <>
              <select
                value={selectedAdd}
                onChange={e => setSelectedAdd(e.target.value)}
                style={{
                  flex: 1,
                  background: '#181825', border: '1px solid #45475a', color: '#cdd6f4',
                  borderRadius: '4px', fontSize: '11px', padding: '4px 6px',
                  outline: 'none', cursor: 'pointer',
                }}
              >
                <option value=''>— pick a node —</option>
                {eligible.map(n => {
                  const label = typeof n.params.label === 'string' ? n.params.label
                    : getNodeDefinition(n.type)?.label ?? n.type;
                  return (
                    <option key={n.id} value={n.id}>{label} ({n.type})</option>
                  );
                })}
              </select>
              <button
                onClick={() => addStep(selectedAdd)}
                disabled={!selectedAdd}
                style={{
                  ...BTN,
                  color: '#a6e3a1', borderColor: '#a6e3a133',
                  opacity: selectedAdd ? 1 : 0.4,
                }}
              >
                + Add
              </button>
            </>
          )}
        </div>

        {/* Usage hint */}
        <div style={{ marginTop: '14px', padding: '8px 10px', background: '#11111b', borderRadius: '5px', border: '1px solid #313244' }}>
          <div style={{ fontSize: '10px', color: '#585b70', lineHeight: 1.6 }}>
            <strong style={{ color: '#89dceb' }}>How it works:</strong> Each iteration feeds the loop's carry value into step 1, then step 1's output into step 2, and so on. The final step's output becomes the new carry for the next iteration. After all iterations, the result is the loop's output.<br/>
            <strong style={{ color: '#f9e2af' }}>Tip:</strong> On each step node, leave the <em>{carryType}</em> input <em>disconnected</em> — the loop injects the carry value automatically. Other inputs (params, time, etc.) are used normally.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
