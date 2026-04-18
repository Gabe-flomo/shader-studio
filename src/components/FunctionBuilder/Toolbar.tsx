import React, { useState } from 'react';
import { useFunctionBuilder } from './useFunctionBuilder';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

interface Props {
  hasErrors: boolean;
}

const inputStyle: React.CSSProperties = {
  background: '#181825',
  border: '1px solid #45475a',
  borderRadius: '4px',
  color: '#cdd6f4',
  fontFamily: 'monospace',
  fontSize: '11px',
  padding: '3px 6px',
  width: '52px',
  outline: 'none',
};

function RangeInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>{label}</span>
      <input
        style={inputStyle}
        value={local}
        onChange={e => setLocal(e.target.value)}
        onBlur={() => {
          const n = parseFloat(local);
          if (!isNaN(n)) { onChange(n); } else { setLocal(String(value)); }
        }}
        onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
      />
    </div>
  );
}

export function Toolbar({ hasErrors }: Props) {
  const { functions, activeId, xRange, yRange, setActiveId, setXRange, setYRange, linkedBlockId } = useFunctionBuilder();
  const addNode = useNodeGraphStore(s => s.addNode);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const nodes = useNodeGraphStore(s => s.nodes);

  const activeFn = functions.find(f => f.id === activeId) ?? functions[0];

  const handleSave = () => {
    if (linkedBlockId) {
      // Update existing ExprBlock in place
      const node = nodes.find(n => n.id === linkedBlockId);
      if (node) {
        updateNodeParams(linkedBlockId, {
          lines: activeFn?.body ?? '',
          functions: functions.map(f => ({ name: f.name, returnType: f.returnType, body: f.body })),
        });
        return;
      }
    }
    // Create new ExprBlock
    const pos = { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 };
    addNode('exprNode', pos);
    // Note: newly created node will have the default params; user can open it to see
  };

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 10px',
      borderTop: '1px solid #313244',
      background: '#1e1e2e',
      flexShrink: 0,
      flexWrap: 'wrap',
    }}>
      {/* Active function selector */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>Visualize</span>
        <select
          value={activeId}
          onChange={e => setActiveId(e.target.value)}
          style={{
            background: '#313244', border: '1px solid #45475a', color: '#cdd6f4',
            borderRadius: '4px', fontSize: '11px', fontFamily: 'monospace',
            padding: '3px 6px', cursor: 'pointer', outline: 'none',
          }}
        >
          {functions.map(f => (
            <option key={f.id} value={f.id}>{f.name} ({f.returnType})</option>
          ))}
        </select>
      </div>

      <div style={{ width: '1px', height: '16px', background: '#313244', flexShrink: 0 }} />

      {/* X range */}
      {activeFn?.returnType === 'float' && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>x</span>
            <RangeInput label="[" value={xRange[0]} onChange={v => setXRange([v, xRange[1]])} />
            <RangeInput label="," value={xRange[1]} onChange={v => setXRange([xRange[0], v])} />
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>]</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>y</span>
            <RangeInput label="[" value={yRange[0]} onChange={v => setYRange([v, yRange[1]])} />
            <RangeInput label="," value={yRange[1]} onChange={v => setYRange([yRange[0], v])} />
            <span style={{ fontSize: '10px', color: '#585b70', fontFamily: 'monospace' }}>]</span>
          </div>
          <div style={{ width: '1px', height: '16px', background: '#313244', flexShrink: 0 }} />
        </>
      )}

      <div style={{ flex: 1 }} />

      {hasErrors && (
        <span style={{ fontSize: '10px', color: '#f38ba8', fontFamily: 'monospace' }}>⚠ GLSL error</span>
      )}

      <button
        onClick={handleSave}
        style={{
          background: '#89b4fa',
          border: 'none',
          color: '#1e1e2e',
          borderRadius: '5px',
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: 700,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {linkedBlockId ? 'Update ExprBlock' : 'Save to ExprBlock'}
      </button>
    </div>
  );
}
