import { useShaderStore } from '../store/useShaderStore';
import type { NodeType } from '../types/nodes';
import { exportShaderFiles } from '../utils/export';

const NODE_LABELS: Record<NodeType, string> = {
  circleSDF: 'Circle SDF',
  ringSDF: 'Ring SDF',
  boxSDF: 'Box SDF',
  smoothMin: 'Smooth Min',
  makeLight: 'Make Light',
  palette: 'Palette',
};

export default function EffectChain() {
  const nodes = useShaderStore((state) => state.nodes);
  const selectedNodeId = useShaderStore((state) => state.selectedNodeId);
  const selectNode = useShaderStore((state) => state.selectNode);
  const removeNode = useShaderStore((state) => state.removeNode);
  const addNode = useShaderStore((state) => state.addNode);

  const handleAddNode = (type: NodeType) => {
    const newNode = {
      id: `node-${Date.now()}`,
      type,
      params: getDefaultParams(type),
      modifiers: [],
    };
    addNode(newNode);
    selectNode(newNode.id);
  };

  return (
    <div
      style={{
        width: '250px',
        height: '100%',
        background: '#1a1a1a',
        borderRight: '1px solid #333',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px',
        gap: '8px',
        overflowY: 'auto',
      }}
    >
      <h3 style={{ margin: 0, color: '#fff', fontSize: '14px', marginBottom: '8px' }}>
        Effect Chain
      </h3>

      {nodes.map((node, index) => (
        <div key={node.id}>
          <div
            onClick={() => selectNode(node.id)}
            style={{
              background: selectedNodeId === node.id ? '#3a3a3a' : '#2a2a2a',
              padding: '12px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              border: selectedNodeId === node.id ? '1px solid #555' : '1px solid #333',
            }}
          >
            <span style={{ color: '#fff', fontSize: '13px' }}>
              {NODE_LABELS[node.type]}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeNode(node.id);
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '0 4px',
              }}
            >
              ×
            </button>
          </div>
          {index < nodes.length - 1 && (
            <div
              style={{
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div
                style={{
                  width: '2px',
                  height: '100%',
                  background: '#444',
                }}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #333' }}>
        <button
          onClick={() => {
            // Simple add menu - in full version this would be a dropdown
            const type = prompt(
              'Enter node type: circleSDF, ringSDF, boxSDF, smoothMin, makeLight, palette'
            ) as NodeType;
            if (type) handleAddNode(type);
          }}
          style={{
            width: '100%',
            padding: '10px',
            background: '#3a3a3a',
            border: '1px solid #555',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px',
            marginBottom: '8px',
          }}
        >
          + Add Node
        </button>
        <button
          onClick={() => exportShaderFiles(nodes)}
          style={{
            width: '100%',
            padding: '10px',
            background: '#2a4a2a',
            border: '1px solid #4a7a4a',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer',
            fontSize: '13px',
          }}
        >
          ↓ Export Shader Files
        </button>
      </div>
    </div>
  );
}

function getDefaultParams(type: NodeType) {
  switch (type) {
    case 'circleSDF':
    case 'ringSDF':
      return { size: 0.5, position: [0, 0] as [number, number] };
    case 'boxSDF':
      return { dimensions: [0.5, 0.5] as [number, number], position: [0, 0] as [number, number] };
    case 'smoothMin':
      return { smoothness: 0.5 };
    case 'makeLight':
      return { brightness: 5.0 };
    case 'palette':
      return {
        a: [0.5, 0.5, 0.5] as [number, number, number],
        b: [0.5, 0.5, 0.5] as [number, number, number],
        c: [1.0, 1.0, 1.0] as [number, number, number],
        d: [0.0, 0.33, 0.67] as [number, number, number],
      };
  }
}
