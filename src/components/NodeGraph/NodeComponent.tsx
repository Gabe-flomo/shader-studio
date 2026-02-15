import React, { useRef, useState } from 'react';
import type { GraphNode, DataType, NodeDefinition } from '../../types/nodeGraph';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { ExprModal } from './ExprModal';
import { CustomFnModal } from './CustomFnModal';
import { registerSocket } from './NodeGraph';

interface Props {
  node: GraphNode;
  onStartConnection: (nodeId: string, outputKey: string, event: React.MouseEvent) => void;
  onEndConnection: (nodeId: string, inputKey: string) => void;
  draggingType?: DataType | null;
}

const TYPE_COLORS: Record<string, string> = {
  float: '#f0a',
  vec2: '#0af',
  vec3: '#0fa',
  vec4: '#fa0',
};

const INPUT_STYLE: React.CSSProperties = {
  background: '#11111b',
  border: '1px solid #45475a',
  color: '#cdd6f4',
  padding: '2px 4px',
  borderRadius: '3px',
  fontSize: '11px',
  width: '52px',
  outline: 'none',
};

const RANGE_STYLE: React.CSSProperties = {
  width: '72px',
  accentColor: '#89b4fa',
  cursor: 'pointer',
};

// ─── Type compatibility check (mirrors graphCompiler.ts logic) ───────────────
function typesCompatible(sourceType: DataType, targetType: DataType): boolean {
  return sourceType === targetType || (sourceType === 'float' && targetType === 'vec3');
}

// ─── Find compatible source sockets in the current graph for a given target type ─
function getCompatibleSources(
  nodes: GraphNode[],
  currentNodeId: string,
  targetType: DataType,
): Array<{ nodeId: string; nodeLabel: string; outputKey: string; outputLabel: string }> {
  const results: Array<{ nodeId: string; nodeLabel: string; outputKey: string; outputLabel: string }> = [];
  for (const n of nodes) {
    if (n.id === currentNodeId) continue; // skip self
    const def = getNodeDefinition(n.type);
    if (!def) continue;
    // Use the node instance's outputs (handles customFn dynamic outputs)
    const outputsToCheck = Object.keys(n.outputs).length > 0 ? n.outputs : def.outputs;
    for (const [outKey, outSocket] of Object.entries(outputsToCheck)) {
      if (typesCompatible(outSocket.type as DataType, targetType)) {
        const nodeLabel = n.type === 'customFn' && typeof n.params.label === 'string' ? n.params.label || def.label : def.label;
        results.push({ nodeId: n.id, nodeLabel, outputKey: outKey, outputLabel: outSocket.label });
      }
    }
  }
  return results;
}

