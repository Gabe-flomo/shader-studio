import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';

// Inject save-flash keyframe once
if (typeof document !== 'undefined' && !document.getElementById('gs-anim')) {
  const s = document.createElement('style');
  s.id = 'gs-anim';
  s.textContent = `
    @keyframes groupSaveFlash {
      0%   { background: rgba(166,227,161,0.5); border-color: ${ctp.green}; color: ${ctp.green}; box-shadow: 0 0 8px ${ctp.green}66; }
      100% { background: none; border-color: ${ctp.surface2}; color: ${ctp.subtext0}; box-shadow: none; }
    }
    .group-save-flash { animation: groupSaveFlash 0.7s ease-out forwards; }
    input[type=number]::-webkit-outer-spin-button,
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
    input[type=number] { -moz-appearance: textfield; }
  `;
  document.head.appendChild(s);
}
import { toast } from '../ui/toastStore';
import type { GraphNode, DataType, NodeDefinition } from '../../types/nodeGraph';
import { TYPE_COLORS } from './typeColors';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';
import { compileNodePreviewShader } from '../../lib/compileNodePreviewShader';
import { getNodeDefinition } from '../../nodes/definitions';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { lazyWithSuspense, type PropsOf } from '../lazyWithSuspense';
// Editors that only open on demand load in their own chunks (type-only imports
// carry the props; they're erased at build time).
import type { ExprModal as ExprModalT } from './ExprModal';
import type { CustomFnModal as CustomFnModalT } from './CustomFnModal';
import type { ExprBlockModal as ExprBlockModalT } from './ExprBlockModal';
import type { BezierEditorModal as BezierEditorModalT } from './BezierEditorModal';
import type { TransformVecModal as TransformVecModalT } from './TransformVecModal';
import type { AssignInitModal as AssignInitModalT } from './AssignInitModal';
import type { KeyframeEditorModal as KeyframeEditorModalT } from './KeyframeEditorModal';
const ExprModal           = lazyWithSuspense<PropsOf<typeof ExprModalT>>(() => import('./ExprModal').then(m => ({ default: m.ExprModal })));
const CustomFnModal       = lazyWithSuspense<PropsOf<typeof CustomFnModalT>>(() => import('./CustomFnModal').then(m => ({ default: m.CustomFnModal })));
const ExprBlockModal      = lazyWithSuspense<PropsOf<typeof ExprBlockModalT>>(() => import('./ExprBlockModal').then(m => ({ default: m.ExprBlockModal })));
const BezierEditorModal   = lazyWithSuspense<PropsOf<typeof BezierEditorModalT>>(() => import('./BezierEditorModal').then(m => ({ default: m.BezierEditorModal })));
const TransformVecModal   = lazyWithSuspense<PropsOf<typeof TransformVecModalT>>(() => import('./TransformVecModal').then(m => ({ default: m.TransformVecModal })));
const AssignInitModal     = lazyWithSuspense<PropsOf<typeof AssignInitModalT>>(() => import('./AssignInitModal').then(m => ({ default: m.AssignInitModal })));
const KeyframeEditorModal = lazyWithSuspense<PropsOf<typeof KeyframeEditorModalT>>(() => import('./KeyframeEditorModal').then(m => ({ default: m.KeyframeEditorModal })));
import type { PublishNodeModal as PublishNodeModalT } from './PublishNodeModal';
const PublishNodeModal    = lazyWithSuspense<PropsOf<typeof PublishNodeModalT>>(() => import('./PublishNodeModal').then(m => ({ default: m.PublishNodeModal })));
import { AudioInputModal } from './AudioInputModal';
import { VideoInputModal } from './VideoInputModal';
import { GroupParamPicker } from './GroupParamPicker';
import { NodeInlineViz, INLINE_VIZ_TYPES, AudioFreqRangeViz } from './NodeInlineViz';
import { VECTORIZABLE_NODES, VEC4_CAPABLE_NODES } from '../../nodes/definitions/math';
import { registerSocket, getView } from './socketRegistry';
import { startNodeMouseDrag, startNodeTouchDrag } from './nodeDrag';
import { moveItem } from '../../lib/reorder';
import { scopeCanvasRegistry, scopeBufferRegistry, vectorValueRegistry, floatValueRegistry } from '../../lib/scopeRegistry';
import { audioEngine } from '../../lib/audioEngine';
import { videoEngine } from '../../lib/videoEngine';
import { errorMessage } from '../../utils/fileIO';
import type { FileResult } from '../../utils/fileIO';
import { isParamVisible } from '../../compiler/uniformPatcher';
import { typesCompatible } from '../../lib/typesCompatible';
import type { SurfacedParam, SubgraphData } from '../../types/nodeGraph';
import { Menu } from '../ui/Menu';
import { computeNodeSlug } from '../../compiler/nodeSlug';
import { getUserNode } from '../../nodes/userNodes/userNodeRegistry';
import { DocText } from '../ui/DocText';
import { canRandomize, randomizableParams, randomizeAmount, randomizeExcluded } from '../../nodes/randomizeParams';
import { useFoldState } from './foldState';
import { RandomizeMenu } from './RandomizeMenu';
import { timeReadoutRef } from '../../lib/timeTick';
import type { NodeError } from '../../compiler/nodeErrors';
import { isKeyframeBypassed, socketHasKeyframes, socketHasVectorKeyframes, VECTOR_AXES } from '../../compiler/keyframes';
import { loadImageTextureFromFile } from '../../lib/loadImageTexture';
import { NumberInput } from './NumberInput';
import { ctp } from '../../theme/palette';
import { useCtp, type CtpPalette } from '../../theme/nodePalette';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { RulerSlider } from '../ui/RulerSlider';
import { Select } from '../ui/Select';
import { Toggle } from '../ui/Choice';
import { CardBadge, CardButton, CardDivider, KeyframedRuler, ParamLabel, ParamSocket, WiredChip } from './NodeCardParts';

function adaptiveStep(value: number, baseStep: number): number {
  const abs = Math.abs(value);
  if (abs > 0 && abs < baseStep) {
    return Math.pow(10, Math.floor(Math.log10(abs)) - 1);
  }
  return baseStep;
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
  /** The group currently drilled into (resolved once in NodeGraph), or null at the top level. */
  activeGroupNode?: GraphNode | null;
  /** When a highlight filter is active, non-matching nodes are dimmed */
  dimmed?: boolean;
  /** Called when user double-clicks a group node header to drill into it */
  onEnterGroup?: (groupId: string) => void;
  /** Node has a compilation error — show red ring */
  hasError?: boolean;
  /** Click (not drag) on an open socket → Smart connect suggestions at the pointer */
  onSuggestSocket?: (nodeId: string, key: string, dir: 'in' | 'out', x: number, y: number) => void;
  /** Compile problems traced to this node (see compiler/nodeErrors.ts) */
  errors?: NodeError[];
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
  /** Called when the pointer enters/leaves any socket dot; used for Shift+hover connection spotlight */
  onSocketHover?: (info: { nodeId: string; key: string; dir: 'in' | 'out' } | null) => void;
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

const SKIP_PREVIEW = new Set(['output', 'vec4Output', 'scope', 'textureInput', 'audioInput', 'transformVec', 'videoInput']);
let zCounter = 10; // incremented each time a node is brought to front
const LFO_TYPES    = new Set(['lfo']);
// Node types with always-visible built-in visualizations (skip the 👁 in-card panel for these)
const ALWAYS_VIZ_TYPES = new Set([...LFO_TYPES, 'remap', 'audioInput']);
// Float-output nodes that should render a grayscale shader thumbnail instead of the scope waveform
const GRAYSCALE_PREVIEW_TYPES = new Set(['fbm', 'voronoi', 'noiseFloat', 'sdSegment', 'mask', 'luminance', 'sobel', 'compare', 'select']);


const inputStyleFor = (tc: CtpPalette): React.CSSProperties => ({
  background: 'transparent',
  border: `1px solid ${tc.surface0}88`,
  color: tc.text,
  padding: '1px 4px',
  borderRadius: '3px',
  fontSize: '11px',
  width: '52px',
  outline: 'none',
  textAlign: 'center',
  // hide browser spinner arrows
  MozAppearance: 'textfield' as React.CSSProperties['MozAppearance'],
}) as React.CSSProperties;


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
function formatVal(v: number | number[] | undefined, type: string): string | null {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    const parts = v.map(n => n.toFixed(2));
    if (type === 'vec2') return `(${parts[0]}, ${parts[1]})`;
    if (type === 'vec3') return `(${parts[0]}, ${parts[1]}, ${parts[2]})`;
    return `(${parts.join(', ')})`;
  }
  return (v as number).toFixed(3);
}

