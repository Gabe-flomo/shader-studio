/**
 * MobileGraphBrowser — touch-first alternative to the spatial node-graph
 * canvas. Instead of panning/zooming/dragging connections, you drill into
 * one node at a time: Home shows the graph's Source nodes (no inputs, e.g.
 * UV) and the Output node; tapping a node focuses it and lists its inputs
 * and outputs as rows. Tapping a connected row drills into whatever it's
 * wired to; tapping an unconnected input (or "+ add consumer" on an output)
 * lets you either add a brand-new node or wire up an existing one already
 * in the graph — never by dragging, always by picking from a list.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode, DataType } from '../../types/nodeGraph';
import { TYPE_COLORS } from './typeColors';
import { NodeSearchPalette } from './NodeSearchPalette';
import { typesCompatible } from '../../lib/typesCompatible';
import { groupNodesByRank } from '../../store/graphLayout';
import { moveItem } from '../../lib/reorder';
import { GLSL_PALETTE } from '../../lib/glslPalette';
import { compileNodePreviewShader } from '../../lib/compileNodePreviewShader';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';

function nodeDotColor(n: GraphNode): string {
  if (n.type === 'output') return '#a6e3a1';
  const outType = Object.values(n.outputs)[0]?.type;
  return TYPE_COLORS[outType ?? 'float'] ?? '#888';
}

// ── Inline param sliders (unconnected float/int inputs only) ──────────────────
// Mirrors the desktop card's paramDefs-driven slider: same key convention
// (a scalar input socket's key matches its paramDef key 1:1, e.g. Simple
// SDF's `r` input <-> `r` paramDef), same min/max/step, same showWhen
// conditional visibility — just without desktop's bidirectional-range /
// custom-max power-user controls.
function paramVisible(node: GraphNode, paramDef: { showWhen?: { param: string; value: string | string[] } }): boolean {
  if (!paramDef.showWhen) return true;
  const val = node.params[paramDef.showWhen.param];
  const want = paramDef.showWhen.value;
  return Array.isArray(want) ? want.includes(val as string) : val === want;
}
function sliderableParam(node: GraphNode, key: string) {
  const def = getNodeDefinition(node.type);
  const pd = def?.paramDefs?.[key];
  if (!pd || (pd.type !== 'float' && pd.type !== 'int')) return undefined;
  if (!paramVisible(node, pd)) return undefined;
  return pd;
}
function currentSliderValue(node: GraphNode, key: string, pd: { min?: number }): number {
  if (typeof node.params[key] === 'number') return node.params[key] as number;
  const def = getNodeDefinition(node.type);
  const dv = def?.defaultParams?.[key];
  return typeof dv === 'number' ? dv : (pd.min ?? 0);
}
function formatSliderValue(v: number, step?: number): string {
  if (!step || step >= 1) return v.toFixed(0);
  if (step >= 0.1) return v.toFixed(1);
  if (step >= 0.01) return v.toFixed(2);
  return v.toFixed(3);
}

// ── Cycle safety ──────────────────────────────────────────────────────────────
// Adding a connection sourceId.output -> targetId.input is only valid if
// sourceId isn't already downstream of targetId (i.e. targetId doesn't
// already, directly or indirectly, feed into sourceId) — otherwise the new
// edge closes a loop.
function wouldCreateCycle(nodes: GraphNode[], sourceId: string, targetId: string): boolean {
  if (sourceId === targetId) return true;
  const visited = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === sourceId) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of nodes) {
      for (const inp of Object.values(n.inputs)) {
        if (inp.connection?.nodeId === cur) stack.push(n.id);
      }
    }
  }
  return false;
}

// `sourceType` finds a compatible INPUT on `node` — node.inputs are the sink,
// so the wire runs sourceType -> inp.type.
function firstCompatibleInputKey(node: GraphNode, sourceType: string): string | undefined {
  return Object.entries(node.inputs).find(([, inp]) => typesCompatible(sourceType, inp.type))?.[0];
}
// `targetType` finds a compatible OUTPUT on `node` — node.outputs are the
// source, so the wire runs out.type -> targetType.
function firstCompatibleOutputKey(node: GraphNode, targetType: string): string | undefined {
  return Object.entries(node.outputs).find(([, out]) => typesCompatible(out.type, targetType))?.[0];
}

type PendingSocket =
  | { dir: 'input'; nodeId: string; key: string; type: string }
  | { dir: 'output'; nodeId: string; key: string; type: string };

// ── Shared graph-diagram layout ─────────────────────────────────────────────
// Positions every node by (rank, index-within-rank) and collects the bezier
// edges for its existing connections. Used by both the read-only Home graph
// view and the "tap a node to connect" picker, so they always agree on where
// a node sits.
const GRAPH_ROW_H = 68, GRAPH_CELL_W = 104, GRAPH_NODE_W = 88, GRAPH_NODE_H = 34, GRAPH_PAD = 16;
function computeGraphLayout(nodes: GraphNode[], rankedRows: Array<{ rank: number; nodes: GraphNode[] }>) {
  const pos = new Map<string, { x: number; y: number }>();
  let maxCols = 1;
  rankedRows.forEach(({ nodes: rowNodes }, rowIdx) => {
    maxCols = Math.max(maxCols, rowNodes.length);
    rowNodes.forEach((n, i) => pos.set(n.id, { x: GRAPH_PAD + i * GRAPH_CELL_W, y: GRAPH_PAD + rowIdx * GRAPH_ROW_H }));
  });
  const width = GRAPH_PAD * 2 + maxCols * GRAPH_CELL_W;
  const height = GRAPH_PAD * 2 + rankedRows.length * GRAPH_ROW_H;

  const edges: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
  for (const n of nodes) {
    const to = pos.get(n.id);
    if (!to) continue;
    for (const [key, inp] of Object.entries(n.inputs)) {
      if (!inp.connection) continue;
      const from = pos.get(inp.connection.nodeId);
      if (!from) continue;
      edges.push({
        x1: from.x + GRAPH_NODE_W / 2, y1: from.y + GRAPH_NODE_H,
        x2: to.x + GRAPH_NODE_W / 2, y2: to.y,
        key: `${inp.connection.nodeId}:${inp.connection.outputKey}->${n.id}:${key}`,
      });
    }
  }
  return { pos, width, height, edges };
}
function GraphEdges({ edges }: { edges: ReturnType<typeof computeGraphLayout>['edges'] }) {
  return (
    <>
      {edges.map(e => {
        const midY = (e.y1 + e.y2) / 2;
        return (
          <path
            key={e.key}
            d={`M ${e.x1} ${e.y1} C ${e.x1} ${midY}, ${e.x2} ${midY}, ${e.x2} ${e.y2}`}
            stroke="#585b70" strokeWidth={1.5} fill="none"
          />
        );
      })}
    </>
  );
}

const dotStyle = (color: string): React.CSSProperties => ({
  width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0,
});
const chipStyle: React.CSSProperties = {
  background: '#313244', border: '1px solid #45475a', borderRadius: '999px',
  padding: '4px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
};
const addBtnStyle: React.CSSProperties = {
  marginLeft: 'auto', flexShrink: 0, background: '#313244', border: '1px solid #89b4fa66', color: '#89b4fa',
  borderRadius: '6px', width: '30px', height: '30px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '18px', lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
};
// Compact square icon button for tight rows (e.g. "+" / "✕" sitting side by
// side on an Expr Block input row) — smaller than addBtnStyle so a pair of
// them doesn't force the row taller than the text field next to them.
const smallIconBtnStyle = (color: string): React.CSSProperties => ({
  flexShrink: 0, background: 'none', border: 'none', color,
  width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '15px', lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
});

// ── Socket type icon ─────────────────────────────────────────────────────────
// Used in the node detail view's Inputs/Outputs cards in place of a plain
// color dot: floats get a "#", vectors get their component letters in
// brackets ("[XY]", "[XYZ]", "[XYZW]") with each letter in its own axis
// color, so a socket's shape is readable at a glance instead of just its
// color. Anything else (bool, sampler2D, mat3, …) falls back to the dot.
const AXIS_COLORS: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa', w: '#cba6f7' };
const VECTOR_AXES: Record<string, string[]> = { vec2: ['x', 'y'], vec3: ['x', 'y', 'z'], vec4: ['x', 'y', 'z', 'w'] };
function TypeIcon({ type }: { type: string }) {
  if (type === 'float' || type === 'int') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', flexShrink: 0, fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: TYPE_COLORS[type] ?? '#888' }}>
        #
      </span>
    );
  }
  const axes = VECTOR_AXES[type];
  if (axes) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontFamily: 'monospace', fontWeight: 700, fontSize: '10px', whiteSpace: 'nowrap' }}>
        <span style={{ color: '#585b70' }}>[</span>
        {axes.map(a => <span key={a} style={{ color: AXIS_COLORS[a] }}>{a.toUpperCase()}</span>)}
        <span style={{ color: '#585b70' }}>]</span>
      </span>
    );
  }
  return <div style={dotStyle(TYPE_COLORS[type] ?? '#888')} />;
}
// Tappable, collapsible column header ("▾ INPUTS" / "▸ OUTPUTS").
const sectionHeaderBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px', width: '100%',
  background: 'none', border: 'none', padding: '4px 2px',
  fontSize: '11px', fontWeight: 700, color: '#7d8296', letterSpacing: '0.05em',
  cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
};

// ── Node preview thumbnail ──────────────────────────────────────────────────
// Reuses desktop's preview pipeline (compileNodePreviewShader walks the
// node's upstream ancestors into a self-contained shader; nodePreviewRenderer
// is a shared offscreen-WebGL singleton, not tied to the desktop canvas) to
// render a small static snapshot next to the Remove button. Recomputed only
// when the focused node changes, not on every param edit — same "snapshot,
// not live" behavior as desktop's 👁 toggle. Callers must pass `key={nodeId}`
// so switching nodes remounts this fresh (clears the stale thumbnail) rather
// than reusing state across nodes.
function NodePreviewThumb({ nodeId, nodeType }: { nodeId: string; nodeType: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const nodes = useNodeGraphStore.getState().nodes;
    const fs = compileNodePreviewShader(nodeId, nodes);
    if (!fs) return;
    let cancelled = false;
    const time = useNodeGraphStore.getState().currentTime ?? 0;
    nodePreviewRenderer.renderNodePreview(nodeId, fs, { u_time: { value: time } }, 88)
      .then(dataUrl => { if (!cancelled) setUrl(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [nodeId, nodeType]);

  if (!url) return null;
  return (
    <div style={{ width: '36px', height: '36px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #313244', flexShrink: 0, background: '#11111b' }}>
      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}

// ── Expr Block editor (mobile) ──────────────────────────────────────────────
const EXPR_TYPE_OPTIONS: DataType[] = ['float', 'vec2', 'vec3', 'vec4'];
const EXPR_OPS = ['=', '+=', '-=', '*=', '/='];
const exprTextInputStyle: React.CSSProperties = {
  background: '#11111b', border: '1px solid #45475a', color: '#cdd6f4',
  borderRadius: '6px', padding: '8px 10px', fontSize: '13px', fontFamily: 'monospace', outline: 'none', minWidth: 0,
};
const exprSelectStyle: React.CSSProperties = {
  background: '#11111b', border: '1px solid #45475a', color: '#89b4fa',
  borderRadius: '6px', padding: '8px 6px', fontSize: '13px', cursor: 'pointer', outline: 'none',
};
// Thin highlight stroke around whichever input/line card currently has focus
// — makes it obvious which element you're editing on a small screen.
const exprCardStyle = (focused: boolean): React.CSSProperties => ({
  background: '#1e1e2e', borderRadius: '8px', padding: '7px 8px',
  border: focused ? '1px solid #89b4fa' : '1px solid #313244',
  display: 'flex', flexDirection: 'column', gap: '6px',
});
type ExprInputDef = { name: string; type: DataType; slider: { min: number; max: number } | null; carry?: boolean };
type ExprLine = { lhs: string; op: string; rhs: string };

// The identifier-ish token immediately before `cursor` in `str` — e.g. for
// "sin(a) + cl|" with the cursor at "|", returns { start: 10, word: "cl" }.
function wordBeforeCursor(str: string, cursor: number): { start: number; word: string } {
  let start = cursor;
  while (start > 0 && /[A-Za-z0-9_]/.test(str[start - 1])) start--;
  return { start, word: str.slice(start, cursor) };
}

// The only global uniforms every compiled shader (and every Expr Block's
// scope) can always reference, regardless of what the node declares —
// suggested after local variables but before builtin functions.
const GLSL_GLOBALS = ['u_time', 'u_resolution'];

type ExprSuggestion = { label: string; insert: string; kind: 'variable' | 'global' | 'function' };

// ── GLSL expression input with inline autocomplete ─────────────────────────
// Used for any freeform GLSL expression field (a line's RHS, the result
// expression) — not the LHS, which is normally just a variable/component
// name. As you type an identifier, matching suggestions appear as a chip row
// below the field, ranked local variables first (this block's declared
// inputs), then the couple of always-available globals, then builtin
// functions from GLSL_PALETTE; tapping one replaces the partial word with
// the full snippet and drops the cursor inside its parens (functions) or
// right after (variables/globals), ready to keep typing.
function GlslExprInput({ value, onChange, placeholder, style, variables = [] }: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style: React.CSSProperties;
  variables?: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const matches = useMemo<ExprSuggestion[]>(() => {
    if (query.length === 0) return [];
    const q = query.toLowerCase();
    const varMatches: ExprSuggestion[] = variables
      .filter(v => v.toLowerCase().startsWith(q))
      .map(v => ({ label: v, insert: v, kind: 'variable' }));
    const globalMatches: ExprSuggestion[] = GLSL_GLOBALS
      .filter(v => v.toLowerCase().startsWith(q))
      .map(v => ({ label: v, insert: v, kind: 'global' }));
    // GLSL_PALETTE's Constants group also lists u_time (for desktop's insert
    // palette) — skip it here since GLSL_GLOBALS already covers it, ranked
    // higher, and we don't want the same chip appearing twice.
    const fnMatches: ExprSuggestion[] = GLSL_PALETTE
      .filter(e => e.label.toLowerCase().startsWith(q) && !GLSL_GLOBALS.includes(e.label))
      .map(e => ({ label: e.label, insert: e.insert, kind: 'function' }));
    return [...varMatches, ...globalMatches, ...fnMatches].slice(0, 8);
  }, [query, variables]);

  const syncQueryFromCaret = (el: HTMLInputElement) => {
    const cursor = el.selectionStart ?? el.value.length;
    setQuery(wordBeforeCursor(el.value, cursor).word);
  };

  const applySuggestion = (insert: string) => {
    const el = inputRef.current;
    const cursor = el?.selectionStart ?? value.length;
    const { start } = wordBeforeCursor(value, cursor);
    const before = value.slice(0, start);
    const after = value.slice(cursor);
    const next = before + insert + after;
    onChange(next);
    setOpen(false);
    setQuery('');
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      const parenIdx = insert.indexOf('(');
      const caret = before.length + (parenIdx >= 0 ? parenIdx + 1 : insert.length);
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div style={{ position: 'relative', flex: (style as { flex?: number | string }).flex, minWidth: 0 }}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={e => { onChange(e.target.value); syncQueryFromCaret(e.target); }}
        onFocus={e => { syncQueryFromCaret(e.target); setOpen(true); }}
        onKeyUp={e => syncQueryFromCaret(e.currentTarget)}
        onClick={e => syncQueryFromCaret(e.currentTarget)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        style={{ ...style, width: '100%' }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, marginTop: '4px', zIndex: 30,
          display: 'flex', gap: '4px', overflowX: 'auto', background: '#11111b',
          border: '1px solid #45475a', borderRadius: '6px', padding: '4px',
        }}>
          {matches.map(m => (
            <button
              key={`${m.kind}:${m.label}`}
              onMouseDown={e => e.preventDefault()}
              onClick={() => applySuggestion(m.insert)}
              style={{
                flexShrink: 0, background: '#313244', border: '1px solid #45475a', borderRadius: '4px',
                padding: '4px 8px', fontSize: '11px', fontFamily: 'monospace',
                color: m.kind === 'variable' ? '#89b4fa' : m.kind === 'global' ? '#cba6f7' : '#a6e3a1',
                cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap',
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reorderable GLSL line list (drag handle, press-and-drag) ───────────────
// A dedicated component (not a helper function) so its drag-state hooks obey
// the rules of hooks regardless of how the parent conditionally renders it.
// Dragging works by pointer capture on the handle: as the pointer crosses a
// neighboring row's midpoint, that row swaps position in the array (and the
// drag continues from there) — the row you're holding is translateY'd to
// visually track the pointer between swaps.
function ExprLinesList({ lines, onReorder, onUpdateLine, onRemoveLine, variables }: {
  lines: ExprLine[];
  onReorder: (next: ExprLine[]) => void;
  onUpdateLine: (idx: number, field: keyof ExprLine, value: string) => void;
  onRemoveLine: (idx: number) => void;
  variables: string[];
}) {
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [drag, setDrag] = useState<{ index: number; startY: number; currentY: number } | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  const handlePointerDown = (index: number, e: React.PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ index, startY: e.clientY, currentY: e.clientY });
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!drag) return;
    const currentY = e.clientY;
    const rows = rowRefs.current;
    let targetIndex = drag.index;
    for (let i = 0; i < rows.length; i++) {
      const el = rows[i];
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (currentY < rect.top + rect.height / 2) { targetIndex = i; break; }
      targetIndex = i;
    }
    if (targetIndex !== drag.index) {
      onReorder(moveItem(lines, drag.index, targetIndex));
      setDrag({ index: targetIndex, startY: currentY, currentY });
    } else {
      setDrag(d => (d ? { ...d, currentY } : d));
    }
  };
  const endDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDrag(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {lines.map((line, i) => {
        const isDragging = drag?.index === i;
        return (
          <div
            key={i}
            ref={el => { rowRefs.current[i] = el; }}
            onFocus={() => setFocusedIdx(i)}
            onBlur={() => setFocusedIdx(null)}
            style={{
              ...exprCardStyle(focusedIdx === i),
              position: 'relative',
              transform: isDragging ? `translateY(${drag!.currentY - drag!.startY}px)` : undefined,
              zIndex: isDragging ? 10 : undefined,
              boxShadow: isDragging ? '0 6px 16px rgba(0,0,0,0.5)' : undefined,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                onPointerDown={e => handlePointerDown(i, e)}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                style={{ background: 'none', border: 'none', color: '#6c7086', fontSize: '16px', lineHeight: 1, cursor: 'grab', padding: '4px', touchAction: 'none' }}
                title="Drag to reorder"
              >☰</button>
              <span style={{ fontSize: '10px', color: '#585b70', flex: 1 }}>Line {i + 1}</span>
              <button
                onClick={() => onRemoveLine(i)}
                style={{ background: 'none', border: 'none', color: '#f38ba8', fontSize: '16px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                title="Remove line"
              >✕</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input type="text" value={line.lhs} onChange={e => onUpdateLine(i, 'lhs', e.target.value)} placeholder="p.xy" style={{ ...exprTextInputStyle, width: '64px' }} />
              <select value={line.op} onChange={e => onUpdateLine(i, 'op', e.target.value)} style={exprSelectStyle}>
                {EXPR_OPS.map(op => <option key={op} value={op}>{op}</option>)}
              </select>
              <GlslExprInput
                value={line.rhs}
                onChange={v => onUpdateLine(i, 'rhs', v)}
                placeholder="expression…"
                style={{ ...exprTextInputStyle, flex: 1, color: '#a6e3a1' }}
                variables={variables}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MobileGraphBrowser() {
  const nodes = useNodeGraphStore(s => s.nodes);
  const connectNodes = useNodeGraphStore(s => s.connectNodes);
  const disconnectInput = useNodeGraphStore(s => s.disconnectInput);
  const removeNode = useNodeGraphStore(s => s.removeNode);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);

  const [focusStack, setFocusStack] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingSocket | null>(null);
  const [connectPicker, setConnectPicker] = useState<PendingSocket | null>(null);
  const [homeGraphView, setHomeGraphView] = useState(false);
  // The graph diagram is reachable from anywhere (not just Home) via the
  // breadcrumb's "⋈ Graph" button — at Home it toggles the list/graph view
  // in place (homeGraphView above); inside a node it opens this overlay
  // instead, highlighting the current node, so you can jump straight to any
  // other node without walking back up the drill-down stack.
  const [showGraphOverlay, setShowGraphOverlay] = useState(false);
  // Expr Block nodes have their own two-mode editor (Inputs / Output); it
  // always opens on Inputs, the same as a freshly-added block would. Reset
  // during render (not an effect) when focus moves to a different node —
  // React's documented pattern for "adjust state when a prop changes".
  const [exprMode, setExprMode] = useState<'inputs' | 'output'>('inputs');
  const [exprModeFor, setExprModeFor] = useState<string | undefined>(undefined);
  // Which Expr Block input card currently has focus, for the thin highlight
  // stroke — cleared naturally by the row's onBlur, not reset elsewhere.
  const [focusedInputIdx, setFocusedInputIdx] = useState<number | null>(null);
  // Generic node detail: whether the Inputs/Outputs column is expanded —
  // each collapses independently by tapping its own header. Reset open on
  // every node change (below), same as exprMode.
  const [nodeSectionsOpen, setNodeSectionsOpen] = useState({ inputs: true, outputs: true });

  const focusedId = focusStack[focusStack.length - 1];
  const focusedNode = focusedId ? nodes.find(n => n.id === focusedId) : undefined;

  if (exprModeFor !== focusedId) {
    setExprModeFor(focusedId);
    setExprMode('inputs');
    setNodeSectionsOpen({ inputs: true, outputs: true });
  }

  // Same rank assignment the desktop "Auto Layout" button uses for spatial
  // x position — reused here as row index, so a node's row in this grid
  // always matches the column it would land in on the canvas.
  const rankedRows = useMemo(() => groupNodesByRank(nodes), [nodes]);

  const pushFocus = (id: string) => setFocusStack(stack => [...stack, id]);
  const jumpTo = (index: number) => setFocusStack(stack => stack.slice(0, index + 1));
  const goHome = () => setFocusStack([]);

  const downstreamConsumers = (nodeId: string, outputKey: string) =>
    nodes.filter(n => Object.values(n.inputs).some(inp => inp.connection?.nodeId === nodeId && inp.connection.outputKey === outputKey));

  const labelFor = (n: GraphNode) => getNodeDefinition(n.type)?.label ?? n.type;

  const handleNodePlacedForInput = (newId: string, socket: Extract<PendingSocket, { dir: 'input' }>) => {
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newId);
    if (!newNode) return;
    const outKey = firstCompatibleOutputKey(newNode, socket.type);
    if (outKey) connectNodes(newId, outKey, socket.nodeId, socket.key);
    pushFocus(newId);
  };

  const handleNodePlacedForOutput = (newId: string, socket: Extract<PendingSocket, { dir: 'output' }>) => {
    const newNode = useNodeGraphStore.getState().nodes.find(n => n.id === newId);
    if (!newNode) return;
    const inKey = firstCompatibleInputKey(newNode, socket.type);
    if (inKey) connectNodes(socket.nodeId, socket.key, newId, inKey);
    pushFocus(newId);
  };

  // ── Connect-existing candidate list ──────────────────────────────────────
  const connectCandidates = useMemo(() => {
    if (!connectPicker) return [];
    if (connectPicker.dir === 'input') {
      // picking a node whose OUTPUT will feed this input
      return nodes.filter(n =>
        n.id !== connectPicker.nodeId &&
        Object.values(n.outputs).some(o => typesCompatible(o.type, connectPicker.type)) &&
        !wouldCreateCycle(nodes, n.id, connectPicker.nodeId),
      );
    }
    // picking a node whose INPUT will consume this output
    return nodes.filter(n =>
      n.id !== connectPicker.nodeId &&
      Object.values(n.inputs).some(i => typesCompatible(connectPicker.type, i.type)) &&
      !wouldCreateCycle(nodes, connectPicker.nodeId, n.id),
    );
  }, [connectPicker, nodes]);

  const commitConnectExisting = (otherId: string) => {
    if (!connectPicker) return;
    const other = nodes.find(n => n.id === otherId);
    if (!other) return;
    if (connectPicker.dir === 'input') {
      const outKey = firstCompatibleOutputKey(other, connectPicker.type);
      if (outKey) connectNodes(otherId, outKey, connectPicker.nodeId, connectPicker.key);
    } else {
      const inKey = firstCompatibleInputKey(other, connectPicker.type);
      if (inKey) connectNodes(connectPicker.nodeId, connectPicker.key, otherId, inKey);
    }
    setConnectPicker(null);
    pushFocus(otherId);
  };

  // ── Node detail (focused) view ───────────────────────────────────────────
  function renderNodeDetail(node: GraphNode) {
    const def = getNodeDefinition(node.type);
    const hasInputs = Object.keys(node.inputs).length > 0;
    const hasOutputs = Object.keys(node.outputs).length > 0;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Header — the one fixed element as you scroll the cards below, so
            it's styled brighter than everything else to anchor "what node
            am I in" at a glance. */}
        <div style={{ padding: '12px', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '8px', background: '#242438' }}>
          <div style={dotStyle(nodeDotColor(node))} />
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#ffffff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(node)}</div>
          <NodePreviewThumb key={node.id} nodeId={node.id} nodeType={node.type} />
          {node.type !== 'output' && focusStack.length > 0 && (
            <button
              onClick={() => { removeNode(node.id); setFocusStack(stack => stack.slice(0, -1)); }}
              style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
            >
              Remove
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            {hasInputs && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <button style={sectionHeaderBtnStyle} onClick={() => setNodeSectionsOpen(s => ({ ...s, inputs: !s.inputs }))}>
                  <span>{nodeSectionsOpen.inputs ? '▾' : '▸'} INPUTS</span>
                </button>
                {nodeSectionsOpen.inputs && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {Object.entries(node.inputs).map(([key, inp]) => {
                      const upstream = inp.connection ? nodes.find(n => n.id === inp.connection!.nodeId) : undefined;
                      const pd = upstream ? undefined : sliderableParam(node, key);
                      const val = pd ? currentSliderValue(node, key, pd) : 0;
                      return (
                        <div key={key} style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <TypeIcon type={inp.type} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inp.label}</div>
                          </div>
                          {upstream ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <button style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px' }} onClick={() => pushFocus(upstream.id)}>{labelFor(upstream)} ›</button>
                              <button
                                onClick={() => disconnectInput(node.id, key)}
                                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', cursor: 'pointer', padding: '2px', touchAction: 'manipulation' }}
                                title="Disconnect"
                              >✕</button>
                            </div>
                          ) : (
                            <button style={smallIconBtnStyle('#89b4fa')} title="Wire this input" onClick={() => setPending({ dir: 'input', nodeId: node.id, key, type: inp.type })}>+</button>
                          )}
                          {pd && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <input
                                type="range"
                                min={pd.min ?? 0}
                                max={pd.max ?? 1}
                                step={pd.step ?? 0.01}
                                value={val}
                                onChange={e => updateNodeParams(node.id, { [key]: parseFloat(e.target.value) })}
                                style={{ flex: 1 }}
                              />
                              <span style={{ fontSize: '10px', color: '#a6adc8', minWidth: '38px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                {formatSliderValue(val, pd.step)}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {hasOutputs && (
              <div style={{ flex: 1, minWidth: 0 }}>
                <button style={sectionHeaderBtnStyle} onClick={() => setNodeSectionsOpen(s => ({ ...s, outputs: !s.outputs }))}>
                  <span>{nodeSectionsOpen.outputs ? '▾' : '▸'} OUTPUTS</span>
                </button>
                {nodeSectionsOpen.outputs && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                    {Object.entries(node.outputs).map(([key, out]) => {
                      const consumers = downstreamConsumers(node.id, key);
                      return (
                        <div key={key} style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <TypeIcon type={out.type} />
                            <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out.label}</div>
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
                            {consumers.map(c => (
                              <button key={c.id} style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px' }} onClick={() => pushFocus(c.id)}>{labelFor(c)} ›</button>
                            ))}
                            <button style={smallIconBtnStyle('#89b4fa')} title="Add a consumer for this output" onClick={() => setPending({ dir: 'output', nodeId: node.id, key, type: out.type })}>+</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {def?.description && (
            <div style={{ fontSize: '11px', color: '#585b70', lineHeight: 1.5 }}>{def.description}</div>
          )}
        </div>

        {renderSocketOverlays(node)}
      </div>
    );
  }

  // ── Socket-wiring overlays shared by every node detail view (generic and
  // Expr Block alike) — the "feed this input / consume this output" action
  // sheet, the "Add New Node" search palette, and the tap-to-connect graph
  // picker. Each is keyed off `pending`/`connectPicker.nodeId === node.id`.
  function renderSocketOverlays(node: GraphNode) {
    return (
      <>
        {/* Add New / Connect Existing action sheet */}
        {pending && pending.nodeId === node.id && (
          <div
            onClick={() => setPending(null)}
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 40, display: 'flex', alignItems: 'flex-end' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: '100%', background: '#1e1e2e', borderRadius: '16px 16px 0 0', border: '1px solid #45475a', padding: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa', marginBottom: '12px' }}>
                {pending.dir === 'input' ? 'Feed this input' : 'Consume this output'}
              </div>
              <button
                style={{ width: '100%', padding: '12px', marginBottom: '8px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => { setConnectPicker(pending); setPending(null); }}
              >
                Connect Existing Node
              </button>
              <button
                style={{ width: '100%', padding: '12px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => {
                  const socket = pending;
                  setPending({ ...socket, key: `__search__${socket.key}` });
                }}
              >
                Add New Node
              </button>
            </div>
          </div>
        )}

        {/* NodeSearchPalette for "Add New Node" */}
        {pending && pending.nodeId === node.id && pending.key.startsWith('__search__') && (
          <NodeSearchPalette
            open
            onClose={() => setPending(null)}
            filterOutputType={pending.dir === 'input' ? pending.type : undefined}
            filterInputType={pending.dir === 'output' ? pending.type : undefined}
            onNodePlaced={(newId) => {
              const socket = { ...pending, key: pending.key.replace('__search__', '') } as PendingSocket;
              if (socket.dir === 'input') handleNodePlacedForInput(newId, socket as Extract<PendingSocket, { dir: 'input' }>);
              else handleNodePlacedForOutput(newId, socket as Extract<PendingSocket, { dir: 'output' }>);
              setPending(null);
            }}
          />
        )}

        {/* Connect Existing picker — the graph diagram with the current node
            highlighted; tap any highlighted (compatible) node to wire it up. */}
        {connectPicker && connectPicker.nodeId === node.id && (
          <div style={{ position: 'absolute', inset: 0, background: '#181825', zIndex: 40, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa' }}>Tap a node to connect</div>
                {connectCandidates.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#585b70', marginTop: '2px' }}>No compatible nodes yet — try "Add New Node" instead.</div>
                )}
              </div>
              <button
                onClick={() => setConnectPicker(null)}
                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '18px', lineHeight: 1, cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                title="Cancel"
              >✕</button>
            </div>
            {renderConnectGraphPicker()}
          </div>
        )}
      </>
    );
  }

  // ── Expr Block detail view ───────────────────────────────────────────────
  // Two modes instead of the generic input/output list: "Inputs" (add/remove
  // inputs and wire them — no inline sliders, connections only) and "Output"
  // (the GLSL line editor, reorderable, plus the result expression and the
  // node's single `result` output socket). A freshly-added block opens on
  // Inputs, matching how you'd build one up: declare what feeds in, then
  // write the code that uses it.
  function renderExprBlockDetail(node: GraphNode) {
    const customInputs = (node.params.inputs as ExprInputDef[] | undefined) ?? [];
    const lines = (node.params.lines as ExprLine[] | undefined) ?? [];
    const result = (node.params.result as string | undefined) ?? 'p';
    const outputType = (node.params.outputType as DataType | undefined) ?? 'float';
    const outSocket = node.outputs.result;
    const outType: DataType = outSocket?.type ?? outputType;
    const consumers = downstreamConsumers(node.id, 'result');

    const setInputs = (next: ExprInputDef[]) => {
      updateNodeParams(node.id, { inputs: next });
      updateNodeSockets(node.id, next, outputType);
    };
    const addInput = () => setInputs([...customInputs, { name: `in${customInputs.length}`, type: 'float', slider: null }]);
    const removeInput = (idx: number) => setInputs(customInputs.filter((_, i) => i !== idx));
    const renameInput = (idx: number, name: string) => setInputs(customInputs.map((c, i) => i === idx ? { ...c, name } : c));
    const retypeInput = (idx: number, type: DataType) => setInputs(customInputs.map((c, i) => i === idx ? { ...c, type } : c));
    const changeOutputType = (type: DataType) => {
      updateNodeParams(node.id, { outputType: type });
      updateNodeSockets(node.id, customInputs, type);
    };

    const addLine = () => updateNodeParams(node.id, { lines: [...lines, { lhs: 'p', op: '=', rhs: '' }] });
    const removeLine = (idx: number) => updateNodeParams(node.id, { lines: lines.filter((_, i) => i !== idx) });
    const updateLine = (idx: number, field: keyof ExprLine, value: string) =>
      updateNodeParams(node.id, { lines: lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) });
    const setLines = (next: ExprLine[]) => updateNodeParams(node.id, { lines: next });
    const updateResult = (value: string) => updateNodeParams(node.id, { result: value });

    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{ padding: '12px', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '8px', background: '#242438' }}>
          <div style={dotStyle(nodeDotColor(node))} />
          <div style={{ fontWeight: 700, fontSize: '16px', color: '#ffffff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(node)}</div>
          <NodePreviewThumb key={node.id} nodeId={node.id} nodeType={node.type} />
          <button
            onClick={() => { removeNode(node.id); setFocusStack(stack => stack.slice(0, -1)); }}
            style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
          >
            Remove
          </button>
        </div>

        <div style={{ display: 'flex', gap: '6px', padding: '8px 12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          {(['inputs', 'output'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setExprMode(mode)}
              style={{
                flex: 1, padding: '8px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                background: exprMode === mode ? '#313244' : 'none',
                border: exprMode === mode ? '1px solid #89b4fa' : '1px solid #45475a',
                color: exprMode === mode ? '#89b4fa' : '#6c7086',
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              {mode === 'inputs' ? 'Inputs' : 'Output'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {exprMode === 'inputs' ? (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {customInputs.length === 0 && (
                <div style={{ fontSize: '12px', color: '#585b70' }}>No inputs yet — add one below.</div>
              )}
              {customInputs.map((inp, idx) => {
                const socket = node.inputs[inp.name];
                const upstream = socket?.connection ? nodes.find(n => n.id === socket.connection!.nodeId) : undefined;
                return (
                  <div
                    key={idx}
                    onFocus={() => setFocusedInputIdx(idx)}
                    onBlur={() => setFocusedInputIdx(null)}
                    style={exprCardStyle(focusedInputIdx === idx)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <div style={dotStyle(TYPE_COLORS[inp.type] ?? '#888')} />
                      <input
                        type="text"
                        value={inp.name}
                        onChange={e => renameInput(idx, e.target.value)}
                        placeholder="name"
                        style={{ ...exprTextInputStyle, width: '92px', flexShrink: 0 }}
                      />
                      <select value={inp.type} onChange={e => retypeInput(idx, e.target.value as DataType)} style={exprSelectStyle}>
                        {EXPR_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginLeft: 'auto' }}>
                        {!upstream && (
                          <button style={smallIconBtnStyle('#89b4fa')} title="Wire this input" onClick={() => setPending({ dir: 'input', nodeId: node.id, key: inp.name, type: inp.type })}>+</button>
                        )}
                        <button style={smallIconBtnStyle('#f38ba8')} title="Remove input" onClick={() => removeInput(idx)}>✕</button>
                      </div>
                    </div>
                    {upstream && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '18px' }}>
                        <button style={chipStyle} onClick={() => pushFocus(upstream.id)}>{labelFor(upstream)} ›</button>
                        <button
                          onClick={() => disconnectInput(node.id, inp.name)}
                          style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '14px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
                          title="Disconnect"
                        >✕</button>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                onClick={addInput}
                style={{ alignSelf: 'flex-start', background: '#a6e3a111', border: '1px solid #a6e3a133', color: '#a6e3a1', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
              >
                + Add Input
              </button>
            </div>
          ) : (
            <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>OUTPUT TYPE</div>
                <select value={outputType} onChange={e => changeOutputType(e.target.value as DataType)} style={{ ...exprSelectStyle, width: '100%' }}>
                  {EXPR_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>LINES</div>
                {lines.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#45475a', fontFamily: 'monospace', marginBottom: '8px' }}>No lines yet.</div>
                )}
                <ExprLinesList lines={lines} onReorder={setLines} onUpdateLine={updateLine} onRemoveLine={removeLine} variables={customInputs.map(i => i.name)} />
                <button
                  onClick={addLine}
                  style={{ marginTop: '8px', background: '#a6e3a111', border: '1px solid #a6e3a133', color: '#a6e3a1', borderRadius: '6px', padding: '8px 12px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
                >
                  + Add Line
                </button>
              </div>

              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>RESULT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', color: '#6c7086', fontFamily: 'monospace' }}>return</span>
                  <GlslExprInput value={result} onChange={updateResult} placeholder="p" style={{ ...exprTextInputStyle, flex: 1, color: '#89b4fa' }} variables={customInputs.map(i => i.name)} />
                </div>
              </div>

              <div style={{ borderTop: '1px solid #313244', paddingTop: '10px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>OUTPUT</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={dotStyle(TYPE_COLORS[outType] ?? '#888')} />
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: '#cdd6f4' }}>Result</div>
                    <div style={{ fontSize: '10px', color: '#585b70' }}>{outType}</div>
                  </div>
                  <button style={addBtnStyle} title="Add a consumer for this output" onClick={() => setPending({ dir: 'output', nodeId: node.id, key: 'result', type: outType })}>+</button>
                  {consumers.length > 0 && (
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', width: '100%', paddingLeft: '18px' }}>
                      {consumers.map(c => (
                        <button key={c.id} style={chipStyle} onClick={() => pushFocus(c.id)}>{labelFor(c)} ›</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {renderSocketOverlays(node)}
      </div>
    );
  }

  // ── Connect-existing graph picker ────────────────────────────────────────
  // Same node positions as the Home graph view, but every node is shown (not
  // just candidates) so the current node's highlight makes sense in context;
  // compatible nodes are tappable and outlined, everything else is dimmed.
  function renderConnectGraphPicker() {
    if (!connectPicker) return null;
    const layout = computeGraphLayout(nodes, rankedRows);
    const candidateIds = new Set(connectCandidates.map(c => c.id));
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            <GraphEdges edges={layout.edges} />
          </svg>
          {nodes.map(n => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            const isCurrent = n.id === connectPicker.nodeId;
            const isCandidate = candidateIds.has(n.id);
            return (
              <button
                key={n.id}
                disabled={!isCandidate}
                onClick={() => commitConnectExisting(n.id)}
                style={{
                  position: 'absolute', left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
                  display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden',
                  background: isCurrent ? '#313244' : '#1e1e2e',
                  border: isCurrent ? '2px solid #89b4fa' : isCandidate ? '1px solid #a6e3a1' : '1px solid #313244',
                  borderRadius: '6px', padding: '0 8px', fontSize: '11px',
                  color: isCandidate || isCurrent ? '#cdd6f4' : '#45475a',
                  opacity: isCandidate || isCurrent ? 1 : 0.4,
                  cursor: isCandidate ? 'pointer' : 'default', touchAction: 'manipulation',
                }}
              >
                <div style={dotStyle(nodeDotColor(n))} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Graph navigator overlay ───────────────────────────────────────────────
  // Reachable from the breadcrumb's "⋈ Graph" button while inside any node
  // (not just Home) — same diagram as the Home graph view, but the currently
  // focused node is highlighted, and tapping any node teleports straight to
  // it (resets the drill-down stack to just that node) rather than requiring
  // you to walk back up through Home first.
  function renderGraphNavigatorOverlay() {
    if (!showGraphOverlay) return null;
    const layout = computeGraphLayout(nodes, rankedRows);
    return (
      <div style={{ position: 'absolute', inset: 0, background: '#181825', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          <div style={{ flex: 1, fontSize: '13px', fontWeight: 700, color: '#89b4fa' }}>Tap a node to jump there</div>
          <button
            onClick={() => setShowGraphOverlay(false)}
            style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '18px', lineHeight: 1, cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
            title="Close"
          >✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
            <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              <GraphEdges edges={layout.edges} />
            </svg>
            {nodes.map(n => {
              const p = layout.pos.get(n.id);
              if (!p) return null;
              const isCurrent = n.id === focusedId;
              return (
                <button
                  key={n.id}
                  onClick={() => { setFocusStack([n.id]); setShowGraphOverlay(false); }}
                  style={{
                    position: 'absolute', left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
                    display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden',
                    background: isCurrent ? '#313244' : '#1e1e2e',
                    border: isCurrent ? '2px solid #89b4fa' : '1px solid #313244',
                    borderRadius: '6px', padding: '0 8px', fontSize: '11px', color: '#cdd6f4',
                    cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >
                  <div style={dotStyle(nodeDotColor(n))} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ── Home view: graph-shape grid ──────────────────────────────────────────
  // Rows = rank (left-to-right depth in the node editor, top-to-bottom
  // here); cells within a row = sibling nodes at that same depth. Same
  // ranking the desktop "Auto Layout" button uses, so this grid always
  // matches that arrangement.
  function renderHome() {
    if (nodes.length === 0) {
      return <div style={{ flex: 1, padding: '16px 12px', fontSize: '12px', color: '#585b70' }}>No nodes yet.</div>;
    }
    return (
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        {rankedRows.map(({ rank, nodes: rowNodes }) => (
          <div key={rank} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #24243a' }}>
            <div style={{ width: '14px', flexShrink: 0, fontSize: '10px', color: '#45475a', paddingTop: '9px', textAlign: 'right' }}>{rank}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
              {rowNodes.map(n => (
                <button
                  key={n.id}
                  onClick={() => pushFocus(n.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px',
                    padding: '8px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
                  }}
                >
                  <div style={dotStyle(nodeDotColor(n))} />
                  {labelFor(n)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Home view: graph diagram ─────────────────────────────────────────────
  // Same rank/row data as the grid above, laid out as fixed-position chips
  // with actual connector lines drawn between them — a read-only "see the
  // flow" view, not a spatial editor (tap a chip to drill in, same as the
  // grid; no dragging). Source rank is always strictly less than target rank
  // (that's what the BFS rank assignment guarantees), so every edge flows
  // top-to-bottom or skips rows entirely — never sideways or backwards.
  function renderHomeGraph() {
    if (nodes.length === 0) {
      return <div style={{ flex: 1, padding: '16px 12px', fontSize: '12px', color: '#585b70' }}>No nodes yet.</div>;
    }
    const layout = computeGraphLayout(nodes, rankedRows);
    return (
      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
          <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
            <GraphEdges edges={layout.edges} />
          </svg>
          {nodes.map(n => {
            const p = layout.pos.get(n.id);
            if (!p) return null;
            return (
              <button
                key={n.id}
                onClick={() => pushFocus(n.id)}
                style={{
                  position: 'absolute', left: p.x, top: p.y, width: GRAPH_NODE_W, height: GRAPH_NODE_H,
                  display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden',
                  background: '#1e1e2e', border: '1px solid #313244', borderRadius: '6px',
                  padding: '0 8px', fontSize: '11px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation',
                }}
              >
                <div style={dotStyle(nodeDotColor(n))} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: '#181825', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      {/* Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', borderBottom: '1px solid #313244', overflowX: 'auto', flexShrink: 0 }}>
        <button onClick={goHome} style={{ background: 'none', border: 'none', color: focusStack.length === 0 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}>
          Home
        </button>
        {focusStack.map((id, i) => {
          const n = nodes.find(nn => nn.id === id);
          if (!n) return null;
          return (
            <span key={id} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
              <button
                onClick={() => jumpTo(i)}
                style={{ background: 'none', border: 'none', color: i === focusStack.length - 1 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
              >
                {labelFor(n)}
              </button>
            </span>
          );
        })}
        <button
          onClick={() => (focusedNode ? setShowGraphOverlay(true) : setHomeGraphView(v => !v))}
          style={{
            marginLeft: 'auto', flexShrink: 0,
            background: !focusedNode && homeGraphView ? '#313244' : 'none', border: '1px solid #45475a', color: '#89b4fa',
            borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation',
          }}
          title="See the flow as a connected graph"
        >
          {!focusedNode && homeGraphView ? '☰ List' : '⋈ Graph'}
        </button>
      </div>

      {focusedNode
        ? (focusedNode.type === 'exprNode' ? renderExprBlockDetail(focusedNode) : renderNodeDetail(focusedNode))
        : (homeGraphView ? renderHomeGraph() : renderHome())}

      {renderGraphNavigatorOverlay()}
    </div>
  );
}