// ─── Node header tooltip ─────────────────────────────────────────────────────
function NodeTooltip({ def }: { def: NodeDefinition }) {
  const inputEntries  = Object.entries(def.inputs);
  const outputEntries = Object.entries(def.outputs);
  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 1000,
        background: '#1e1e2e',
        border: '1px solid #45475a',
        borderRadius: '8px',
        padding: '10px 12px',
        minWidth: '240px',
        maxWidth: '340px',
        fontSize: '11px',
        color: '#cdd6f4',
        pointerEvents: 'none',
        boxShadow: '0 6px 20px rgba(0,0,0,0.7)',
        marginTop: '2px',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 5, fontSize: '12px' }}>{def.label}</div>
      {def.description && (
        <div style={{ color: '#a6adc8', marginBottom: 8, lineHeight: 1.4 }}>{def.description}</div>
      )}
      {inputEntries.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ color: '#585b70', fontSize: '10px', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Inputs</div>
          {inputEntries.map(([k, s]) => (
            <div key={k} style={{ display: 'flex', gap: 6, paddingLeft: 4, marginBottom: 1 }}>
              <span style={{ color: '#89b4fa', fontFamily: 'monospace', fontSize: '10px', minWidth: 60 }}>{s.label}</span>
              <span style={{ color: '#585b70', fontSize: '10px' }}>{s.type}</span>
            </div>
          ))}
        </div>
      )}
      {outputEntries.length > 0 && (
        <div style={{ marginBottom: def.glslFunction ? 8 : 0 }}>
          <div style={{ color: '#585b70', fontSize: '10px', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Outputs</div>
          {outputEntries.map(([k, s]) => (
            <div key={k} style={{ display: 'flex', gap: 6, paddingLeft: 4, marginBottom: 1 }}>
              <span style={{ color: '#a6e3a1', fontFamily: 'monospace', fontSize: '10px', minWidth: 60 }}>{s.label}</span>
              <span style={{ color: '#585b70', fontSize: '10px' }}>{s.type}</span>
            </div>
          ))}
        </div>
      )}
      {def.glslFunction && (
        <div>
          <div style={{ color: '#585b70', fontSize: '10px', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>GLSL</div>
          <pre style={{
            background: '#11111b', borderRadius: 4, padding: '6px 8px',
            fontSize: '9px', color: '#a6e3a1', margin: 0,
            maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre', fontFamily: 'monospace',
          }}>
            {def.glslFunction.slice(0, 500)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Socket tooltip ──────────────────────────────────────────────────────────
interface TooltipProps {
  lines: React.ReactNode[];
  side: 'left' | 'right'; // left = input socket (tooltip appears right), right = output socket (tooltip appears left)
}

function SocketTooltip({ lines, side }: TooltipProps) {
  return (
    <div
      style={{
        position: 'absolute',
        [side === 'left' ? 'left' : 'right']: '20px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 200,
        background: '#1e1e2e',
        border: '1px solid #45475a',
        borderRadius: '6px',
        padding: '6px 8px',
        minWidth: '160px',
        maxWidth: '240px',
        fontSize: '10px',
        color: '#cdd6f4',
        pointerEvents: 'none',
        boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
        whiteSpace: 'nowrap',
      }}
    >
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

// Extract the lines from the compiled fragment shader that belong to a specific node
function extractNodeCodeFromShader(fragmentShader: string, nodeId: string): string {
  if (!fragmentShader) return '';
  const lines = fragmentShader.split('\n');
  const relevant = lines.filter(l => l.includes(nodeId));
  return relevant.join('\n');
}

// Extract the RHS expression for a specific output variable from compiled GLSL
// e.g. for nodeId="make_3", outputKey="glow" finds "float make_3_glow = ..." and returns the RHS
function getSourceExpr(fragmentShader: string, sourceNodeId: string, outputKey: string): string {
  if (!fragmentShader) return '';
  const varName = `${sourceNodeId}_${outputKey}`;
  const lines = fragmentShader.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    // Match: "float varName = ..." or "vec2 varName = ..." etc.
    if (trimmed.includes(varName)) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const rhs = trimmed.slice(eqIdx + 1).trim().replace(/;$/, '');
        // Truncate long expressions
        return rhs.length > 60 ? rhs.slice(0, 57) + '...' : rhs;
      }
    }
  }
  return varName; // fallback: just show the variable name
}

export function NodeComponent({ node, onStartConnection, onEndConnection, draggingType }: Props) {
  const { nodes, updateNodePosition, removeNode, updateNodeParams, disconnectInput, setPreviewNodeId } = useNodeGraphStore();
  const fragmentShader  = useNodeGraphStore(s => s.fragmentShader);
  const currentTime     = useNodeGraphStore(s => s.currentTime);
  const previewNodeId   = useNodeGraphStore(s => s.previewNodeId);
  const isPreviewActive = previewNodeId === node.id;
  const def = getNodeDefinition(node.type);
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showExprModal, setShowExprModal] = useState(false);
  const [showCustomFnModal, setShowCustomFnModal] = useState(false);
  const [codeEditMode, setCodeEditMode] = useState(false);
  const [hoveredInput, setHoveredInput] = useState<string | null>(null);
  const [hoveredOutput, setHoveredOutput] = useState<string | null>(null);
  const [showNodeTooltip, setShowNodeTooltip] = useState(false);

  if (!def) return null;

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    dragOffset.current = {
      x: e.clientX - node.position.x,
      y: e.clientY - node.position.y,
    };

    const handleMouseMove = (ev: MouseEvent) => {
      if (dragOffset.current) {
        updateNodePosition(node.id, {
          x: ev.clientX - dragOffset.current.x,
          y: ev.clientY - dragOffset.current.y,
        });
      }
    };

    const handleMouseUp = () => {
      dragOffset.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const setFloat = (key: string, raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) updateNodeParams(node.id, { [key]: v }, { immediate: true });
  };

  const setVec3Component = (key: string, idx: number, raw: string) => {
    const v = parseFloat(raw);
    if (isNaN(v)) return;
    const current = Array.isArray(node.params[key]) ? [...(node.params[key] as number[])] : [0, 0, 0];
    current[idx] = v;
    updateNodeParams(node.id, { [key]: current }, { immediate: true });
  };

  const paramDefs = def.paramDefs ?? {};

  // Generate code snippet for this node (pass empty inputVars for template display)
  const generatedCode = showCode ? def.generateGLSL(node, {}).code : '';
  const hasOverride = typeof node.params.__codeOverride === 'string' && (node.params.__codeOverride as string).trim().length > 0;
  const codeSnippet = hasOverride ? (node.params.__codeOverride as string) : generatedCode;
  // The value shown in the editable textarea
  const codeEditValue = codeEditMode
    ? (typeof node.params.__codeOverride === 'string' ? node.params.__codeOverride as string : generatedCode)
    : codeSnippet;

  // ─── Build tooltip for an input socket ─────────────────────────────────────
  const buildInputTooltip = (inputKey: string): React.ReactNode[] => {
    const input = node.inputs[inputKey];
    if (!input) return [];
    const typeColor = TYPE_COLORS[input.type] || '#888';
    const lines: React.ReactNode[] = [];
    lines.push(
      <span style={{ fontWeight: 700 }}>
        <span style={{ color: typeColor }}>▶</span> {input.label} <span style={{ color: '#585b70' }}>({input.type})</span>
      </span>
    );
    if (input.connection) {
      // Show what's connected
      const srcNode = nodes.find(n => n.id === input.connection!.nodeId);
      const srcDef = srcNode ? getNodeDefinition(srcNode.type) : undefined;
      const srcOutLabel = srcDef?.outputs[input.connection.outputKey]?.label ?? input.connection.outputKey;
      const srcType = srcDef?.outputs[input.connection.outputKey]?.type;
      lines.push(
        <span style={{ color: '#585b70', marginTop: '2px', display: 'block' }}>Connected to:</span>
      );
      lines.push(
        <span style={{ color: srcType ? (TYPE_COLORS[srcType] || '#cdd6f4') : '#cdd6f4', paddingLeft: '6px' }}>
          {srcDef?.label ?? srcNode?.type} → {srcOutLabel} <span style={{ color: '#585b70' }}>({srcType})</span>
        </span>
      );
    } else {
      // Show compatible sources
      const sources = getCompatibleSources(nodes, node.id, input.type as DataType);
      if (sources.length > 0) {
        lines.push(<span style={{ color: '#585b70', marginTop: '2px', display: 'block' }}>Sources in graph:</span>);
        for (const s of sources.slice(0, 6)) {
          lines.push(
            <span style={{ paddingLeft: '6px', color: '#a6adc8' }}>• {s.nodeLabel} → {s.outputLabel}</span>
          );
        }
        if (sources.length > 6) {
          lines.push(<span style={{ paddingLeft: '6px', color: '#585b70' }}>...+{sources.length - 6} more</span>);
        }
      } else {
        lines.push(<span style={{ color: '#585b70', marginTop: '2px', display: 'block' }}>No compatible sources in graph</span>);
      }
    }
    return lines;
  };

  // ─── Build tooltip for an output socket ────────────────────────────────────
  const buildOutputTooltip = (outputKey: string): React.ReactNode[] => {
    const output = def.outputs[outputKey];
    if (!output) return [];
    const typeColor = TYPE_COLORS[output.type] || '#888';
    const lines: React.ReactNode[] = [];
    lines.push(
      <span style={{ fontWeight: 700 }}>
        <span style={{ color: typeColor }}>◀</span> {output.label} <span style={{ color: '#585b70' }}>({output.type})</span>
      </span>
    );
    // List what types this can connect to
    const compatMsg = output.type === 'float'
      ? 'Connects to float or vec3 inputs'
      : `Connects to ${output.type} inputs`;
    lines.push(<span style={{ color: '#585b70', marginTop: '2px', display: 'block' }}>{compatMsg}</span>);
    return lines;
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        background: '#1e1e2e',
        border: isPreviewActive ? '1px solid #a6e3a1' : '1px solid #444',
        borderRadius: '8px',
        minWidth: '240px',
        color: '#cdd6f4',
        fontSize: '12px',
        userSelect: 'none',
        boxShadow: isPreviewActive
          ? '0 0 14px #a6e3a133, 0 4px 12px rgba(0,0,0,0.4)'
          : '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onMouseEnter={() => setShowNodeTooltip(true)}
        onMouseLeave={() => setShowNodeTooltip(false)}
        style={{
          background: '#313244',
          borderRadius: showCode ? '8px 8px 0 0' : '8px 8px 0 0',
          padding: '6px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'grab',
          fontWeight: 600,
          fontSize: '12px',
          letterSpacing: '0.03em',
          position: 'relative',
        }}
      >
        <span
          onClick={e => { e.stopPropagation(); setCollapsed(v => !v); }}
          title={collapsed ? 'Expand node' : 'Collapse node'}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', userSelect: 'none' }}
        >
          <span style={{ fontSize: '9px', opacity: 0.5, lineHeight: 1 }}>{collapsed ? '▶' : '▼'}</span>
          {node.type === 'customFn' && typeof node.params.label === 'string' ? node.params.label || def.label : def.label}
        </span>
        {showNodeTooltip && <NodeTooltip def={def} />}
        <div style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
          {/* Code toggle button */}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setShowCode(v => !v)}
            title={showCode ? 'Hide generated GLSL' : 'Show generated GLSL'}
            style={{
              background: showCode ? '#89b4fa22' : 'none',
              border: showCode ? '1px solid #89b4fa55' : 'none',
              color: showCode ? '#89b4fa' : '#585b70',
              cursor: 'pointer',
              fontSize: '11px',
              lineHeight: 1,
              padding: '1px 4px',
              borderRadius: '3px',
              fontFamily: 'monospace',
            }}
          >
            {'</>'}
          </button>
          {/* Preview toggle — isolates this node's output on the canvas */}
          {!['output', 'vec4Output', 'uv', 'time', 'mouse', 'constant'].includes(node.type) && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setPreviewNodeId(isPreviewActive ? null : node.id)}
              title={isPreviewActive ? 'Exit preview (restore full graph)' : 'Preview this node in isolation'}
              style={{
                background: isPreviewActive ? '#a6e3a122' : 'none',
                border: isPreviewActive ? '1px solid #a6e3a155' : 'none',
                color: isPreviewActive ? '#a6e3a1' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              👁
            </button>
          )}
          {/* Expr modal expand button — only shown on Expr nodes */}
          {node.type === 'expr' && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowExprModal(v => !v)}
              title="Open Expr editor"
              style={{
                background: showExprModal ? '#a6e3a122' : 'none',
                border: showExprModal ? '1px solid #a6e3a155' : 'none',
                color: showExprModal ? '#a6e3a1' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              ⛶
            </button>
          )}
          {/* CustomFn modal button — only shown on customFn nodes */}
          {node.type === 'customFn' && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowCustomFnModal(v => !v)}
              title="Open Custom Function editor"
              style={{
                background: showCustomFnModal ? '#cba6f722' : 'none',
                border: showCustomFnModal ? '1px solid #cba6f755' : 'none',
                color: showCustomFnModal ? '#cba6f7' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              ƒ
            </button>
          )}
          {/* Reset params button — only shown if node has paramDefs */}
          {Object.keys(def.paramDefs ?? {}).length > 0 && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                if (def.defaultParams) {
                  updateNodeParams(node.id, def.defaultParams as Record<string, unknown>, { immediate: true });
                }
              }}
              title="Reset parameters to defaults"
              style={{
                background: 'none',
                border: 'none',
                color: '#585b70',
                cursor: 'pointer',
                fontSize: '13px',
                lineHeight: 1,
                padding: '0 2px',
              }}
            >
              ↺
            </button>
          )}
          {/* Delete button */}
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => removeNode(node.id)}
            title="Remove node"
            style={{
              background: 'none',
              border: 'none',
              color: '#f38ba8',
              cursor: 'pointer',
              fontSize: '14px',
              lineHeight: 1,
              padding: '0 2px',
            }}
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ padding: '6px 0 4px' }}>
        {/* ── Inputs (always visible) ── */}
        {Object.entries(node.inputs).map(([key, input]) => {
          const isConnected = !!input.connection;

          // For Expr node: show name-edit field inline with each input slot
          const isExprSlot = node.type === 'expr' && /^in\d$/.test(key);
          const slotIdx = isExprSlot ? parseInt(key.slice(2)) : -1;
          const slotNameKey = isExprSlot ? `in${slotIdx}Name` : '';
          const slotName = isExprSlot
            ? (typeof node.params[slotNameKey] === 'string' ? (node.params[slotNameKey] as string) : key)
            : input.label;

          // Drag-highlight: compatible = glow, incompatible = dim
          let socketOpacity = 1;
          let socketGlow: string | undefined;
          if (draggingType) {
            const compat = typesCompatible(draggingType, input.type as DataType);
            socketOpacity = compat ? 1 : 0.25;
            socketGlow = compat ? `0 0 8px ${TYPE_COLORS[input.type] || '#888'}` : undefined;
          }

          const isHovered = hoveredInput === key;

          return (
            <div
              key={key}
              style={{ display: 'flex', alignItems: 'center', padding: '3px 10px 3px 0', position: 'relative' }}
            >
              {/* Socket dot + disconnect */}
              <div
                ref={el => registerSocket(node.id, 'in', key, el)}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: isConnected ? (TYPE_COLORS[input.type] || '#888') : '#333',
                  border: `2px solid ${TYPE_COLORS[input.type] || '#888'}`,
                  marginRight: '8px',
                  flexShrink: 0,
                  marginLeft: '-6px',
                  cursor: 'pointer',
                  opacity: socketOpacity,
                  boxShadow: socketGlow,
                  transition: 'box-shadow 0.1s, opacity 0.1s',
                }}
                onMouseEnter={() => setHoveredInput(key)}
                onMouseLeave={() => setHoveredInput(null)}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  if (isConnected) {
                    disconnectInput(node.id, key);
                  } else {
                    onEndConnection(node.id, key);
                  }
                }}
              />
              {/* Hover tooltip */}
              {isHovered && !draggingType && (
                <SocketTooltip lines={buildInputTooltip(key)} side="left" />
              )}
              {/* When dragging: show a drop-here indicator on compatible sockets */}
              {draggingType && typesCompatible(draggingType, input.type as DataType) && (
                <div style={{
                  position: 'absolute',
                  left: '-3px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: TYPE_COLORS[input.type] || '#888',
                  opacity: 0.8,
                  pointerEvents: 'none',
                }} />
              )}
              {isExprSlot ? (
                // Expr node: editable name field + disconnect indicator
                <input
                  type="text"
                  value={slotName}
                  onChange={e => updateNodeParams(node.id, { [slotNameKey]: e.target.value })}
                  onMouseDown={e => e.stopPropagation()}
                  spellCheck={false}
                  placeholder={key}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid #313244',
                    color: '#cdd6f4',
                    fontSize: '11px',
                    fontFamily: 'monospace',
                    outline: 'none',
                    width: '80px',
                    padding: '0 2px',
                    opacity: socketOpacity,
                  }}
                />
              ) : (
                <span
                  style={{ color: '#a6adc8', fontSize: '11px', cursor: 'pointer', flex: 1, opacity: socketOpacity }}
                  onMouseUp={(e) => {
                    e.stopPropagation();
                    if (isConnected) {
                      disconnectInput(node.id, key);
                    } else {
                      onEndConnection(node.id, key);
                    }
                  }}
                >
                  {slotName}
                </span>
              )}
              {isConnected && (
                <span
                  style={{ marginLeft: 'auto', color: '#585b70', fontSize: '10px', paddingRight: '6px', cursor: 'pointer' }}
                  onMouseUp={(e) => { e.stopPropagation(); disconnectInput(node.id, key); }}
                >
                  ×
                </span>
              )}
            </div>
          );
        })}

        {/* ── Params (hidden when collapsed) ── */}
        {!collapsed && Object.entries(paramDefs).map(([key, paramDef]) => {
          // showWhen — conditionally hide params based on another param's value
          if (paramDef.showWhen) {
            const watchedVal = node.params[paramDef.showWhen.param] as string;
            const allowed = Array.isArray(paramDef.showWhen.value)
              ? paramDef.showWhen.value
              : [paramDef.showWhen.value];
            if (!allowed.includes(watchedVal)) return null;
          }
          // 'string' type → text input or textarea (code font for 'expr'/'body' keys)
          if (paramDef.type === 'string') {
            // For Expr node: skip inXName fields here — they're rendered inline with sockets above
            if (node.type === 'expr' && /^in\dName$/.test(key)) return null;
            // For Expr node: skip 'expr' field here — it's in the modal; show a compact hint instead
            if (node.type === 'expr' && key === 'expr') {
              const val = typeof node.params[key] === 'string' ? (node.params[key] as string) : '';
              return (
                <div
                  key={key}
                  style={{ padding: '3px 10px', display: 'flex', flexDirection: 'column', gap: '2px' }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <span style={{ color: '#6c7086', fontSize: '11px' }}>{paramDef.label}</span>
                  <div
                    style={{
                      background: '#11111b', border: '1px solid #313244',
                      color: '#a6e3a1', padding: '3px 6px', borderRadius: '3px',
                      fontSize: '10px', fontFamily: 'monospace',
                      maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                    title={val}
                  >
                    {val || '(empty)'}
                  </div>
                </div>
              );
            }

            const val    = typeof node.params[key] === 'string' ? (node.params[key] as string) : '';
            const isBody = key === 'body';
            return (
              <div
                key={key}
                style={{ padding: '3px 10px', display: 'flex', flexDirection: 'column', gap: '4px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: '#6c7086', fontSize: '11px' }}>{paramDef.label}</span>
                {isBody ? (
                  <textarea
                    value={val}
                    onChange={e => updateNodeParams(node.id, { [key]: e.target.value })}
                    spellCheck={false}
                    rows={8}
                    style={{
                      background: '#11111b',
                      border: '1px solid #45475a',
                      color: '#a6e3a1',
                      padding: '6px 8px',
                      borderRadius: '3px',
                      fontSize: '10px',
                      fontFamily: 'monospace',
                      width: '100%',
                      resize: 'vertical',
                      outline: 'none',
                      boxSizing: 'border-box',
                      lineHeight: 1.5,
                    }}
                  />
                ) : (
                  <input
                    type="text"
                    value={val}
                    onChange={e => updateNodeParams(node.id, { [key]: e.target.value })}
                    spellCheck={false}
                    style={{
                      background: '#11111b',
                      border: '1px solid #45475a',
                      color: '#cdd6f4',
                      padding: '3px 6px',
                      borderRadius: '3px',
                      fontSize: '11px',
                      width: '100%',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                )}
              </div>
            );
          }

          if (paramDef.type === 'float') {
            // If a matching input socket exists and is connected, the slider has no effect — show a "wired" indicator with source expression
            const socketConn = node.inputs[key]?.connection;
            const isSocketConnected = socketConn != null;
            if (isSocketConnected) {
              const srcExpr = getSourceExpr(fragmentShader, socketConn!.nodeId, socketConn!.outputKey);
              return (
                <div
                  key={key}
                  style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span style={{ color: '#45475a', fontSize: '11px', minWidth: '60px', flexShrink: 0 }}>{paramDef.label}</span>
                  <span
                    style={{
                      color: '#89b4fa',
                      fontSize: '9px',
                      fontFamily: 'monospace',
                      fontStyle: 'normal',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                      opacity: 0.8,
                    }}
                    title={srcExpr}
                  >
                    = {srcExpr}
                  </span>
                </div>
              );
            }
            const val = typeof node.params[key] === 'number' ? (node.params[key] as number) : 0;
            const min = paramDef.min ?? 0;
            const max = paramDef.max ?? 1;
            const step = paramDef.step ?? 0.01;
            return (
              <div
                key={key}
                style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: '#6c7086', fontSize: '11px', minWidth: '60px' }}>{paramDef.label}</span>
                <input
                  type="range"
                  style={RANGE_STYLE}
                  min={min}
                  max={max}
                  step={step}
                  value={val}
                  onChange={e => setFloat(key, e.target.value)}
                />
                <input
                  type="number"
                  style={INPUT_STYLE}
                  step={step}
                  value={val}
                  onChange={e => setFloat(key, e.target.value)}
                />
              </div>
            );
          }

          if (paramDef.type === 'vec3') {
            const vals = Array.isArray(node.params[key]) ? (node.params[key] as number[]) : [0, 0, 0];
            const step = paramDef.step ?? 0.01;
            const min = paramDef.min ?? 0;
            const max = paramDef.max ?? 1;
            // Per-component socket keys follow the pattern `{key}_r`, `{key}_g`, `{key}_b`
            const compKeys = [`${key}_r`, `${key}_g`, `${key}_b`];
            const compLabels = ['r', 'g', 'b'];
            return (
              <div
                key={key}
                style={{ padding: '3px 10px 5px', display: 'flex', flexDirection: 'column', gap: '3px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: '#6c7086', fontSize: '11px' }}>{paramDef.label}</span>
                {[0, 1, 2].map(idx => {
                  const compConnected = node.inputs[compKeys[idx]]?.connection != null;
                  if (compConnected) {
                    return (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: '#45475a', fontSize: '10px', minWidth: '12px' }}>{compLabels[idx]}</span>
                        <span style={{ color: '#45475a', fontSize: '10px', fontStyle: 'italic' }}>wired ↑</span>
                      </div>
                    );
                  }
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="range"
                        style={{ ...RANGE_STYLE, width: '80px' }}
                        min={min}
                        max={max}
                        step={step}
                        value={vals[idx] ?? 0}
                        onChange={e => setVec3Component(key, idx, e.target.value)}
                      />
                      {/* No min/max on number input — allows typing values beyond the slider range */}
                      <input
                        type="number"
                        style={{ ...INPUT_STYLE, width: '48px' }}
                        step={step}
                        value={vals[idx] ?? 0}
                        onChange={e => setVec3Component(key, idx, e.target.value)}
                      />
                    </div>
                  );
                })}
              </div>
            );
          }

          if (paramDef.type === 'select') {
            const val = typeof node.params[key] === 'string' ? (node.params[key] as string) : (paramDef.options?.[0]?.value ?? '');
            return (
              <div
                key={key}
                style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: '#6c7086', fontSize: '11px', minWidth: '60px' }}>{paramDef.label}</span>
                <select
                  value={val}
                  onChange={e => updateNodeParams(node.id, { [key]: e.target.value }, { immediate: true })}
                  style={{
                    background: '#181825',
                    border: '1px solid #45475a',
                    color: '#cdd6f4',
                    borderRadius: '3px',
                    fontSize: '11px',
                    padding: '2px 4px',
                    outline: 'none',
                    cursor: 'pointer',
                    flex: 1,
                  }}
                >
                  {(paramDef.options ?? []).map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            );
          }

          return null;
        })}

        {/* ── Outputs (always visible) ── */}
        {Object.entries(node.outputs).map(([key, output]) => {
          const isHovered = hoveredOutput === key;
          // Live value badge: show time for Time node
          const liveValueBadge = node.type === 'time' && key === 'time'
            ? currentTime.toFixed(2) + 's'
            : null;
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                padding: '3px 0 3px 10px',
                position: 'relative',
              }}
            >
              {liveValueBadge && (
                <span style={{ color: '#f9e2af', fontSize: '9px', fontFamily: 'monospace', marginRight: '6px', opacity: 0.8 }}>
                  {liveValueBadge}
                </span>
              )}
              <span style={{ color: '#a6adc8', fontSize: '11px' }}>{output.label}</span>
              <div
                ref={el => registerSocket(node.id, 'out', key, el)}
                onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                onMouseEnter={() => setHoveredOutput(key)}
                onMouseLeave={() => setHoveredOutput(null)}
                title={`${output.label} (${output.type})`}
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: TYPE_COLORS[output.type] || '#888',
                  border: `2px solid ${TYPE_COLORS[output.type] || '#888'}`,
                  marginLeft: '8px',
                  flexShrink: 0,
                  marginRight: '-6px',
                  cursor: 'crosshair',
                }}
              />
              {/* Hover tooltip for output socket */}
              {isHovered && !draggingType && (
                <SocketTooltip lines={buildOutputTooltip(key)} side="right" />
              )}
            </div>
          );
        })}
      </div>

      {/* ── Expr modal ── */}
      {showExprModal && node.type === 'expr' && (
        <ExprModal node={node} onClose={() => setShowExprModal(false)} />
      )}

      {/* ── CustomFn modal ── */}
      {showCustomFnModal && node.type === 'customFn' && (
        <CustomFnModal node={node} onClose={() => setShowCustomFnModal(false)} />
      )}

      {/* ── Generated GLSL code (editable, hidden when collapsed) ── */}
      {showCode && !collapsed && (
        <div
          style={{
            background: '#181825',
            borderTop: '1px solid #313244',
            borderRadius: '0 0 8px 8px',
            padding: '0',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          {/* Toolbar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', borderBottom: '1px solid #313244' }}>
            {hasOverride && (
              <span style={{ fontSize: '9px', color: '#f9e2af', letterSpacing: '0.05em', marginRight: '4px' }}>✎ OVERRIDDEN</span>
            )}
            <button
              onClick={() => {
                if (codeEditMode) {
                  // done editing — value already stored via onChange
                  setCodeEditMode(false);
                } else {
                  // enter edit mode: seed with LIVE compiled code (real var names) if no override yet
                  if (!hasOverride) {
                    const liveCode = extractNodeCodeFromShader(fragmentShader, node.id);
                    updateNodeParams(node.id, { __codeOverride: liveCode || generatedCode });
                  }
                  setCodeEditMode(true);
                }
              }}
              style={{
                background: codeEditMode ? '#89b4fa22' : '#313244',
                border: `1px solid ${codeEditMode ? '#89b4fa55' : '#45475a'}`,
                color: codeEditMode ? '#89b4fa' : '#cdd6f4',
                borderRadius: '3px',
                padding: '2px 7px',
                fontSize: '10px',
                cursor: 'pointer',
                fontFamily: 'monospace',
              }}
            >
              {codeEditMode ? '✓ Done' : '✎ Edit'}
            </button>
            {hasOverride && (
              <button
                onClick={() => {
                  updateNodeParams(node.id, { __codeOverride: '' });
                  setCodeEditMode(false);
                }}
                style={{
                  background: 'none',
                  border: '1px solid #45475a',
                  color: '#f38ba8',
                  borderRadius: '3px',
                  padding: '2px 7px',
                  fontSize: '10px',
                  cursor: 'pointer',
                }}
                title="Clear code override — revert to generated GLSL"
              >
                ✕ Reset
              </button>
            )}
          </div>
          {codeEditMode ? (
            <textarea
              value={codeEditValue}
              onChange={e => updateNodeParams(node.id, { __codeOverride: e.target.value })}
              spellCheck={false}
              rows={8}
              style={{
                background: '#11111b',
                border: 'none',
                color: '#a6e3a1',
                fontSize: '10px',
                padding: '6px 10px',
                margin: 0,
                width: '100%',
                resize: 'vertical',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'monospace',
                lineHeight: 1.5,
                borderRadius: '0 0 8px 8px',
              }}
            />
          ) : (
            <pre
              style={{
                background: 'transparent',
                color: hasOverride ? '#f9e2af' : '#a6e3a1',
                fontSize: '10px',
                padding: '6px 10px',
                margin: 0,
                overflowX: 'auto',
                maxHeight: '400px',
                overflowY: 'auto',
                fontFamily: 'monospace',
                whiteSpace: 'pre',
              }}
            >
              {codeSnippet || '// (no code generated)'}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