function NodeTooltip({ def, node, allNodes }: { def: NodeDefinition; node: GraphNode; allNodes: GraphNode[] }) {
  const tc = useCtp();
  const tk = useTokens();
  const inputEntries  = Object.entries(def.inputs);
  const outputEntries = Object.entries(def.outputs);

  function getInputInfo(k: string, type: string): React.ReactNode {
    const sock = node.inputs[k];
    if (!sock) return null;
    if (sock.connection) {
      const src = allNodes.find(n => n.id === sock.connection!.nodeId);
      const srcDef = src ? getNodeDefinition(src.type) : null;
      const srcLabel = src && src.type === 'customFn' && typeof src.params.label === 'string'
        ? src.params.label || srcDef?.label
        : srcDef?.label;
      const connKey = `${sock.connection.nodeId}:${sock.connection.outputKey}`;
      if (type === 'float') {
        const decoded = floatValueRegistry.get(`__preview__${connKey}`);
        if (decoded !== undefined) {
          return <span style={{ color: tc.yellow, fontFamily: fontFamily.mono, fontSize: 11 }}>{decoded.toFixed(3)}</span>;
        }
      } else if (type === 'vec2' || type === 'vec3') {
        const vals = vectorValueRegistry.get(`__preview__${connKey}`);
        if (vals) {
          const formatted = type === 'vec2'
            ? `(${vals[0].toFixed(2)}, ${vals[1].toFixed(2)})`
            : `(${vals[0].toFixed(2)}, ${vals[1].toFixed(2)}, ${vals[2].toFixed(2)})`;
          return <span style={{ color: tc.yellow, fontFamily: fontFamily.mono, fontSize: 11 }}>{formatted}</span>;
        }
      }
      return <span style={{ color: tc.surface1, fontSize: '10px' }}>← {srcLabel ?? src?.type}</span>;
    }
    const formatted = formatVal(sock.defaultValue, type);
    if (formatted) return <span style={{ color: tc.overlay0, fontFamily: fontFamily.mono, fontSize: 11 }}>{formatted}</span>;
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '100%',
        left: 0,
        zIndex: 1000,
        background: tk.bg.panel,
        borderRadius: radius.lg,
        padding: '12px 14px',
        width: 340,
        boxSizing: 'border-box',
        font: `12px/1.45 ${fontFamily.ui}`,
        color: tk.text.primary,
        pointerEvents: 'none',
        boxShadow: tk.shadow.popover,
        marginTop: 6,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13.5 }}>{def.label}</div>
      {def.description && (
        <DocText text={Array.isArray(def.description) ? (def.description as string[]).join('\n') : def.description} style={{ color: tc.subtext0, marginBottom: 8 }} />
      )}
      {inputEntries.length > 0 && (
        <div style={{ marginBottom: 5 }}>
          <div style={{ color: tk.text.faint, fontSize: 10, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Inputs</div>
          {inputEntries.map(([k, s]) => {
            const info = getInputInfo(k, s.type);
            return (
              <div key={k} style={{ paddingLeft: 4, marginBottom: s.hint ? 4 : 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: tc.blue, fontFamily: fontFamily.mono, fontSize: 11, minWidth: 60 }}>{s.label}</span>
                  <span style={{ color: tc.surface2, fontSize: 11, minWidth: 34 }}>{s.type}</span>
                  {info}
                </div>
                {s.hint && <DocText text={s.hint} style={{ color: tc.subtext0, fontSize: 11.5, paddingLeft: 8, marginTop: 1 }} />}
              </div>
            );
          })}
        </div>
      )}
      {outputEntries.length > 0 && (
        <div style={{ marginBottom: def.glslFunction ? 8 : 0 }}>
          <div style={{ color: tk.text.faint, fontSize: 10, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Outputs</div>
          {outputEntries.map(([k, s]) => {
            // Show probed float output value if available
            const probed = s.type === 'float' ? floatValueRegistry.get(`__preview__${node.id}`) : undefined;
            const liveVal = probed !== undefined ? probed.toFixed(3) : null;
            return (
              <div key={k} style={{ paddingLeft: 4, marginBottom: s.hint ? 4 : 1 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: tc.green, fontFamily: fontFamily.mono, fontSize: 11, minWidth: 60 }}>{s.label}</span>
                  <span style={{ color: tc.surface2, fontSize: 11, minWidth: 34 }}>{s.type}</span>
                  {liveVal && <span style={{ color: tc.yellow, fontFamily: fontFamily.mono, fontSize: 11 }}>{liveVal}</span>}
                </div>
                {s.hint && <DocText text={s.hint} style={{ color: tc.subtext0, fontSize: 11.5, paddingLeft: 8, marginTop: 1 }} />}
              </div>
            );
          })}
        </div>
      )}
      {(() => {
        // Sliders that aren't also sockets, with their docstrings (user nodes
        // document these in the publish dialog; built-ins via paramDef.hint).
        const sliders = Object.entries(def.paramDefs ?? {}).filter(([k, pd]) => !(k in def.inputs) && pd.hint);
        if (sliders.length === 0) return null;
        return (
          <div style={{ marginBottom: def.glslFunction ? 8 : 0 }}>
            <div style={{ color: tk.text.faint, fontSize: 10, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Sliders</div>
            {sliders.map(([k, pd]) => (
              <div key={k} style={{ paddingLeft: 4, marginBottom: 4 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: tc.mauve, fontFamily: fontFamily.mono, fontSize: 11, minWidth: 60 }}>{pd.label}</span>
                  {pd.min !== undefined && pd.max !== undefined && <span style={{ color: tc.surface2, fontSize: 11 }}>{pd.min} – {pd.max}</span>}
                </div>
                <DocText text={pd.hint!} style={{ color: tc.subtext0, fontSize: 11.5, paddingLeft: 8, marginTop: 1 }} />
              </div>
            ))}
          </div>
        );
      })()}
      {def.glslFunction && (
        <div>
          <div style={{ color: tk.text.faint, fontSize: 10, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>GLSL</div>
          <pre style={{
            background: tk.bg.field, borderRadius: radius.sm, padding: '6px 8px',
            fontSize: 10.5, color: tk.text.secondary, margin: 0,
            maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre', fontFamily: fontFamily.mono,
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
  const tk = useTokens();
  return (
    <div
      style={{
        position: 'absolute',
        [side === 'left' ? 'left' : 'right']: '22px',
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 200,
        background: tk.bg.panel,
        borderRadius: radius.md,
        padding: '8px 10px',
        minWidth: 180,
        maxWidth: 280,
        font: `11.5px/1.5 ${fontFamily.ui}`,
        color: tk.text.primary,
        pointerEvents: 'none',
        boxShadow: tk.shadow.popover,
        whiteSpace: 'nowrap',
      }}
    >
      {lines.map((line, i) => <div key={i}>{line}</div>)}
    </div>
  );
}

// Extract the lines of the compiled fragment shader that belong to a node: the ones declaring or
// assigning one of its variables. Those are named after the node's slug (`circ_3_dist`), not its id.
function extractNodeCodeFromShader(lines: string[], node: GraphNode): string {
  if (!lines.length) return '';
  const slug = computeNodeSlug(node, new Set());
  const ownAssignment = new RegExp(`^\\s*(?:\\w+\\s+)?${slug}_\\w*(?:\\.\\w+)?\\s*[-+*/]?=(?!=)`);
  return lines.filter(l => ownAssignment.test(l)).join('\n');
}

// Extract the RHS expression for a specific output variable from compiled GLSL
function getSourceExpr(lines: string[], varMap: ReadonlyMap<string, Record<string, string>>, sourceNodeId: string, outputKey: string): string {
  if (!lines.length) return '';
  // Compiled variables are named from the node's slug (`circ_3_dist`), not its id or output key:
  // the compiler's map says which one this output became.
  const varName = varMap.get(sourceNodeId)?.[outputKey] ?? `${sourceNodeId}_${outputKey}`;
  const assign = new RegExp(`(?:^|\\s)${varName.replace(/[^A-Za-z0-9_]/g, '')}\\s*=(?!=)`);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!assign.test(trimmed)) continue;
    const eqIdx = trimmed.search(/=(?!=)/);
    const rhs = trimmed.slice(eqIdx + 1).trim().replace(/;$/, '');
    // Truncate long expressions
    return rhs.length > 60 ? rhs.slice(0, 57) + '...' : rhs;
  }
  return varName; // fallback: just show the variable name
}

const EMPTY_NODES: GraphNode[] = [];
/** Live zoom for drag math — published by NodeGraph, read at each move. */
const getZoom = () => getView().zoom;

// Memoised: NodeGraph re-renders on every pan commit, selection change and
// store write, and a plain function component would re-render every card each
// time. All props are stable references or primitives.
export const NodeComponent = React.memo(function NodeComponent({ node, onStartConnection, onEndConnection, onTapOutputSocket, onTapInputSocket, pendingMobileConnection, pendingMobileType, isTouchDevice = false, draggingType, activeGroupNode = null, dimmed = false, onEnterGroup, hasError = false, errors, externalInputKeys, externalParamKeys, onAltClickSocket, isConnectionDragging = false, onSocketHover, onSuggestSocket }: Props) {
  const tc = useCtp();
  const tk = useTokens();
  const inputStyle_ = inputStyleFor(tc);
  const fragmentShader  = useNodeGraphStore(s => s.fragmentShader);
  const nodeOutputVarMap = useNodeGraphStore(s => s.nodeOutputVarMap);
  const previewNodeId   = useNodeGraphStore(s => s.previewNodeId);
  const activeGroupId   = useNodeGraphStore(s => s.activeGroupId);
  // Check if the active group has iterations > 1 (assignOp / carryMode only meaningful in loops)
  const activeGroupIterations = typeof activeGroupNode?.params?.iterations === 'number' ? activeGroupNode.params.iterations : 1;
  const isInsideLoop = activeGroupId != null && activeGroupIterations > 1;
  const isPreviewActive = previewNodeId === node.id;
  const updateNodePosition = useNodeGraphStore(s => s.updateNodePosition);
  const removeNode         = useNodeGraphStore(s => s.removeNode);
  const updateNodeParams       = useNodeGraphStore(s => s.updateNodeParams);
  const randomizeNodeParams    = useNodeGraphStore(s => s.randomizeNodeParams);
  const foldedSections = useFoldState(s => s.folded);
  const toggleFold     = useFoldState(s => s.toggle);
  const [randomizeMenu, setRandomizeMenu] = useState<{ x: number; y: number } | null>(null);
  const changeNodeVectorType   = useNodeGraphStore(s => s.changeNodeVectorType);
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
  const revealNode         = useNodeGraphStore(s => s.revealNode);
  const revealTimer        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedNodeId     = useNodeGraphStore(s => s.selectedNodeId);
  const isSelected         = selectedNodeId === node.id;

  // Multi-select
  const selectNode         = useNodeGraphStore(s => s.selectNode);
  const selectedNodeIds    = useNodeGraphStore(s => s.selectedNodeIds);
  const isMultiSelected    = selectedNodeIds.includes(node.id);
  const addMarchLoopInput      = useNodeGraphStore(s => s.addMarchLoopInput);
  const removeMarchLoopInput   = useNodeGraphStore(s => s.removeMarchLoopInput);
  const renameMarchLoopInput   = useNodeGraphStore(s => s.renameMarchLoopInput);
  const toggleMarchLoopOutputPort = useNodeGraphStore(s => s.toggleMarchLoopOutputPort);
  const mlGroupHiddenOutputs = (activeGroupNode?.params?.hiddenOutputs as string[] | undefined) ?? [];
  const renameGroupPort        = useNodeGraphStore(s => s.renameGroupPort);
  const removeGroupInputPort   = useNodeGraphStore(s => s.removeGroupInputPort);
  const saveGroupPreset        = useNodeGraphStore(s => s.saveGroupPreset);
  const duplicateGroup         = useNodeGraphStore(s => s.duplicateGroup);
  const ungroupNode            = useNodeGraphStore(s => s.ungroupNode);

  // Swap mode
  const swapTargetNodeId   = useNodeGraphStore(s => s.swapTargetNodeId);
  const setSwapTargetNodeId = useNodeGraphStore(s => s.setSwapTargetNodeId);
  const openUserNodeSource  = useNodeGraphStore(s => s.openUserNodeSource);
  const isSwapTarget       = swapTargetNodeId === node.id;
  // Texture input
  const setNodeTexture     = useNodeGraphStore(s => s.setNodeTexture);
  const nodeTexture        = useNodeGraphStore(s => node.type === 'textureInput' ? s.nodeTextures[node.id] : null);
  // Video input
  const setVideoTexture    = useNodeGraphStore(s => s.setVideoTexture);

  // Node preview thumbnail — rendered at 200×200 when the 👁 preview mode is active
  const setNodePreview  = useNodeGraphStore(s => s.setNodePreview);
  const previewDataUrl  = useNodeGraphStore(s => s.nodePreviews[node.id] ?? null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // The thumbnail follows the node's own sliders: params are baked into the preview shader, so a
  // change is a new shader. Debounced so a slider drag doesn't compile on every tick.
  const paramsKey = JSON.stringify(node.params);
  const [previewParamsKey, setPreviewParamsKey] = useState(paramsKey);
  useEffect(() => {
    if (!isPreviewActive) return;
    const t = setTimeout(() => setPreviewParamsKey(paramsKey), 300);
    return () => clearTimeout(t);
  }, [paramsKey, isPreviewActive]);

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
    nodePreviewRenderer.renderNodePreview(node.id, fs, { u_time: { value: useNodeGraphStore.getState().currentTime ?? 0 } }, 200)
      .then(url => { if (!cancelled) { setNodePreview(node.id, url); setPreviewLoading(false); } })
      .catch(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreviewActive, node.id, node.type, previewParamsKey]);

  // Comment preview — brief hover delay (not the old 1200ms tooltip delay,
  // just enough to avoid flicker while panning/passing over the card).
  const commentHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCommentPreview, setShowCommentPreview] = useState(false);
  const handleCardMouseEnter = useCallback(() => {
    commentHoverTimerRef.current = setTimeout(() => setShowCommentPreview(true), 200);
  }, []);
  const handleCardMouseLeave = useCallback(() => {
    if (commentHoverTimerRef.current) { clearTimeout(commentHoverTimerRef.current); commentHoverTimerRef.current = null; }
    setShowCommentPreview(false);
  }, []);

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
  const [collapsed, setCollapsed] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showPublish, setShowPublish] = useState(false); // group card → Publish as node
  // "Publish as node" on the selection bar groups the selection and asks the
  // new group's card to open the dialog as soon as it exists.
  const pendingPublishGroupId = useNodeGraphStore(s => s.pendingPublishGroupId);
  const setPendingPublishGroupId = useNodeGraphStore(s => s.setPendingPublishGroupId);
  useEffect(() => {
    if (pendingPublishGroupId && pendingPublishGroupId === node.id && node.type === 'group') {
      setPendingPublishGroupId(null);
      setShowPublish(true);
    }
  }, [pendingPublishGroupId, node.id, node.type, setPendingPublishGroupId]);
  // Custom Fn card → Publish as node (code source), or a user node's "open source" for code-backed types
  const [publishCode, setPublishCode] = useState<{ code: string; entry?: string; label: string; existingId?: string } | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [showExprModal, setShowExprModal] = useState(false);
  const [showExprBlockModal, setShowExprBlockModal] = useState(false);
  const [showBezierModal, setShowBezierModal] = useState(false);
  const [showTransformVecModal, setShowTransformVecModal] = useState(false);
  const [showCustomFnModal, setShowCustomFnModal] = useState(false);
  const [showAudioInputModal, setShowAudioInputModal] = useState(false);
  const [showVideoInputModal, setShowVideoInputModal] = useState(false);
  const [kfMenu, setKfMenu] = useState<{ x: number; y: number; key: string } | null>(null);
  const [kfModalKey, setKfModalKey] = useState<string | null>(null);
  const [hoveredInput, setHoveredInput] = useState<string | null>(null);
  const [kfChipHover, setKfChipHover] = useState(false);
  const [hoveredOutput, setHoveredOutput] = useState<string | null>(null);
  const [showNodeTooltip, setShowNodeTooltip] = useState(false);
  // The full node list is only read by the socket / node tooltips ("connected
  // to", "sources in graph"). Subscribing to it unconditionally re-rendered
  // every card on every graph change, so it's selected only while one of
  // those tooltips is open; otherwise a stable empty array.
  const nodes = useNodeGraphStore(s => (showNodeTooltip || hoveredInput !== null) ? s.nodes : EMPTY_NODES);
  const [showCommentEditor, setShowCommentEditor] = useState(false);
  const [zIndex, setZIndex] = useState(1);
  // Info tooltip: close on any click outside the tooltip itself or the info
  // button that opened it (button is excluded so its own onClick toggle isn't
  // immediately undone by this — mousedown fires before click).
  const infoButtonRef = useRef<HTMLSpanElement>(null);
  const nodeTooltipRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showNodeTooltip) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (infoButtonRef.current?.contains(target)) return;
      if (nodeTooltipRef.current?.contains(target)) return;
      setShowNodeTooltip(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNodeTooltip]);
  // Comment text lives in node.params.__comment — same "__-prefixed metadata,
  // not a real shader param" convention already used by __codeOverride.
  const nodeComment = typeof node.params.__comment === 'string' ? (node.params.__comment as string) : '';
  // Close the comment editor; a comment that's only whitespace is removed rather than kept
  const finishComment = () => {
    if (typeof node.params.__comment === 'string' && !node.params.__comment.trim()) updateNodeParams(node.id, { __comment: undefined });
    setShowCommentEditor(false);
  };

  // Scope node: canvas ref + global registry (drawing happens in ShaderCanvas animation loop)
  const scopeCanvasRef        = useRef<HTMLCanvasElement>(null);
  const previewScopeCanvasRef = useRef<HTMLCanvasElement>(null);

  // Register / unregister this canvas in the global scope registry so ShaderCanvas
  // can draw directly without going through React state (eliminates setState→re-render lag).
  // Keep matConst output type in sync with its size param (mat2 vs mat3)
  React.useEffect(() => {
    if (node.type !== 'matConst') return;
    const size = (node.params.size as string) ?? 'mat3';
    const currentType = node.outputs.mat?.type;
    if (currentType !== size) {
      updateNodeOutputs(node.id, { mat: { type: size as import('../../types/nodeGraph').DataType, label: 'Matrix' } });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.type, node.id, node.params.size]);

  React.useEffect(() => {
    if (node.type !== 'scope' && !LFO_TYPES.has(node.type)) return;
    const canvas = scopeCanvasRef.current;
    if (canvas) scopeCanvasRegistry.register(node.id, canvas);
    return () => {
      scopeCanvasRegistry.unregister(node.id);
      scopeBufferRegistry.delete(node.id);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.type, node.id]);

  // Show scope canvas only when the node's dominant output is float — i.e. it has a float
  // output but NO vec3/vec4 output that would be better shown as a shader thumbnail.
  const primaryOutputIsFloat = !!def
    && Object.values(def.outputs).some(s => s.type === 'float')
    && !Object.values(def.outputs).some(s => s.type === 'vec3' || s.type === 'vec4');

  // Register preview scope canvas when 👁 is active and output is float
  React.useEffect(() => {
    if (!isPreviewActive || !primaryOutputIsFloat) return;
    const canvas = previewScopeCanvasRef.current;
    const key = `__preview__${node.id}`;
    if (canvas) scopeCanvasRegistry.register(key, canvas);
    return () => {
      scopeCanvasRegistry.unregister(key);
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

  /** Shell shared by the special cards (loop index, media inputs, scope, march loop ends). */
  const specialCardStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', left: node.position.x, top: node.position.y, width: 360, boxSizing: 'border-box',
    background: tk.bg.panel, borderRadius: radius.card, color: tk.text.primary, fontSize: 12.5, fontFamily: fontFamily.ui,
    userSelect: 'none', opacity: dimmed ? 0.2 : 1, transition: 'opacity 0.15s, box-shadow 0.15s',
    boxShadow: isMultiSelected ? `0 0 0 2px ${tk.accent.base}, ${tk.shadow.card}`
      : isSelected ? `0 0 0 1.5px ${tk.accent.base}, ${tk.shadow.card}` : tk.shadow.card,
    ...extra,
  });
  const specialHeadStyle: React.CSSProperties = {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '8px 8px 8px 14px',
    borderBottom: `1px solid ${tk.border.subtle}`, cursor: 'grab',
    background: tk.bg.head, borderRadius: `${radius.card}px ${radius.card}px 0 0`,
  };

  // ── Loop Index node special card ─────────────────────────────────────────────
  if (node.type === 'loopIndex') {
    // Deletable if: in the main graph (no active group), OR inside a group with 2+ loop index nodes
    const loopIndexSiblingCount = (() => {
      if (!activeGroupId) return 0; // main graph — count doesn't matter, always deletable
      const sg = activeGroupNode?.params.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
      return sg ? sg.nodes.filter(n => n.type === 'loopIndex').length : 0;
    })();
    const canDeleteLoopIndex = !activeGroupId || loopIndexSiblingCount > 1;

    const nodeStyle = specialCardStyle({ cursor: 'default' });
    return (
      <div
        data-node-id={node.id}
        style={nodeStyle}
        onMouseDown={e => {
          e.stopPropagation();
          setSelectedNodeId(node.id);
          selectNode(node.id, e.shiftKey || e.metaKey);
          startNodeMouseDrag({
            nodeId: node.id,
            cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
            startClient: { x: e.clientX, y: e.clientY },
            startPosition: node.position,
            getZoom,
            threshold: 0,
            commit: pos => updateNodePosition(node.id, pos),
          });
        }}
      >
        {/* Header */}
        <div style={specialHeadStyle}>
          <span style={{ fontWeight: 600, fontSize: 13.5, color: tc.mauve, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ fontSize: '10px', opacity: 0.7 }}>⟳</span> Loop Index
          </span>
          {canDeleteLoopIndex ? (
            <button
              onMouseDown={e => e.stopPropagation()}
              onClick={() => removeNode(node.id)}
              style={{ background: 'none', border: 'none', color: tc.surface2, cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = tc.red)}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = tc.surface2)}
              title="Remove loop index"
            >✕</button>
          ) : (
            <span style={{ fontSize: '9px', color: tc.surface2, fontFamily: 'monospace' }} title="Last loop index in group — cannot delete">🔒</span>
          )}
        </div>
        {/* Body */}
        <div style={{ padding: '6px 0 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '3px 0 3px 10px' }}>
            <span style={{ color: tc.subtext0, fontSize: '11px', marginRight: '6px', fontFamily: 'monospace', opacity: 0.6 }}>float i</span>
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
      loadImageTextureFromFile(file)
        .then(({ texture, thumbnailDataUrl, imageAspect }) => {
          setNodeTexture(node.id, texture);
          updateNodeParams(node.id, { _thumbnailUrl: thumbnailDataUrl, _imageAspect: imageAspect }, { immediate: true });
        })
        .catch(err => toast.error('Couldn’t load that image', { message: 'The file may be damaged or in a format the browser can’t read. Your graph wasn’t changed.', details: errorMessage(err) }));
    };

    return (
      <div
        data-node-id={node.id}
        style={specialCardStyle()}
      >
        {/* Header */}
        <div
          onMouseDown={(e) => {
            if (e.button === 2) return;
            e.stopPropagation();
            startNodeMouseDrag({
              nodeId: node.id,
              cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
              startClient: { x: e.clientX, y: e.clientY },
              startPosition: node.position,
              getZoom,
              threshold: 0,
              commit: pos => updateNodePosition(node.id, pos),
              onSettle: () => setSelectedNodeId(isSelected ? null : node.id),
            });
          }}
          style={specialHeadStyle}
        >
          <span style={{ fontWeight: 600, fontSize: '11px' }}>Texture Input</span>
          <button onMouseDown={e => e.stopPropagation()} onClick={() => removeNode(node.id)} style={{ background: 'none', border: 'none', color: tc.red, cursor: 'pointer', fontSize: '13px' }}>✕</button>
        </div>

        {/* Thumbnail or placeholder */}
        <div style={{ padding: '8px 10px', display: 'flex', gap: '8px', alignItems: 'center' }} onMouseDown={e => e.stopPropagation()}>
          {thumbnailUrl ? (
            <img src={thumbnailUrl} alt="texture" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '4px', border: `1px solid ${tc.surface1}`, flexShrink: 0 }} />
          ) : (
            <div style={{ width: 48, height: 48, background: tc.surface0, borderRadius: '4px', border: `1px dashed ${tc.surface1}`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🖼</div>
          )}
          <label style={{ fontSize: '10px', color: tc.blue, cursor: 'pointer', border: `1px solid ${tc.blue}55`, borderRadius: '3px', padding: '3px 7px' }}>
            {nodeTexture ? 'Change' : 'Load Image'}
            <input type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
          </label>
        </div>

        {/* Fit mode — this card bypasses the generic paramDefs renderer
            (it returns early, above), so unlike most select params this one
            needs its own dropdown here. */}
        <div style={{ padding: '0 10px 8px', display: 'flex', alignItems: 'center', gap: '6px' }} onMouseDown={e => e.stopPropagation()}>
          <span style={{ color: tc.overlay0, fontSize: '10px' }}>Fit</span>
          <select
            value={(node.params.fit as string) ?? 'stretch'}
            onChange={e => updateNodeParams(node.id, { fit: e.target.value }, { immediate: true })}
            style={{ background: tc.mantle, border: `1px solid ${tc.surface1}`, color: tc.text, borderRadius: '3px', fontSize: '10px', padding: '2px 4px', outline: 'none', cursor: 'pointer', flex: 1 }}
          >
            <option value="stretch">Stretch</option>
            <option value="contain">Fit (no crop)</option>
            <option value="cover">Fill (crop)</option>
          </select>
        </div>

        {/* Sockets row: UV input on left, outputs on right */}
        <div style={{ padding: '3px 0 5px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* UV input socket */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '4px' }}>
            <div
              data-socket="in"
              ref={el => { registerSocket(node.id, 'in', 'uv', el); }}
              onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, 'uv'); }}
              onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapInputSocket?.(node.id, 'uv'); }}
              style={{
                width: isTouchDevice ? 22 : 12, height: isTouchDevice ? 22 : 12,
                borderRadius: '50%',
                background: node.inputs.uv?.connection ? TYPE_COLORS['vec2'] : '#333',
                border: `2px solid ${TYPE_COLORS['vec2']}`,
                cursor: 'pointer',
                marginLeft: isTouchDevice ? '-11px' : '-6px',
                flexShrink: 0,
                touchAction: 'manipulation',
              }}
            />
            <span style={{ fontSize: '10px', color: tc.subtext0 }}>UV</span>
          </div>
          {/* Output sockets */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
            {Object.entries(node.outputs).map(([key, out]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '4px' }}>
                <span style={{ fontSize: '10px', color: tc.subtext0 }}>{out.label}</span>
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

    // Resolves (never rejects) with the outcome so a UI can report it; the
    // node's params are only updated once the audio has actually decoded.
    const loadAudioFile = (file: File): Promise<FileResult> => {
      if (!file.name.match(/\.(wav|mp3|ogg|aac|flac)$/i)) {
        const error = `"${file.name}" is not a supported audio file (wav, mp3, ogg, aac, flac)`;
        console.error('[AudioInput]', error);
        return Promise.resolve({ ok: false, error });
      }
      return new Promise<FileResult>((resolve) => {
        const reader = new FileReader();
        reader.onerror = () => {
          const error = `Could not read "${file.name}": ${reader.error?.message || 'unknown read error'}`;
          console.error('[AudioInput]', error, reader.error);
          resolve({ ok: false, error });
        };
        reader.onload = async (ev) => {
          const arrayBuffer = ev.target?.result as ArrayBuffer;
          try {
            await audioEngine.loadAudio(node.id, arrayBuffer, file.name);
          } catch (e) {
            // audioEngine.loadAudio already logged the decode failure.
            resolve({ ok: false, error: errorMessage(e) });
            return;
          }
          audioEngine.startAudio(node.id);
          updateNodeParams(node.id, { _fileName: file.name, _hasFile: true, _isPlaying: true }, { immediate: true });
          resolve({ ok: true });
        };
        reader.readAsArrayBuffer(file);
      });
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
          style={specialCardStyle()}
        >
          {/* Header */}
          <div
            onMouseDown={(e) => {
              if (e.button === 2) return;
              e.stopPropagation();
              startNodeMouseDrag({
                nodeId: node.id,
                cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
                startClient: { x: e.clientX, y: e.clientY },
                startPosition: node.position,
                getZoom,
                threshold: 0,
                commit: pos => updateNodePosition(node.id, pos),
                onSettle: () => setSelectedNodeId(isSelected ? null : node.id),
              });
            }}
            style={specialHeadStyle}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {/* Play/pause button */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={togglePlay}
                title={isNodePlaying ? 'Pause' : 'Play'}
                disabled={!hasFile}
                style={{ background: 'none', border: 'none', color: !hasFile ? tc.surface1 : isNodePlaying ? tc.green : tc.sky, cursor: hasFile ? 'pointer' : 'default', fontSize: '11px', padding: '0', lineHeight: 1 }}
              >{isNodePlaying ? '⏸' : '▶'}</button>
              <span style={{ fontWeight: 600, fontSize: '11px', color: tc.sky }}>
                Audio Input{soloedBand >= 0 ? <span style={{ color: tc.yellow, fontSize: '9px', marginLeft: '4px' }}>SOLO</span> : null}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {/* Open analyzer modal */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setShowAudioInputModal(v => !v)}
                title="Open Audio analyzer"
                style={{ background: 'none', border: 'none', color: showAudioInputModal ? tc.sky : tc.surface2, cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
              >◉</button>
              <button onMouseDown={e => e.stopPropagation()} onClick={() => removeNode(node.id)} style={{ background: 'none', border: 'none', color: tc.red, cursor: 'pointer', fontSize: '13px' }}>✕</button>
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
              border: `1px dashed ${tc.surface1}`,
              borderRadius: '4px',
              margin: '6px 8px',
              textAlign: 'center',
              cursor: 'pointer',
              background: tc.mantle,
            }}
          >
            {hasFile ? (
              <span style={{ fontSize: '10px', color: tc.sky, fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ♫ {fileName}
              </span>
            ) : (
              <span style={{ fontSize: '10px', color: tc.surface2 }}>Click or drop WAV / MP3 / OGG</span>
            )}
          </div>

          {/* Params */}
          <div style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: '5px' }} onMouseDown={e => e.stopPropagation()}>
            {/* Mode */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: tc.surface2, width: '60px', flexShrink: 0 }}>Mode</span>
              <select
                value={mode}
                onChange={e => updateNodeParams(node.id, { mode: e.target.value }, { immediate: true })}
                style={{ flex: 1, background: tc.surface0, border: `1px solid ${tc.surface1}`, color: tc.text, fontSize: '10px', borderRadius: '4px', padding: '2px 4px', cursor: 'pointer' }}
              >
                <option value="band">Band</option>
                <option value="full">Full Spectrum</option>
              </select>
            </div>
            {/* Shared range */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: tc.surface2, width: '60px', flexShrink: 0 }}>Range Hz</span>
              <input
                type="range" min={0} max={10000} step={1}
                value={freqRange}
                disabled={mode === 'full'}
                onChange={e => updateNodeParams(node.id, { freq_range: parseFloat(e.target.value) }, { immediate: true })}
                style={{ flex: 1, accentColor: tc.sky, cursor: mode === 'full' ? 'default' : 'pointer', opacity: mode === 'full' ? 0.3 : 1 }}
              />
              <span style={{ fontSize: '10px', color: tc.overlay0, fontFamily: 'monospace', width: '42px', textAlign: 'right' }}>±{freqRange}</span>
            </div>
            {/* Band list */}
            {mode !== 'full' && bands.map((center, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleRemoveBand(i)}
                  disabled={bands.length <= 1}
                  title="Remove band"
                  style={{ background: 'none', border: 'none', color: bands.length <= 1 ? tc.surface1 : tc.surface2, cursor: bands.length <= 1 ? 'default' : 'pointer', fontSize: '11px', padding: '0', lineHeight: 1, flexShrink: 0 }}
                >×</button>
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={() => handleSolo(i)}
                  title={soloedBand === i ? 'Un-solo' : 'Solo this band'}
                  style={{ background: 'none', border: 'none', color: soloedBand === i ? tc.yellow : tc.surface1, cursor: 'pointer', fontSize: '9px', padding: '0', lineHeight: 1, flexShrink: 0, fontWeight: 700 }}
                >S</button>
                <input
                  type="range" min={0} max={1000} step={1}
                  value={hzToSlider(center)}
                  onChange={e => {
                    const newHz = sliderToHz(parseInt(e.target.value));
                    const newBands = bands.map((c, idx) => idx === i ? newHz : c);
                    updateNodeParams(node.id, { _bands: newBands }, { immediate: true });
                  }}
                  style={{ flex: 1, accentColor: tc.sky, cursor: 'pointer' }}
                />
                <span style={{ fontSize: '10px', color: tc.overlay0, fontFamily: 'monospace', width: '38px', textAlign: 'right' }}>
                  {center >= 1000 ? `${(center/1000).toFixed(1)}k` : `${center}`}
                </span>
              </div>
            ))}
            {/* Add band button */}
            {mode !== 'full' && (
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={handleAddBand}
                style={{ background: tc.surface0, border: `1px dashed ${tc.surface1}`, color: tc.surface2, fontSize: '10px', borderRadius: '4px', padding: '3px', cursor: 'pointer', width: '100%', marginTop: '2px' }}
              >+ Add Band</button>
            )}
          </div>

          {/* Inline freq-range viz */}
          <AudioFreqRangeViz node={node} />

          {/* Output sockets */}
          <div style={{ padding: '3px 0 5px', display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
            {Object.entries(node.outputs).map(([key, out]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '4px' }}>
                <span style={{ fontSize: '10px', color: tc.subtext0 }}>{out.label}</span>
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

  // ── Video Input node special card ────────────────────────────────────────────
  if (node.type === 'videoInput') {
    const thumbnailUrl = node.params._thumbnailUrl as string | undefined;
    const hasFile      = !!(node.params._hasFile);
    const isPlaying    = !!(node.params._isPlaying);
    const fileName     = (node.params._fileName as string) || '';
    const videoFileInputRef = React.useRef<HTMLInputElement>(null);

    // Resolves (never rejects) with the outcome; a video that fails to decode
    // or times out leaves the node's params untouched instead of hanging.
    const loadVideoFile = async (file: File): Promise<FileResult> => {
      if (!file.name.match(/\.(mp4|webm|mov|ogg|mkv)$/i)) {
        const error = `"${file.name}" is not a supported video file (mp4, webm, mov, ogg, mkv)`;
        console.error('[VideoInput]', error);
        return { ok: false, error };
      }
      try {
        await videoEngine.loadVideo(node.id, file);
      } catch (e) {
        // videoEngine.loadVideo already logged the failure.
        return { ok: false, error: errorMessage(e) };
      }
      const tex = videoEngine.getTexture(node.id);
      setVideoTexture(node.id, tex);
      videoEngine.play(node.id);
      const thumbUrl = URL.createObjectURL(file);
      updateNodeParams(node.id, {
        _fileName: file.name, _hasFile: true, _isPlaying: true,
        _thumbnailUrl: thumbUrl,
      }, { immediate: true });
      return { ok: true };
    };

    const handleVideoDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer.files[0];
      if (f) loadVideoFile(f);
    };

    const handleVideoFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) loadVideoFile(f);
      e.target.value = '';
    };

    const toggleVideoPlay = () => {
      if (isPlaying) {
        videoEngine.pause(node.id);
        updateNodeParams(node.id, { _isPlaying: false }, { immediate: true });
      } else {
        videoEngine.play(node.id);
        updateNodeParams(node.id, { _isPlaying: true }, { immediate: true });
      }
    };

    return (
      <>
        <div
          data-node-id={node.id}
          style={specialCardStyle()}
        >
          {/* Header */}
          <div
            onMouseDown={(e) => {
              if (e.button === 2) return;
              e.stopPropagation();
              startNodeMouseDrag({
                nodeId: node.id,
                cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
                startClient: { x: e.clientX, y: e.clientY },
                startPosition: node.position,
                getZoom,
                threshold: 0,
                commit: pos => updateNodePosition(node.id, pos),
                onSettle: () => setSelectedNodeId(isSelected ? null : node.id),
              });
            }}
            style={specialHeadStyle}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={toggleVideoPlay}
                title={isPlaying ? 'Pause' : 'Play'}
                disabled={!hasFile}
                style={{ background: 'none', border: 'none', color: !hasFile ? tc.surface1 : isPlaying ? tc.green : tc.mauve, cursor: hasFile ? 'pointer' : 'default', fontSize: '11px', padding: '0', lineHeight: 1 }}
              >{isPlaying ? '⏸' : '▶'}</button>
              <span style={{ fontWeight: 600, fontSize: '11px', color: tc.mauve }}>Video Input</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => setShowVideoInputModal(v => !v)}
                title="Open video settings"
                style={{ background: 'none', border: 'none', color: showVideoInputModal ? tc.mauve : tc.surface2, cursor: 'pointer', fontSize: '12px', padding: '0 2px', lineHeight: 1 }}
              >◉</button>
              <button onMouseDown={e => e.stopPropagation()} onClick={() => removeNode(node.id)} style={{ background: 'none', border: 'none', color: tc.red, cursor: 'pointer', fontSize: '13px' }}>✕</button>
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={videoFileInputRef}
            type="file"
            accept="video/mp4,video/webm,video/ogg,video/quicktime,.mkv"
            style={{ display: 'none' }}
            onChange={handleVideoFileInput}
          />

          {/* Drop zone / thumbnail */}
          <div
            onDrop={handleVideoDrop}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onMouseDown={e => e.stopPropagation()}
            onClick={() => videoFileInputRef.current?.click()}
            style={{
              margin: '6px 8px',
              border: `1px dashed ${tc.surface1}`,
              borderRadius: '4px',
              cursor: 'pointer',
              background: tc.mantle,
              overflow: 'hidden',
              minHeight: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {thumbnailUrl ? (
              <video
                src={thumbnailUrl}
                style={{ width: '100%', maxHeight: '100px', objectFit: 'cover', display: 'block' }}
                muted
                playsInline
              />
            ) : (
              <span style={{ fontSize: '10px', color: tc.surface2, padding: '10px' }}>Click or drop MP4 / WebM / MOV</span>
            )}
          </div>

          {/* File name */}
          {hasFile && (
            <div style={{ padding: '2px 10px 4px', overflow: 'hidden' }} onMouseDown={e => e.stopPropagation()}>
              <span style={{ fontSize: '10px', color: tc.mauve, fontFamily: 'monospace', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ▶ {fileName}
              </span>
            </div>
          )}

          {/* Sockets row: UV input on left, outputs on right */}
          <div style={{ padding: '3px 0 5px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {/* UV input socket */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingLeft: '4px' }}>
              <div
                data-socket="in"
                ref={el => { registerSocket(node.id, 'in', 'uv', el); }}
                onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, 'uv'); }}
                onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapInputSocket?.(node.id, 'uv'); }}
                style={{
                  width: isTouchDevice ? 22 : 12, height: isTouchDevice ? 22 : 12,
                  borderRadius: '50%',
                  background: node.inputs.uv?.connection ? TYPE_COLORS['vec2'] : '#333',
                  border: `2px solid ${TYPE_COLORS['vec2']}`,
                  cursor: 'pointer',
                  marginLeft: isTouchDevice ? '-11px' : '-6px',
                  flexShrink: 0,
                  touchAction: 'manipulation',
                }}
              />
              <span style={{ fontSize: '10px', color: tc.subtext0 }}>UV</span>
            </div>
            {/* Output sockets */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
              {Object.entries(node.outputs).map(([key, out]) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', paddingRight: '4px' }}>
                  <span style={{ fontSize: '10px', color: tc.subtext0 }}>{out.label}</span>
                  <div
                    data-socket="out"
                    ref={el => { registerSocket(node.id, 'out', key, el); }}
                    onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                    onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, key); }}
                    style={{ width: isTouchDevice ? 22 : 12, height: isTouchDevice ? 22 : 12, borderRadius: '50%', background: TYPE_COLORS[out.type] ?? '#888', border: `2px solid ${TYPE_COLORS[out.type] ?? '#888'}`, cursor: 'crosshair', marginRight: isTouchDevice ? '-11px' : '-6px', touchAction: 'manipulation' }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        {showVideoInputModal && (
          <VideoInputModal node={node} onClose={() => setShowVideoInputModal(false)} />
        )}
      </>
    );
  }

  // Touch drag handler for node header — declared early so scope node can use it too
  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    startNodeTouchDrag({
      nodeId: node.id,
      cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
      startClient: { x: touch.clientX, y: touch.clientY },
      startPosition: node.position,
      getZoom,
      threshold: 5,
      commit: pos => updateNodePosition(node.id, pos),
      onSettle: dragged => {
        if (!dragged) {
          setSelectedNodeId(isSelected ? null : node.id);
          selectNode(node.id, false);
        }
      },
    });
  };

  // Click (no movement) toggles selection; Cmd/Ctrl-click toggles multi-select.
  const settleSelection = (e: React.MouseEvent) => (dragged: boolean) => {
    if (dragged) return;
    if (e.metaKey || e.ctrlKey) selectNode(node.id, true);
    else { setSelectedNodeId(isSelected ? null : node.id); selectNode(node.id, false); }
  };

  const handleScopeHeaderMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    startNodeMouseDrag({
      nodeId: node.id,
      cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
      startClient: { x: e.clientX, y: e.clientY },
      startPosition: node.position,
      getZoom,
      commit: pos => updateNodePosition(node.id, pos),
      onSettle: settleSelection(e),
    });
  };

  // ── Scope node special card ──────────────────────────────────────────────────
  if (node.type === 'scope') {
    return (
      <div
        data-node-id={node.id}
        style={specialCardStyle()}
      >
        {/* Header */}
        <div
          onMouseDown={handleScopeHeaderMouseDown}
          onTouchStart={handleHeaderTouchStart}
          style={{
            borderBottom: `1px solid ${tk.border.subtle}`,
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
            style={{ background: 'none', border: 'none', color: tc.red, cursor: 'pointer', fontSize: '13px', lineHeight: 1, padding: '0 2px' }}
          >✕</button>
        </div>

        {/* Waveform canvas */}
        <canvas
          ref={scopeCanvasRef}
          width={220}
          height={80}
          style={{ display: 'block', width: '100%', height: '80px', borderBottom: `1px solid ${tc.surface0}` }}
        />

        {/* Min/Max params */}
        <div style={{ padding: '4px 10px', display: 'flex', gap: '8px', alignItems: 'center' }}
             onMouseDown={e => e.stopPropagation()}>
          {(['min', 'max'] as const).map(key => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', flex: 1 }}>
              <span style={{ color: tc.overlay0, fontSize: '10px', minWidth: '22px' }}>{key}</span>
              <NumberInput
                value={typeof node.params[key] === 'number' ? node.params[key] as number : (key === 'min' ? -1 : 1)}
                step={0.1}
                onCommit={n => updateNodeParams(node.id, { [key]: n })}
                style={{ ...inputStyle_, width: '48px', fontSize: '10px', padding: '1px 4px' }}
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
            <span style={{ fontSize: '10px', color: tc.subtext0 }}>value</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '0 0 0 10px' }}>
            <span style={{ fontSize: '10px', color: tc.subtext0 }}>value</span>
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
  const [hoveredSliderKey, setHoveredSliderKey] = useState<string | null>(null);
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
    vec3: tc.green,
    float: tc.red,
    vec2: tc.blue,
    vec4: tc.peach,
  };

  const handleAnchorDragMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return;
    e.stopPropagation();
    e.preventDefault();
    startNodeMouseDrag({
      nodeId: node.id,
      cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
      startClient: { x: e.clientX, y: e.clientY },
      startPosition: node.position,
      getZoom,
      threshold: 0,
      commit: pos => updateNodePosition(node.id, pos),
    });
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
        style={specialCardStyle({ zIndex })}
        onMouseDown={() => { setZIndex(++zCounter); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: `1px solid ${tk.border.subtle}`,
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
            const color = SOCKET_COLORS[type] ?? tc.subtext0;
            return (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 8px 2px 10px', gap: 6, position: 'relative' }}
                onMouseEnter={() => { setHoveredOutput(key); onSocketHover?.({ nodeId: node.id, key, dir: 'out' }); }}
                onMouseLeave={() => { setHoveredOutput(null); onSocketHover?.(null); }}
              >
                <span style={{ fontSize: '10px', color: tc.surface2 }}>&#128274;</span>
                <span style={{ fontSize: '11px', color: tc.subtext0 }}>{label}</span>
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
            const color = SOCKET_COLORS[type] ?? tc.subtext0;
            return (
              <div
                key={key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '2px 8px 2px 10px', gap: 6, position: 'relative' }}
                onMouseEnter={() => { setHoveredOutput(key); onSocketHover?.({ nodeId: node.id, key, dir: 'out' }); }}
                onMouseLeave={() => { setHoveredOutput(null); onSocketHover?.(null); }}
              >
                <button
                  onClick={() => activeGroupId && removeMarchLoopInput(activeGroupId, key)}
                  style={{
                    background: 'none', border: 'none', color: tc.surface2, cursor: 'pointer',
                    padding: '0 2px', fontSize: '11px', lineHeight: 1,
                  }}
                  title={`Remove ${label}`}
                >&#10005;</button>
                {editingPortKey === `mlgin_${key}` ? (
                  <input
                    autoFocus
                    value={editingPortLabel}
                    onChange={e => setEditingPortLabel(e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    onBlur={() => {
                      if (editingPortLabel.trim() && activeGroupId) renameMarchLoopInput(activeGroupId, key, editingPortLabel.trim());
                      setEditingPortKey(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      if (e.key === 'Escape') setEditingPortKey(null);
                    }}
                    style={{ width: '60px', fontSize: '10px', background: tc.base, border: '1px solid #88aacc', color: tc.text, borderRadius: '2px', padding: '0 3px', outline: 'none' }}
                  />
                ) : (
                  <span
                    style={{ fontSize: '11px', color: tc.text, cursor: 'text' }}
                    title="Double-click to rename"
                    onDoubleClick={() => { setEditingPortKey(`mlgin_${key}`); setEditingPortLabel(label); }}
                  >{label}</span>
                )}
                <span style={{ fontSize: '10px', color: tc.surface2 }}>({type})</span>
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
        <div style={{ borderTop: `1px solid ${tc.surface0}88`, padding: '6px 8px' }}>
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
                style={{ ...inputStyle_, width: '100%', boxSizing: 'border-box' }}
              />
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {(['float', 'vec2', 'vec3', 'vec4'] as DataType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setAddingMarchInput(prev => prev ? { ...prev, type: t } : prev)}
                    style={{
                      background: addingMarchInput.type === t ? '#88aacc' : `${tc.surface0}88`,
                      border: `1px solid ${addingMarchInput.type === t ? '#88aacc' : tc.surface2}`,
                      borderRadius: 3, color: addingMarchInput.type === t ? tc.base : tc.subtext0,
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
                  style={{ flex: 1, background: 'none', border: `1px solid ${tc.surface1}`, borderRadius: 3, color: tc.surface2, fontSize: '10px', padding: '3px 0', cursor: 'pointer' }}
                >Cancel</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAddingMarchInput({ name: '', type: 'float' })}
              style={{
                width: '100%', background: 'none', border: `1px dashed ${tc.surface1}`,
                borderRadius: 3, color: tc.surface2, fontSize: '10px', padding: '3px 0',
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
        style={specialCardStyle({ zIndex })}
        onMouseDown={() => { setZIndex(++zCounter); }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
      >
        {/* Header */}
        <div
          style={{
            borderBottom: `1px solid ${tk.border.subtle}`,
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
            const color = tc.green;
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
                <span style={{ fontSize: '11px', color: tc.subtext0 }}>Position</span>
                <span style={{ fontSize: '10px', color: tc.surface2 }}>&#128274;</span>
              </div>
            );
          })()}
        </div>

        {/* Standard outputs toggle section */}
        {activeGroupId && (
          <div style={{ borderTop: `1px solid ${tc.surface0}88`, padding: '6px 8px' }}>
            <div style={{ fontSize: '10px', color: tc.surface2, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Outputs
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {MARCH_STANDARD_OUTPUTS.map(({ key, type, label }) => {
                const isHidden = mlGroupHiddenOutputs.includes(key);
                const color = SOCKET_COLORS[type] ?? tc.subtext0;
                return (
                  <button
                    key={key}
                    title={isHidden ? `Show ${label} output` : `Hide ${label} output`}
                    onClick={() => toggleMarchLoopOutputPort(activeGroupId, key)}
                    style={{
                      background: isHidden ? 'none' : `${color}22`,
                      border: `1px solid ${isHidden ? tc.surface1 : color}`,
                      borderRadius: 3,
                      color: isHidden ? tc.surface2 : color,
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

  if (node.type === 'group' || node.type === 'sceneGroup' || node.type === 'spaceWarpGroup' || node.type === 'marchLoopGroup' || node.type === 'giLitMarchGroup') {
    const subgraph = node.params.subgraph as import('../../types/nodeGraph').SubgraphData | undefined;
    const defaultLabel = node.type === 'sceneGroup' ? 'Scene Group' : node.type === 'spaceWarpGroup' ? 'Space Warp Group' : node.type === 'marchLoopGroup' ? 'March Loop Group' : node.type === 'giLitMarchGroup' ? 'GI Lit March Group' : 'Group';
    const groupLabel = typeof node.params.label === 'string' ? node.params.label : defaultLabel;
    const nodeCount = subgraph?.nodes.length ?? 0;
    const inputPorts = subgraph?.inputPorts ?? [];
    const outputPorts = subgraph?.outputPorts ?? [];
    const groupIters = typeof node.params.iterations === 'number' ? node.params.iterations : 1;
    const hasInnerGroups = subgraph?.nodes.some(n => n.type === 'group') ?? false;
    const isSceneGroup = node.type === 'sceneGroup';
    const isSpaceWarpGroup = node.type === 'spaceWarpGroup';
    const isMarchLoopGroup = node.type === 'marchLoopGroup' || node.type === 'giLitMarchGroup';
    // Color per type
    const groupAccentColor = isSceneGroup ? '#cc88aa' : isSpaceWarpGroup ? '#aa88cc' : isMarchLoopGroup ? '#88aacc' : (hasInnerGroups ? tc.mauve : tc.blue);

    const handleGroupHeaderMouseDown = (e: React.MouseEvent) => {
      if (e.button === 2) return;
      e.stopPropagation();
      e.preventDefault();
      startNodeMouseDrag({
        nodeId: node.id,
        cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
        startClient: { x: e.clientX, y: e.clientY },
        startPosition: node.position,
        getZoom,
        commit: pos => updateNodePosition(node.id, pos),
        onSettle: settleSelection(e),
      });
    };

    const groupIcon = isSceneGroup ? 'presets' : isSpaceWarpGroup ? 'loop' : isMarchLoopGroup ? 'wave' : 'nodes';

    /**
     * Section header on a group card: click opens that inner node in the group, double-click renames
     * the section. The click waits out the double-click window so a rename doesn't also navigate.
     */
    const sectionClick = (innerId: string, startRename: () => void) => ({
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        if (editingSectionId === innerId || e.detail > 1) return;
        if (revealTimer.current) clearTimeout(revealTimer.current);
        revealTimer.current = setTimeout(() => { revealTimer.current = null; revealNode([node.id], innerId); }, 220);
      },
      onDoubleClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        if (revealTimer.current) { clearTimeout(revealTimer.current); revealTimer.current = null; }
        startRename();
      },
    });

    /** One exposed inner param: typed socket on the card edge, label, and a ruler (or the wire). */
    const groupParamRow = (o: {
      rowKey: string; psKey: string; label: string; value: number; min: number; max: number; step: number;
      overrideKey: string; defaultValue?: number;
      /** Clicking the label opens the node this param belongs to */
      reveal?: { path: string[]; nodeId: string };
    }) => {
      const wired = !!node.inputs[o.psKey]?.connection;
      const wire = node.inputs[o.psKey]?.connection;
      return (
        <div key={o.rowKey} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 10px 4px 14px' }}
          onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
          <ParamSocket color={TYPE_COLORS.float} wired={wired} touch={isTouchDevice}
            register={el => { registerSocket(node.id, 'in', o.psKey, el); }}
            onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, o.psKey); }} />
          {o.reveal ? (
            <ParamLabel muted={wired} title="Open this node in the group" onClick={() => revealNode(o.reveal!.path, o.reveal!.nodeId)}>{o.label}</ParamLabel>
          ) : (
            <ParamLabel muted={wired}>{o.label}</ParamLabel>
          )}
          {wired && wire ? (
            <>
              <WiredChip source={wire} expr={getSourceExpr(shaderLines, nodeOutputVarMap, wire.nodeId, wire.outputKey)} />
              <CardButton icon="unlink" label="Disconnect" onClick={() => disconnectInput(node.id, o.psKey)} />
            </>
          ) : (
            <RulerSlider
              value={o.value}
              min={o.min}
              max={o.max}
              step={adaptiveStep(o.value, o.step)}
              defaultValue={o.defaultValue ?? (o.min + o.max) / 2}
              onChange={v => updateNodeParams(node.id, { [o.overrideKey]: v }, { immediate: true })}
              onType={n => updateNodeParams(node.id, { [o.overrideKey]: n }, { immediate: true })}
              ariaLabel={o.label}
              touch={isTouchDevice}
            />
          )}
        </div>
      );
    };
    const sectionHeadStyle: React.CSSProperties = {
      display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px 3px', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.08em', color: tk.text.faint, userSelect: 'none', textTransform: 'uppercase',
    };
    const sectionInputStyle: React.CSSProperties = {
      flex: 1, background: 'transparent', border: 0, borderBottom: `1px solid ${tk.accent.base}`, outline: 'none', padding: 0,
      color: tk.text.primary, font: `700 10px ${fontFamily.ui}`, letterSpacing: '0.08em', textTransform: 'uppercase',
    };

    return (
      <div
        data-node-id={node.id}
        style={{
          position: 'absolute',
          left: node.position.x,
          top: node.position.y,
          width: 360,
          boxSizing: 'border-box',
          background: tk.bg.panel,
          border: `2px ${isSelected || isMultiSelected ? 'solid' : 'dashed'} ${groupAccentColor}`,
          borderRadius: radius.card,
          color: tk.text.primary,
          fontSize: 12.5,
          fontFamily: fontFamily.ui,
          userSelect: 'none',
          opacity: dimmed ? 0.2 : 1,
          boxShadow: isMultiSelected ? `0 0 16px ${alpha(groupAccentColor, 0.3)}, ${tk.shadow.card}` : tk.shadow.card,
        }}
      >
        {/* Group header — drag handle; double-click enters the group */}
        <div
          onMouseDown={handleGroupHeaderMouseDown}
          onDoubleClick={() => { if (!savingMode) onEnterGroup?.(node.id); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 3, padding: '7px 7px 7px 11px', cursor: 'grab',
            borderBottom: `1px solid ${tk.border.subtle}`,
            background: tk.bg.head, borderRadius: collapsed ? radius.card - 2 : `${radius.card - 2}px ${radius.card - 2}px 0 0`,
          }}
        >
          <button
            type="button"
            aria-label={collapsed ? 'Expand group' : 'Collapse group (keeps its ports and wired params)'}
            aria-expanded={!collapsed}
            onMouseDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            onClick={() => setCollapsed(v => !v)}
            style={{
              width: 18, height: 26, marginLeft: -6, padding: 0, border: 0, background: 'none', cursor: 'pointer', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint,
            }}
          ><Icon name={collapsed ? 'chevR' : 'chevD'} size={14} /></button>
          <span style={{ display: 'flex', color: groupAccentColor, flexShrink: 0 }}><Icon name={groupIcon} size={16} /></span>
          {isEditingTitle ? (
            <input
              autoFocus
              aria-label="Group name"
              value={editingTitleValue}
              onChange={e => setEditingTitleValue(e.target.value)}
              onMouseDown={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              onBlur={() => {
                const trimmed = editingTitleValue.trim();
                updateNodeParams(node.id, { label: trimmed || groupLabel });
                setIsEditingTitle(false);
              }}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setIsEditingTitle(false);
              }}
              style={{
                flex: 1, minWidth: 0, height: 26, marginLeft: 5, padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.sm,
                background: tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${groupAccentColor}`, color: tk.text.primary,
                font: `600 13.5px ${fontFamily.ui}`,
              }}
            />
          ) : (
            <span
              onDoubleClick={e => {
                e.stopPropagation();
                setEditingTitleValue(groupLabel);
                setIsEditingTitle(true);
              }}
              title="Double-click to rename"
              style={{
                marginLeft: 5, fontWeight: 600, fontSize: 13.5, color: groupAccentColor, cursor: 'text',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0,
              }}
            >{groupLabel}</span>
          )}
          <span style={{ flex: 1, minWidth: 0, marginLeft: 4, fontSize: 12, color: tk.text.faint, whiteSpace: 'nowrap' }}>
            {nodeCount} {nodeCount === 1 ? 'node' : 'nodes'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }} onDoubleClick={e => e.stopPropagation()}>
            {canRandomize(node, def) && (
              <CardButton icon="dice" on={randomizeExcluded(node).length > 0}
                label="Randomize the values on this card (right-click to choose which)"
                onClick={() => randomizeNodeParams(node.id)}
                onContextMenu={e => setRandomizeMenu({ x: e.clientX, y: e.clientY })} />
            )}
            {randomizeMenu && (
              <RandomizeMenu
                x={randomizeMenu.x}
                y={randomizeMenu.y}
                params={randomizableParams(node, def)}
                excluded={randomizeExcluded(node)}
                onChange={next => updateNodeParams(node.id, { __randExclude: next.length ? next : undefined })}
                amount={randomizeAmount(node)}
                onAmountChange={a => updateNodeParams(node.id, { __randAmount: a >= 1 ? undefined : a })}
                onRandomize={() => randomizeNodeParams(node.id)}
                onClose={() => setRandomizeMenu(null)}
              />
            )}
            <CardButton icon="copy" label="Duplicate group (an independent copy)" onClick={() => duplicateGroup(node.id)} />
            <CardButton icon="save" tint="success" on={savedFlash} label="Save as a preset" onClick={() => {
              setSaveLabel(typeof node.params.label === 'string' ? node.params.label : 'Group');
              setSaveDescription('');
              setSavingMode(true);
            }} />
            {node.type === 'group' && (
              <CardButton icon="spark" tint="fn" label="Publish as a node type (flattens the group into one GLSL function)" onClick={() => setShowPublish(true)} />
            )}
            {node.type === 'group' && (
              <CardButton icon="unlink"
                label={groupIters > 1 ? 'Ungroup (iterations flatten to a single pass)' : 'Ungroup (put the nodes back in the graph)'}
                onClick={() => ungroupNode(node.id)} />
            )}
            <CardButton icon="close" tone="danger" label="Delete the group and its nodes" onClick={() => removeNode(node.id)} />
          </div>
        </div>

        {/* Save-as-preset form — below the header while saving */}
        {savingMode && (() => {
          const commitSave = () => {
            if (saveLabel.trim()) {
              saveGroupPreset(node.id, saveLabel.trim(), saveDescription.trim());
              setSavedFlash(true);
              setTimeout(() => setSavedFlash(false), 700);
            }
            setSavingMode(false);
          };
          const fieldStyle: React.CSSProperties = {
            height: 30, minWidth: 0, padding: '0 10px', border: 0, outline: 'none', borderRadius: radius.md,
            background: tk.bg.field, color: tk.text.primary, font: `500 12.5px ${fontFamily.ui}`,
          };
          return (
            <div
              onMouseDown={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
              style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', background: tk.bg.subtle, borderBottom: `1px solid ${tk.border.subtle}` }}
            >
              <input autoFocus aria-label="Preset name" value={saveLabel} onChange={e => setSaveLabel(e.target.value)} placeholder="Name"
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') setSavingMode(false); }}
                style={fieldStyle} />
              <input aria-label="Preset description" value={saveDescription} onChange={e => setSaveDescription(e.target.value)} placeholder="Description (optional)"
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') commitSave(); if (e.key === 'Escape') setSavingMode(false); }}
                style={fieldStyle} />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                <Button size="sm" variant="ghost" onClick={() => setSavingMode(false)}>Cancel</Button>
                <Button size="sm" variant="primary" disabled={!saveLabel.trim()} onClick={commitSave}>Save preset</Button>
              </div>
            </div>
          );
        })()}

        {/* Iterations — regular groups only */}
        {node.type === 'group' && !collapsed && (
          <div
            onMouseDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px 6px 14px', background: tk.bg.subtle, borderBottom: `1px solid ${tk.border.subtle}` }}
          >
            <span style={{ width: 70, flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>ITERATIONS</span>
            <RulerSlider
              integer
              value={groupIters}
              min={1}
              max={16}
              defaultValue={1}
              onChange={v => updateNodeParams(node.id, { iterations: Math.max(1, Math.min(16, Math.round(v))) }, { immediate: true })}
              ariaLabel="Iterations"
              touch={isTouchDevice}
            />
          </div>
        )}

        {/* Port list */}
        <div style={{ padding: '6px 14px', display: 'flex', gap: 12, justifyContent: 'space-between' }}>
          {/* Inputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {/* MarchLoopGroup: render definition-based inputs */}
            {isMarchLoopGroup && (() => {
              const MLG_FIXED_INPUTS = new Set(['ro', 'rd', 'scene', 'uv', 'time']);
              return Object.entries(node.inputs).map(([key, input]) => {
                const isExtraInput = !MLG_FIXED_INPUTS.has(key) && !key.startsWith('ps_');
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', height: isTouchDevice ? 40 : 30 }}>
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
                        width: 12, height: 12, borderRadius: '50%',
                        background: node.inputs[key]?.connection
                          ? (TYPE_COLORS[input.type] ?? '#888')
                          : tk.bg.panel,
                        boxShadow: node.inputs[key]?.connection ? `0 0 0 2px ${tk.bg.panel}` : undefined,
                        border: `2px solid ${TYPE_COLORS[input.type] ?? '#888'}`,
                        cursor: 'crosshair',
                        position: 'relative', left: -22,
                        boxSizing: 'border-box',
                      }}
                    />
                    {isExtraInput && editingPortKey === `mlgext_${key}` ? (
                      <input
                        autoFocus
                        value={editingPortLabel}
                        onChange={e => setEditingPortLabel(e.target.value)}
                        onMouseDown={e => e.stopPropagation()}
                        onBlur={() => {
                          if (editingPortLabel.trim()) renameMarchLoopInput(node.id, key, editingPortLabel.trim());
                          setEditingPortKey(null);
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setEditingPortKey(null);
                        }}
                        style={{ width: 96, height: 24, fontSize: 12.5, background: tk.bg.panel, border: 0, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, borderRadius: 6, padding: '0 6px', outline: 'none', marginLeft: -16 }}
                      />
                    ) : (
                      <span
                        style={{ fontSize: 12.5, color: tk.text.secondary, marginLeft: -16, cursor: isExtraInput ? 'text' : 'default' }}
                        title={isExtraInput ? 'Double-click to rename' : undefined}
                        onDoubleClick={isExtraInput ? e => { e.stopPropagation(); setEditingPortKey(`mlgext_${key}`); setEditingPortLabel(input.label); } : undefined}
                      >{input.label}</span>
                    )}
                  </div>
                );
              });
            })()}
            {inputPorts.map((port) => (
              <div key={port.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', height: isTouchDevice ? 40 : 30 }}>
                {/* Socket dot */}
                <div
                  ref={el => { registerSocket(node.id, 'in', port.key, el); }}
                  onMouseEnter={() => onSocketHover?.({ nodeId: node.id, key: port.key, dir: 'in' })}
                  onMouseLeave={() => onSocketHover?.(null)}
                  onMouseUp={e => {
                    e.stopPropagation();
                    if (node.inputs[port.key]?.connection && !isConnectionDragging) {
                      disconnectInput(node.id, port.key);
                    } else {
                      onEndConnection(node.id, port.key);
                    }
                  }}
                  style={{
                    width: 12, height: 12, borderRadius: '50%',
                    background: node.inputs[port.key]?.connection
                      ? (TYPE_COLORS[port.type] ?? '#888')
                      : tk.bg.panel,
                    boxShadow: node.inputs[port.key]?.connection ? `0 0 0 2px ${tk.bg.panel}` : undefined,
                    border: `2px solid ${TYPE_COLORS[port.type] ?? '#888'}`,
                    cursor: 'crosshair',
                    position: 'relative', left: -22,
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
                    style={{ width: 96, height: 24, fontSize: 12.5, background: tk.bg.panel, border: 0, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, borderRadius: 6, padding: '0 6px', outline: 'none' }}
                  />
                ) : (
                  <span
                    style={{ fontSize: 12.5, color: tk.text.secondary, marginLeft: -16, cursor: 'text' }}
                    title="Double-click to rename"
                    onDoubleClick={e => { e.stopPropagation(); setEditingPortKey(port.key); setEditingPortLabel(port.label); }}
                  >{port.label}</span>
                )}
              </div>
            ))}
          </div>

          {/* Outputs */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, alignItems: 'flex-end', minWidth: 0 }}>
            {/* MarchLoopGroup: always show the full definition output set + any dynamic
                accumulator outputs (acc0, acc1…) from the stored node, skipping hidden ones */}
            {isMarchLoopGroup && (() => {
              const defOuts = def?.outputs ?? {};
              // Dynamic acc* outputs not in the definition (added at compile time)
              const dynOuts = Object.fromEntries(
                Object.entries(node.outputs).filter(([k]) => k.startsWith('acc'))
              );
              const mergedOuts = { ...defOuts, ...dynOuts };
              const hidden = (node.params.hiddenOutputs as string[] | undefined) ?? [];
              return Object.entries(mergedOuts).filter(([key]) => !hidden.includes(key));
            })().map(([key, output]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: isTouchDevice ? 40 : 30 }}>
                <span style={{ fontSize: 12.5, color: tk.text.secondary }}>{output.label}</span>
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', key, el); }}
                  onMouseDown={e => { e.stopPropagation(); onStartConnection(node.id, key, e); }}
                  onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, key); }}
                  style={{
                    width: isTouchDevice ? 20 : 12,
                    height: isTouchDevice ? 20 : 12,
                    borderRadius: '50%',
                    background: TYPE_COLORS[output.type] ?? '#888',
                    cursor: 'crosshair',
                    position: 'relative',
                    right: isTouchDevice ? -26 : -22,
                    touchAction: 'manipulation',
                    boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === key
                      ? `0 0 0 3px ${TYPE_COLORS[output.type] ?? '#888'}, 0 0 10px ${TYPE_COLORS[output.type] ?? '#888'}`
                      : `0 0 0 2px ${tk.bg.panel}`,
                  }}
                />
              </div>
            ))}
            {/* SceneGroup: always show the scene output socket */}
            {isSceneGroup && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', height: isTouchDevice ? 40 : 30 }}>
                <span style={{ fontSize: 12.5, color: tk.text.secondary }}>Scene</span>
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', 'scene', el); }}
                  onMouseDown={e => onStartConnection(node.id, 'scene', e)}
                  onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, 'scene'); }}
                  style={{
                    width: isTouchDevice ? 20 : 12,
                    height: isTouchDevice ? 20 : 12,
                    borderRadius: '50%',
                    background: TYPE_COLORS['scene3d'] ?? '#cc88aa',
                    cursor: 'crosshair',
                    position: 'relative',
                    right: isTouchDevice ? -26 : -22,
                    touchAction: 'manipulation',
                    boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === 'scene'
                      ? `0 0 0 3px ${TYPE_COLORS['scene3d'] ?? '#cc88aa'}, 0 0 10px ${TYPE_COLORS['scene3d'] ?? '#cc88aa'}`
                      : undefined,
                  }}
                />
              </div>
            )}
            {outputPorts.map(port => (
              <div key={port.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', height: isTouchDevice ? 40 : 30 }}>
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
                    style={{ width: 96, height: 24, fontSize: 12.5, background: tk.bg.panel, border: 0, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`, color: tk.text.primary, borderRadius: 6, padding: '0 6px', outline: 'none' }}
                  />
                ) : (
                  <span
                    style={{ fontSize: 12.5, color: tk.text.secondary, cursor: 'text' }}
                    title="Double-click to rename"
                    onDoubleClick={e => { e.stopPropagation(); setEditingPortKey('out_' + port.key); setEditingPortLabel(port.label); }}
                  >{port.label}</span>
                )}
                <div
                  data-socket="out"
                  ref={el => { registerSocket(node.id, 'out', port.key, el); }}
                  onMouseEnter={() => onSocketHover?.({ nodeId: node.id, key: port.key, dir: 'out' })}
                  onMouseLeave={() => onSocketHover?.(null)}
                  onMouseDown={e => onStartConnection(node.id, port.key, e)}
                  onTouchEnd={e => { e.stopPropagation(); e.preventDefault(); onTapOutputSocket?.(node.id, port.key); }}
                  style={{
                    width: isTouchDevice ? 20 : 12, height: isTouchDevice ? 20 : 12, borderRadius: '50%',
                    background: TYPE_COLORS[port.type] ?? '#888',
                    cursor: 'crosshair',
                    position: 'relative', right: isTouchDevice ? -26 : -22,
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
            // Collapsed: only wired rows stay (their wires need somewhere to land)
            const shownSurfaced = collapsed
              ? surfacedParams.filter(sp => node.inputs[`ps_${innerNode.id}_${sp.nodeId}_${sp.paramKey}`]?.connection)
              : surfacedParams;
            if (shownSurfaced.length === 0) return null;

            const innerGroupLabel = typeof innerNode.params.label === 'string' ? innerNode.params.label : 'Inner Group';
            const sectionLabelKey = `__sectionLabel_${innerNode.id}`;
            const sectionLabel = typeof node.params[sectionLabelKey] === 'string'
              ? node.params[sectionLabelKey] as string
              : innerGroupLabel;

            return (
              <div key={innerNode.id} style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingBottom: 4 }}>
                <div
                  title="Click to open it in the group · double-click to rename"
                  style={{ ...sectionHeadStyle, cursor: 'pointer' }}
                  {...sectionClick(innerNode.id, () => { setEditingSectionId(innerNode.id); setEditingSectionLabel(sectionLabel); })}
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
                      style={sectionInputStyle}
                    />
                  ) : (
                    <span style={{ flex: 1 }}>{sectionLabel}</span>
                  )}
                  <Icon name="nodes" size={12} />
                </div>
                {shownSurfaced.map(sp => {
                  const innNode = innerGroupSub?.nodes.find(n => n.id === sp.nodeId);
                  if (!innNode) return null;
                  const innDef = getNodeDefinition(innNode.type);
                  const paramDef = innDef?.paramDefs?.[sp.paramKey];
                  if (!paramDef) return null;
                  const psKey = `ps_${innerNode.id}_${sp.nodeId}_${sp.paramKey}`;
                  const overrideKey = `${innerNode.id}::${sp.nodeId}::${sp.paramKey}`;
                  const rawVal = node.params[overrideKey] ?? innNode.params[sp.paramKey];
                  const currentVal = typeof rawVal === 'number' ? rawVal : (typeof paramDef.min === 'number' ? paramDef.min : 0);
                  return groupParamRow({
                    rowKey: `${sp.nodeId}::${sp.paramKey}`, psKey, label: sp.label ?? paramDef.label, value: currentVal,
                    min: paramDef.min ?? 0, max: paramDef.max ?? 1, step: paramDef.step ?? 0.01, overrideKey,
                    defaultValue: typeof innDef?.defaultParams?.[sp.paramKey] === 'number' ? innDef.defaultParams[sp.paramKey] as number : undefined,
                    reveal: { path: [node.id, innerNode.id], nodeId: sp.nodeId },
                  });
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
          const visibleParams = paramEntries.filter(([paramKey, pd]) => {
            // Same showWhen gate as the node's own card (a vec3 Constant has no Value slider)
            if (!isParamVisible(pd, innerNode.params, getNodeDefinition(innerNode.type)?.defaultParams)) return false;
            if (innerNode.inputs[`__param_${paramKey}`]?.connection) return false;
            const matchingInput = Object.entries(innerNode.inputs).find(
              ([k, inp]) => k.toLowerCase() === paramKey.toLowerCase() && inp.connection
            );
            if (matchingInput) return false;
            if (hiddenParams.includes(`${innerNode.id}::${paramKey}`)) return false;
            return true;
          });
          const shownParams = collapsed
            ? visibleParams.filter(([k]) => node.inputs[`ps_${innerNode.id}_${k}`]?.connection)
            : visibleParams;
          if (shownParams.length === 0) return null;

          const innerLabel = typeof innerNode.params.label === 'string'
            ? innerNode.params.label
            : (innerDef?.label ?? innerNode.type);
          const sectionLabelOverrideKey = `__sectionLabel_${innerNode.id}`;
          const displayLabel = typeof node.params[sectionLabelOverrideKey] === 'string'
            ? node.params[sectionLabelOverrideKey] as string
            : innerLabel;

          return (
            <div key={innerNode.id} style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingBottom: 4 }}>
              <div
                title="Click to open this node in the group · double-click to rename"
                style={{ ...sectionHeadStyle, cursor: 'pointer' }}
                {...sectionClick(innerNode.id, () => { setEditingSectionId(innerNode.id); setEditingSectionLabel(displayLabel); })}
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
                    style={sectionInputStyle}
                  />
                ) : (
                  displayLabel
                )}
              </div>
              {shownParams.map(([paramKey, paramDef]) => {
                if (paramDef.type !== 'float') return null;
                const psKey = `ps_${innerNode.id}_${paramKey}`;
                const overrideKey = `${innerNode.id}::${paramKey}`;
                const rawVal = node.params[overrideKey] ?? innerNode.params[paramKey];
                const currentVal = typeof rawVal === 'number' ? rawVal : (typeof paramDef.min === 'number' ? paramDef.min : 0);
                const innerBidir = innerNode.params[`__scBidir_${paramKey}`] === true;
                const innerCustomMax = typeof innerNode.params[`__scMax_${paramKey}`] === 'number' ? innerNode.params[`__scMax_${paramKey}`] as number : null;
                const effMax = innerCustomMax ?? (paramDef.max ?? 1);
                const effMin = innerBidir ? -effMax : (innerCustomMax != null ? 0 : (paramDef.min ?? 0));
                const innerDefault = innerDef?.defaultParams?.[paramKey];
                return groupParamRow({
                  rowKey: paramKey, psKey, label: paramDef.label, value: currentVal, min: effMin, max: effMax,
                  step: paramDef.step ?? 0.01, overrideKey, defaultValue: typeof innerDefault === 'number' ? innerDefault : undefined,
                });
              })}
            </div>
          );
        })}

        {/* MarchLoopGroup outer params — maxSteps, maxDist, stepScale, bg, albedo */}
        {isMarchLoopGroup && !collapsed && (() => {
          const outerDef = getNodeDefinition(node.type);
          const outerParamDefs = outerDef?.paramDefs ?? {};
          const outerEntries = Object.entries(outerParamDefs).filter(([, pd]) => pd.type === 'float' || pd.type === 'bool');
          if (outerEntries.length === 0) return null;
          const hidden = node.params.__marchSettingsHidden === true;
          return (
            <div style={{ borderTop: `1px solid ${tk.border.subtle}`, paddingBottom: 4 }} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
              <button
                type="button"
                aria-expanded={!hidden}
                style={{ ...sectionHeadStyle, width: '100%', border: 0, background: 'none', cursor: 'pointer', textAlign: 'left' }}
                onClick={() => updateNodeParams(node.id, { __marchSettingsHidden: !hidden }, { immediate: true })}
              >
                <span style={{ flex: 1 }}>March settings</span>
                <Icon name={hidden ? 'chevR' : 'chevD'} size={12} />
              </button>
              {!hidden && outerEntries.map(([paramKey, paramDef]) => {
                if (paramDef.type === 'bool') {
                  return (
                    <div key={paramKey} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 10px 4px 14px' }}>
                      <ParamLabel>{paramDef.label}</ParamLabel>
                      <Toggle checked={node.params[paramKey] === true} onChange={v => updateNodeParams(node.id, { [paramKey]: v }, { immediate: true })} />
                    </div>
                  );
                }
                const rawVal = node.params[paramKey];
                const defaultVal = (def.defaultParams as Record<string, unknown> | undefined)?.[paramKey];
                const currentVal = typeof rawVal === 'number' ? rawVal
                  : typeof defaultVal === 'number' ? defaultVal
                    : (typeof paramDef.min === 'number' ? paramDef.min : 0);
                const step = paramDef.step ?? 1;
                return (
                  <div key={paramKey} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 10px 4px 14px' }}>
                    <ParamLabel title={paramDef.label}>{paramDef.label}</ParamLabel>
                    <RulerSlider
                      value={currentVal}
                      min={paramDef.min ?? 0}
                      max={paramDef.max ?? 256}
                      step={adaptiveStep(currentVal, step)}
                      integer={step >= 1 && Number.isInteger(currentVal) && (paramDef.max ?? 256) <= 512}
                      defaultValue={typeof defaultVal === 'number' ? defaultVal : undefined}
                      onChange={v => updateNodeParams(node.id, { [paramKey]: v }, { immediate: true })}
                      ariaLabel={paramDef.label}
                      touch={isTouchDevice}
                    />
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* "Customize params" button — shown for any group with float params */}
        {subgraph && !collapsed && (() => {
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
          const accentColor = hasInnerGroupNodes ? tc.mauve : tc.blue;
          return (
            <div
              style={{ borderTop: `1px solid ${tk.border.subtle}`, padding: '5px 8px', display: 'flex', alignItems: 'center', position: 'relative' }}
              onMouseDown={e => e.stopPropagation()}
              onDoubleClick={e => e.stopPropagation()}
            >
              <Button
                size="sm"
                variant="ghost"
                icon="plus"
                style={{ height: 28, color: showParamPicker ? accentColor : undefined }}
                title={hasInnerGroupNodes ? 'Choose which inner-group params show on this card' : 'Choose which params show on this card'}
                onClick={e => { e.stopPropagation(); setShowParamPicker(v => !v); }}
              >
                Params on card
              </Button>
              {showParamPicker && (
                <GroupParamPicker
                  outerNode={node}
                  onClose={() => setShowParamPicker(false)}
                />
              )}
              {showPublish && (
                <PublishNodeModal source={{ kind: 'group', node }} onClose={() => setShowPublish(false)} />
              )}
            </div>
          );
        })()}
        {/* Subgraph mini-map — always visible for all group types */}
        <NodeInlineViz node={node} />
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

    // The card moves imperatively during the drag and the store is written
    // once on release (one undo step); a release without movement is a click
    // and updates the selection instead.
    startNodeMouseDrag({
      nodeId: node.id,
      cardEl: (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-node-id]'),
      startClient: { x: e.clientX, y: e.clientY },
      startPosition: node.position,
      getZoom,
      commit: pos => updateNodePosition(node.id, pos),
      onSettle: settleSelection(e),
    });
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
  // Hairline between the sockets, params and outputs sections
  const sectionRule = <div aria-hidden style={{ height: 1, background: tk.border.subtle, margin: '6px 0' }} />;

  // Generate code snippet for this node (pass empty inputVars for template display)
  // Prefer this node's lines from the compiled shader (real variable names); fall back to the template
  const generatedCode = showCode ? (extractNodeCodeFromShader(shaderLines, node) || def.generateGLSL(node, {}).code) : '';
  const hasOverride = typeof node.params?.__codeOverride === 'string' && (node.params.__codeOverride as string).trim().length > 0;
  const codeSnippet = hasOverride ? (node.params.__codeOverride as string) : generatedCode;
  // The helper functions this node's line calls (circleSDF, palette, …), so the panel can show
  // what the node actually computes above how this instance calls it.
  const helperFunctions = useMemo(() => {
    if (!showCode) return [] as string[];
    const all = [...(def.glslFunction ? [def.glslFunction] : []), ...(def.glslFunctions ?? []), ...(def.glslFunctionsFor?.(node) ?? [])];
    if (all.length === 0) return [] as string[];
    const called = new Set([...codeSnippet.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].map(m => m[1]));
    const nameOf = (fn: string) => /^\s*(?:[a-z0-9]+\s+)?([A-Za-z_]\w*)\s*\(/m.exec(fn)?.[1];
    const used = all.filter(fn => { const n = nameOf(fn); return n && called.has(n); });
    return (used.length ? used : all).map(fn => fn.trim());
  }, [showCode, def, node, codeSnippet]);

  // ─── Build tooltip for an input socket ─────────────────────────────────────
  const buildInputTooltip = (inputKey: string): React.ReactNode[] => {
    const input = node.inputs[inputKey];
    if (!input) return [];
    const typeColor = TYPE_COLORS[input.type] || '#888';
    const lines: React.ReactNode[] = [];
    lines.push(
      <span style={{ fontWeight: 700 }}>
        <span style={{ color: typeColor }}>▶</span> {input.label} <span style={{ color: tc.surface2 }}>({input.type})</span>
      </span>
    );
    const inputError = errors?.find(e => e.socket === inputKey);
    if (inputError) lines.push(<span style={{ color: tk.status.danger, fontWeight: 600, whiteSpace: 'normal' }}>{inputError.message}</span>);
    if (input.connection) {
      // Show what's connected
      const srcNode = nodes.find(n => n.id === input.connection!.nodeId);
      const srcDef = srcNode ? getNodeDefinition(srcNode.type) : undefined;
      const srcOutLabel = srcDef?.outputs[input.connection.outputKey]?.label ?? input.connection.outputKey;
      const srcType = srcDef?.outputs[input.connection.outputKey]?.type;
      lines.push(
        <span style={{ color: tc.surface2, marginTop: '2px', display: 'block' }}>Connected to:</span>
      );
      lines.push(
        <span style={{ color: srcType ? (TYPE_COLORS[srcType] || tc.text) : tc.text, paddingLeft: '6px' }}>
          {srcDef?.label ?? srcNode?.type} → {srcOutLabel} <span style={{ color: tc.surface2 }}>({srcType})</span>
        </span>
      );
    } else {
      // Show compatible sources
      const sources = getCompatibleSources(nodes, node.id, input.type as DataType);
      if (sources.length > 0) {
        lines.push(<span style={{ color: tc.surface2, marginTop: '2px', display: 'block' }}>Sources in graph:</span>);
        for (const s of sources.slice(0, 6)) {
          lines.push(
            <span style={{ paddingLeft: '6px', color: tc.subtext0 }}>• {s.nodeLabel} → {s.outputLabel}</span>
          );
        }
        if (sources.length > 6) {
          lines.push(<span style={{ paddingLeft: '6px', color: tc.surface2 }}>...+{sources.length - 6} more</span>);
        }
      } else {
        lines.push(<span style={{ color: tc.surface2, marginTop: '2px', display: 'block' }}>No compatible sources in graph</span>);
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
        <span style={{ color: typeColor }}>◀</span> {output.label} <span style={{ color: tc.surface2 }}>({output.type})</span>
      </span>
    );
    // List what types this can connect to
    const compatMsg = output.type === 'float'
      ? 'Connects to float or vec3 inputs'
      : `Connects to ${output.type} inputs`;
    lines.push(<span style={{ color: tc.surface2, marginTop: '2px', display: 'block' }}>{compatMsg}</span>);
    return lines;
  };

  return (
    <div
      data-node-id={node.id}
      onMouseEnter={handleCardMouseEnter}
      onMouseLeave={handleCardMouseLeave}
      onMouseDown={() => setZIndex(++zCounter)}
      style={{
        position: 'absolute',
        left: node.position.x,
        top: node.position.y,
        zIndex,
        width: 360,
        boxSizing: 'border-box',
        background: tk.bg.panel,
        borderRadius: radius.card,
        color: tk.text.primary,
        fontSize: 12.5,
        fontFamily: fontFamily.ui,
        userSelect: 'none',
        opacity: dimmed ? 0.2 : isBypassed ? 0.55 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.15s',
        // One ring per state, strongest first; the resting card only has its shadow.
        boxShadow: [
          isSwapTarget ? `0 0 0 2px ${tk.status.warning}, 0 0 18px ${alpha(tk.status.warning, 0.35)}`
            : hasError ? `0 0 0 1.5px ${tk.status.danger}, 0 0 18px ${alpha(tk.status.danger, 0.22)}`
            : isPreviewActive ? `0 0 0 1.5px ${tk.status.success}, 0 0 22px ${alpha(tk.status.success, 0.22)}`
            : isBypassed ? `0 0 0 1.5px ${alpha(tk.status.warning, 0.65)}`
            : isMultiSelected ? `0 0 0 2px ${tk.accent.base}, 0 0 16px ${alpha(tk.accent.base, 0.25)}`
            : isSelected ? `0 0 0 1.5px ${tk.accent.base}`
            : null,
          tk.shadow.card,
        ].filter(Boolean).join(', '),
      }}
    >
      {/* Comment preview — appears above the card on hover; click to open the full editor */}
      {showCommentPreview && nodeComment && !showCommentEditor && (
        <div
          onMouseDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); setShowCommentEditor(true); setShowCommentPreview(false); }}
          style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, maxWidth: 320, zIndex: 50,
            background: tk.bg.panel, borderRadius: radius.md + 2, boxShadow: tk.shadow.float, padding: '7px 10px',
            fontSize: 12, lineHeight: 1.45, color: tk.text.muted, whiteSpace: 'pre-wrap', cursor: 'pointer',
          }}
        >
          {nodeComment}
        </div>
      )}
      {/* Header — drag handle; double-click toggles collapse (enters a scene group) */}
      <div
        onMouseDown={handleHeaderMouseDown}
        onTouchStart={handleHeaderTouchStart}
        onDoubleClick={e => {
          e.stopPropagation();
          if (node.type === 'sceneGroup' && !savingMode) onEnterGroup?.(node.id);
          else setCollapsed(v => !v);
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 3, padding: isTouchDevice ? '10px 8px' : 8, position: 'relative',
          minHeight: isTouchDevice ? 44 : undefined, cursor: 'grab', borderBottom: `1px solid ${tk.border.subtle}`,
          background: tk.bg.head, borderRadius: collapsed ? radius.card : `${radius.card}px ${radius.card}px 0 0`,
        }}
      >
        <button
          type="button"
          aria-label={collapsed ? 'Expand node' : 'Collapse node'}
          aria-expanded={!collapsed}
          onMouseDown={e => e.stopPropagation()}
          onDoubleClick={e => e.stopPropagation()}
          onClick={() => setCollapsed(v => !v)}
          style={{
            width: 20, height: 26, padding: 0, border: 0, background: 'none', cursor: 'pointer', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint,
          }}
        >
          <Icon name={collapsed ? 'chevR' : 'chevD'} size={14} />
        </button>
        {isEditingTitle ? (
          <input
            autoFocus
            aria-label="Node name"
            value={editingTitleValue}
            onChange={e => setEditingTitleValue(e.target.value)}
            onMouseDown={e => e.stopPropagation()}
            onDoubleClick={e => e.stopPropagation()}
            onBlur={() => {
              updateNodeParams(node.id, { label: editingTitleValue.trim() });
              setIsEditingTitle(false);
            }}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setIsEditingTitle(false); }
            }}
            style={{
              flex: 1, minWidth: 0, height: 26, padding: '0 6px', border: 0, outline: 'none', borderRadius: radius.sm,
              background: tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${tk.accent.base}`,
              color: tk.text.primary, font: `600 13.5px ${fontFamily.ui}`,
            }}
          />
        ) : (
          <span
            onDoubleClick={e => {
              e.stopPropagation();
              const current = typeof node.params.label === 'string' && node.params.label ? node.params.label : def.label;
              setEditingTitleValue(current);
              setIsEditingTitle(true);
            }}
            title="Double-click to rename"
            style={{
              flex: 1, minWidth: 0, paddingLeft: 2, fontWeight: 600, fontSize: 13.5, cursor: 'text',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {typeof node.params.label === 'string' && node.params.label ? node.params.label : def.label}
          </span>
        )}
        {!!node.params._groupOriginal && def.anchored && (
          <span title="Anchored — can't be deleted" style={{ display: 'flex', color: tk.text.faint, marginRight: 2 }}><Icon name="lock" size={13} /></span>
        )}
        {def.deprecated && <CardBadge tone="muted">DEPRECATED</CardBadge>}
        {isBypassed && <CardBadge>BYPASS</CardBadge>}
        {showNodeTooltip && <div ref={nodeTooltipRef}><NodeTooltip def={def} node={node} allNodes={nodes} /></div>}
        <div style={{ display: 'flex', gap: 1, alignItems: 'center', flexShrink: 0 }} onDoubleClick={e => e.stopPropagation()}>
          {!['output', 'vec4Output', 'uv', 'time', 'mouse', 'constant'].includes(node.type) && (
            <CardButton icon="eye" tint="success" on={isPreviewActive}
              label={isPreviewActive ? 'Stop previewing (show the full graph)' : 'Preview this node in isolation'}
              onClick={() => setPreviewNodeId(isPreviewActive ? null : node.id)} />
          )}
          {node.type === 'exprNode' && (
            <CardButton icon="expr" tint="expr" on={showExprBlockModal} label="Open the Expression Block editor" onClick={() => setShowExprBlockModal(v => !v)} />
          )}
          {node.type === 'transformVec' && (
            <CardButton icon="grid" on={showTransformVecModal} label="Open the Transform Vec editor" onClick={() => setShowTransformVecModal(v => !v)} />
          )}
          {(node.type === 'cubicBezierShaper' || node.type === 'quadBezierShaper') && (
            <CardButton icon="curve" on={showBezierModal} label="Open the Bezier editor" onClick={() => setShowBezierModal(v => !v)} />
          )}
          {node.type === 'floatWarp' && (
            <CardButton icon="expr" tint="expr" on={showExprModal} label="Open the expression editor" onClick={() => setShowExprModal(v => !v)} />
          )}
          {node.type === 'customFn' && (
            <CardButton icon="fn" tint="fn" on={showCustomFnModal} label="Open the Custom Function editor" onClick={() => setShowCustomFnModal(v => !v)} />
          )}
          {node.type === 'customFn' && (
            <CardButton icon="spark" tint="fn" label="Publish as a node type (this function becomes a reusable node)" onClick={() => {
              const cfInputs = (node.params.inputs as Array<{ name: string; type: string }> | undefined) ?? [];
              const outType = typeof node.params.outputType === 'string' ? node.params.outputType : 'float';
              const body = typeof node.params.body === 'string' ? node.params.body.trim() : '0.0';
              const helpers = typeof node.params.glslFunctions === 'string' ? node.params.glslFunctions.trim() : '';
              const fnLabel = typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Custom Function';
              const fnName = fnLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z_]+/, '') || 'custom_fn';
              const bodyCode = /\breturn\b/.test(body) ? body : `return ${body};`;
              const code = `${helpers ? helpers + '\n\n' : ''}${outType} ${fnName}(${cfInputs.map(i => `${i.type} ${i.name}`).join(', ')}) {\n    ${bodyCode.replace(/\n/g, '\n    ')}\n}`;
              setPublishCode({ code, entry: fnName, label: fnLabel });
            }} />
          )}
          {!['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group'].includes(node.type) && <CardDivider />}
          {/* Carry mode — only inside a group with iterations > 1 */}
          {isInsideLoop && !['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group', 'uv', 'time', 'mouse', 'constant'].includes(node.type) && (
            <CardButton icon="loop" tint="success" on={isCarry}
              label={isCarry ? 'Carry is on: the output feeds back in each iteration' : 'Carry: feed the output back in each iteration (e.g. UV folding)'}
              onClick={() => toggleCarryMode(node.id)} />
          )}
          {/* assignOp — declare an accumulator and combine this node's output */}
          {!['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group'].includes(node.type) && (
            <select
              aria-label="Assign operator"
              onMouseDown={e => e.stopPropagation()}
              value={assignOp}
              onChange={e => setNodeAssignOp(node.id, e.target.value as import('../../types/nodeGraph').GraphNode['assignOp'])}
              title="Assign operator: accumulate this node's output (+= -= *= /=)"
              style={{
                height: 24, width: 38, margin: '0 1px', padding: 0, borderRadius: 7, outline: 'none', cursor: 'pointer',
                appearance: 'none', WebkitAppearance: 'none', textAlign: 'center', textAlignLast: 'center',
                font: `600 12px ${fontFamily.mono}`,
                border: `1px solid ${assignOp !== '=' ? alpha(tk.accent.base, 0.4) : tk.border.default}`,
                background: assignOp !== '=' ? tk.bg.selected : tk.bg.panel,
                color: assignOp !== '=' ? tk.accent.text : tk.text.muted,
              }}
            >
              <option value="=">=</option>
              <option value="+=">+=</option>
              <option value="-=">-=</option>
              <option value="*=">*=</option>
              <option value="/=">/=</option>
            </select>
          )}
          {!['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'constant'].includes(node.type) && (
            <CardButton icon="bypass" tint="warning" on={isBypassed}
              label={isBypassed ? 'Turn the node back on' : 'Bypass: pass the input straight through'}
              onClick={() => toggleBypass(node.id)} />
          )}
          {!node.params._groupOriginal && (
            <CardButton icon="close" tone="danger" label="Remove node" onClick={() => removeNode(node.id)} />
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
            borderBottom: `1px solid ${tc.surface0}88`,
            background: `${tc.base}88`,
          }}
        >
          <span style={{ fontSize: '10px', color: tc.overlay0, flexShrink: 0, fontFamily: 'monospace' }}>
            init
          </span>
          {/* Clickable chip — opens the expression picker modal */}
          <button
            onClick={() => setShowInitModal(true)}
            title="Edit initializer expression — click to open expression picker"
            style={{
              flex: 1,
              background: node.assignInit ? tc.crust : 'transparent',
              border: `1px solid ${node.assignInit ? tc.surface1 : `${tc.surface0}66`}`,
              borderRadius: '4px',
              color: node.assignInit ? tc.blue : tc.surface1,
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
              style={{ background: 'none', border: 'none', color: tc.surface1, cursor: 'pointer', fontSize: '12px', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
            >
              ×
            </button>
          )}
          {showInitModal && (
            <AssignInitModal node={node} onClose={() => setShowInitModal(false)} />
          )}
        </div>
      )}


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
            borderBottom: isPreviewActive ? `1px solid ${tc.surface0}` : 'none',
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
          ['In',  inMin,  inMax,  tc.blue],
          ['Out', outMin, outMax, tc.green],
        ];
        return (
          <div style={{ padding: '6px 10px 4px', borderBottom: `1px solid ${tc.surface0}`, display: 'flex', flexDirection: 'column', gap: '5px' }}
               onMouseDown={e => e.stopPropagation()}>
            {rows.map(([label, mn, mx, color]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '9px', color: tc.overlay0, width: '20px', flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: '8px', background: tc.crust, borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: barLeft(mn, mx), width: barWidth(mn, mx), height: '100%', background: color, borderRadius: '4px', opacity: 0.7 }} />
                </div>
                <span style={{ fontSize: '9px', color: tc.overlay0, width: '60px', textAlign: 'right', flexShrink: 0 }}>
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
        <div style={{ width: '100%', borderBottom: `1px solid ${tc.surface0}` }}>
          {primaryOutputIsFloat && !GRAYSCALE_PREVIEW_TYPES.has(node.type) ? (
            /* Float output → live waveform scope */
            <canvas
              ref={previewScopeCanvasRef}
              width={240}
              height={80}
              style={{ display: 'block', width: '100%', height: '80px' }}
            />
          ) : (
            /* Vec3/vec4 output → rendered shader thumbnail */
            <div style={{ width: '100%', height: 160, background: tc.crust, overflow: 'hidden', position: 'relative' }}>
              {previewLoading && !previewDataUrl ? (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tc.surface2, fontSize: '12px' }}>
                  rendering…
                </div>
              ) : previewDataUrl ? (
                <img
                  src={previewDataUrl}
                  alt="node preview"
                  style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tc.surface2, fontSize: '11px' }}>
                  no preview
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ padding: '6px 0' }}>
        {/* ── Inputs (always visible) ── */}
        {Object.entries(node.inputs).filter(([key]) => Object.keys(def.inputs).length === 0 || key in def.inputs).map(([key, input]) => {
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
          let socketOpacity = 1;
          let socketGlow: string | undefined;
          if (draggingType) {
            const compat = typesCompatible(draggingType, input.type as DataType);
            socketOpacity = compat ? 1 : 0.25;
            socketGlow = compat ? `0 0 8px ${TYPE_COLORS[input.type] || '#888'}` : undefined;
          }
          // Mobile pending-connection highlight
          const pendingCompat = pendingMobileType
            ? typesCompatible(pendingMobileType as DataType, input.type as DataType)
            : false;
          if (pendingMobileConnection && !draggingType) {
            socketOpacity = pendingCompat ? 1 : 0.25;
            socketGlow = pendingCompat ? `0 0 10px ${TYPE_COLORS[input.type] || '#888'}` : undefined;
          }

          const socketSize = isTouchDevice ? '22px' : '12px';
          const socketMarginLeft = isTouchDevice ? '-11px' : '-6px';
          const socketMarginRight = '10px';

          const isHovered = hoveredInput === key;
          // Keyframes are a third input mode (alongside "wired" and "static
          // value") — meaningful for an unwired float socket, or an unwired
          // vec2/vec3 socket that declares which params back each axis
          // (most vec2/vec3 sockets are meant to be wired — UV, positions —
          // and don't declare this, so they stay ineligible).
          const isVectorKfType = input.type === 'vec2' || input.type === 'vec3';
          const vectorAxes = isVectorKfType ? VECTOR_AXES[input.type as 'vec2' | 'vec3'] : null;
          const kfEligible = !isConnected && !isExternal && (
            input.type === 'float' || (isVectorKfType && !!input.axisParams)
          );
          const isKeyframed = kfEligible && (
            input.type === 'float' ? socketHasKeyframes(node, key) : socketHasVectorKeyframes(node, key, vectorAxes ?? [])
          );
          const kfBypassed = isKeyframed && isKeyframeBypassed(node, key);
          const socketError = errors?.find(e => e.socket === key);

          return (
            <div
              key={key}
              style={{ display: 'flex', alignItems: 'center', minHeight: isTouchDevice ? 40 : 26, padding: '0 8px 0 0', position: 'relative' }}
            >
              {/* Socket dot — locked for external inputs */}
              <div
                data-socket="in"
                ref={el => registerSocket(node.id, 'in', key, el)}
                title={isKeyframed ? (kfBypassed ? 'Keyframes bypassed — right-click to use them again' : 'Keyframed — right-click for options, double-click to edit') : undefined}
                style={{
                  width: socketSize,
                  height: socketSize,
                  borderRadius: isKeyframed ? '3px' : '50%',
                  transform: isKeyframed ? 'rotate(45deg)' : undefined,
                  boxSizing: 'border-box',
                  background: socketError ? tk.status.danger : isKeyframed ? (kfBypassed ? tk.bg.panel : tk.status.warning) : isConnected ? (TYPE_COLORS[input.type] || '#888') : tk.bg.panel,
                  border: `2px solid ${socketError ? tk.status.danger : isKeyframed ? tk.status.warning : (TYPE_COLORS[input.type] || '#888')}`,
                  marginRight: socketMarginRight,
                  flexShrink: 0,
                  marginLeft: socketMarginLeft,
                  cursor: 'pointer',
                  opacity: socketOpacity,
                  boxShadow: socketGlow ?? (isConnected || isKeyframed ? `0 0 0 2px ${tk.bg.panel}` : undefined),
                  transition: 'box-shadow 0.1s, opacity 0.1s',
                  touchAction: 'manipulation',
                }}
                onMouseEnter={() => { setHoveredInput(key); onSocketHover?.({ nodeId: node.id, key, dir: 'in' }); }}
                onMouseLeave={() => { setHoveredInput(null); onSocketHover?.(null); }}
                onContextMenu={(e) => {
                  if (!kfEligible) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setKfMenu({ x: e.clientX, y: e.clientY, key });
                }}
                onDoubleClick={(e) => {
                  if (!isKeyframed) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setKfModalKey(key);
                }}
                onMouseDown={(e) => {
                  if (e.altKey && !isConnected) {
                    e.stopPropagation();
                    e.preventDefault();
                    onAltClickSocket?.(node.id, key, 'in', input.type, e);
                  }
                }}
                onMouseUp={(e) => {
                  e.stopPropagation();
                  if (e.altKey && !isConnected) return; // handled by onMouseDown
                  // Right-click is the keyframe menu only (onContextMenu); only a left click connects or disconnects
                  if (e.button !== 0) return;
                  if (isConnectionDragging) {
                    if (isExternal && activeGroupId) removeGroupInputPort(activeGroupId, key);
                    onEndConnection(node.id, key);
                    return;
                  }
                  if (isConnected) {
                    if (isExternal && activeGroupId) removeGroupInputPort(activeGroupId, key);
                    disconnectInput(node.id, key);
                  } else if (!isExternal && onSuggestSocket) {
                    // Click on an open input: the nearest outputs that could feed it
                    onSuggestSocket(node.id, key, 'in', e.clientX, e.clientY);
                  } else {
                    onEndConnection(node.id, key);
                  }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (pendingMobileConnection) {
                    onTapInputSocket?.(node.id, key);
                  } else if (isConnected) {
                    if (isExternal && activeGroupId) removeGroupInputPort(activeGroupId, key);
                    disconnectInput(node.id, key);
                  }
                }}
              />
              {/* Hover tooltip */}
              {isHovered && !draggingType && !kfChipHover && (
                <SocketTooltip
                  lines={isExternal ? [`🔒 Wired from outside group`, `(${input.type})`] : buildInputTooltip(key)}
                  side="left"
                />
              )}
              {/* Discoverability hint: unconnected float sockets can be keyframed —
                  surface that on hover instead of requiring right-click to find it.
                  Only float, unconnected, non-external sockets are kfEligible, so a
                  wired input never shows this (you'd delete the connection first). */}
              {isHovered && !draggingType && kfEligible && !isKeyframed && !isTouchDevice && (
                // Sits out in the canvas gutter left of the socket, so it never collides with the
                // socket tooltip (which opens to the right). The padding bridges the gap from the dot.
                <div
                  onMouseEnter={() => { setHoveredInput(key); setKfChipHover(true); }}
                  onMouseLeave={() => { setHoveredInput(null); setKfChipHover(false); }}
                  style={{ position: 'absolute', right: '100%', top: '50%', transform: 'translateY(-50%)', zIndex: 200, marginRight: -4, paddingRight: 12 }}
                >
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setKfChipHover(false); setKfModalKey(key); }}
                    title="Add keyframes to this input"
                    style={{
                      height: 20, padding: '0 7px', borderRadius: 6,
                      display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap',
                      border: 0, background: tk.bg.panel, color: tk.status.warningText, font: `600 10.5px ${fontFamily.ui}`,
                      boxShadow: `inset 0 0 0 1px ${alpha(tk.status.warning, 0.6)}, ${tk.shadow.float}`,
                    }}
                  ><Icon name="kf" size={10} />Keyframe</button>
                </div>
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
                    color: isExternal ? tk.text.faint : tk.text.secondary,
                    fontSize: isTouchDevice ? 13.5 : 12.5,
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
                  {isExternal && <span title="Wired from outside the group" style={{ marginLeft: 5, verticalAlign: -2, display: 'inline-flex' }}><Icon name="lock" size={12} /></span>}
                </span>
              )}
              {isConnected && !isExternal && (
                <span
                  role="button"
                  aria-label={`Disconnect ${slotName}`}
                  title="Disconnect"
                  style={{
                    marginLeft: 'auto', width: isTouchDevice ? 32 : 20, height: isTouchDevice ? 32 : 20, borderRadius: 6, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: tk.text.faint, touchAction: 'manipulation',
                  }}
                  onMouseUp={(e) => { e.stopPropagation(); disconnectInput(node.id, key); }}
                  onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); disconnectInput(node.id, key); }}
                >
                  <Icon name="close" size={12} />
                </span>
              )}
              {isConnected && isExternal && (
                <span style={{ marginLeft: 'auto', font: `500 10.5px ${fontFamily.mono}`, color: tk.text.muted, background: tk.bg.field, borderRadius: 5, padding: '1px 6px' }}>
                  outside
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
          const inputBg = tc.crust;
          const inputBorder = `1px solid ${tc.surface1}`;
          const inputStyle: React.CSSProperties = {
            background: inputBg, border: inputBorder, color: tc.text,
            padding: '2px 5px', borderRadius: '3px', fontSize: '10px',
            fontFamily: 'monospace', outline: 'none',
          };
          return (
            <div
              style={{ padding: '4px 10px 6px', display: 'flex', flexDirection: 'column', gap: '4px' }}
              onMouseDown={e => e.stopPropagation()}
            >
              <span style={{ fontSize: '10px', color: tc.overlay0, marginBottom: '1px' }}>Warp Lines</span>

              {lines.map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                  {/* Reorder */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1px', flexShrink: 0 }}>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => updateNodeParams(node.id, { lines: moveItem(lines, i, i - 1) })}
                      disabled={i === 0}
                      style={{ background: 'none', border: 'none', color: i === 0 ? tc.surface0 : tc.overlay0, cursor: i === 0 ? 'default' : 'pointer', padding: 0, fontSize: '8px', lineHeight: 1 }}
                      title="Move up"
                    >▲</button>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={() => updateNodeParams(node.id, { lines: moveItem(lines, i, i + 1) })}
                      disabled={i === lines.length - 1}
                      style={{ background: 'none', border: 'none', color: i === lines.length - 1 ? tc.surface0 : tc.overlay0, cursor: i === lines.length - 1 ? 'default' : 'pointer', padding: 0, fontSize: '8px', lineHeight: 1 }}
                      title="Move down"
                    >▼</button>
                  </div>
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
                    style={{ background: inputBg, border: inputBorder, color: tc.blue, fontSize: '10px', padding: '2px 2px', borderRadius: '3px', cursor: 'pointer', outline: 'none' }}
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
                    style={{ ...inputStyle, flex: 1, color: tc.green }}
                  />
                  {/* Remove row */}
                  <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={() => updateNodeParams(node.id, { lines: lines.filter((_, j) => j !== i) })}
                    style={{ background: 'none', border: 'none', color: tc.red, cursor: 'pointer', padding: '0 2px', fontSize: '13px', lineHeight: 1, flexShrink: 0 }}
                    title="Remove line"
                  >×</button>
                </div>
              ))}

              {/* Add line */}
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={() => updateNodeParams(node.id, { lines: [...lines, { lhs: 'p', op: '=', rhs: '' }] })}
                style={{ alignSelf: 'flex-start', background: tc.surface0, border: 'none', color: tc.subtext0, cursor: 'pointer', fontSize: '10px', padding: '2px 7px', borderRadius: '3px', marginTop: '1px' }}
              >+ line</button>

              {/* Return expression */}
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center', marginTop: '2px' }}>
                <span style={{ fontSize: '10px', color: tc.overlay0, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>return</span>
                <input
                  type="text"
                  value={result}
                  onChange={e => updateNodeParams(node.id, { result: e.target.value })}
                  placeholder="p"
                  style={{ ...inputStyle, flex: 1, color: tc.blue, border: `1px solid ${tc.surface1}` }}
                />
              </div>
            </div>
          );
        })()}

        {/* ── Transform Vec inline editor ── */}
        {!collapsed && node.type === 'transformVec' && (() => {
          const type  = (node.params.outputType as string) || 'vec2';
          const dims  = type === 'vec4' ? 4 : type === 'vec3' ? 3 : 2;
          const comps = (['x', 'y', 'z', 'w'] as const).slice(0, dims);
          return (
            <div onMouseDown={e => e.stopPropagation()}>
              {/* Type pills */}
              <div style={{ padding: '3px 10px 4px', display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: '10px', color: tc.surface1, marginRight: '2px' }}>type</span>
                {(['vec2', 'vec3', 'vec4'] as DataType[]).map(t => {
                  const active = type === t;
                  return (
                    <button key={t}
                      onClick={() => changeNodeVectorType(node.id, 'uv', 'result', t)}
                      style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '3px', cursor: 'pointer',
                        background: active ? `${tc.blue}22` : 'none',
                        border: `1px solid ${active ? tc.blue : `${tc.surface1}44`}`,
                        color: active ? tc.blue : tc.surface2,
                      }}
                    >{t === 'vec2' ? 'v2' : t === 'vec3' ? 'v3' : 'v4'}</button>
                  );
                })}
              </div>
              {/* Per-component expression inputs with inline operator dropdown */}
              {comps.map(c => {
                const pk  = `expr${c.toUpperCase()}`;
                const opk = `expr${c.toUpperCase()}Op`;
                const val = typeof node.params[pk]  === 'string' ? (node.params[pk]  as string) : c;
                const op  = typeof node.params[opk] === 'string' ? (node.params[opk] as string) : '=';
                const compColor = ({ x: tc.red, y: tc.green, z: tc.blue, w: tc.peach } as Record<string, string>)[c];
                return (
                  <div key={c} style={{ padding: '2px 10px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span style={{ fontSize: '10px', color: compColor, width: '8px', flexShrink: 0, fontFamily: 'monospace' }}>{c}</span>
                    <select value={op}
                      onChange={e => updateNodeParams(node.id, { [opk]: e.target.value })}
                      onMouseDown={e => e.stopPropagation()}
                      style={{ background: tc.crust, border: `1px solid ${tc.surface0}88`, color: tc.blue, fontSize: '10px', padding: '2px 2px', borderRadius: '3px', cursor: 'pointer', outline: 'none', flexShrink: 0 }}
                    >
                      {(['=', '+=', '-=', '*=', '/='] as const).map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <input
                      type="text"
                      value={val}
                      spellCheck={false}
                      onChange={e => updateNodeParams(node.id, { [pk]: e.target.value })}
                      style={{
                        flex: 1, background: tc.crust, border: `1px solid ${tc.surface0}88`,
                        color: tc.green, borderRadius: '3px', padding: '2px 6px',
                        fontSize: '10px', fontFamily: 'monospace', outline: 'none',
                      }}
                    />
                  </div>
                );
              })}
              <div style={{ height: '4px' }} />
            </div>
          );
        })()}

        {/* ── Vector type selector (vectorizable math nodes) ── */}
        {!collapsed && node.type in VECTORIZABLE_NODES && (() => {
          const info = VECTORIZABLE_NODES[node.type];
          const current = (node.params.outputType as string) || 'float';
          return (
            <div
              style={{ padding: '3px 10px 4px', display: 'flex', gap: '4px', alignItems: 'center' }}
              onMouseDown={e => e.stopPropagation()}
            >
              <span style={{ fontSize: '10px', color: tc.surface1, marginRight: '2px' }}>type</span>
              {(VEC4_CAPABLE_NODES.has(node.type) ? ['float', 'vec2', 'vec3', 'vec4'] as DataType[] : ['float', 'vec2', 'vec3'] as DataType[]).map(t => {
                const active = current === t;
                return (
                  <button
                    key={t}
                    onClick={() => changeNodeVectorType(node.id, info.primaryInput, info.primaryOutput, t)}
                    style={{
                      fontSize: '10px', padding: '1px 6px', borderRadius: '3px', cursor: 'pointer',
                      background: active ? `${tc.blue}22` : 'none',
                      border: `1px solid ${active ? tc.blue : `${tc.surface1}44`}`,
                      color: active ? tc.blue : tc.surface2,
                    }}
                  >
                    {t === 'float' ? 'f' : t === 'vec2' ? 'v2' : t === 'vec3' ? 'v3' : 'v4'}
                  </button>
                );
              })}
            </div>
          );
        })()}

        {/* ── matConst: size selector + grid of number inputs ── */}
        {!collapsed && node.type === 'matConst' && (() => {
          const size = (node.params.size as string) ?? 'mat3';
          const dim  = size === 'mat2' ? 2 : 3;
          const rows = Array.from({ length: dim }, (_, r) => r);
          const cols = Array.from({ length: dim }, (_, c) => c);
          const cellKey = (r: number, c: number) => `m${r}${c}`;
          const cellStyle: React.CSSProperties = {
            width: '100%', padding: '2px 4px', background: tc.crust,
            border: `1px solid ${tc.surface0}`, borderRadius: '3px',
            color: tc.text, fontSize: '11px', textAlign: 'center',
            outline: 'none', boxSizing: 'border-box' as const,
            fontFamily: 'monospace',
          };
          return (
            <div onMouseDown={e => e.stopPropagation()}>
              {/* Size selector */}
              <div style={{ padding: '3px 10px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: tc.overlay0, fontSize: '11px' }}>Size</span>
                <select
                  value={size}
                  onChange={e => updateNodeParams(node.id, { size: e.target.value })}
                  style={{ background: tc.base, border: `1px solid ${tc.surface1}`, color: tc.text, borderRadius: '3px', fontSize: '11px', padding: '1px 4px', cursor: 'pointer' }}
                >
                  <option value="mat2">2 × 2</option>
                  <option value="mat3">3 × 3</option>
                </select>
              </div>
              {/* Matrix grid */}
              <div style={{ padding: '2px 10px 6px', display: 'grid', gridTemplateColumns: `repeat(${dim}, 1fr)`, gap: '3px' }}>
                {rows.map(r => cols.map(c => {
                  const k = cellKey(r, c);
                  const raw = node.params[k];
                  const val = typeof raw === 'number' ? raw : 0;
                  return (
                    <NumberInput
                      key={k}
                      step={0.01}
                      value={val}
                      onCommit={n => updateNodeParams(node.id, { [k]: n })}
                      style={cellStyle}
                    />
                  );
                }))}
              </div>
            </div>
          );
        })()}

        {/* ── Image slots (published nodes with sampler2D arguments) ── */}
        {!collapsed && def.textureSlots && def.textureSlots.length > 0 && (() => {
          const un = getUserNode(node.type);
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px' }} onMouseDown={e => e.stopPropagation()}>
              {def.textureSlots.map(slot => {
                const thumb = node.params[`__tex_${slot}_thumb`] as string | undefined;
                const slotLabel = un?.textures?.find(t => t.key === slot)?.label ?? slot;
                const slotKey = `${node.id}::${slot}`;
                return (
                  <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {thumb ? (
                      <img src={thumb} alt={slotLabel} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: radius.sm, flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: radius.sm, flexShrink: 0, background: tk.bg.field, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🖼</div>
                    )}
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: tk.text.secondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slotLabel}</span>
                    <label style={{ fontSize: 11.5, color: tk.accent.base, cursor: 'pointer', padding: '4px 8px', borderRadius: radius.md, boxShadow: `inset 0 0 0 1px ${tk.border.default}` }}>
                      {thumb ? 'Change' : 'Load image'}
                      <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        loadImageTextureFromFile(file)
                          .then(({ texture, thumbnailDataUrl }) => {
                            setNodeTexture(slotKey, texture);
                            updateNodeParams(node.id, { [`__tex_${slot}_thumb`]: thumbnailDataUrl }, { immediate: true });
                          })
                          .catch(err => console.error('Failed to load texture image:', err));
                      }} />
                    </label>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ── Params (hidden when collapsed) ── */}
        {!collapsed && node.type !== 'matConst' && Object.keys(paramDefs).length > 0 && Object.keys(node.inputs).length > 0 && sectionRule}
        {!collapsed && node.type !== 'matConst' && Object.entries(paramDefs).map(([key, paramDef]) => {
          // showWhen — conditionally hide params based on another param's value
          if (paramDef.showWhen) {
            // A gate param an older save never had reads as its default (same rule as isParamVisible)
            const watchedVal = (node.params[paramDef.showWhen.param] ?? def?.defaultParams?.[paramDef.showWhen.param]) as string;
            const allowed = Array.isArray(paramDef.showWhen.value)
              ? paramDef.showWhen.value
              : [paramDef.showWhen.value];
            if (!allowed.includes(watchedVal)) return null;
          }
          // 'string' type → text input, or a code textarea for 'body'
          if (paramDef.type === 'string') {
            const val    = typeof node.params[key] === 'string' ? (node.params[key] as string) : '';
            const isBody = key === 'body';
            const fieldStyle: React.CSSProperties = {
              width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', borderRadius: radius.md,
              background: tk.bg.field, color: tk.text.primary,
            };
            return (
              <div
                key={key}
                style={{ padding: '4px 12px 4px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}
                onMouseDown={e => e.stopPropagation()}
              >
                <span style={{ color: tk.text.secondary, fontSize: 12.5 }}>{paramDef.label}</span>
                {isBody ? (
                  <textarea
                    aria-label={paramDef.label}
                    value={val}
                    onChange={e => updateNodeParams(node.id, { [key]: e.target.value })}
                    spellCheck={false}
                    rows={8}
                    style={{ ...fieldStyle, padding: '8px 10px', resize: 'vertical', font: `11.5px/1.55 ${fontFamily.mono}` }}
                  />
                ) : (
                  <input
                    type="text"
                    aria-label={paramDef.label}
                    value={val}
                    onChange={e => updateNodeParams(node.id, { [key]: e.target.value })}
                    spellCheck={false}
                    style={{ ...fieldStyle, height: 30, padding: '0 10px', font: `500 12.5px ${fontFamily.ui}` }}
                  />
                )}
              </div>
            );
          }

          const rowStyle: React.CSSProperties = {
            position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 12px 4px 16px',
          };

          if (paramDef.type === 'float') {
            // A connected matching input socket overrides the slider: show where the value comes from
            const socketConn = node.inputs[key]?.connection;
            const isSocketConnected = socketConn != null;
            const isParamExternal = externalInputKeys?.has(key) ?? false;
            const isParamExternallyDriven = externalParamKeys?.has(key) ?? false;
            const paramInputKey = `__param_${key}`;
            const paramInputConn = node.inputs[paramInputKey]?.connection;
            const isParamInternallyWired = paramInputConn != null;
            const lockIcon = <span style={{ marginLeft: 4, verticalAlign: -2, display: 'inline-flex' }}><Icon name="lock" size={11} /></span>;
            if (isSocketConnected) {
              const srcExpr = getSourceExpr(shaderLines, nodeOutputVarMap, socketConn!.nodeId, socketConn!.outputKey);
              return (
                <div key={key} style={rowStyle}>
                  <ParamLabel muted>{paramDef.label}{isParamExternal && lockIcon}</ParamLabel>
                  <WiredChip source={socketConn!} expr={srcExpr} locked={isParamExternal} />
                </div>
              );
            }
            const val = typeof node.params[key] === 'number' ? (node.params[key] as number) : 0;
            // Reserved for, or driven by, a wire from outside the group — show the value, locked
            if (isParamExternal || isParamExternallyDriven) {
              return (
                <div key={key} style={rowStyle} title="Set from outside the group">
                  <ParamLabel muted>{paramDef.label}{lockIcon}</ParamLabel>
                  <RulerSlider value={val} min={paramDef.min ?? 0} max={paramDef.max ?? 1} step={paramDef.step ?? 0.01}
                    onChange={() => {}} disabled ariaLabel={paramDef.label} touch={isTouchDevice} />
                </div>
              );
            }
            // Wired inside the group through the param's own socket
            if (isParamInternallyWired) {
              const srcExpr = getSourceExpr(shaderLines, nodeOutputVarMap, paramInputConn!.nodeId, paramInputConn!.outputKey);
              return (
                <div key={key} style={rowStyle} onMouseDown={e => e.stopPropagation()}>
                  {activeGroupId && (
                    <ParamSocket color={TYPE_COLORS.float} wired touch={isTouchDevice}
                      register={el => { registerSocket(node.id, 'in', paramInputKey, el); }}
                      onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, paramInputKey); }} />
                  )}
                  <ParamLabel muted>{paramDef.label}</ParamLabel>
                  <WiredChip source={paramInputConn!} expr={srcExpr} />
                  <CardButton icon="unlink" label="Disconnect" onClick={() => disconnectInput(node.id, paramInputKey)} />
                </div>
              );
            }
            const step = paramDef.step ?? 0.01;
            const bidir = node.params[`__scBidir_${key}`] === true;
            const customMax = typeof node.params[`__scMax_${key}`] === 'number' ? node.params[`__scMax_${key}`] as number : null;
            const baseMax = paramDef.max ?? 1;
            const effMax = customMax ?? baseMax;
            const effMin = bidir ? -effMax : (customMax != null ? 0 : (paramDef.min ?? 0));
            const defVal = def?.defaultParams?.[key];
            const hovered = hoveredSliderKey === key;
            const isKeyframed = node.inputs[key]?.type === 'float' && !node.inputs[key]?.connection
              && socketHasKeyframes(node, key) && !isKeyframeBypassed(node, key);

            // A typed value becomes the new max (by magnitude), so the ruler can reach it
            const handleTyped = (n: number) => {
              if (Math.abs(n) > 0) updateNodeParams(node.id, { [`__scMax_${key}`]: Math.abs(n) });
              setFloat(key, String(n));
            };

            return (
              <div
                key={key}
                style={rowStyle}
                onMouseDown={e => e.stopPropagation()}
                onMouseEnter={() => { setHoveredSliderKey(key); setHoveredParamHint(paramDef.hint ?? null); }}
                onMouseLeave={() => { setHoveredSliderKey(prev => prev === key ? null : prev); setHoveredParamHint(null); }}
              >
                {activeGroupId && (
                  <ParamSocket color={TYPE_COLORS.float} wired={false} touch={isTouchDevice}
                    register={el => { registerSocket(node.id, 'in', paramInputKey, el); }}
                    onMouseUp={e => { e.stopPropagation(); onEndConnection(node.id, paramInputKey); }} />
                )}
                <ParamLabel title={paramDef.hint}>{paramDef.label}</ParamLabel>
                {isKeyframed ? (
                  <KeyframedRuler node={node} socketKey={key} label={paramDef.label} min={effMin} max={effMax} step={step} touch={isTouchDevice} />
                ) : (
                  <RulerSlider
                    value={val}
                    min={effMin}
                    max={effMax}
                    step={adaptiveStep(val, step)}
                    defaultValue={typeof defVal === 'number' ? defVal : (effMin + effMax) / 2}
                    onChange={v => setFloat(key, String(v))}
                    onType={handleTyped}
                    ariaLabel={paramDef.label}
                    touch={isTouchDevice}
                  />
                )}
                {/* Range tools: bidirectional (±max) and, after typing past the range, reset it */}
                <div style={{ display: 'flex', gap: 1, marginRight: -6, visibility: hovered || bidir || customMax != null ? 'visible' : 'hidden' }}>
                  <CardButton icon="bidir" on={bidir}
                    label={bidir ? `Range is −${+effMax.toFixed(3)} to ${+effMax.toFixed(3)}: click for 0 to max` : 'Make the range run both ways (−max to max)'}
                    onClick={() => updateNodeParams(node.id, { [`__scBidir_${key}`]: !bidir })} />
                  {customMax != null && hovered && (
                    <CardButton icon="reset" label="Reset the slider range" onClick={() => updateNodeParams(node.id, { [`__scMax_${key}`]: null })} />
                  )}
                </div>
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
            const compColors = [tc.red, tc.green, tc.blue];
            const defVal = def?.defaultParams?.[key];
            // Each vec3 section folds on its own to a one-line summary (see foldState.ts)
            const foldId = `${node.id}:${key}`;
            const isFolded = !!foldedSections[foldId];
            return (
              <div
                key={key}
                style={{ padding: '6px 12px 6px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}
                onMouseDown={e => e.stopPropagation()}
              >
                <button
                  type="button"
                  aria-expanded={!isFolded}
                  onClick={() => toggleFold(foldId)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: 0, margin: '0 0 2px -4px', border: 0, background: 'none',
                    cursor: 'pointer', textAlign: 'left', color: tk.text.secondary, font: `600 12.5px ${fontFamily.ui}`,
                  }}
                  title={`${paramDef.hint ? `${paramDef.hint}\n` : ''}Click to ${isFolded ? 'expand' : 'fold'} · double-click the name to reset`}
                >
                  <Icon name={isFolded ? 'chevR' : 'chevD'} size={13} style={{ color: tk.text.faint, flexShrink: 0 }} />
                  <span onDoubleClick={e => { e.stopPropagation(); if (Array.isArray(defVal)) updateNodeParams(node.id, { [key]: defVal }, { immediate: true }); }}>{paramDef.label}</span>
                  {isFolded && (
                    <span style={{ marginLeft: 'auto', font: `500 11.5px ${fontFamily.mono}`, color: tk.text.muted }}>
                      {node.inputs[key]?.connection ? 'wired' : vals.slice(0, 3).map(v => (+(v ?? 0)).toFixed(2)).join('  ')}
                    </span>
                  )}
                </button>
                {/* The whole vec3 wired (Palette's Offset, …): one chip instead of three rulers */}
                {isFolded ? null : node.inputs[key]?.connection ? (
                  <WiredChip source={node.inputs[key].connection!} expr={getSourceExpr(shaderLines, nodeOutputVarMap, node.inputs[key].connection!.nodeId, node.inputs[key].connection!.outputKey)} />
                ) : [0, 1, 2].map(idx => {
                  const conn = node.inputs[compKeys[idx]]?.connection;
                  return (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 }}>
                      <span style={{ width: 10, flexShrink: 0, textAlign: 'center', font: `600 11px ${fontFamily.mono}`, color: compColors[idx] }}>{compLabels[idx]}</span>
                      {conn
                        ? <WiredChip source={conn} expr={getSourceExpr(shaderLines, nodeOutputVarMap, conn.nodeId, conn.outputKey)} />
                        : (
                          <RulerSlider
                            value={vals[idx] ?? 0}
                            min={min}
                            max={max}
                            step={step}
                            defaultValue={Array.isArray(defVal) ? (defVal[idx] as number) : undefined}
                            onChange={v => setVec3Component(key, idx, String(v))}
                            onType={n => setVec3Component(key, idx, String(n))}
                            ariaLabel={`${paramDef.label} ${compLabels[idx]}`}
                            touch={isTouchDevice}
                          />
                        )}
                    </div>
                  );
                })}
              </div>
            );
          }

          if (paramDef.type === 'select') {
            const val = node.params[key] !== undefined ? String(node.params[key]) : (paramDef.options?.[0]?.value ?? '');
            return (
              <div key={key} style={rowStyle} onMouseDown={e => e.stopPropagation()}>
                <ParamLabel>{paramDef.label}</ParamLabel>
                <Select
                  ariaLabel={paramDef.label}
                  value={val}
                  options={paramDef.options ?? []}
                  onChange={v => updateNodeParams(node.id, { [key]: v }, { immediate: true })}
                  style={{ flex: 1 }}
                />
              </div>
            );
          }

          if (paramDef.type === 'vec3color') {
            // Native colour picker — converts between [r,g,b] 0-1 and hex
            const vals = Array.isArray(node.params[key]) ? (node.params[key] as number[]) : [0, 0, 0];
            const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
            const hexValue = `#${toHex(vals[0])}${toHex(vals[1])}${toHex(vals[2])}`;
            return (
              <div key={key} style={rowStyle} onMouseDown={e => e.stopPropagation()}>
                <ParamLabel>{paramDef.label}</ParamLabel>
                <label style={{
                  position: 'relative', width: 44, height: 26, borderRadius: radius.md, cursor: 'pointer', flexShrink: 0,
                  background: hexValue, boxShadow: `inset 0 0 0 1px ${alpha('#000000', 0.12)}`,
                }}>
                  <input
                    type="color"
                    aria-label={paramDef.label}
                    value={hexValue}
                    onChange={e => {
                      const hex = e.target.value;
                      const r = parseInt(hex.slice(1, 3), 16) / 255;
                      const g = parseInt(hex.slice(3, 5), 16) / 255;
                      const b = parseInt(hex.slice(5, 7), 16) / 255;
                      updateNodeParams(node.id, { [key]: [r, g, b] }, { immediate: true });
                    }}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                  />
                </label>
                <span style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.muted }}>{hexValue}</span>
              </div>
            );
          }

          if (paramDef.type === 'bool') {
            const val = node.params[key] !== false;
            return (
              <div key={key} style={rowStyle} onMouseDown={e => e.stopPropagation()}>
                <ParamLabel>{paramDef.label}</ParamLabel>
                <Toggle checked={val} onChange={v => updateNodeParams(node.id, { [key]: v })} />
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
            const wire = node.inputs[inp.name]?.connection;
            return (
              <div
                key={inp.name}
                style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '4px 12px 4px 16px' }}
                onMouseDown={e => e.stopPropagation()}
              >
                <ParamLabel muted={isWired}>{inp.name}</ParamLabel>
                {isWired && wire
                  ? <WiredChip source={wire} expr={getSourceExpr(shaderLines, nodeOutputVarMap, wire.nodeId, wire.outputKey)} />
                  : (
                    <RulerSlider
                      value={val}
                      min={sl.min}
                      max={sl.max}
                      step={step}
                      defaultValue={(sl.min + sl.max) / 2}
                      onChange={v => updateNodeParams(node.id, { [inp.name]: v }, { immediate: true })}
                      onType={n => updateNodeParams(node.id, { [inp.name]: n }, { immediate: true })}
                      ariaLabel={inp.name}
                      touch={isTouchDevice}
                    />
                  )}
              </div>
            );
          });
        })()}

        {/* ── Outputs (always visible) ── */}
        {Object.keys(node.outputs).length > 0 && (Object.keys(node.inputs).length > 0 || (!collapsed && Object.keys(paramDefs).length > 0)) && sectionRule}
        {Object.entries(node.outputs).map(([key, output]) => {
          const isHovered = hoveredOutput === key;
          // Live clock on the Time node's output (follows every frame, see timeReadoutRef)
          const liveValueBadge = node.type === 'time' && key === 'time';
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                minHeight: isTouchDevice ? 40 : 26,
                padding: '0 0 0 12px',
                position: 'relative',
              }}
            >
              {liveValueBadge && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 2, marginRight: 8 }}>
                  <span ref={timeReadoutRef} style={{ font: `600 11.5px ${fontFamily.mono}`, color: tk.text.primary, background: tk.bg.field, borderRadius: 6, padding: '2px 7px', fontVariantNumeric: 'tabular-nums' }}>
                    {(useNodeGraphStore.getState().currentTime ?? 0).toFixed(2)}s
                  </span>
                  <CardButton icon="reset" label="Reset time to 0" onClick={() => window.dispatchEvent(new CustomEvent('reset-time'))} />
                </span>
              )}
              <span style={{ color: tk.text.secondary, fontSize: isTouchDevice ? 13.5 : 12.5 }}>{output.label}</span>
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
                onMouseEnter={() => { setHoveredOutput(key); onSocketHover?.({ nodeId: node.id, key, dir: 'out' }); }}
                onMouseLeave={() => { setHoveredOutput(null); onSocketHover?.(null); }}
                title={`${output.label} (${output.type})`}
                style={{
                  width: isTouchDevice ? '22px' : '12px',
                  height: isTouchDevice ? '22px' : '12px',
                  borderRadius: '50%',
                  boxSizing: 'border-box',
                  background: TYPE_COLORS[output.type] || '#888',
                  border: `2px solid ${TYPE_COLORS[output.type] || '#888'}`,
                  marginLeft: '10px',
                  flexShrink: 0,
                  marginRight: isTouchDevice ? '-11px' : '-6px',
                  cursor: 'crosshair',
                  touchAction: 'manipulation',
                  boxShadow: pendingMobileConnection?.sourceNodeId === node.id && pendingMobileConnection?.sourceOutputKey === key
                    ? `0 0 0 3px ${TYPE_COLORS[output.type] || '#888'}, 0 0 12px ${TYPE_COLORS[output.type] || '#888'}`
                    : `0 0 0 2px ${tk.bg.panel}`,
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
        <ExprBlockModal node={node} insideLoop={isInsideLoop} onClose={() => setShowExprBlockModal(false)} />
      )}

      {/* ── Bezier editor modal ── */}
      {showBezierModal && (node.type === 'cubicBezierShaper' || node.type === 'quadBezierShaper') && (
        <BezierEditorModal node={node} onClose={() => setShowBezierModal(false)} />
      )}

      {/* ── Keyframe context menu + editor ── */}
      {kfMenu && (() => {
        const kfInput = node.inputs[kfMenu.key];
        const isVec = kfInput && (kfInput.type === 'vec2' || kfInput.type === 'vec3');
        const axes = isVec ? VECTOR_AXES[kfInput.type as 'vec2' | 'vec3'] : null;
        const hasKf = isVec ? socketHasVectorKeyframes(node, kfMenu.key, axes ?? []) : socketHasKeyframes(node, kfMenu.key);
        const bypassed = isKeyframeBypassed(node, kfMenu.key);
        const clearParams: Record<string, unknown> = {
          [`__kfMode_${kfMenu.key}`]: undefined,
          [`__kfLoopBack_${kfMenu.key}`]: undefined,
          [`__kfBypass_${kfMenu.key}`]: undefined,
        };
        if (isVec && axes) axes.forEach(axis => { clearParams[`__keyframes_${kfMenu.key}_${axis}`] = undefined; });
        else clearParams[`__keyframes_${kfMenu.key}`] = undefined;
        return (
          <Menu
            x={kfMenu.x}
            y={kfMenu.y}
            onClose={() => setKfMenu(null)}
            items={hasKf ? [
              { label: 'Edit keyframes…', icon: 'kf', hint: 'dbl-click', onSelect: () => setKfModalKey(kfMenu.key) },
              bypassed
                ? { label: 'Use keyframes again', icon: 'bypass', onSelect: () => updateNodeParams(node.id, { [`__kfBypass_${kfMenu.key}`]: undefined }) }
                : { label: 'Bypass keyframes', icon: 'bypass', onSelect: () => updateNodeParams(node.id, { [`__kfBypass_${kfMenu.key}`]: true }) },
              'separator',
              { label: 'Remove keyframes', icon: 'trash', danger: true, onSelect: () => updateNodeParams(node.id, clearParams) },
            ] : [
              { label: 'Add keyframes…', icon: 'kf', onSelect: () => setKfModalKey(kfMenu.key) },
            ]}
          />
        );
      })()}
      {kfModalKey && (
        <KeyframeEditorModal node={node} socketKey={kfModalKey} onClose={() => setKfModalKey(null)} />
      )}

      {/* ── TransformVec modal ── */}
      {showTransformVecModal && node.type === 'transformVec' && (
        <TransformVecModal node={node} onClose={() => setShowTransformVecModal(false)} />
      )}

      {/* ── CustomFn modal ── */}
      {showCustomFnModal && node.type === 'customFn' && (
        <CustomFnModal node={node} onClose={() => setShowCustomFnModal(false)} />
      )}
      {publishCode && (
        <PublishNodeModal source={{ kind: 'code', code: publishCode.code, entry: publishCode.entry, label: publishCode.label }}
          existingId={publishCode.existingId} onClose={() => setPublishCode(null)} />
      )}

      {/* ── Comment editor (hidden when collapsed) ── */}
      {showCommentEditor && !collapsed && (
        <div style={{ padding: '10px 12px', borderTop: `1px solid ${tk.border.subtle}` }} onMouseDown={e => e.stopPropagation()}>
          <textarea
            autoFocus
            aria-label="Node comment"
            value={nodeComment}
            placeholder="Describe what this node does…"
            onChange={e => updateNodeParams(node.id, { __comment: e.target.value })}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); finishComment(); }
            }}
            style={{
              width: '100%', minHeight: 58, boxSizing: 'border-box', resize: 'vertical', border: 0, outline: 'none',
              borderRadius: radius.md, padding: '8px 10px', background: tk.bg.field, color: tk.text.primary,
              font: `12.5px/1.45 ${fontFamily.ui}`,
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
            {nodeComment && (
              <Button size="sm" variant="ghost" icon="trash" style={{ color: tk.status.danger }}
                onClick={() => { updateNodeParams(node.id, { __comment: undefined }); setShowCommentEditor(false); }}>Delete</Button>
            )}
            <span style={{ flex: 1 }} />
            <Button size="sm" variant="primary" onClick={finishComment} title="Done (⌘↵)">Done</Button>
          </div>
        </div>
      )}

      {/* ── Generated GLSL code (read-only, hidden when collapsed) ── */}
      {showCode && !collapsed && (
        <div style={{ borderTop: `1px solid ${tk.border.subtle}`, background: tk.bg.subtle }} onMouseDown={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 12px', borderBottom: `1px solid ${tk.border.subtle}` }}>
            <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>GLSL</span>
            {hasOverride && <CardBadge>EDITED</CardBadge>}
            {hasOverride && (
              <Button size="sm" variant="ghost" style={{ height: 26 }}
                title="This node's GLSL was edited by hand (an older feature). Revert to the generated code."
                onClick={() => updateNodeParams(node.id, { __codeOverride: '' })}>
                Revert
              </Button>
            )}
          </div>
            {helperFunctions.length > 0 && (
              <>
                <div style={{ padding: '6px 12px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>WHAT IT COMPUTES</div>
                <pre style={{
                  margin: 0, padding: '4px 12px 8px', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre',
                  color: tk.text.muted, font: `11px/1.55 ${fontFamily.mono}`, borderBottom: `1px solid ${tk.border.subtle}`,
                }}>
                  {helperFunctions.join('\n\n')}
                </pre>
                <div style={{ padding: '6px 12px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: tk.text.faint }}>HOW THIS NODE USES IT</div>
              </>
            )}
            <pre style={{
              margin: 0, padding: '8px 12px', maxHeight: 400, overflow: 'auto', whiteSpace: 'pre',
              color: hasOverride ? tk.status.warningText : tk.text.secondary, font: `11.5px/1.55 ${fontFamily.mono}`,
            }}>
              {codeSnippet || '// (no code generated)'}
            </pre>
        </div>
      )}

      {/* ── Compile problems traced to this node ── */}
      {errors && errors.length > 0 && !collapsed && (
        <div role="alert" style={{
          display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 12px', borderTop: `1px solid ${alpha(tk.status.danger, 0.25)}`,
          background: alpha(tk.status.danger, 0.07), color: tk.status.danger, font: `500 12px/1.45 ${fontFamily.ui}`, userSelect: 'text',
        }}>
          <Icon name="alert" size={14} style={{ flexShrink: 0, marginTop: 1.5 }} />
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
            {errors[0].message}
            {errors.length > 1 && <span style={{ opacity: 0.75 }}>{` · ${errors.length - 1} more in the error panel`}</span>}
          </span>
        </div>
      )}

      {/* ── Footer — Info/Comment/Code/Reset live here instead of the header, so the
          title doesn't get crowded as a node gains more of these toggles ── */}
      <div
        onMouseDown={e => e.stopPropagation()}
        style={{ display: 'flex', gap: 2, alignItems: 'center', padding: '5px 8px', borderTop: `1px solid ${tk.border.subtle}` }}
      >
        <span ref={infoButtonRef} style={{ display: 'inline-flex' }}>
          <CardButton icon="info" on={showNodeTooltip} label={showNodeTooltip ? 'Hide node info' : 'Node info'} onClick={() => setShowNodeTooltip(v => !v)} />
        </span>
        <CardButton icon="comment" tint="success" on={showCommentEditor || !!nodeComment}
          label={nodeComment ? 'Edit comment' : 'Add a comment'}
          onClick={() => { setShowCommentEditor(v => !v); setShowCommentPreview(false); }} />
        <CardButton icon="code" on={showCode} label={showCode ? 'Hide the generated GLSL' : 'Show the generated GLSL'} onClick={() => setShowCode(v => !v)} />
        {getUserNode(node.type)?.source && (
          <CardButton icon={getUserNode(node.type)?.source?.kind === 'code' ? 'code' : 'layoutGraph'} tint="fn"
            label={getUserNode(node.type)?.source?.kind === 'code' ? "Edit this node type's GLSL (publishing again updates every instance)" : "Open this node type's source graph (publish it again to update every instance)"}
            onClick={() => {
              const un = getUserNode(node.type);
              if (un?.source?.kind === 'code') setPublishCode({ code: un.source.code, entry: un.source.entry, label: un.label, existingId: un.id });
              else openUserNodeSource(node.type, { x: node.position.x, y: node.position.y + 260 });
            }} />
        )}
        {Object.keys(def.paramDefs ?? {}).length > 0 && (
          <CardButton icon="resetParams" label="Reset parameters to defaults"
            onClick={() => { if (def.defaultParams) updateNodeParams(node.id, def.defaultParams as Record<string, unknown>, { immediate: true }); }} />
        )}
        {canRandomize(node, def) && (
          <CardButton icon="dice" on={randomizeExcluded(node).length > 0}
            label={randomizeExcluded(node).length > 0 ? 'Randomize the ticked sliders (right-click to choose)' : 'Randomize values (right-click to choose which)'}
            onClick={() => randomizeNodeParams(node.id)}
            onContextMenu={e => setRandomizeMenu({ x: e.clientX, y: e.clientY })} />
        )}
      </div>
      {randomizeMenu && (
        <RandomizeMenu
          x={randomizeMenu.x}
          y={randomizeMenu.y}
          params={randomizableParams(node, def)}
          excluded={randomizeExcluded(node)}
          onChange={next => updateNodeParams(node.id, { __randExclude: next.length ? next : undefined })}
                amount={randomizeAmount(node)}
                onAmountChange={a => updateNodeParams(node.id, { __randAmount: a >= 1 ? undefined : a })}
          onRandomize={() => randomizeNodeParams(node.id)}
          onClose={() => setRandomizeMenu(null)}
        />
      )}
    </div>
  );
});
