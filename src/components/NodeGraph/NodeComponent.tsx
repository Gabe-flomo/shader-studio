import React, { useRef, useState, useCallback, useEffect } from 'react';
import * as THREE from 'three';

// Inject save-flash keyframe once
if (typeof document !== 'undefined' && !document.getElementById('gs-anim')) {
  const s = document.createElement('style');
  s.id = 'gs-anim';
  s.textContent = `
    @keyframes groupSaveFlash {
      0%   { background: rgba(166,227,161,0.5); border-color: #a6e3a1; color: #a6e3a1; box-shadow: 0 0 8px #a6e3a166; }
      100% { background: none; border-color: #585b70; color: #a6adc8; box-shadow: none; }
    }
    .group-save-flash { animation: groupSaveFlash 0.7s ease-out forwards; }
    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
  `;
  document.head.appendChild(s);
}
import type { GraphNode, DataType, NodeDefinition } from '../../types/nodeGraph';
import { renderNodePreview } from '../../lib/nodePreviewRenderer';
import { compileNodePreviewShader } from '../../lib/compileNodePreviewShader';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { ExprModal } from './ExprModal';
import { CustomFnModal } from './CustomFnModal';
import { ExprBlockModal } from './ExprBlockModal';
import { BezierEditorModal } from './BezierEditorModal';
import { AudioInputModal } from './AudioInputModal';
import { GroupParamPicker } from './GroupParamPicker';
import { AssignInitModal } from './AssignInitModal';
import { NodeInlineViz, INLINE_VIZ_TYPES, AudioFreqRangeViz, SdfPreviewViz, SDF_TYPES } from './NodeInlineViz';
import { registerSocket } from './socketRegistry';
import { scopeCanvasRegistry, scopeBufferRegistry } from '../../lib/scopeRegistry';
import { audioEngine } from '../../lib/audioEngine';
import { typesCompatible } from '../../lib/typesCompatible';
import type { SurfacedParam, SubgraphData } from '../../types/nodeGraph';

function adaptiveStep(value: number, baseStep: number): number {
  const abs = Math.abs(value);
  if (abs > 0 && abs < baseStep) {
    return Math.pow(10, Math.floor(Math.log10(abs)) - 1);
  }
  return baseStep;
}

function adaptiveDecimals(step: number): number {
  if (step < 0.0001) return 6;
  if (step < 0.001) return 5;
  if (step < 0.01) return 4;
  if (step < 0.1) return 3;
  if (step < 1) return 2;
  return 1;
}

interface Props {
  node: GraphNode;
  onStartConnection: (nodeId: string, outputKey: string, event: React.MouseEvent) => void;
  onEndConnection: (nodeId: string, inputKey: string) => void;
  /** Mobile tap-to-connect: called when user taps an output socket */
  onTapOutputSocket?: (nodeId: string, outputKey: string) => void;
  /** Mobile tap-to-connect: called when user taps an input socket to complete a pending connection */
  onTapInputSocket?: (nodeId: string, inputKey: string) => void;
  /** Pending mobile connection in progress (for visual highlighting) */
  pendingMobileConnection?: { sourceNodeId: string; sourceOutputKey: string; fromPos: { x: number; y: number } } | null;
  /** Output type of the pending mobile connection (for compatibility highlighting) */
  pendingMobileType?: DataType | null;
  /** Whether the current device has touch input */
  isTouchDevice?: boolean;
  draggingType?: DataType | null;
  zoom?: number;
  /** When a highlight filter is active, non-matching nodes are dimmed */
  dimmed?: boolean;
  /** Called when user double-clicks a group node header to drill into it */
  onEnterGroup?: (groupId: string) => void;
  /** Node has a compilation error — show red ring */
  hasError?: boolean;
  /**
   * When inside a group view, the set of this node's input keys that are
   * driven by an external (group-level) connection. These sockets are
   * immutable — they cannot be disconnected or re-connected from within
   * the group editor.
   */
  externalInputKeys?: Set<string>;
  /** When inside a group view, set of param keys that are driven by external ps_ connections */
  externalParamKeys?: Set<string>;
  /** Option-click on a socket: open filtered node search palette */
  onAltClickSocket?: (nodeId: string, key: string, dir: 'in' | 'out', type: string, e: React.MouseEvent) => void;
  /** True while the user is actively dragging a connection wire — input sockets should complete the connection rather than disconnect */
  isConnectionDragging?: boolean;
}

// Maps slider position (0–1000) to Hz using a dampened log scale (power=0.6)
// Feels smoother than pure log but still covers 20Hz–20kHz
function sliderToHz(v: number): number {
  const t = v / 1000;
  return Math.round(20 * Math.pow(1000, Math.pow(t, 0.6)));
}
function hzToSlider(hz: number): number {
  const ratio = Math.log(Math.max(20, Math.min(20000, hz)) / 20) / Math.log(1000);
  return Math.round(Math.pow(Math.max(0, ratio), 1 / 0.6) * 1000);
}

const SKIP_PREVIEW = new Set(['output', 'vec4Output', 'loopStart', 'loopEnd', 'scope', 'textureInput', 'audioInput']);
let zCounter = 10; // incremented each time a node is brought to front
const LFO_TYPES    = new Set(['sineLFO', 'squareLFO', 'sawtoothLFO', 'triangleLFO']);
// Node types with always-visible built-in visualizations (skip the 👁 in-card panel for these)
const ALWAYS_VIZ_TYPES = new Set([...LFO_TYPES, 'remap', 'audioInput']);

const TYPE_COLORS: Record<string, string> = {
  float: '#f0a',
  vec2: '#0af',
  vec3: '#0fa',
  vec4: '#fa0',
  scene3d:     '#cc88aa',  // pastel pink for 3D scene wires
  spacewarp3d: '#aa88cc',  // pastel purple for space warp wires
};

const INPUT_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #31324488',
  color: '#cdd6f4',
  padding: '1px 4px',
  borderRadius: '3px',
  fontSize: '11px',
  width: '52px',
  outline: 'none',
  textAlign: 'center',
  // hide browser spinner arrows
  MozAppearance: 'textfield' as React.CSSProperties['MozAppearance'],
} as React.CSSProperties;

const RANGE_STYLE: React.CSSProperties = {
  width: '72px',
  accentColor: '#89b4fa',
  cursor: 'pointer',
};

// ─── Type compatibility check (mirrors graphCompiler.ts logic) ───────────────

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
function extractNodeCodeFromShader(lines: string[], nodeId: string): string {
  if (!lines.length) return '';
  const relevant = lines.filter(l => l.includes(nodeId));
  return relevant.join('\n');
}

// Extract the RHS expression for a specific output variable from compiled GLSL
// e.g. for nodeId="make_3", outputKey="glow" finds "float make_3_glow = ..." and returns the RHS
function getSourceExpr(lines: string[], sourceNodeId: string, outputKey: string): string {
  if (!lines.length) return '';
  const varName = `${sourceNodeId}_${outputKey}`;
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

export function NodeComponent({ node, onStartConnection, onEndConnection, onTapOutputSocket, onTapInputSocket, pendingMobileConnection, pendingMobileType, isTouchDevice = false, draggingType, zoom = 1, dimmed = false, onEnterGroup, hasError = false, externalInputKeys, externalParamKeys, onAltClickSocket, isConnectionDragging = false }: Props) {
  const nodes           = useNodeGraphStore(s => s.nodes);
  const fragmentShader  = useNodeGraphStore(s => s.fragmentShader);
  const previewNodeId   = useNodeGraphStore(s => s.previewNodeId);
  const activeGroupId   = useNodeGraphStore(s => s.activeGroupId);
  // Check if the active group has iterations > 1 (assignOp / carryMode only meaningful in loops)
  const activeGroupIterations = useNodeGraphStore(s => {
    if (!s.activeGroupId) return 1;
    const g = s.nodes.find(n => n.id === s.activeGroupId);
    const iters = g?.params?.iterations;
    return typeof iters === 'number' ? iters : 1;
  });
  const isInsideLoop = activeGroupId != null && activeGroupIterations > 1;
  const isPreviewActive = previewNodeId === node.id;
  const updateNodePosition = useNodeGraphStore(s => s.updateNodePosition);
  const removeNode         = useNodeGraphStore(s => s.removeNode);
  const updateNodeParams   = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeOutputs  = useNodeGraphStore(s => s.updateNodeOutputs);
  const updateNodeInputs   = useNodeGraphStore(s => s.updateNodeInputs);
  const disconnectInput    = useNodeGraphStore(s => s.disconnectInput);
  const setPreviewNodeId   = useNodeGraphStore(s => s.setPreviewNodeId);
  const toggleBypass       = useNodeGraphStore(s => s.toggleBypass);
  const setNodeAssignOp      = useNodeGraphStore(s => s.setNodeAssignOp);
  const setNodeAssignInit    = useNodeGraphStore(s => s.setNodeAssignInit);
  const setHoveredParamHint  = useNodeGraphStore(s => s.setHoveredParamHint);
  const toggleCarryMode    = useNodeGraphStore(s => s.toggleNodeCarryMode);
  const setSelectedNodeId  = useNodeGraphStore(s => s.setSelectedNodeId);
  const selectedNodeId     = useNodeGraphStore(s => s.selectedNodeId);
  const isSelected         = selectedNodeId === node.id;

  // Multi-select
  const selectNode         = useNodeGraphStore(s => s.selectNode);
  const selectedNodeIds    = useNodeGraphStore(s => s.selectedNodeIds);
  const isMultiSelected    = selectedNodeIds.includes(node.id);
  const ungroupNode        = useNodeGraphStore(s => s.ungroupNode);
  const addMarchLoopInput      = useNodeGraphStore(s => s.addMarchLoopInput);
  const removeMarchLoopInput   = useNodeGraphStore(s => s.removeMarchLoopInput);
  const toggleMarchLoopOutputPort = useNodeGraphStore(s => s.toggleMarchLoopOutputPort);
  // NOTE: do NOT inline `?? []` inside the selector — that creates a new array
  // reference on every call, making Object.is always fail and causing infinite re-renders.
  const _mlGroupHiddenOutputsRaw = useNodeGraphStore(s =>
    s.nodes.find(n => n.id === s.activeGroupId)?.params?.hiddenOutputs as string[] | undefined
  );
  const mlGroupHiddenOutputs = _mlGroupHiddenOutputsRaw ?? [];
  const renameGroupPort    = useNodeGraphStore(s => s.renameGroupPort);
  const saveGroupPreset    = useNodeGraphStore(s => s.saveGroupPreset);
  const duplicateGroup     = useNodeGraphStore(s => s.duplicateGroup);

  // Swap mode
  const swapTargetNodeId   = useNodeGraphStore(s => s.swapTargetNodeId);
  const setSwapTargetNodeId = useNodeGraphStore(s => s.setSwapTargetNodeId);
  const isSwapTarget       = swapTargetNodeId === node.id;
  // currentTime is only needed for the Time node live badge — subscribed below conditionally
  const currentTime = useNodeGraphStore(s => node.type === 'time' ? s.currentTime : null);
  // Texture input
  const setNodeTexture     = useNodeGraphStore(s => s.setNodeTexture);
  const nodeTexture        = useNodeGraphStore(s => node.type === 'textureInput' ? s.nodeTextures[node.id] : null);

  // Node preview thumbnail — rendered at 200×200 when the 👁 preview mode is active
  const setNodePreview  = useNodeGraphStore(s => s.setNodePreview);
  const previewDataUrl  = useNodeGraphStore(s => s.nodePreviews[node.id] ?? null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Render a 200×200 preview whenever preview mode is activated for this node
  useEffect(() => {
    if (!isPreviewActive || SKIP_PREVIEW.has(node.type)) return;
    let cancelled = false;
    // When inside a group, build a merged node list so the BFS in
    // compileNodePreviewShader can resolve anchor nodes (UV, time, etc.)
    // that live at the top level even though the target node is in the subgraph.
    const state = useNodeGraphStore.getState();
    const activeGroupId = state.activeGroupId;
    let currentNodes = state.nodes;
    if (activeGroupId) {
      const groupNode = state.nodes.find(n => n.id === activeGroupId);
      const sg = groupNode?.params?.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
      if (sg) {
        // Subgraph nodes take priority (same ID wins for sg); top-level nodes fill in
        // any anchor node dependencies (UV, time, etc.) not defined inside the group.
        const sgIds = new Set(sg.nodes.map((n: { id: string }) => n.id));
        currentNodes = [...sg.nodes, ...state.nodes.filter(n => !sgIds.has(n.id))];
      }
    }
    const fs = compileNodePreviewShader(node.id, currentNodes);
    if (!fs) return;
    setPreviewLoading(true);
    renderNodePreview(node.id, fs, { u_time: { value: useNodeGraphStore.getState().currentTime ?? 0 } }, 200)
      .then(url => { if (!cancelled) { setNodePreview(node.id, url); setPreviewLoading(false); } })
      .catch(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewActive, node.id, node.type]);

  // Placeholder handlers so we don't break the existing onMouseEnter/Leave wiring
  const handleCardMouseEnter = useCallback(() => {}, []);
  const handleCardMouseLeave = useCallback(() => {}, []);

  // Memoize the shader line split so getSourceExpr / extractNodeCodeFromShader
  // don't re-split the full shader string on every render for every wired input.
  const shaderLines = React.useMemo(
    () => (fragmentShader ? fragmentShader.split('\n') : []),
    [fragmentShader],
  );

  const def = getNodeDefinition(node.type);
  const isBypassed = !!node.bypassed;
  const assignOp = node.assignOp ?? '=';
  const isCarry = !!node.carryMode;
  const dragOffset = useRef<{ x: number; y: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showExprModal, setShowExprModal] = useState(false);
  const [showExprBlockModal, setShowExprBlockModal] = useState(false);
  const [showBezierModal, setShowBezierModal] = useState(false);
  const [showCustomFnModal, setShowCustomFnModal] = useState(false);
  const [showAudioInputModal, setShowAudioInputModal] = useState(false);
  const [codeEditMode, setCodeEditMode] = useState(false);
  const [hoveredInput, setHoveredInput] = useState<string | null>(null);
  const [hoveredOutput, setHoveredOutput] = useState<string | null>(null);
  const [showNodeTooltip, setShowNodeTooltip] = useState(false);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [zIndex, setZIndex] = useState(1);

  // Scope node: canvas ref + global registry (drawing happens in ShaderCanvas animation loop)
  const scopeCanvasRef        = useRef<HTMLCanvasElement>(null);
  const previewScopeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Register / unregister this canvas in the global scope registry so ShaderCanvas
  // can draw directly without going through React state (eliminates setState→re-render lag).
  React.useEffect(() => {
    if (node.type !== 'scope' && !LFO_TYPES.has(node.type)) return;
    const canvas = scopeCanvasRef.current;
    if (canvas) scopeCanvasRegistry.set(node.id, canvas);
    return () => {
      scopeCanvasRegistry.delete(node.id);
      scopeBufferRegistry.delete(node.id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.type, node.id]);

  // Determine if the primary output is float (for preview scope vs shader thumbnail)
  const primaryOutputIsFloat = !!def && Object.values(def.outputs).some(s => s.type === 'float');

  // Register preview scope canvas when 👁 is active and output is float
  React.useEffect(() => {
    if (!isPreviewActive || !primaryOutputIsFloat) return;
    const canvas = previewScopeCanvasRef.current;
    const key = `__preview__${node.id}`;
    if (canvas) scopeCanvasRegistry.set(key, canvas);
    return () => {
      scopeCanvasRegistry.delete(key);
      scopeBufferRegistry.delete(key);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewActive, primaryOutputIsFloat, node.id]);

  // ── Audio Input: sync freq params to engine each time they change ────────────
  React.useEffect(() => {
    if (node.type !== 'audioInput') return;
    const rawBands = node.params._bands;
    const bs: number[] = Array.isArray(rawBands) ? rawBands as number[] : [200];
    const range = typeof node.params.freq_range === 'number' ? node.params.freq_range : 200;
    const m = (node.params.mode as string) ?? 'band';
    audioEngine.updateFreqParams(node.id, bs, range, m);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.params?._bands, node.params?.freq_range, node.params?.mode]);

  // ── Audio Input: cleanup when node is removed ─────────────────────────────────
  React.useEffect(() => {
    if (node.type !== 'audioInput') return;
    return () => {
      audioEngine.removeAudio(node.id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  if (!def) return null;

  // ── Loop Index node special card ─────────────────────────────────────────────
  if (node.type === 'loopIndex') {
    // Deletable if: in the main graph (no active group), OR inside a group with 2+ loop index nodes
    const loopIndexSiblingCount = (() => {
      if (!activeGroupId) return 0; // main graph — count doesn't matter, always deletable
      const group = nodes.find(n => n.id === activeGroupId);
      const sg = group?.params.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
      return sg ? sg.nodes.filter(n => n.type === 'loopIndex').length : 0;
    })();
    const canDeleteLoopIndex = !activeGroupId || loopIndexSiblingCount > 1;

    const nodeStyle: React.CSSProperties = {
      position: 'absolute',
      left: node.position.x,
      top: node.position.y,
      minWidth: '140px',
      background: '#1e1e2e',
      border: `1px solid ${isSelected || isMultiSelected ? '#cba6f7' : '#45475a'}`,
      borderRadius: '8px',
      boxShadow: isSelected || isMultiSelected ? '0 0 0 2px #cba6f744' : '0 2px 8px rgba(0,0,0,0.4)',
      opacity: dimmed ? 0.3 : 1,
      transition: 'opacity 0.15s',
      cursor: 'default',
      userSelect: 'none',
    };
    return (
      <div
        style={nodeStyle}
        onMouseDown={e => {
          e.stopPropagation();
          setSelectedNodeId(node.id);
          selectNode(node.id, e.shiftKey || e.metaKey);
          const startX = e.clientX - node.position.x;
          const startY = e.clientY - node.position.y;
          const onMove = (me: MouseEvent) => updateNodePosition(node.id, { x: me.clientX - startX, y: me.clientY - startY });
          const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        {/* Header */}
        <div style={{ background: '#181825', borderRadius: '8px 8px 0 0', padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}>
          <span style={{ fontWeight: 700, fontSize: '11px', color: '#cba6f7', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10px', opacity: 0.7 }}>⟳</span> Loop Index
          </span>
          {canDeleteLoopIndex ? (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => removeNode(node.id)}
              style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
              title="Remove loop index"
            >✕</button>
          ) : (
            <span style={{ fontSize: '9px', color: '#585b70', fontFamily: 'monospace' }} title="Last loop index in group — cannot delete">🔒</span>
          )}
        </div>
        {/* Body */}
        <div style={{ padding: '6px 0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '3px 0 3px 10px' }}>
            <span style={{ color: '#a6adc8', fontSize: '11px', marginRight: '6px', fontFamily: 'monospace', opacity: 0.6 }}>float i</span>
            <div
              data-socket="out"
              ref={el => registerSocket(node.id, 'out', 'i', el)}
              onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, 'i', e); }}
              style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: TYPE_COLORS['float'] || '#f0a',
                border: `2px solid ${TYPE_COLORS['float'] || '#f0a'}`,
                marginRight: '-6px', flexShrink: 0, cursor: 'crosshair',
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Texture Input node special card ─────────────────────────────────────────
  if (node.type === 'textureInput') {
    const thumbnailUrl = node.params._thumbnailUrl as string | undefined;
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const loader = new THREE.TextureLoader();
      loader.load(url, (tex) => {
        setNodeTexture(node.id, tex);
        // Store thumbnail URL in params for display
        updateNodeParams(node.id, { _thumbnailUrl: url }, { immediate: true });
      });
    };

    return (
      <div
        style={{
          position: 'absolute', left: node.position.x, top: node.position.y,
          background: '#1e1e2e', border: isSelected ? '1px solid #89b4fa' : '1px solid #45475a',
          borderRadius: '8px', width: '200px', color: '#cdd6f4', fontSize: '12px',
          userSelect: 'none', opacity: dimmed ? 0.2 : 1,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          onMouseDown={(e) => {
            if (e.button === 2) return;
            e.stopPropagation();
            dragOffset.current = { x: e.clientX / zoom - node.position.x, y: e.clientY / zoom - node.position.y };
            const onMove = (ev: MouseEvent) => {
              if (!dragOffset.current) return;
              updateNodePosition(node.id, { x: ev.clientX / zoom - dragOffset.current.x, y: ev.clientY / zoom - dragOffset.current.y });
            };
            const onUp = () => {
              dragOffset.current = null;
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
              setSelectedNodeId(isSelected ? null : node.id);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
          style={{ background: '#313244', borderRadius: '6px 6px 0 0', padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}
        >
          <span style={{ fontWeight: 600, fontSize: '11px' }}>Texture Input</span>
          <button onMouseDown={e => e.stopPropagation()} onClick={() => removeNode(node.id)} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: '13px' }}>✕</button>
        </div>

        {/* Thumbnail or placeholder */}
        <div style={{ padding: '8px 10px', display: 'flex', gap: '8px', alignItems: 'center' }} onMouseDown={e => e.stopPropagation()}>
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="texture" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '4px', border: '1px solid #45475a', flexShrink: 0 }} />
          ) : (
            <div style={{ width: 48, height: 48, background: '#313244', borderRadius: '4px', border: '1px dashed #45475a', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🖼</div>
          )}
          <label style={{ fontSize: '10px', color: '#89b4fa', cursor: 'pointer', border: '1px solid #89b4fa55', borderRadius: '3px', padding: '3px 7px' }}>
            {nodeTexture ? 'Change' : 'Load Image'}
            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Output sockets */}
        <div style={{ padding: '3px 0 5px', display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
          {Object.entries(node.outputs).map(([key, out]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '4px' }}>
              <span style={{ fontSize: '10px', color: '#a6adc8' }}>{out.label}</span>
              <div
                data-socket="out"
                ref={el => { registerSocket(node.id, 'out', key, el); }}
                onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, key); }}
                style={{ width: isTouchDevice ? 22 : 12, height: isTouchDevice ? 22 : 12, borderRadius: '50%', background: TYPE_COLORS[out.type] ?? '#888', border: `2px solid ${TYPE_COLORS[out.type] ?? '#888'}`, cursor: 'crosshair', marginRight: isTouchDevice ? '-11px' : '-6px', touchAction: 'manipulation', boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === key ? `0 0 0 3px ${TYPE_COLORS[out.type] ?? '#888'}, 0 0 12px ${TYPE_COLORS[out.type] ?? '#888'}` : undefined }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Audio Input node special card ────────────────────────────────────────────
  if (node.type === 'audioInput') {
    const hasFile      = !!(node.params._hasFile);
    const fileName     = (node.params._fileName as string) || '';
    const isNodePlaying = !!(node.params._isPlaying);
    const rawBands     = node.params._bands;
    const bands: number[] = Array.isArray(rawBands) ? rawBands as number[] : [200];
    const freqRange    = typeof node.params.freq_range  === 'number' ? node.params.freq_range  : 200;
    const mode         = (node.params.mode as string) ?? 'band';
    const soloedBand   = typeof node.params._soloedBand === 'number' ? node.params._soloedBand : -1;

    const buildOutputs = (bs: number[]) =>
      Object.fromEntries(bs.map((_, i) => [`amplitude_${i}`, { type: 'float' as const, label: `Band ${i}` }]));

    const buildInputs = (bs: number[]) =>
      Object.fromEntries(bs.map((_, i) => [
        `band_${i}_center`,
        { type: 'float' as const, label: `Band ${i} Hz` },
      ]));

    const handleAddBand = () => {
      const newBands = [...bands, 1000];
      updateNodeParams(node.id, { _bands: newBands }, { immediate: true });
      updateNodeOutputs(node.id, buildOutputs(newBands));
      updateNodeInputs(node.id, buildInputs(newBands));
    };

    const handleRemoveBand = (i: number) => {
      if (bands.length <= 1) return;
      const newBands = bands.filter((_, idx) => idx !== i);
      updateNodeParams(node.id, { _bands: newBands }, { immediate: true });
      updateNodeOutputs(node.id, buildOutputs(newBands));
      updateNodeInputs(node.id, buildInputs(newBands));
    };

    const handleSolo = (i: number) => {
      updateNodeParams(node.id, { _soloedBand: soloedBand === i ? -1 : i }, { immediate: true });
    };

    const audioFileInputRef = useRef<HTMLInputElement>(null);

    const loadAudioFile = (file: File) => {
      if (!file.name.match(/\.(wav|mp3|ogg|aac|flac)$/i)) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const arrayBuffer = ev.target?.result as ArrayBuffer;
        await audioEngine.loadAudio(node.id, arrayBuffer, file.name);
        audioEngine.startAudio(node.id);
        updateNodeParams(node.id, { _fileName: file.name, _hasFile: true, _isPlaying: true }, { immediate: true });
      };
      reader.readAsArrayBuffer(file);
    };

    const handleAudioDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      loadAudioFile(file);
    };

    const handleAudioFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      loadAudioFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    };

    const togglePlay = () => {
      if (isNodePlaying) {
        audioEngine.stopAudio(node.id);
        updateNodeParams(node.id, { _isPlaying: false }, { immediate: true });
      } else {
        if (audioEngine.isLoaded(node.id)) {
          audioEngine.startAudio(node.id);
          updateNodeParams(node.id, { _isPlaying: true }, { immediate: true });
        }
      }
    };

    return (
      <>
        <div
          style={{
            position: 'absolute', left: node.position.x, top: node.position.y,
            background: '#1e1e2e', border: isSelected ? '1px solid #89b4fa' : '1px solid #45475a',
            borderRadius: '8px', width: '240px', color: '#cdd6f4', fontSize: '12px',
            userSelect: 'none', opacity: dimmed ? 0.2 : 1,
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {/* Header */}
          <div
            onMouseDown={(e) => {
              if (e.button === 2) return;
              e.stopPropagation();
              dragOffset.current = { x: e.clientX / zoom - node.position.x, y: e.clientY / zoom - node.position.y };
              const onMove = (ev: MouseEvent) => {
                if (!dragOffset.current) return;
                updateNodePosition(node.id, { x: ev.clientX / zoom - dragOffset.current.x, y: ev.clientY / zoom - dragOffset.current.y });
              };
              const onUp = () => {
                dragOffset.current = null;
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                setSelectedNodeId(isSelected ? null : node.id);
              };
              window.addEventListener('mousemove', onMove);
              window.addEventListener('mouseup', onUp);
            }}
            style={{ background: '#313244', borderRadius: '6px 6px 0 0', padding: '5px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Play/pause button */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={togglePlay}
                title={isNodePlaying ? 'Pause' : 'Play'}
                disabled={!hasFile}
                style={{ background: 'none', border: 'none', color: !hasFile ? '#45475a' : isNodePlaying ? '#a6e3a1' : '#89dceb', cursor: hasFile ? 'pointer' : 'default', fontSize: '11px', padding: '0', lineHeight: 1 }}
              >{isNodePlaying ? '⏸' : '▶'}</button>
              <span style={{ fontWeight: 600, fontSize: '11px', color: '#89dceb' }}>
                Audio Input{soloedBand >= 0 ? <span style={{ color: '#f9e2af', fontSize: '9px', marginLeft: '4px' }}>SOLO</span> : null}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Open analyzer modal */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setShowAudioInputModal(v => !v)}
                title="Open Audio analyzer"
                style={{ background: 'none', border: 'none', color: showAudioInputModal ? '#89dceb' : '#585b70', cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
              >◉</button>
              <button onMouseDown={e => e.stopPropagation()} onClick={() => removeNode(node.id)} style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: '13px' }}>✕</button>
            </div>
          </div>

          {/* Hidden file input for click-to-upload */}
          <input
            ref={audioFileInputRef}
            type="file"
            accept="audio/*,.wav,.mp3,.ogg,.aac,.flac"
            style={{ display: 'none' }}
            onChange={handleAudioFileInput}
          />

          {/* File drop zone — click or drag to load audio */}
          <div
            onDrop={handleAudioDrop}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => audioFileInputRef.current?.click()}
            style={{
              padding: '6px 10px',
              border: '1px dashed #45475a',
              borderRadius: '4px',
              margin: '6px 8px',
              textAlign: 'center',
              cursor: 'pointer',
              background: '#181825',
            }}
          >
            {hasFile ? (
              <span style={{ fontSize: '10px', color: '#89dceb', fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ♫ {fileName}
              </span>
            ) : (
              <span style={{ fontSize: '10px', color: '#585b70' }}>Click or drop WAV / MP3 / OGG</span>
            )}
          </div>

          {/* Params */}
          <div style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: '5px' }} onMouseDown={e => e.stopPropagation()}>
            {/* Mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: '#585b70', width: '60px', flexShrink: 0 }}>Mode</span>
              <select
                value={mode}
                onChange={e => updateNodeParams(node.id, { mode: e.target.value }, { immediate: true })}
                style={{ flex: 1, background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', fontSize: '10px', borderRadius: '4px', padding: '2px 4px', cursor: 'pointer' }}
              >
                <option value="band">Band</option>
                <option value="full">Full Spectrum</option>
              </select>
            </div>
            {/* Shared range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: '#585b70', width: '60px', flexShrink: 0 }}>Range Hz</span>
              <input
                type="range" min={0} max={10000} step={1}
                value={freqRange}
                disabled={mode === 'full'}
                onChange={e => updateNodeParams(node.id, { freq_range: parseFloat(e.target.value) }, { immediate: true })}
                style={{ flex: 1, accentColor: '#89dceb', cursor: mode === 'full' ? 'default' : 'pointer', opacity: mode === 'full' ? 0.3 : 1 }}
              />
              <span style={{ fontSize: '10px', color: '#6c7086', fontFamily: 'monospace', width: '42px', textAlign: 'right' }}>±{freqRange}</span>
            </div>
            {/* Band list */}
            {mode !== 'full' && bands.map((center, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleRemoveBand(i)}
                  disabled={bands.length <= 1}
                  title="Remove band"
                  style={{ background: 'none', border: 'none', color: bands.length <= 1 ? '#45475a' : '#585b70', cursor: bands.length <= 1 ? 'default' : 'pointer', fontSize: '11px', padding: '0', lineHeight: 1, flexShrink: 0 }}
                >×</button>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleSolo(i)}
                  title={soloedBand === i ? 'Un-solo' : 'Solo this band'}
                  style={{ background: 'none', border: 'none', color: soloedBand === i ? '#f9e2af' : '#45475a', cursor: 'pointer', fontSize: '9px', padding: '0', lineHeight: 1, flexShrink: 0, fontWeight: 700 }}
                >S</button>
                <input
                  type="range" min={0} max={1000} step={1}
                  value={hzToSlider(center)}
                  onChange={e => {
                    const newHz = sliderToHz(parseInt(e.target.value));
                    const newBands = bands.map((c, idx) => idx === i ? newHz : c);
                    updateNodeParams(node.id, { _bands: newBands }, { immediate: true });
                  }}
                  style={{ flex: 1, accentColor: '#89dceb', cursor: 'pointer' }}
                />
                <span style={{ fontSize: '10px', color: '#6c7086', fontFamily: 'monospace', width: '38px', textAlign: 'right' }}>
                  {center >= 1000 ? `${(center/1000).toFixed(1)}k` : `${center}`}
                </span>
              </div>
            ))}
            {/* Add band button */}
            {mode !== 'full' && (
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={handleAddBand}
                style={{ background: '#313244', border: '1px dashed #45475a', color: '#585b70', fontSize: '10px', borderRadius: '4px', padding: '3px', cursor: 'pointer', width: '100%', marginTop: '2px' }}
              >+ Add Band</button>
            )}
          </div>

          {/* Inline freq-range viz */}
          <AudioFreqRangeViz node={node} />

          {/* Output sockets */}
          <div style={{ padding: '3px 0 5px', display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
            {Object.entries(node.outputs).map(([key, out]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '4px' }}>
                <span style={{ fontSize: '10px', color: '#a6adc8' }}>{out.label}</span>
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', key, el); }}
                  onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                  style={{ width: 12, height: 12, borderRadius: '50%', background: TYPE_COLORS['float'] ?? '#f0a', border: `2px solid ${TYPE_COLORS['float'] ?? '#f0a'}`, cursor: 'crosshair', marginRight: '-6px' }}
                />
              </div>
            ))}
          </div>
        </div>
        {/* Audio Input Modal (portal) */}
        {showAudioInputModal && (
          <AudioInputModal node={node} onClose={() => setShowAudioInputModal(false)} />
        )}
      </>
    );
  }

  // Touch drag handler for node header — declared early so scope node can use it too
  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    dragOffset.current = {
      x: touch.clientX / zoom - node.position.x,
      y: touch.clientY / zoom - node.position.y,
    };
    let hasDragged = false;
    const startX = touch.clientX;
    const startY = touch.clientY;

    const handleTouchMove = (ev: TouchEvent) => {
      const t = ev.touches[0];
      if (!t || !dragOffset.current) return;
      if (!hasDragged && (Math.abs(t.clientX - startX) > 5 || Math.abs(t.clientY - startY) > 5)) {
        hasDragged = true;
      }
      if (hasDragged) {
        ev.preventDefault();
        updateNodePosition(node.id, {
          x: t.clientX / zoom - dragOffset.current.x,
          y: t.clientY / zoom - dragOffset.current.y,
        });
      }
    };

    const handleTouchEnd = () => {
      dragOffset.current = null;
      if (!hasDragged) {
        setSelectedNodeId(isSelected ? null : node.id);
        selectNode(node.id, false);
      }
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };

    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
  };

  const handleScopeHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    dragOffset.current = {
      x: e.clientX / zoom - node.position.x,
      y: e.clientY / zoom - node.position.y,
    };
    let hasDragged = false;
    const startX = e.clientX;
    const startY = e.clientY;
    document.body.style.userSelect = 'none';
    const handleMove = (ev: MouseEvent) => {
      if (!dragOffset.current) return;
      if (!hasDragged && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) hasDragged = true;
      updateNodePosition(node.id, { x: ev.clientX / zoom - dragOffset.current.x, y: ev.clientY / zoom - dragOffset.current.y });
    };
    const handleUp = () => {
      dragOffset.current = null;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      if (!hasDragged) {
        if (e.metaKey || e.ctrlKey) selectNode(node.id, true);
        else { setSelectedNodeId(isSelected ? null : node.id); selectNode(node.id, false); }
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  // ── Scope node special card ──────────────────────────────────────────────────
  if (node.type === 'scope') {
    return (
      <div
        style={{
          position: 'absolute',
          left: node.position.x,
          top: node.position.y,
          background: '#1e1e2e',
          border: isSelected ? '1px solid #89b4fa' : '1px solid #444',
          borderRadius: '8px',
          width: '220px',
          color: '#cdd6f4',
          fontSize: '12px',
          userSelect: 'none',
          opacity: dimmed ? 0.2 : 1,
          boxShadow: isSelected ? '0 0 10px #89b4fa33, 0 4px 12px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div
          onMouseDown={handleScopeHeaderMouseDown}
          onTouchStart={handleHeaderTouchStart}
          style={{
            background: '#313244', borderRadius: '6px 6px 0 0',
            padding: '5px 10px', display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', cursor: 'grab',
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ opacity: 0.7 }}>⌇</span> Scope
          </span>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => removeNode(node.id)}
            style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}
          >✕</button>
        </div>

        {/* Waveform canvas */}
        <canvas
          ref={scopeCanvasRef}
          width={220}
          height={80}
          style={{ display: 'block', width: '100%', height: '80px', borderBottom: '1px solid #313244' }}
        />

        {/* Min/Max params */}
        <div style={{ padding: '4px 10px', display: 'flex', gap: '8px', alignItems: 'center' }}
             onMouseDown={e => e.stopPropagation()}>
          {(['min', 'max'] as const).map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
              <span style={{ color: '#6c7086', fontSize: '10px', minWidth: '22px' }}>{key}</span>
              <input
                type="number"
                value={typeof node.params[key] === 'number' ? node.params[key] as number : (key === 'min' ? -1 : 1)}
                step={0.1}
                onChange={e => updateNodeParams(node.id, { [key]: parseFloat(e.target.value) || 0 })}
                style={{ ...INPUT_STYLE, width: '48px', fontSize: '10px', padding: '1px 4px' }}
              />
            </div>
          ))}
        </div>

        {/* Input / Output sockets */}
        <div style={{ padding: '3px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 10px 0 0' }}>
            <div
              ref={el => { registerSocket(node.id, 'in', 'value', el); }}
              onMouseUp={e => {
                e.stopPropagation();
                if (node.inputs.value?.connection && !isConnectionDragging) {
                  disconnectInput(node.id, 'value');
                } else {
                  onEndConnection(node.id, 'value');
                }
              }}
              style={{
                width: 12, height: 12, borderRadius: '50%',
                background: node.inputs.value?.connection ? TYPE_COLORS['float'] : '#333',
                border: `2px solid ${TYPE_COLORS['float']}`,
                cursor: 'crosshair', flexShrink: 0, marginLeft: '-6px',
              }}
            />
            <span style={{ fontSize: '10px', color: '#a6adc8' }}>value</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 0 0 10px' }}>
            <span style={{ fontSize: '10px', color: '#a6adc8' }}>value</span>
            <div
              data-socket="out"
              ref={el => { registerSocket(node.id, 'out', 'value', el); }}
              onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, 'value', e); }}
              onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, 'value'); }}
              style={{
                width: isTouchDevice ? 22 : 12, height: isTouchDevice ? 22 : 12, borderRadius: '50%',
                background: TYPE_COLORS['float'], border: `2px solid ${TYPE_COLORS['float']}`,
                cursor: 'crosshair', flexShrink: 0, marginRight: isTouchDevice ? '-11px' : '-6px',
                touchAction: 'manipulation',
                boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === 'value' ? `0 0 0 3px ${TYPE_COLORS['float']}, 0 0 12px ${TYPE_COLORS['float']}` : undefined,
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── March Loop anchor node state ────────────────────────────────────────────
  const [addingMarchInput, setAddingMarchInput] = useState<{name: string; type: DataType} | null>(null);

  // ── Group node special card ──────────────────────────────────────────────────
  const [editingPortKey, setEditingPortKey] = useState<string | null>(null);
  const [editingPortLabel, setEditingPortLabel] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionLabel, setEditingSectionLabel] = useState('');
  const [savingMode, setSavingMode] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveHovered, setSaveHovered] = useState(false);
  const [openSliderConfig, setOpenSliderConfig] = useState<string | null>(null);
  const [hoveredSliderKey, setHoveredSliderKey] = useState<string | null>(null);
  const [editingSliderKey, setEditingSliderKey] = useState<string | null>(null);
  const [editingSliderValue, setEditingSliderValue] = useState('');
  const [showParamPicker, setShowParamPicker] = useState(false);
  const [showInitModal, setShowInitModal] = useState(false);

  // ── March Loop Group anchor nodes — special card rendering ──────────────────
  const MARCH_STANDARD_OUTPUTS = [
    { key: 'color',     type: 'vec3' as DataType,  label: 'Color' },
    { key: 'normal',    type: 'vec3' as DataType,  label: 'Normal' },
    { key: 'dist',      type: 'float' as DataType, label: 'Dist' },
    { key: 'iter',      type: 'float' as DataType, label: 'Iter' },
    { key: 'iterCount', type: 'float' as DataType, label: 'Iter Count' },
    { key: 'hit',       type: 'float' as DataType, label: 'Hit' },
    { key: 'depth',     type: 'float' as DataType, label: 'Depth' },
    { key: 'pos',       type: 'vec3' as DataType,  label: 'Hit Pos' },
  ] as const;

  const SOCKET_COLORS: Record<string, string> = {
    vec3: '#a6e3a1',
    float: '#f38ba8',
    vec2: '#89b4fa',
    vec4: '#fab387',
  };

  const handleAnchorDragMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    dragOffset.current = {
      x: e.clientX / zoom - node.position.x,
      y: e.clientY / zoom - node.position.y,
    };
    document.body.style.userSelect = 'none';
    const handleMove = (ev: MouseEvent) => {
      if (!dragOffset.current) return;
      updateNodePosition(node.id, { x: ev.clientX / zoom - dragOffset.current.x, y: ev.clientY / zoom - dragOffset.current.y });
    };
    const handleUp = () => {
      dragOffset.current = null;
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  if (node.type === 'marchLoopInputs') {
    const extraInputs = (node.params.extraInputs ?? []) as Array<{key: string; type: string; label: string}>;
    const fixedOutputs = [
      { key: 'ro',        type: 'vec3',  label: 'Ray Origin' },
      { key: 'rd',        type: 'vec3',  label: 'Ray Dir' },
      { key: 'marchPos',  type: 'vec3',  label: 'March Pos' },
      { key: 'marchDist', type: 'float', label: 'March Dist' },
    ] as const;

    return (
      <div
        data-node-id={node.id}
        style={{
          position: 'absolute',
          left: node.position.x,
          top: node.position.y,
          background: '#1e1e2e',
          border: isSelected ? '1px solid #88aacc' : '1px solid #45475a',
          borderRadius: '8px',
          minWidth: '180px',
          color: '#cdd6f4',
          fontSize: '12px',
          userSelect: 'none',
          zIndex,
          opacity: dimmed ? 0.2 : 1,
        }}
        onMouseDown={() => { setZIndex(++zCounter); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      >
        {/* Header */}
        <div
          style={{
            background: '#313244',
            borderRadius: '7px 7px 0 0',
            padding: '6px 10px',
            fontWeight: 700,
            fontSize: '11px',
            color: '#88aacc',
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onMouseDown={handleAnchorDragMouseDown}
          onClick={() => { setSelectedNodeId(isSelected ? null : node.id); selectNode(node.id, false); }}
        >
          <span style={{ fontSize: '10px' }}>&#9668;</span>
          Group Inputs
        </div>

        {/* Fixed outputs */}
        <div style={{ padding: '6px 0' }}>
          {fixedOutputs.map(({ key, type, label }) => {
            const color = SOCKET_COLORS[type] ?? '#a6adc8';
            return (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 8px 2px 10px', gap: 6, position: 'relative' }}
                onMouseEnter={() => setHoveredOutput(key)}
                onMouseLeave={() => setHoveredOutput(null)}
              >
                <span style={{ fontSize: '10px', color: '#585b70' }}>&#128274;</span>
                <span style={{ fontSize: '11px', color: '#a6adc8' }}>{label}</span>
                <div
                  ref={el => { if (el) registerSocket(node.id, 'out', key, el); }}
                  onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: hoveredOutput === key ? '#ffffff' : color,
                    border: `2px solid ${color}`,
                    cursor: 'crosshair',
                    flexShrink: 0,
                    transition: 'background 0.1s',
                  }}
                />
              </div>
            );
          })}

          {/* User-added extra outputs */}
          {extraInputs.map(({ key, type, label }) => {
            const color = SOCKET_COLORS[type] ?? '#a6adc8';
            return (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 8px 2px 10px', gap: 6, position: 'relative' }}
                onMouseEnter={() => setHoveredOutput(key)}
                onMouseLeave={() => setHoveredOutput(null)}
              >
                <button
                  onClick={() => activeGroupId && removeMarchLoopInput(activeGroupId, key)}
                  style={{
                    background: 'none', border: 'none', color: '#585b70', cursor: 'pointer',
                    padding: '0 2px', fontSize: '11px', lineHeight: 1,
                  }}
                  title={`Remove ${label}`}
                >&#10005;</button>
                <span style={{ fontSize: '11px', color: '#cdd6f4' }}>{label}</span>
                <span style={{ fontSize: '10px', color: '#585b70' }}>({type})</span>
                <div
                  ref={el => { if (el) registerSocket(node.id, 'out', key, el); }}
                  onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: hoveredOutput === key ? '#ffffff' : color,
                    border: `2px solid ${color}`,
                    cursor: 'crosshair',
                    flexShrink: 0,
                    transition: 'background 0.1s',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Add Input form */}
        <div style={{ borderTop: '1px solid #31324488', padding: '6px 8px' }}>
          {addingMarchInput ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                autoFocus
                placeholder="name (e.g. speed)"
                value={addingMarchInput.name}
                onChange={e => setAddingMarchInput(prev => prev ? { ...prev, name: e.target.value } : prev)}
                onKeyDown={e => {
                  if (e.key === 'Escape') setAddingMarchInput(null);
                  if (e.key === 'Enter' && addingMarchInput.name.trim() && activeGroupId) {
                    addMarchLoopInput(activeGroupId, addingMarchInput.name.trim(), addingMarchInput.type, addingMarchInput.name.trim());
                    setAddingMarchInput(null);
                  }
                }}
                style={{ ...INPUT_STYLE, width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {(['float', 'vec2', 'vec3', 'vec4'] as DataType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setAddingMarchInput(prev => prev ? { ...prev, type: t } : prev)}
                    style={{
                      background: addingMarchInput.type === t ? '#88aacc' : '#31324488',
                      border: `1px solid ${addingMarchInput.type === t ? '#88aacc' : '#585b70'}`,
                      borderRadius: 3, color: addingMarchInput.type === t ? '#1e1e2e' : '#a6adc8',
                      fontSize: '10px', padding: '2px 5px', cursor: 'pointer',
                    }}
                  >{t}</button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => {
                    if (addingMarchInput.name.trim() && activeGroupId) {
                      addMarchLoopInput(activeGroupId, addingMarchInput.name.trim(), addingMarchInput.type, addingMarchInput.name.trim());
                      setAddingMarchInput(null);
                    }
                  }}
                  style={{ flex: 1, background: '#88aacc22', border: '1px solid #88aacc', borderRadius: 3, color: '#88aacc', fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}
                >Add</button>
                <button
                  onClick={() => setAddingMarchInput(null)}
                  style={{ flex: 1, background: 'none', border: '1px solid #45475a', borderRadius: 3, color: '#585b70', fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingMarchInput({ name: '', type: 'float' })}
              style={{
                width: '100%', background: 'none', border: '1px dashed #45475a',
                borderRadius: 3, color: '#585b70', fontSize: '10px', padding: '3px 0',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
              }}
            >
              <span>&#43;</span> Add Input
            </button>
          )}
        </div>
      </div>
    );
  }

  if (node.type === 'marchLoopOutput') {
    return (
      <div
        data-node-id={node.id}
        style={{
          position: 'absolute',
          left: node.position.x,
          top: node.position.y,
          background: '#1e1e2e',
          border: isSelected ? '1px solid #88aacc' : '1px solid #45475a',
          borderRadius: '8px',
          minWidth: '200px',
          color: '#cdd6f4',
          fontSize: '12px',
          userSelect: 'none',
          zIndex,
          opacity: dimmed ? 0.2 : 1,
        }}
        onMouseDown={() => { setZIndex(++zCounter); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      >
        {/* Header */}
        <div
          style={{
            background: '#313244',
            borderRadius: '7px 7px 0 0',
            padding: '6px 10px',
            fontWeight: 700,
            fontSize: '11px',
            color: '#88aacc',
            cursor: 'grab',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
          onMouseDown={handleAnchorDragMouseDown}
          onClick={() => { setSelectedNodeId(isSelected ? null : node.id); selectNode(node.id, false); }}
        >
          Group Output
          <span style={{ fontSize: '10px' }}>&#9658;</span>
        </div>

        {/* pos input socket */}
        <div style={{ padding: '6px 0' }}>
          {(() => {
            const posInp = node.inputs.pos;
            const color = '#a6e3a1';
            const isConnected = !!posInp?.connection;
            return (
              <div
                style={{ display: 'flex', alignItems: 'center', padding: '2px 10px 2px 8px', gap: 6, position: 'relative' }}
                onMouseEnter={() => setHoveredInput('pos')}
                onMouseLeave={() => setHoveredInput(null)}
              >
                <div
                  ref={el => { if (el) registerSocket(node.id, 'in', 'pos', el); }}
                  onMouseUp={() => onEndConnection(node.id, 'pos')}
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: isConnected ? color : (hoveredInput === 'pos' ? '#ffffff' : 'transparent'),
                    border: `2px solid ${color}`,
                    cursor: 'crosshair',
                    flexShrink: 0,
                    transition: 'background 0.1s',
                  }}
                />
                <span style={{ fontSize: '11px', color: '#a6adc8' }}>Position</span>
                <span style={{ fontSize: '10px', color: '#585b70' }}>&#128274;</span>
              </div>
            );
          })()}
        </div>

        {/* Standard outputs toggle section */}
        {activeGroupId && (
          <div style={{ borderTop: '1px solid #31324488', padding: '6px 8px' }}>
            <div style={{ fontSize: '10px', color: '#585b70', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Outputs
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {MARCH_STANDARD_OUTPUTS.map(({ key, type, label }) => {
                const isHidden = mlGroupHiddenOutputs.includes(key);
                const color = SOCKET_COLORS[type] ?? '#a6adc8';
                return (
                  <button
                    key={key}
                    title={isHidden ? `Show ${label} output` : `Hide ${label} output`}
                    onClick={() => toggleMarchLoopOutputPort(activeGroupId, key)}
                    style={{
                      background: isHidden ? 'none' : `${color}22`,
                      border: `1px solid ${isHidden ? '#45475a' : color}`,
                      borderRadius: 3,
                      color: isHidden ? '#585b70' : color,
                      fontSize: '10px',
                      padding: '2px 5px',
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (node.type === 'group' || node.type === 'sceneGroup' || node.type === 'spaceWarpGroup' || node.type === 'marchLoopGroup') {
    const subgraph = node.params.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
    const defaultLabel = node.type === 'sceneGroup' ? 'Scene Group' : node.type === 'spaceWarpGroup' ? 'Space Warp Group' : node.type === 'marchLoopGroup' ? 'March Loop Group' : 'Group';
    const groupLabel = typeof node.params.label === 'string' ? node.params.label : defaultLabel;
    const nodeCount = subgraph?.nodes.length ?? 0;
    const inputPorts = subgraph?.inputPorts ?? [];
    const outputPorts = subgraph?.outputPorts ?? [];
    const groupIters = typeof node.params.iterations === 'number' ? node.params.iterations : 1;
    const hasInnerGroups = subgraph?.nodes.some(n => n.type === 'group') ?? false;
    const isSceneGroup = node.type === 'sceneGroup';
    const isSpaceWarpGroup = node.type === 'spaceWarpGroup';
    const isMarchLoopGroup = node.type === 'marchLoopGroup';
    // Color per type
    const groupAccentColor = isSceneGroup ? '#cc88aa' : isSpaceWarpGroup ? '#aa88cc' : isMarchLoopGroup ? '#88aacc' : (hasInnerGroups ? '#cba6f7' : '#89b4fa');

    const handleGroupHeaderMouseDown = (e: React.MouseEvent) => {
      if (e.button === 2) return;
      e.stopPropagation();
      e.preventDefault();
      dragOffset.current = {
        x: e.clientX / zoom - node.position.x,
        y: e.clientY / zoom - node.position.y,
      };
      let hasDragged = false;
      const startX = e.clientX;
      const startY = e.clientY;
      document.body.style.userSelect = 'none';
      const handleMove = (ev: MouseEvent) => {
        if (!dragOffset.current) return;
        if (!hasDragged && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) hasDragged = true;
        updateNodePosition(node.id, { x: ev.clientX / zoom - dragOffset.current.x, y: ev.clientY / zoom - dragOffset.current.y });
      };
      const handleUp = () => {
        dragOffset.current = null;
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        if (!hasDragged) {
          if (e.metaKey || e.ctrlKey) selectNode(node.id, true);
          else { setSelectedNodeId(isSelected ? null : node.id); selectNode(node.id, false); }
        }
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    };

    return (
      <div
        data-node-id={node.id}
        style={{
          position: 'absolute',
          left: node.position.x,
          top: node.position.y,
          background: '#1e1e2e',
          border: isMultiSelected ? `2px solid ${groupAccentColor}` : isSelected ? `1px solid ${groupAccentColor}` : `2px dashed ${groupAccentColor}`,
          borderRadius: '8px',
          minWidth: '200px',
          color: '#cdd6f4',
          fontSize: '12px',
          userSelect: 'none',
          opacity: dimmed ? 0.2 : 1,
          boxShadow: isMultiSelected ? `0 0 12px ${groupAccentColor}55, 0 4px 12px rgba(0,0,0,0.4)` : '0 4px 12px rgba(0,0,0,0.4)',
        }}
      >
        {/* Group header */}
        <div
          onMouseDown={handleGroupHeaderMouseDown}
          onDoubleClick={() => { if (!savingMode) onEnterGroup?.(node.id); }}
          style={{
            background: '#313244',
            borderRadius: '6px 6px 0 0',
            padding: '5px 8px 5px 10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'grab',
            gap: '6px',
          }}
        >
          {/* Label + count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <span style={{ fontSize: '13px', flexShrink: 0 }}>{isSceneGroup ? '◉' : isSpaceWarpGroup ? '⟳' : isMarchLoopGroup ? '⟲' : '⬡'}</span>
            <span style={{ fontWeight: 600, color: groupAccentColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{groupLabel}</span>
            <span style={{ fontSize: '10px', color: '#585b70', flexShrink: 0 }}>({nodeCount})</span>
          </div>
          {/* Action icons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
            {/* Duplicate */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); duplicateGroup(node.id); }}
              title="Duplicate group (independent copy)"
              style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, borderRadius: '3px' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = groupAccentColor)}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
            >⧉</button>
            {/* Save preset */}
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                setSaveLabel(typeof node.params.label === 'string' ? node.params.label : 'Group');
                setSaveDescription('');
                setSavingMode(true);
              }}
              onMouseEnter={() => setSaveHovered(true)}
              onMouseLeave={() => setSaveHovered(false)}
              title="Save as preset"
              className={savedFlash ? 'group-save-flash' : ''}
              style={{
                background: 'none', border: 'none',
                color: saveHovered || savedFlash ? '#a6e3a1' : '#585b70',
                cursor: 'pointer', fontSize: '12px', padding: '2px 4px', lineHeight: 1, borderRadius: '3px',
                transition: 'color 0.15s',
              }}
            >↓</button>
            {/* Dissolve — only for regular groups, not scene groups */}
            {!isSceneGroup && (
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => ungroupNode(node.id)}
                title="Dissolve group"
                style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '11px', padding: '2px 4px', lineHeight: 1, borderRadius: '3px' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
              >✕</button>
            )}
            {/* Delete button — only for special group types (sceneGroup, marchLoopGroup) */}
            {(isSceneGroup || isMarchLoopGroup) && (
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={e => {
                  e.stopPropagation();
                  const label = isSceneGroup ? 'Scene Group' : 'March Loop Group';
                  if (window.confirm(`Delete ${label} and all its nodes?`)) {
                    removeNode(node.id);
                  }
                }}
                title={`Delete ${isSceneGroup ? 'Scene Group' : 'March Loop Group'}`}
                style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '13px', padding: '2px 4px', lineHeight: 1, borderRadius: '3px' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
              >✕</button>
            )}
          </div>
        </div>

        {/* Save-as-preset inline form — shown below header when savingMode is active */}
        {savingMode && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{ background: '#252536', padding: '5px 8px', display: 'flex', alignItems: 'center', gap: '4px', borderBottom: '1px solid #313244' }}
          >
            <input
              autoFocus
              value={saveLabel}
              onChange={e => setSaveLabel(e.target.value)}
              placeholder="Name…"
              onMouseDown={e => e.stopPropagation()}
              style={{ flex: 1, minWidth: '70px', background: '#11111b', border: '1px solid #89b4fa', color: '#cdd6f4', borderRadius: '3px', padding: '2px 5px', fontSize: '10px', outline: 'none' }}
            />
            <input
              value={saveDescription}
              onChange={e => setSaveDescription(e.target.value)}
              placeholder="Description…"
              onMouseDown={e => e.stopPropagation()}
              style={{ flex: 2, minWidth: '60px', background: '#11111b', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '3px', padding: '2px 5px', fontSize: '10px', outline: 'none' }}
            />
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => {
                if (saveLabel.trim()) {
                  saveGroupPreset(node.id, saveLabel.trim(), saveDescription.trim());
                  setSavedFlash(true);
                  setTimeout(() => setSavedFlash(false), 700);
                }
                setSavingMode(false);
              }}
              style={{ background: '#a6e3a1', border: 'none', color: '#1e1e2e', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer', fontWeight: 700 }}
            >✓</button>
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setSavingMode(false)}
              style={{ background: 'none', border: '1px solid #585b70', color: '#6c7086', borderRadius: '3px', padding: '2px 6px', fontSize: '10px', cursor: 'pointer' }}
            >✕</button>
          </div>
        )}

        {/* Iterations row — compact param row below header (group only) */}
        {node.type === 'group' && <div
          onMouseDown={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          style={{ padding: '3px 10px 3px 10px', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid #252536', background: '#252536' }}
        >
          <span style={{ fontSize: '9px', color: '#585b70', letterSpacing: '0.05em', minWidth: '60px' }}>ITERATIONS</span>
          <span style={{ fontSize: '10px', color: groupIters > 1 ? groupAccentColor : '#585b70', minWidth: '16px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>×{groupIters}</span>
          <input
            type="range"
            min={1}
            max={16}
            step={1}
            value={groupIters}
            onChange={e => {
              const v = Math.max(1, Math.min(16, Math.round(Number(e.target.value))));
              if (!isNaN(v)) updateNodeParams(node.id, { iterations: v }, { immediate: true });
            }}
            style={{ flex: 1, accentColor: groupAccentColor, cursor: 'pointer', margin: 0 }}
          />
        </div>}

        {/* Port list */}
        <div style={{ padding: '6px 10px', display: 'flex', gap: '12px', justifyContent: 'space-between' }}>
          {/* Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {/* MarchLoopGroup: render definition-based inputs */}
            {isMarchLoopGroup && Object.entries(node.inputs).map(([key, input]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div
                  ref={el => { registerSocket(node.id, 'in', key, el); }}
                  onMouseUp={e => {
                    e.stopPropagation();
                    if (node.inputs[key]?.connection && !isConnectionDragging) {
                      disconnectInput(node.id, key);
                    } else {
                      onEndConnection(node.id, key);
                    }
                  }}
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: node.inputs[key]?.connection
                      ? (TYPE_COLORS[input.type] ?? '#888')
                      : '#1e1e2e',
                    border: `2px solid ${TYPE_COLORS[input.type] ?? '#888'}`,
                    cursor: 'crosshair',
                    position: 'relative', left: -14,
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: '10px', color: '#a6adc8', marginLeft: -14 }}>{input.label}</span>
              </div>
            ))}
            {inputPorts.map((port) => (
              <div key={port.key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {/* Socket dot */}
                <div
                  ref={el => { registerSocket(node.id, 'in', port.key, el); }}
                  onMouseUp={e => {
                    e.stopPropagation();
                    if (node.inputs[port.key]?.connection && !isConnectionDragging) {
                      disconnectInput(node.id, port.key);
                    } else {
                      onEndConnection(node.id, port.key);
                    }
                  }}
                  style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: node.inputs[port.key]?.connection
                      ? (TYPE_COLORS[port.type] ?? '#888')
                      : '#1e1e2e',
                    border: `2px solid ${TYPE_COLORS[port.type] ?? '#888'}`,
                    cursor: 'crosshair',
                    position: 'relative', left: -14,
                    boxSizing: 'border-box',
                  }}
                />
                {editingPortKey === port.key ? (
                  <input
                    autoFocus
                    value={editingPortLabel}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => setEditingPortLabel(e.target.value)}
                    onBlur={() => {
                      if (editingPortLabel.trim()) {
                        renameGroupPort(node.id, port.key, 'in', editingPortLabel.trim());
                      }
                      setEditingPortKey(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingPortKey(null);
                    }}
                    style={{ width: '70px', fontSize: '10px', background: '#1e1e2e', border: '1px solid #89b4fa', color: '#cdd6f4', borderRadius: '2px', padding: '0 3px', outline: 'none' }}
                  />
                ) : (
                  <span
                    style={{ fontSize: '10px', color: '#a6adc8', marginLeft: -14, cursor: 'text' }}
                    title="Double-click to rename"
                    onDoubleClick={e => { e.stopPropagation(); setEditingPortKey(port.key); setEditingPortLabel(port.label); }}
                  >{port.label}</span>
                )}
              </div>
            ))}
          </div>

          {/* Outputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'flex-end' }}>
            {/* MarchLoopGroup: render definition-based outputs, skipping hidden ones */}
            {isMarchLoopGroup && Object.entries(node.outputs).filter(([key]) => {
              const hidden = (node.params.hiddenOutputs as string[] | undefined) ?? [];
              return !hidden.includes(key);
            }).map(([key, output]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: '#a6adc8' }}>{output.label}</span>
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', key, el); }}
                  onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                  onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, key); }}
                  style={{
                    width: isTouchDevice ? 20 : 10,
                    height: isTouchDevice ? 20 : 10,
                    borderRadius: '50%',
                    background: TYPE_COLORS[output.type] ?? '#888',
                    cursor: 'crosshair',
                    position: 'relative',
                    right: isTouchDevice ? -20 : -14,
                    touchAction: 'manipulation',
                    boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === key
                      ? `0 0 0 3px ${TYPE_COLORS[output.type] ?? '#888'}, 0 0 10px ${TYPE_COLORS[output.type] ?? '#888'}`
                      : undefined,
                  }}
                />
              </div>
            ))}
            {/* SceneGroup: always show the scene output socket */}
            {isSceneGroup && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10px', color: '#cc88aa' }}>Scene</span>
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', 'scene', el); }}
                  onMouseDown={e => onStartConnection(node.id, 'scene', e)}
                  onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, 'scene'); }}
                  style={{
                    width: isTouchDevice ? 20 : 10,
                    height: isTouchDevice ? 20 : 10,
                    borderRadius: '50%',
                    background: TYPE_COLORS['scene3d'] ?? '#cc88aa',
                    cursor: 'crosshair',
                    position: 'relative',
                    right: isTouchDevice ? -20 : -14,
                    touchAction: 'manipulation',
                    boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === 'scene'
                      ? `0 0 0 3px ${TYPE_COLORS['scene3d'] ?? '#cc88aa'}, 0 0 10px ${TYPE_COLORS['scene3d'] ?? '#cc88aa'}`
                      : undefined,
                  }}
                />
              </div>
            )}
            {outputPorts.map(port => (
              <div key={port.key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {editingPortKey === ('out_' + port.key) ? (
                  <input
                    autoFocus
                    value={editingPortLabel}
                    onMouseDown={e => e.stopPropagation()}
                    onChange={e => setEditingPortLabel(e.target.value)}
                    onBlur={() => {
                      if (editingPortLabel.trim()) {
                        renameGroupPort(node.id, port.key, 'out', editingPortLabel.trim());
                      }
                      setEditingPortKey(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingPortKey(null);
                    }}
                    style={{ width: '70px', fontSize: '10px', background: '#1e1e2e', border: '1px solid #89b4fa', color: '#cdd6f4', borderRadius: '2px', padding: '0 3px', outline: 'none' }}
                  />
                ) : (
                  <span
                    style={{ fontSize: '10px', color: '#a6adc8', cursor: 'text' }}
                    title="Double-click to rename"
                    onDoubleClick={e => { e.stopPropagation(); setEditingPortKey('out_' + port.key); setEditingPortLabel(port.label); }}
                  >{port.label}</span>
                )}
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', port.key, el); }}
                  onMouseDown={e => onStartConnection(node.id, port.key, e)}
                  onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, port.key); }}
                  style={{
                    width: isTouchDevice ? 20 : 10, height: isTouchDevice ? 20 : 10, borderRadius: '50%',
                    background: TYPE_COLORS[port.type] ?? '#888',
                    cursor: 'crosshair',
                    position: 'relative', right: isTouchDevice ? -20 : -14,
                    touchAction: 'manipulation',
                    boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === port.key ? `0 0 0 3px ${TYPE_COLORS[port.type] ?? '#888'}, 0 0 10px ${TYPE_COLORS[port.type] ?? '#888'}` : undefined,
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Inner node exposed params */}
        {subgraph && subgraph.nodes.map(innerNode => {
          // ── Inner GROUP node — render surfaced params ──────────────────────────
          if (innerNode.type === 'group') {
            const surfacedParams: SurfacedParam[] = Array.isArray(node.params.surfacedParams)
              ? (node.params.surfacedParams as SurfacedParam[]).filter(sp => sp.innerGroupId === innerNode.id)
              : [];
            const innerGroupSub = innerNode.params.subgraph as SubgraphData | undefined;
            const hasInnerParams = innerGroupSub?.nodes.some(inn => {
              const d = getNodeDefinition(inn.type);
              return d?.paramDefs && Object.values(d.paramDefs).some(pd => pd.type === 'float' && pd.step !== 1);
            }) ?? false;
            if (!hasInnerParams) return null;
            if (surfacedParams.length === 0) return null;

            const innerGroupLabel = typeof innerNode.params.label === 'string' ? innerNode.params.label : 'Inner Group';
            const sectionLabelKey = `__sectionLabel_${innerNode.id}`;
            const sectionLabel = typeof node.params[sectionLabelKey] === 'string'
              ? node.params[sectionLabelKey] as string
              : innerGroupLabel;

            return (
              <div key={innerNode.id} style={{ borderTop: '1px solid #313244' }}>
                <div
                  style={{ padding: '3px 10px 1px', fontSize: '9px', color: '#585b70', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '4px', userSelect: 'none' }}
                  onDoubleClick={e => {
                    e.stopPropagation();
                    setEditingSectionId(innerNode.id);
                    setEditingSectionLabel(sectionLabel);
                  }}
                >
                  {editingSectionId === innerNode.id ? (
                    <input
                      autoFocus
                      value={editingSectionLabel}
                      onChange={e => setEditingSectionLabel(e.target.value)}
                      onBlur={() => {
                        const trimmed = editingSectionLabel.trim();
                        updateNodeParams(node.id, { [sectionLabelKey]: trimmed || innerGroupLabel });
                        setEditingSectionId(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const trimmed = editingSectionLabel.trim();
                          updateNodeParams(node.id, { [sectionLabelKey]: trimmed || innerGroupLabel });
                          setEditingSectionId(null);
                        } else if (e.key === 'Escape') {
                          setEditingSectionId(null);
                        }
                      }}
                      onMouseDown={e => e.stopPropagation()}
                      style={{ background: 'transparent', border: 'none', borderBottom: '1px solid #585b70', color: '#a6adc8', fontSize: '9px', letterSpacing: '0.05em', outline: 'none', padding: 0, width: '100%', textTransform: 'uppercase' }}
                    />
                  ) : (
                    <span style={{ flex: 1, cursor: 'text' }}>{sectionLabel.toUpperCase()}</span>
                  )}
                  <span style={{ color: '#6c7086', fontSize: '9px' }}>⬡</span>
                </div>
                {surfacedParams.map(sp => {
                  const innNode = innerGroupSub?.nodes.find(n => n.id === sp.nodeId);
                  if (!innNode) return null;
                  const innDef = getNodeDefinition(innNode.type);
                  const paramDef = innDef?.paramDefs?.[sp.paramKey];
                  if (!paramDef) return null;
                  const psKey = `ps_${innerNode.id}_${sp.nodeId}_${sp.paramKey}`;
                  const psSocket = node.inputs[psKey];
                  const externallyDriven = !!(psSocket?.connection);
                  const overrideKey = `${innerNode.id}::${sp.nodeId}::${sp.paramKey}`;
                  const rawVal = node.params[overrideKey] ?? innNode.params[sp.paramKey];
                  const currentVal = typeof rawVal === 'number' ? rawVal : (typeof paramDef.min === 'number' ? paramDef.min : 0);
                  const step = paramDef.step ?? 0.01;
                  const baseMax = paramDef.max ?? 1;
                  const effMin = paramDef.min ?? 0;
                  return (
                    <div
                      key={`${sp.nodeId}::${sp.paramKey}`}
                      style={{ padding: '2px 10px 2px 14px', display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}
                      onMouseDown={e => e.stopPropagation()}
                    >
                      {/* ps_ socket dot */}
                      <div
                        ref={el => { registerSocket(node.id, 'in', psKey, el); }}
                        onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, psKey); }}
                        style={{
                          position: 'absolute',
                          left: isTouchDevice ? -6 : -5,
                          width: isTouchDevice ? 16 : 8,
                          height: isTouchDevice ? 16 : 8,
                          borderRadius: '50%',
                          background: externallyDriven ? '#f0a' : 'transparent',
                          border: `1.5px solid ${externallyDriven ? '#f0a' : '#585b70'}`,
                          cursor: 'crosshair',
                          touchAction: 'manipulation',
                        }}
                      />
                      <span style={{ color: externallyDriven ? '#a6adc8' : '#6c7086', fontSize: '10px', minWidth: '60px', flexShrink: 0 }}>
                        {sp.label ?? paramDef.label}
                      </span>
                      {externallyDriven ? (
                        <>
                          <span style={{ flex: 1, fontSize: '10px', color: '#585b70', fontStyle: 'italic' }}>wired</span>
                          <button
                            onMouseDown={e => e.stopPropagation()}
                            onClick={() => disconnectInput(node.id, psKey)}
                            style={{ fontSize: '9px', color: '#585b70', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                            title="Disconnect"
                          >×</button>
                        </>
                      ) : (
                        <>
                          <input
                            type="range"
                            min={effMin}
                            max={baseMax}
                            step={adaptiveStep(currentVal, step)}
                            value={Math.max(effMin, Math.min(baseMax, currentVal))}
                            onChange={e => updateNodeParams(node.id, { [overrideKey]: parseFloat(e.target.value) }, { immediate: true })}
                            style={{ flex: 1, accentColor: '#cba6f7', cursor: 'pointer' }}
                          />
                          {editingSliderKey === `sp_${overrideKey}` ? (
                            <input
                              autoFocus
                              type="text"
                              style={{ ...INPUT_STYLE, width: '40px', fontSize: '10px', border: '1px solid #585b70' }}
                              value={editingSliderValue}
                              onChange={e => setEditingSliderValue(e.target.value)}
                              onBlur={() => {
                                const v = parseFloat(editingSliderValue);
                                if (!isNaN(v)) updateNodeParams(node.id, { [overrideKey]: v });
                                setEditingSliderKey(null);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { const v = parseFloat(editingSliderValue); if (!isNaN(v)) updateNodeParams(node.id, { [overrideKey]: v }); setEditingSliderKey(null); }
                                if (e.key === 'Escape') setEditingSliderKey(null);
                              }}
                            />
                          ) : (
                            <span
                              title="Double-click to edit"
                              style={{ color: '#a6adc8', fontSize: '10px', minWidth: '32px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', cursor: 'text', userSelect: 'none' }}
                              onDoubleClick={() => { setEditingSliderKey(`sp_${overrideKey}`); setEditingSliderValue(String(currentVal)); }}
                            >
                              {currentVal.toFixed(adaptiveDecimals(adaptiveStep(currentVal, step)))}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          }

          // ── Regular inner node — show float params (minus hidden ones) ───────────
          const innerDef = getNodeDefinition(innerNode.type);
          const innerParamDefs = innerDef?.paramDefs ?? {};
          const paramEntries = Object.entries(innerParamDefs).filter(([, pd]) =>
            pd.type === 'float' && pd.step !== 1
          );
          if (paramEntries.length === 0) return null;

          // Filter out internally-driven params (have __param_ connection inside group)
          // Also hide when a regular input socket with the same name is wired
          // Also hide params the user has opted to hide via GroupParamPicker
          const hiddenParams: string[] = Array.isArray(node.params.hiddenParams)
            ? (node.params.hiddenParams as string[])
            : [];
          const visibleParams = paramEntries.filter(([paramKey]) => {
            if (innerNode.inputs[`__param_${paramKey}`]?.connection) return false;
            const matchingInput = Object.entries(innerNode.inputs).find(
              ([k, inp]) => k.toLowerCase() === paramKey.toLowerCase() && inp.connection
            );
            if (matchingInput) return false;
            if (hiddenParams.includes(`${innerNode.id}::${paramKey}`)) return false;
            return true;
          });
          if (visibleParams.length === 0) return null;

          const innerLabel = typeof innerNode.params.label === 'string'
            ? innerNode.params.label
            : (innerDef?.label ?? innerNode.type);
          const sectionLabelOverrideKey = `__sectionLabel_${innerNode.id}`;
          const displayLabel = typeof node.params[sectionLabelOverrideKey] === 'string'
            ? node.params[sectionLabelOverrideKey] as string
            : innerLabel;

          return (
            <div key={innerNode.id} style={{ borderTop: '1px solid #313244' }}>
              <div
                style={{ padding: '3px 10px 1px', fontSize: '9px', color: '#585b70', letterSpacing: '0.05em', cursor: 'text', userSelect: 'none' }}
                onDoubleClick={e => {
                  e.stopPropagation();
                  setEditingSectionId(innerNode.id);
                  setEditingSectionLabel(displayLabel);
                }}
              >
                {editingSectionId === innerNode.id ? (
                  <input
                    autoFocus
                    value={editingSectionLabel}
                    onChange={e => setEditingSectionLabel(e.target.value)}
                    onBlur={() => {
                      const trimmed = editingSectionLabel.trim();
                      updateNodeParams(node.id, { [sectionLabelOverrideKey]: trimmed || innerLabel });
                      setEditingSectionId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const trimmed = editingSectionLabel.trim();
                        updateNodeParams(node.id, { [sectionLabelOverrideKey]: trimmed || innerLabel });
                        setEditingSectionId(null);
                      } else if (e.key === 'Escape') {
                        setEditingSectionId(null);
                      }
                    }}
                    onMouseDown={e => e.stopPropagation()}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      borderBottom: '1px solid #585b70',
                      color: '#a6adc8',
                      fontSize: '9px',
                      letterSpacing: '0.05em',
                      outline: 'none',
                      padding: 0,
                      width: '100%',
                      textTransform: 'uppercase',
                    }}
                  />
                ) : (
                  displayLabel.toUpperCase()
                )}
              </div>
              {visibleParams.map(([paramKey, paramDef]) => {
                if (paramDef.type !== 'float') return null;
                const psKey = `ps_${innerNode.id}_${paramKey}`;
                const psSocket = node.inputs[psKey];
                const externallyDriven = !!(psSocket?.connection);
                const overrideKey = `${innerNode.id}::${paramKey}`;
                const rawVal = node.params[overrideKey] ?? innerNode.params[paramKey];
                const currentVal = typeof rawVal === 'number' ? rawVal : (typeof paramDef.min === 'number' ? paramDef.min : 0);
                const step = paramDef.step ?? 0.01;
                const innerBidir = innerNode.params[`__scBidir_${paramKey}`] === true;
                const innerCustomMax = typeof innerNode.params[`__scMax_${paramKey}`] === 'number' ? innerNode.params[`__scMax_${paramKey}`] as number : null;
                const baseMax = paramDef.max ?? 1;
                const effMax = innerCustomMax ?? baseMax;
                const effMin = innerBidir ? -effMax : (innerCustomMax != null ? 0 : (paramDef.min ?? 0));

                return (
                  <div
                    key={paramKey}
                    style={{ padding: '2px 10px 2px 14px', display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    {/* ps_ input socket dot — positioned on left edge */}
                    <div
                      ref={el => { registerSocket(node.id, 'in', psKey, el); }}
                      onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, psKey); }}
                      style={{
                        position: 'absolute',
                        left: isTouchDevice ? -6 : -5,
                        width: isTouchDevice ? 16 : 8,
                        height: isTouchDevice ? 16 : 8,
                        borderRadius: '50%',
                        background: externallyDriven ? '#f0a' : 'transparent',
                        border: `1.5px solid ${externallyDriven ? '#f0a' : '#585b70'}`,
                        cursor: 'crosshair',
                        touchAction: 'manipulation',
                      }}
                    />
                    <span style={{ color: externallyDriven ? '#a6adc8' : '#6c7086', fontSize: '10px', minWidth: '60px', flexShrink: 0 }}>
                      {paramDef.label}
                    </span>
                    {externallyDriven ? (
                      <>
                        <span style={{ flex: 1, fontSize: '10px', color: '#585b70', fontStyle: 'italic' }}>wired</span>
                        <button
                          onMouseDown={e => e.stopPropagation()}
                          onClick={() => disconnectInput(node.id, psKey)}
                          style={{ fontSize: '9px', color: '#585b70', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                          title="Disconnect"
                        >×</button>
                      </>
                    ) : (
                      <>
                        <input
                          type="range"
                          min={effMin}
                          max={effMax}
                          step={adaptiveStep(currentVal, step)}
                          value={Math.max(effMin, Math.min(effMax, currentVal))}
                          onChange={e => updateNodeParams(node.id, { [overrideKey]: parseFloat(e.target.value) }, { immediate: true })}
                          onDoubleClick={() => updateNodeParams(node.id, { [overrideKey]: (effMin + effMax) / 2 })}
                          style={{ flex: 1, accentColor: '#89b4fa', cursor: 'pointer' }}
                        />
                        {editingSliderKey === `gp_${overrideKey}` ? (
                          <input
                            autoFocus
                            type="text"
                            style={{ ...INPUT_STYLE, width: '40px', fontSize: '10px', border: '1px solid #585b70' }}
                            value={editingSliderValue}
                            onChange={e => setEditingSliderValue(e.target.value)}
                            onBlur={() => {
                              const n = parseFloat(editingSliderValue);
                              if (!isNaN(n)) updateNodeParams(node.id, { [overrideKey]: n });
                              setEditingSliderKey(null);
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { const n = parseFloat(editingSliderValue); if (!isNaN(n)) updateNodeParams(node.id, { [overrideKey]: n }); setEditingSliderKey(null); }
                              if (e.key === 'Escape') setEditingSliderKey(null);
                            }}
                          />
                        ) : (
                          <span
                            title="Double-click to edit"
                            style={{ color: '#a6adc8', fontSize: '10px', minWidth: '32px', textAlign: 'center', fontVariantNumeric: 'tabular-nums', cursor: 'text', userSelect: 'none' }}
                            onDoubleClick={() => { setEditingSliderKey(`gp_${overrideKey}`); setEditingSliderValue(String(currentVal)); }}
                          >
                            {currentVal.toFixed(adaptiveDecimals(adaptiveStep(currentVal, step)))}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* MarchLoopGroup outer params — maxSteps, maxDist, stepScale, bg, albedo */}
        {isMarchLoopGroup && (() => {
          const outerDef = getNodeDefinition(node.type);
          const outerParamDefs = outerDef?.paramDefs ?? {};
          const outerEntries = Object.entries(outerParamDefs).filter(([, pd]) => pd.type === 'float');
          if (outerEntries.length === 0) return null;
          const hidden = node.params.__marchSettingsHidden === true;
          return (
            <div style={{ borderTop: '1px solid #313244' }} onMouseDown={e => e.stopPropagation()}>
              <div
                style={{ padding: '3px 10px 1px', fontSize: '9px', color: '#585b70', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
                onClick={() => updateNodeParams(node.id, { __marchSettingsHidden: !hidden }, { immediate: true })}
              >
                <span>MARCH SETTINGS</span>
                <span style={{ fontSize: '8px', opacity: 0.6 }}>{hidden ? '▶' : '▼'}</span>
              </div>
              {!hidden && outerEntries.map(([paramKey, paramDef]) => {
                const rawVal = node.params[paramKey];
                const currentVal = typeof rawVal === 'number' ? rawVal : (typeof paramDef.min === 'number' ? paramDef.min : 0);
                const step = paramDef.step ?? 1;
                const effMin = paramDef.min ?? 0;
                const effMax = paramDef.max ?? 256;
                return (
                  <div key={paramKey} style={{ padding: '2px 10px 2px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '9px', color: '#6c7086', minWidth: '70px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{paramDef.label}</span>
                    <input
                      type="range"
                      min={effMin}
                      max={effMax}
                      step={adaptiveStep(currentVal, step)}
                      value={currentVal}
                      onChange={e => updateNodeParams(node.id, { [paramKey]: parseFloat(e.target.value) }, { immediate: true })}
                      style={{ flex: 1, accentColor: '#88aacc', cursor: 'pointer', margin: 0 }}
                    />
                    <span style={{ fontSize: '10px', color: '#a6adc8', minWidth: '32px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {currentVal.toFixed(adaptiveDecimals(adaptiveStep(currentVal, step)))}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* "Customize params" button — shown for any group with float params */}
        {subgraph && (() => {
          const SKIP_PARAM_TYPES = new Set(['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'constant', 'loopIndex', 'loopCarry', 'group']);
          const hasInnerGroupNodes = subgraph.nodes.some(n => n.type === 'group');
          // For outer groups: check inner-group subgraph nodes
          // For regular groups: check direct subgraph nodes
          const hasAny = hasInnerGroupNodes
            ? subgraph.nodes.some(innerGrp => {
                if (innerGrp.type !== 'group') return false;
                const sub = innerGrp.params.subgraph as SubgraphData | undefined;
                return sub?.nodes.some(inn => {
                  const d = getNodeDefinition(inn.type);
                  return d?.paramDefs && Object.values(d.paramDefs).some(pd => pd.type === 'float' && pd.step !== 1);
                }) ?? false;
              })
            : subgraph.nodes.some(n => {
                if (SKIP_PARAM_TYPES.has(n.type)) return false;
                const d = getNodeDefinition(n.type);
                return d?.paramDefs && Object.values(d.paramDefs).some(pd => pd.type === 'float' && pd.step !== 1);
              });
          if (!hasAny) return null;
          const accentColor = hasInnerGroupNodes ? '#cba6f7' : '#89b4fa';
          return (
            <div
              style={{ borderTop: '1px solid #313244', padding: '4px 10px', display: 'flex', alignItems: 'center', position: 'relative' }}
              onMouseDown={e => e.stopPropagation()}
            >
              <button
                onClick={e => { e.stopPropagation(); setShowParamPicker(v => !v); }}
                onDoubleClick={e => e.stopPropagation()}
                style={{
                  fontSize: '10px',
                  color: showParamPicker ? accentColor : '#585b70',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '1px 0',
                  letterSpacing: '0.03em',
                }}
                title={hasInnerGroupNodes ? 'Customise which inner-group params appear here' : 'Show or hide params on this group card'}
                onMouseEnter={e => { if (!showParamPicker) (e.currentTarget as HTMLButtonElement).style.color = '#a6adc8'; }}
                onMouseLeave={e => { if (!showParamPicker) (e.currentTarget as HTMLButtonElement).style.color = '#585b70'; }}
              >
                ⊕ params
              </button>
              {showParamPicker && (
                <GroupParamPicker
                  outerNode={node}
                  onClose={() => setShowParamPicker(false)}
                />
              )}
            </div>
          );
        })()}
      </div>
    );
  }

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    // Right-click is handled by the context menu — don't interfere with selection
    if (e.button === 2) return;

    e.stopPropagation();
    e.preventDefault(); // Prevent browser text-selection during drag

    // Shift+click → enter swap mode (select this node for type replacement)
    if (e.shiftKey) {
      setSwapTargetNodeId(isSwapTarget ? null : node.id);
      return;
    }

    // Ctrl+click → navigate palette to this node type
    // (Cmd/Meta is reserved for multi-select grouping)
    if (e.ctrlKey && !e.metaKey) {
      window.dispatchEvent(new CustomEvent('palette-navigate', { detail: { nodeType: node.type } }));
      return;
    }

    // Store offset in world-space units (divide by zoom to compensate for canvas scale)
    dragOffset.current = {
      x: e.clientX / zoom - node.position.x,
      y: e.clientY / zoom - node.position.y,
    };

    let hasDragged = false;
    const startX = e.clientX;
    const startY = e.clientY;

    // Disable all text selection globally for the duration of this drag
    document.body.style.userSelect = 'none';
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (dragOffset.current) {
        if (!hasDragged && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
          hasDragged = true;
        }
        updateNodePosition(node.id, {
          x: ev.clientX / zoom - dragOffset.current.x,
          y: ev.clientY / zoom - dragOffset.current.y,
        });
      }
    };

    const suppressSelect = (ev: Event) => ev.preventDefault();

    const handleMouseUp = () => {
      dragOffset.current = null;
      // Restore selection
      document.body.style.userSelect = '';
      (document.body.style as CSSStyleDeclaration & { webkitUserSelect: string }).webkitUserSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('selectstart', suppressSelect);
      // If mouse didn't move, treat as a click — update selection
      if (!hasDragged) {
        if (e.metaKey || e.ctrlKey) {
          // Cmd/Ctrl+click: toggle this node in the multi-selection
          selectNode(node.id, true);
        } else {
          // Plain click: single-select for probe panel
          setSelectedNodeId(isSelected ? null : node.id);
          selectNode(node.id, false);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('selectstart', suppressSelect);
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
  const hasOverride = typeof node.params?.__codeOverride === 'string' && (node.params.__codeOverride as string).trim().length > 0;
  const codeSnippet = hasOverride ? (node.params.__codeOverride as string) : generatedCode;
  // The value shown in the editable textarea
  const codeEditValue = codeEditMode
    ? (typeof node.params?.__codeOverride === 'string' ? node.params.__codeOverride as string : generatedCode)
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
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
      onMouseDown={() => setZIndex(++zCounter)}
      style={{
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        zIndex,
        background: '#1e1e2e',
        border: isBypassed ? '1px solid #f9e2af55' : isSwapTarget ? '2px solid #f9e2af' : isPreviewActive ? '1px solid #a6e3a1' : hasError ? '1px solid #f38ba8' : isMultiSelected ? '2px solid #cba6f7' : isSelected ? '1px solid #89b4fa' : '1px solid #444',
        borderRadius: '8px',
        minWidth: '240px',
        color: '#cdd6f4',
        fontSize: '12px',
        userSelect: 'none',
        opacity: dimmed ? 0.2 : isBypassed ? 0.55 : 1,
        transition: 'opacity 0.2s ease',
        boxShadow: isSwapTarget
          ? '0 0 14px #f9e2af66, 0 4px 12px rgba(0,0,0,0.4)'
          : isPreviewActive
          ? '0 0 14px #a6e3a133, 0 4px 12px rgba(0,0,0,0.4)'
          : hasError
          ? '0 0 12px #f38ba855, 0 4px 12px rgba(0,0,0,0.4)'
          : isMultiSelected
          ? '0 0 12px #cba6f755, 0 4px 12px rgba(0,0,0,0.4)'
          : isSelected
          ? '0 0 10px #89b4fa33, 0 4px 12px rgba(0,0,0,0.4)'
          : '0 4px 12px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onTouchStart={handleHeaderTouchStart}
        onMouseEnter={() => {
          tooltipTimerRef.current = setTimeout(() => setShowNodeTooltip(true), 1200);
        }}
        onMouseLeave={() => {
          if (tooltipTimerRef.current) { clearTimeout(tooltipTimerRef.current); tooltipTimerRef.current = null; }
          setShowNodeTooltip(false);
        }}
        style={{
          background: '#313244',
          borderRadius: showCode ? '8px 8px 0 0' : '8px 8px 0 0',
          padding: isTouchDevice ? '10px 10px' : '6px 10px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'grab',
          fontWeight: 600,
          fontSize: '12px',
          letterSpacing: '0.03em',
          position: 'relative',
          minHeight: isTouchDevice ? '44px' : undefined,
        }}
      >
        <span
          onDoubleClick={e => {
            e.stopPropagation();
            if (node.type === 'sceneGroup' && !savingMode) {
              onEnterGroup?.(node.id);
            } else {
              setCollapsed(v => !v);
            }
          }}
          title={node.type === 'sceneGroup' ? 'Double-click to enter scene' : collapsed ? 'Double-click to expand' : 'Double-click to collapse'}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', userSelect: 'none' }}
        >
          <span style={{ fontSize: '9px', opacity: 0.5, lineHeight: 1 }}>{collapsed ? '▶' : '▼'}</span>
          {node.type === 'customFn' && typeof node.params.label === 'string' ? node.params.label || def.label : def.label}
          {!!node.params._groupOriginal && def.anchored && (
            <span title="Anchored — cannot be deleted" style={{ fontSize: '9px', opacity: 0.45, lineHeight: 1 }}>🔒</span>
          )}
          {def.deprecated && (
            <span style={{ fontSize: '7px', color: '#f9e2af', letterSpacing: '0.06em', opacity: 0.8, fontWeight: 400, border: '1px solid #f9e2af55', borderRadius: '2px', padding: '0 2px' }}>DEPRECATED</span>
          )}
          {isBypassed && (
            <span style={{ fontSize: '8px', color: '#f9e2af', letterSpacing: '0.06em', opacity: 0.9, fontWeight: 400 }}>BYPASS</span>
          )}
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
          {/* ExprBlock modal button — shown on exprNode */}
          {node.type === 'exprNode' && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowExprBlockModal(v => !v)}
              title="Open Expr Block editor"
              style={{
                background: showExprBlockModal ? '#a6e3a122' : 'none',
                border: showExprBlockModal ? '1px solid #a6e3a155' : 'none',
                color: showExprBlockModal ? '#a6e3a1' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              ⟴
            </button>
          )}
          {/* Bezier editor modal button */}
          {(node.type === 'cubicBezierShaper' || node.type === 'quadBezierShaper') && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => setShowBezierModal(v => !v)}
              title="Open Bezier editor"
              style={{
                background: showBezierModal ? '#f38ba822' : 'none',
                border: showBezierModal ? '1px solid #f38ba855' : 'none',
                color: showBezierModal ? '#f38ba8' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              ⬡
            </button>
          )}
          {/* Expr modal expand button — shown on FloatWarp nodes */}
          {node.type === 'floatWarp' && (
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
          {/* Divider before loop/assign controls */}
          {!['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group'].includes(node.type) && (
            <span style={{ width: '1px', height: '14px', background: '#45475a88', margin: '0 3px', flexShrink: 0 }} />
          )}
          {/* Carry mode — only shown inside a group with iterations > 1 */}
          {isInsideLoop && !['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group', 'uv', 'time', 'mouse', 'constant'].includes(node.type) && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => toggleCarryMode(node.id)}
              title={isCarry ? 'Carry mode ON — output feeds back as input each iteration. Click to disable.' : 'Enable carry mode — output feeds back as input each iteration (e.g. UV self-folding)'}
              style={{
                background: isCarry ? '#a6e3a122' : 'none',
                border: isCarry ? '1px solid #a6e3a155' : '1px solid #31324466',
                color: isCarry ? '#a6e3a1' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '2px 7px',
                borderRadius: '4px',
                fontFamily: 'monospace',
                minWidth: '26px',
                textAlign: 'center',
              }}
            >
              ⟳
            </button>
          )}
          {/* assignOp — available everywhere (not just inside loops) */}
          {!['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group'].includes(node.type) && (
            <select
              onMouseDown={e => e.stopPropagation()}
              value={assignOp}
              onChange={e => setNodeAssignOp(node.id, e.target.value as import('../../types/nodeGraph').GraphNode['assignOp'])}
              title="Assign operator: declare an accumulator and combine this node's output (+= -= *= /=)"
              style={{
                background: assignOp !== '=' ? '#45475a' : '#1e1e2e',
                border: assignOp !== '=' ? '1px solid #89b4fa88' : '1px solid #45475a',
                color: assignOp !== '=' ? '#89b4fa' : '#6c7086',
                cursor: 'pointer',
                fontSize: '11px',
                borderRadius: '4px',
                padding: '2px 4px',
                outline: 'none',
                appearance: 'none',
                WebkitAppearance: 'none',
                fontFamily: 'monospace',
                width: '34px',
                minHeight: '22px',
                textAlign: 'center',
              }}
            >
              <option value="="> = </option>
              <option value="+=">+=</option>
              <option value="-=">-=</option>
              <option value="*=">*=</option>
              <option value="/=">/=</option>
            </select>
          )}
          {/* Bypass toggle — skip node, pass input through to output */}
          {!['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'constant'].includes(node.type) && (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => toggleBypass(node.id)}
              title={isBypassed ? 'Enable node (currently bypassed)' : 'Bypass node (pass input through)'}
              style={{
                background: isBypassed ? '#f9e2af22' : 'none',
                border: isBypassed ? '1px solid #f9e2af55' : 'none',
                color: isBypassed ? '#f9e2af' : '#585b70',
                cursor: 'pointer',
                fontSize: '12px',
                lineHeight: 1,
                padding: '1px 4px',
                borderRadius: '3px',
              }}
            >
              ⊘
            </button>
          )}
          {/* Delete button — hidden for original group nodes (immutable) */}
          {!node.params._groupOriginal && (
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
          )}
        </div>
      </div>

      {/* ── assignInit row — shown when assignOp is an accumulator op ── */}
      {assignOp !== '=' && !['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group'].includes(node.type) && (
        <div
          onMouseDown={e => e.stopPropagation()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '4px 8px',
            borderBottom: '1px solid #31324488',
            background: '#1e1e2e88',
          }}
        >
          <span style={{ fontSize: '10px', color: '#6c7086', flexShrink: 0, fontFamily: 'monospace' }}>
            init
          </span>
          {/* Clickable chip — opens the expression picker modal */}
          <button
            onClick={() => setShowInitModal(true)}
            title="Edit initializer expression — click to open expression picker"
            style={{
              flex: 1,
              background: node.assignInit ? '#11111b' : 'transparent',
              border: `1px solid ${node.assignInit ? '#45475a' : '#31324466'}`,
              borderRadius: '4px',
              color: node.assignInit ? '#89b4fa' : '#45475a',
              fontSize: '11px',
              fontFamily: 'monospace',
              padding: '2px 6px',
              cursor: 'pointer',
              textAlign: 'left',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {node.assignInit || 'default (0 or 1)'}
          </button>
          {node.assignInit && (
            <button
              onClick={() => setNodeAssignInit(node.id, '')}
              title="Clear init expression (revert to neutral element)"
              style={{ background: 'none', border: 'none', color: '#45475a', cursor: 'pointer', fontSize: '12px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
            >
              ×
            </button>
          )}
          {showInitModal && (
            <AssignInitModal node={node} onClose={() => setShowInitModal(false)} />
          )}
        </div>
      )}

      {/* ── SDF shape preview — only when 👁 is active ── */}
      {SDF_TYPES.has(node.type) && isPreviewActive && <SdfPreviewViz node={node} />}

      {/* ── LFO waveform — canvas is always in DOM for scope registry, but hidden unless 👁 active ── */}
      {LFO_TYPES.has(node.type) && (
        <canvas
          ref={scopeCanvasRef}
          width={240}
          height={64}
          style={{
            display: 'block',
            width: '100%',
            height: isPreviewActive ? '64px' : '0',
            overflow: 'hidden',
            borderBottom: isPreviewActive ? '1px solid #313244' : 'none',
          }}
        />
      )}

      {/* ── Always-visible Remap range bars ── */}
      {node.type === 'remap' && (() => {
        const inMin  = typeof node.params.inMin  === 'number' ? node.params.inMin  : 0;
        const inMax  = typeof node.params.inMax  === 'number' ? node.params.inMax  : 1;
        const outMin = typeof node.params.outMin === 'number' ? node.params.outMin : 0;
        const outMax = typeof node.params.outMax === 'number' ? node.params.outMax : 1;
        const lo = Math.min(inMin, inMax, outMin, outMax);
        const hi = Math.max(inMin, inMax, outMin, outMax);
        const range = hi - lo || 1;
        const toPercent = (v: number) => `${((v - lo) / range) * 100}%`;
        const barLeft  = (a: number, b: number) => toPercent(Math.min(a, b));
        const barWidth = (a: number, b: number) => `${(Math.abs(b - a) / range) * 100}%`;
        const rows: Array<[string, number, number, string]> = [
          ['In',  inMin,  inMax,  '#89b4fa'],
          ['Out', outMin, outMax, '#a6e3a1'],
        ];
        return (
          <div style={{ padding: '6px 10px 4px', borderBottom: '1px solid #313244', display: 'flex', flexDirection: 'column', gap: '5px' }}
               onMouseDown={e => e.stopPropagation()}>
            {rows.map(([label, mn, mx, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '9px', color: '#6c7086', width: '20px', flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: '8px', background: '#11111b', borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: barLeft(mn, mx), width: barWidth(mn, mx), height: '100%', background: color, borderRadius: '4px', opacity: 0.7 }} />
                </div>
                <span style={{ fontSize: '9px', color: '#6c7086', width: '60px', textAlign: 'right', flexShrink: 0 }}>
                  {mn.toFixed(2)} → {mx.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* ── In-card preview (visible when 👁 is active) ── */}
      {/* Semantic inline viz: replaces shader thumbnail for supported types */}
      {isPreviewActive && !SKIP_PREVIEW.has(node.type) && INLINE_VIZ_TYPES.has(node.type) && (
        <NodeInlineViz node={node} />
      )}
      {/* Default: shader thumbnail for float-output scope or vec3 render */}
      {isPreviewActive && !SKIP_PREVIEW.has(node.type) && !ALWAYS_VIZ_TYPES.has(node.type) && !INLINE_VIZ_TYPES.has(node.type) && (
        <div style={{ width: '100%', borderBottom: '1px solid #313244' }}>
          {primaryOutputIsFloat ? (
            /* Float output → live waveform scope */
            <canvas
              ref={previewScopeCanvasRef}
              width={240}
              height={80}
              style={{ display: 'block', width: '100%', height: '80px' }}
            />
          ) : (
            /* Vec3/vec4 output → rendered shader thumbnail */
            <div style={{ width: '100%', height: 160, background: '#11111b', overflow: 'hidden', position: 'relative' }}>
              {previewLoading && !previewDataUrl ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#585b70', fontSize: '12px' }}>
                  rendering…
                </div>
              ) : previewDataUrl ? (
                <img
                  src={previewDataUrl}
                  alt="node preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#585b70', fontSize: '11px' }}>
                  no preview
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '6px 0 4px' }}>
        {/* ── Inputs (always visible) ── */}
        {Object.entries(node.inputs).map(([key, input]) => {
          const isConnected = !!input.connection;
          const isExternal = externalInputKeys?.has(key) ?? false;

          // CustomFn slider inputs without connection: rendered as sliders below — skip socket row
          // ExprNode: always show socket row (slider appears alongside, greyed when connected)
          if (node.type === 'customFn') {
            const cfInputs = (node.params.inputs as Array<{ name: string; slider?: unknown }>) || [];
            const cfInp = cfInputs.find(c => c.name === key);
            if (cfInp?.slider != null && !isConnected) return null;
          }

          const slotName = input.label;

          // Drag-highlight: compatible = glow, incompatible = dim
          // External sockets block new connections entirely
          let socketOpacity = isExternal ? 0.45 : 1;
          let socketGlow: string | undefined;
          if (!isExternal && draggingType) {
            const compat = typesCompatible(draggingType, input.type as DataType);
            socketOpacity = compat ? 1 : 0.25;
            socketGlow = compat ? `0 0 8px ${TYPE_COLORS[input.type] || '#888'}` : undefined;
          }
          // Mobile pending-connection highlight
          const pendingCompat = pendingMobileType
            ? typesCompatible(pendingMobileType as DataType, input.type as DataType)
            : false;
          if (!isExternal && pendingMobileConnection && !draggingType) {
            socketOpacity = pendingCompat ? 1 : 0.25;
            socketGlow = pendingCompat ? `0 0 10px ${TYPE_COLORS[input.type] || '#888'}` : undefined;
          }

          const socketSize = isTouchDevice ? '22px' : '12px';
          const socketMarginLeft = isTouchDevice ? '-11px' : '-6px';
          const socketMarginRight = isTouchDevice ? '8px' : '8px';

          const isHovered = hoveredInput === key;

          return (
            <div
              key={key}
              style={{ display: 'flex', alignItems: 'center', padding: isTouchDevice ? '6px 10px 6px 0' : '3px 10px 3px 0', position: 'relative' }}
            >
              {/* Socket dot — locked for external inputs */}
              <div
                data-socket="in"
                ref={el => registerSocket(node.id, 'in', key, el)}
                style={{
                  width: socketSize,
                  height: socketSize,
                  borderRadius: '50%',
                  background: isConnected ? (TYPE_COLORS[input.type] || '#888') : '#333',
                  border: `2px solid ${isExternal ? '#585b70' : (TYPE_COLORS[input.type] || '#888')}`,
                  marginRight: socketMarginRight,
                  flexShrink: 0,
                  marginLeft: socketMarginLeft,
                  cursor: isExternal ? 'not-allowed' : 'pointer',
                  opacity: socketOpacity,
                  boxShadow: isExternal ? 'none' : socketGlow,
                  transition: 'box-shadow 0.1s, opacity 0.1s',
                  touchAction: 'manipulation',
                }}
                onMouseEnter={() => setHoveredInput(key)}
                onMouseLeave={() => setHoveredInput(null)}
                onMouseDown={(e) => {
                  if (e.altKey && !isConnected && !isExternal) {
                    e.stopPropagation();
                    e.preventDefault();
                    onAltClickSocket?.(node.id, key, 'in', input.type, e);
                  }
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  if (isExternal) return;
                  if (e.altKey && !isConnected) return; // handled by onMouseDown
                  // When a connection wire is being dragged, always complete the connection
                  // (never disconnect an existing socket mid-drag)
                  if (isConnected && !isConnectionDragging) {
                    disconnectInput(node.id, key);
                  } else {
                    onEndConnection(node.id, key);
                  }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (isExternal) return;
                  if (pendingMobileConnection) {
                    onTapInputSocket?.(node.id, key);
                  } else if (isConnected) {
                    disconnectInput(node.id, key);
                  }
                }}
              />
              {/* Hover tooltip */}
              {isHovered && !draggingType && (
                <SocketTooltip
                  lines={isExternal ? [`🔒 Wired from outside group`, `(${input.type})`] : buildInputTooltip(key)}
                  side="left"
                />
              )}
              {/* When dragging: show a drop-here indicator on compatible sockets (not external) */}
              {!isExternal && draggingType && typesCompatible(draggingType, input.type as DataType) && (
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
              {(
                <span
                  style={{
                    color: isExternal ? '#585b70' : '#a6adc8',
                    fontSize: isTouchDevice ? '13px' : '11px',
                    cursor: isExternal ? 'default' : 'pointer',
                    flex: 1,
                    opacity: socketOpacity,
                    fontStyle: isExternal ? 'italic' : undefined,
                  }}
                  onMouseUp={(e) => {
                    e.stopPropagation();
                    if (isExternal) return;
                    if (isConnected) {
                      disconnectInput(node.id, key);
                    } else {
                      onEndConnection(node.id, key);
                    }
                  }}
                  onTouchEnd={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (isExternal) return;
                    if (pendingMobileConnection) {
                      onTapInputSocket?.(node.id, key);
                    } else if (isConnected) {
                      disconnectInput(node.id, key);
                    }
                  }}
                >
                  {slotName}
                  {isExternal && <span style={{ marginLeft: '4px', fontSize: '9px', opacity: 0.6 }}>🔒</span>}
                </span>
              )}
              {isConnected && !isExternal && (
                <span
                  style={{ marginLeft: 'auto', color: '#585b70', fontSize: isTouchDevice ? '14px' : '10px', padding: isTouchDevice ? '4px 8px' : '0 6px 0 0', cursor: 'pointer', touchAction: 'manipulation' }}
                  onMouseUp={(e) => { e.stopPropagation(); disconnectInput(node.id, key); }}
                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); disconnectInput(node.id, key); }}
                >
                  ×
                </span>
              )}
              {isConnected && isExternal && (
                <span style={{ marginLeft: 'auto', color: '#45475a', fontSize: '9px', padding: '0 6px 0 0', fontFamily: 'monospace' }}>
                  ext
                </span>
              )}
            </div>
          );
        })}

        {/* ── ExprBlock per-line warp editor (exprNode only) ── */}
        {!collapsed && node.type === 'exprNode' && (() => {
          const lines = (node.params.lines as Array<{ lhs: string; op: string; rhs: string }> | undefined) ?? [];
          const result = (node.params.result as string | undefined) ?? 'p';
          const OPS = ['=', '+=', '-=', '*=', '/='];
          const inputBg = '#11111b';
          const inputBorder = '1px solid #45475a';
          const inputStyle: React.CSSProperties = {
            background: inputBg, border: inputBorder, color: '#cdd6f4',
            padding: '2px 5px', borderRadius: '3px', fontSize: '10px',
            fontFamily: 'monospace', outline: 'none',
          };
          return (
            <div
              style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: '4px' }}
              onMouseDown={e => e.stopPropagation()}
            >
              <span style={{ fontSize: '10px', color: '#6c7086', marginBottom: '1px' }}>Warp Lines</span>

              {lines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                  {/* LHS */}
                  <input
                    type="text"
                    value={line.lhs}
                    onChange={e => {
                      const next = lines.map((l, j) => j === i ? { ...l, lhs: e.target.value } : l);
                      updateNodeParams(node.id, { lines: next });
                    }}
                    placeholder="p.xy"
                    style={{ ...inputStyle, width: '52px' }}
                  />
                  {/* Operator */}
                  <select
                    value={line.op}
                    onChange={e => {
                      const next = lines.map((l, j) => j === i ? { ...l, op: e.target.value } : l);
                      updateNodeParams(node.id, { lines: next });
                    }}
                    style={{ background: inputBg, border: inputBorder, color: '#89b4fa', fontSize: '10px', padding: '2px 2px', borderRadius: '3px', cursor: 'pointer', outline: 'none' }}
                  >
                    {OPS.map(op => <option key={op} value={op}>{op}</option>)}
                  </select>
                  {/* RHS expression */}
                  <input
                    type="text"
                    value={line.rhs}
                    onChange={e => {
                      const next = lines.map((l, j) => j === i ? { ...l, rhs: e.target.value } : l);
                      updateNodeParams(node.id, { lines: next });
                    }}
                    placeholder="expression…"
                    style={{ ...inputStyle, flex: 1, color: '#a6e3a1' }}
                  />
                  {/* Remove row */}
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => updateNodeParams(node.id, { lines: lines.filter((_, j) => j !== i) })}
                    style={{ background: 'none', border: 'none', color: '#f38ba8', cursor: 'pointer', padding: '0 2px', fontSize: '13px', lineHeight: 1, flexShrink: 0 }}
                    title="Remove line"
                  >×</button>
                </div>
              ))}

              {/* Add line */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => updateNodeParams(node.id, { lines: [...lines, { lhs: 'p', op: '=', rhs: '' }] })}
                style={{ alignSelf: 'flex-start', background: '#313244', border: 'none', color: '#a6adc8', cursor: 'pointer', fontSize: '10px', padding: '2px 7px', borderRadius: '3px', marginTop: '1px' }}
              >+ line</button>

              {/* Return expression */}
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginTop: '2px' }}>
                <span style={{ fontSize: '10px', color: '#6c7086', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>return</span>
                <input
                  type="text"
                  value={result}
                  onChange={e => updateNodeParams(node.id, { result: e.target.value })}
                  placeholder="p"
                  style={{ ...inputStyle, flex: 1, color: '#89b4fa', border: '1px solid #45475a' }}
                />
              </div>
            </div>
          );
        })()}

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
            const isParamExternal = externalInputKeys?.has(key) ?? false;
            const isParamExternallyDriven = externalParamKeys?.has(key) ?? false;
            const paramInputKey = `__param_${key}`;
            const paramInputConn = node.inputs[paramInputKey]?.connection;
            const isParamInternallyWired = paramInputConn != null;
            if (isSocketConnected) {
              const srcExpr = getSourceExpr(shaderLines, socketConn!.nodeId, socketConn!.outputKey);
              return (
                <div
                  key={key}
                  style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <span style={{ color: '#45475a', fontSize: '11px', minWidth: '60px', flexShrink: 0 }}>
                    {paramDef.label}
                    {isParamExternal && <span style={{ marginLeft: '3px', fontSize: '8px' }}>🔒</span>}
                  </span>
                  <span
                    style={{
                      color: isParamExternal ? '#45475a' : '#89b4fa',
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
            if (isParamExternal) {
              // The socket has no connection yet but is reserved for external wiring — lock the slider
              const val = typeof node.params[key] === 'number' ? (node.params[key] as number) : 0;
              return (
                <div
                  key={key}
                  style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.4 }}
                >
                  <span style={{ color: '#45475a', fontSize: '11px', minWidth: '60px', flexShrink: 0 }}>
                    {paramDef.label} <span style={{ fontSize: '8px' }}>🔒</span>
                  </span>
                  <span style={{ color: '#585b70', fontSize: '10px', fontFamily: 'monospace' }}>{val}</span>
                </div>
              );
            }
            // When externally driven by a ps_ connection from outside the group — lock
            if (isParamExternallyDriven) {
              const val = typeof node.params[key] === 'number' ? (node.params[key] as number) : 0;
              return (
                <div
                  key={key}
                  style={{ padding: '3px 10px 3px 16px', display: 'flex', alignItems: 'center', gap: '6px', opacity: 0.4, position: 'relative' }}
                >
                  <span style={{ color: '#45475a', fontSize: '11px', minWidth: '60px', flexShrink: 0 }}>
                    {paramDef.label} <span style={{ fontSize: '8px' }}>🔒</span>
                  </span>
                  <span style={{ color: '#585b70', fontSize: '10px', fontFamily: 'monospace' }}>{val}</span>
                </div>
              );
            }
            // When internally wired via __param_ connection
            if (isParamInternallyWired) {
              const srcExpr = getSourceExpr(shaderLines, paramInputConn!.nodeId, paramInputConn!.outputKey);
              return (
                <div
                  key={key}
                  style={{ padding: '3px 10px 3px 16px', display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  {activeGroupId && (
                    <div
                      ref={el => { registerSocket(node.id, 'in', paramInputKey, el); }}
                      onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, paramInputKey); }}
                      style={{
                        position: 'absolute',
                        left: isTouchDevice ? -6 : -5,
                        width: isTouchDevice ? 16 : 8,
                        height: isTouchDevice ? 16 : 8,
                        borderRadius: '50%',
                        background: '#f0a',
                        border: '1.5px solid #f0a',
                        cursor: 'crosshair',
                      }}
                    />
                  )}
                  <span style={{ color: '#45475a', fontSize: '11px', minWidth: '60px', flexShrink: 0 }}>{paramDef.label}</span>
                  <span style={{ color: '#89b4fa', fontSize: '9px', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={srcExpr}>
                    = {srcExpr}
                  </span>
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => disconnectInput(node.id, paramInputKey)}
                    style={{ fontSize: '9px', color: '#585b70', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}
                    title="Disconnect"
                  >×</button>
                </div>
              );
            }
            const val = typeof node.params[key] === 'number' ? (node.params[key] as number) : 0;
            const step = paramDef.step ?? 0.01;
            const bidir = node.params[`__scBidir_${key}`] === true;
            const customMax = typeof node.params[`__scMax_${key}`] === 'number' ? node.params[`__scMax_${key}`] as number : null;
            const baseMax = paramDef.max ?? 1;
            const effMax = customMax ?? baseMax;
            const effMin = bidir ? -effMax : (customMax != null ? 0 : (paramDef.min ?? 0));
            const isConfigOpen = openSliderConfig === key;

            const handleNumberCommit = (raw: string) => {
              const n = parseFloat(raw);
              if (isNaN(n)) return;
              const absN = Math.abs(n);
              // Whatever the user types becomes the new max (abs value).
              // Only skip if zero (a range of 0 is meaningless).
              if (absN > 0) {
                updateNodeParams(node.id, { [`__scMax_${key}`]: absN });
              }
              setFloat(key, String(n));
            };

            return (
              <div
                key={key}
                style={{ padding: '3px 10px 3px 16px', position: 'relative' }}
                onMouseDown={e => e.stopPropagation()}
                onMouseEnter={() => { setHoveredSliderKey(key); setHoveredParamHint(paramDef.hint ?? null); }}
                onMouseLeave={() => { setHoveredSliderKey(prev => prev === key ? null : prev); setHoveredParamHint(null); }}
              >
                {/* socket dot */}
                {activeGroupId && (
                  <div
                    ref={el => { registerSocket(node.id, 'in', paramInputKey, el); }}
                    onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, paramInputKey); }}
                    style={{
                      position: 'absolute',
                      left: isTouchDevice ? -6 : -5,
                      width: isTouchDevice ? 16 : 8,
                      height: isTouchDevice ? 16 : 8,
                      borderRadius: '50%',
                      background: 'transparent',
                      border: '1.5px solid #585b70',
                      cursor: 'crosshair',
                    }}
                  />
                )}
                {/* Main slider row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#6c7086', fontSize: '11px', minWidth: '60px', flexShrink: 0 }}>{paramDef.label}</span>
                  <input
                    type="range"
                    style={RANGE_STYLE}
                    min={effMin}
                    max={effMax}
                    step={adaptiveStep(val, step)}
                    value={Math.max(effMin, Math.min(effMax, val))}
                    onChange={e => setFloat(key, e.target.value)}
                    onDoubleClick={() => setFloat(key, String((effMin + effMax) / 2))}
                  />
                  {editingSliderKey === key ? (
                    <input
                      autoFocus
                      type="text"
                      style={{ ...INPUT_STYLE, border: '1px solid #585b70' }}
                      value={editingSliderValue}
                      onChange={e => setEditingSliderValue(e.target.value)}
                      onBlur={() => {
                        handleNumberCommit(editingSliderValue);
                        setEditingSliderKey(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { handleNumberCommit(editingSliderValue); setEditingSliderKey(null); }
                        if (e.key === 'Escape') setEditingSliderKey(null);
                      }}
                    />
                  ) : (
                    <span
                      title="Double-click to edit"
                      style={{
                        ...INPUT_STYLE,
                        display: 'inline-block',
                        lineHeight: '1.6',
                        cursor: 'text',
                        userSelect: 'none',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                      onDoubleClick={() => { setEditingSliderKey(key); setEditingSliderValue(String(val)); }}
                    >
                      {val.toFixed(adaptiveDecimals(adaptiveStep(val, step)))}
                    </span>
                  )}
                  {/* Gear button */}
                  <button
                    onClick={() => setOpenSliderConfig(prev => prev === key ? null : key)}
                    title="Slider settings"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      padding: '0 1px', lineHeight: 1, fontSize: '10px',
                      color: isConfigOpen ? '#cba6f7' : '#585b70',
                      opacity: hoveredSliderKey === key || isConfigOpen ? 1 : 0,
                      transition: 'opacity 0.15s, color 0.1s',
                      flexShrink: 0,
                    }}
                  >⚙</button>
                </div>
                {/* Config panel */}
                {isConfigOpen && (
                  <div
                    style={{
                      margin: '4px 0 2px',
                      background: '#181825',
                      border: '1px solid #313244',
                      borderRadius: '5px',
                      padding: '6px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '5px',
                    }}
                    onMouseDown={e => e.stopPropagation()}
                  >
                    {/* Bidirectional row */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={bidir}
                        onChange={e => updateNodeParams(node.id, { [`__scBidir_${key}`]: e.target.checked })}
                        style={{ accentColor: '#cba6f7', cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: '10px', color: '#a6adc8' }}>Bidirectional</span>
                    </label>
                    {/* Range display + reset */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '9px', color: '#585b70', flex: 1 }}>
                        Range: {effMin.toFixed(step < 0.1 ? 2 : 1)} → {effMax.toFixed(step < 0.1 ? 2 : 1)}
                      </span>
                      {customMax != null && (
                        <button
                          onClick={() => updateNodeParams(node.id, { [`__scMax_${key}`]: null })}
                          style={{ fontSize: '9px', color: '#585b70', background: 'none', border: '1px solid #313244', borderRadius: '3px', cursor: 'pointer', padding: '1px 5px' }}
                          onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#f38ba8')}
                          onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#585b70')}
                          title="Reset to default range"
                        >Reset</button>
                      )}
                    </div>
                  </div>
                )}
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

          if (paramDef.type === 'vec3color') {
            // HTML color picker — converts between [r,g,b] 0-1 and hex
            const vals = Array.isArray(node.params[key]) ? (node.params[key] as number[]) : [0, 0, 0];
            const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
            const hexValue = `#${toHex(vals[0])}${toHex(vals[1])}${toHex(vals[2])}`;
            return (
              <div
                key={key}
                style={{ padding: '3px 10px 5px', display: 'flex', alignItems: 'center', gap: '6px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: '#6c7086', fontSize: '11px', minWidth: '50px' }}>{paramDef.label}</span>
                <input
                  type="color"
                  value={hexValue}
                  onChange={e => {
                    const hex = e.target.value;
                    const r = parseInt(hex.slice(1, 3), 16) / 255;
                    const g = parseInt(hex.slice(3, 5), 16) / 255;
                    const b = parseInt(hex.slice(5, 7), 16) / 255;
                    updateNodeParams(node.id, { [key]: [r, g, b] }, { immediate: true });
                  }}
                  style={{ width: '32px', height: '20px', border: '1px solid #45475a', borderRadius: '3px', background: 'none', cursor: 'pointer', padding: '1px 2px' }}
                />
              </div>
            );
          }

          if (paramDef.type === 'bool') {
            const val = node.params[key] !== false;
            return (
              <div
                key={key}
                style={{ padding: '3px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: '#6c7086', fontSize: '11px' }}>{paramDef.label}</span>
                <input
                  type="checkbox"
                  checked={val}
                  onChange={e => updateNodeParams(node.id, { [key]: e.target.checked })}
                  style={{ cursor: 'pointer', accentColor: '#cba6f7' }}
                />
              </div>
            );
          }

          return null;
        })}

        {/* ── CustomFn / ExprNode slider params (hidden when collapsed) ── */}
        {!collapsed && (node.type === 'customFn' || node.type === 'exprNode') && (() => {
          const cfInputs = (node.params.inputs as Array<{ name: string; type: string; slider?: { min: number; max: number } | null }>) || [];
          const sliderInputs = cfInputs.filter(inp => inp.type === 'float' && inp.slider != null);
          if (sliderInputs.length === 0) return null;
          return sliderInputs.map(inp => {
            const sl = inp.slider!;
            // For exprNode, check if the input socket is wired — if so, the wire controls it
            const isWired = node.type === 'exprNode' && !!(node.inputs[inp.name]?.connection);
            const val = typeof node.params[inp.name] === 'number' ? (node.params[inp.name] as number) : (sl.min + sl.max) / 2;
            const range = sl.max - sl.min || 1;
            const step = range <= 2 ? 0.001 : range <= 10 ? 0.01 : 0.1;
            return (
              <div
                key={inp.name}
                style={{ padding: '3px 10px', display: 'flex', flexDirection: 'column', gap: '2px', opacity: isWired ? 0.4 : 1 }}
                onMouseDown={e => e.stopPropagation()}
                title={isWired ? `${inp.name} is driven by input wire` : undefined}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#6c7086', fontSize: '11px' }}>{inp.name}{isWired ? ' ⟵' : ''}</span>
                  <input
                    type="number"
                    disabled={isWired}
                    style={{ ...INPUT_STYLE, width: '56px', opacity: isWired ? 0.5 : 1 }}
                    value={val}
                    step={step}
                    onChange={e => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) updateNodeParams(node.id, { [inp.name]: v }, { immediate: true });
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={sl.min}
                  max={sl.max}
                  step={step}
                  value={val}
                  disabled={isWired}
                  style={{ width: '100%', accentColor: '#cba6f7', cursor: isWired ? 'default' : 'pointer' }}
                  onChange={e => {
                    if (!isWired) {
                      const v = parseFloat(e.target.value);
                      updateNodeParams(node.id, { [inp.name]: v }, { immediate: true });
                    }
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#45475a', fontSize: '9px', fontFamily: 'monospace' }}>{sl.min}</span>
                  <span style={{ color: '#45475a', fontSize: '9px', fontFamily: 'monospace' }}>{sl.max}</span>
                </div>
              </div>
            );
          });
        })()}

        {/* ── Outputs (always visible) ── */}
        {Object.entries(node.outputs).map(([key, output]) => {
          const isHovered = hoveredOutput === key;
          // Live value badge: show time for Time node
          const liveValueBadge = node.type === 'time' && key === 'time'
            ? (currentTime as number).toFixed(2) + 's'
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
                <span style={{ display: 'flex', alignItems: 'center', gap: '3px', marginRight: '6px' }}>
                  <span style={{ color: '#f9e2af', fontSize: '9px', fontFamily: 'monospace', opacity: 0.8 }}>
                    {liveValueBadge}
                  </span>
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); window.dispatchEvent(new CustomEvent('reset-time')); }}
                    title="Reset time to 0"
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#585b70', fontSize: '9px', padding: '0', lineHeight: 1,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#f9e2af')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#585b70')}
                  >↺</button>
                </span>
              )}
              <span style={{ color: '#a6adc8', fontSize: '11px' }}>{output.label}</span>
              <div
                data-socket="out"
                ref={el => registerSocket(node.id, 'out', key, el)}
                onMouseDown={e => {
                  if (e.altKey) {
                    e.stopPropagation();
                    e.preventDefault();
                    onAltClickSocket?.(node.id, key, 'out', output.type, e);
                    return;
                  }
                  e.stopPropagation();
                  onStartConnection(node.id, key, e);
                }}
                onTouchEnd={e => {
                  e.stopPropagation();
                  e.preventDefault();
                  onTapOutputSocket?.(node.id, key);
                }}
                onMouseEnter={() => setHoveredOutput(key)}
                onMouseLeave={() => setHoveredOutput(null)}
                title={`${output.label} (${output.type})`}
                style={{
                  width: isTouchDevice ? '22px' : '12px',
                  height: isTouchDevice ? '22px' : '12px',
                  borderRadius: '50%',
                  background: TYPE_COLORS[output.type] || '#888',
                  border: `2px solid ${TYPE_COLORS[output.type] || '#888'}`,
                  marginLeft: '8px',
                  flexShrink: 0,
                  marginRight: isTouchDevice ? '-11px' : '-6px',
                  cursor: 'crosshair',
                  touchAction: 'manipulation',
                  boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === key
                    ? `0 0 0 3px ${TYPE_COLORS[output.type] || '#888'}, 0 0 12px ${TYPE_COLORS[output.type] || '#888'}`
                    : undefined,
                  transition: 'box-shadow 0.15s',
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
      {showExprModal && node.type === 'floatWarp' && (
        <ExprModal node={node} onClose={() => setShowExprModal(false)} />
      )}

      {/* ── ExprBlock modal ── */}
      {showExprBlockModal && node.type === 'exprNode' && (
        <ExprBlockModal node={node} onClose={() => setShowExprBlockModal(false)} />
      )}

      {/* ── Bezier editor modal ── */}
      {showBezierModal && (node.type === 'cubicBezierShaper' || node.type === 'quadBezierShaper') && (
        <BezierEditorModal node={node} onClose={() => setShowBezierModal(false)} />
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
                    const liveCode = extractNodeCodeFromShader(shaderLines, node.id);
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
