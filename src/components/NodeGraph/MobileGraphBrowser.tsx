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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNodeGraphStore, getActiveNodes, getActiveLooseGroups } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import { GROUP_PORT_SENTINEL } from '../../types/nodeGraph';
import type { GraphNode, DataType, LooseGroup } from '../../types/nodeGraph';
import { TYPE_COLORS } from './typeColors';
import { NodeSearchPalette } from './NodeSearchPalette';
import { NodeInlineViz, INLINE_VIZ_TYPES } from './NodeInlineViz';
import { compileNodePreviewShader } from '../../lib/compileNodePreviewShader';
import { nodePreviewRenderer } from '../../lib/nodePreviewRenderer';
import { typesCompatible } from '../../lib/typesCompatible';
import { groupNodesByRank, computeNodeRanks } from '../../store/graphLayout';
import { moveItem } from '../../lib/reorder';
import { GLSL_PALETTE } from '../../lib/glslPalette';
import { loadImageTextureFromFile } from '../../lib/loadImageTexture';
import {
  VECTOR_AXES, EASING_PRESETS, socketHasKeyframes, socketHasVectorKeyframes,
  getKeyframeConfig, getAxisKeyframeConfig,
} from '../../compiler/keyframes';
import type { Keyframe, KeyframeEasing, KeyframeLoopMode } from '../../compiler/keyframes';

function nodeDotColor(n: GraphNode): string {
  if (n.type === 'output') return '#a6e3a1';
  // Groups get their own color rather than their first output's type color —
  // a group's output type is often incidental (whatever its last-added port
  // happens to be), and the point of the dot here is "this is a group, a
  // subgraph," not "this outputs a vec3." Same mauve used everywhere else
  // this session for group-related UI (⛓ port chips, Folder rows, etc).
  if (GROUP_TYPES.has(n.type)) return '#cba6f7';
  const outType = Object.values(n.outputs)[0]?.type;
  return TYPE_COLORS[outType ?? 'float'] ?? '#888';
}

// A custom name (desktop's "Rename Group", also usable on customFn nodes)
// overrides the type's default label — same node.params.label convention
// and fallback order NodeComponent.tsx uses, so a group renamed on either
// platform shows the same name on the other. Pure function of `n`, hoisted
// out of the component so MobileNodeGraphOverlay (a separate exported
// component) can use it too.
function labelFor(n: GraphNode): string {
  return (typeof n.params.label === 'string' && n.params.label) || getNodeDefinition(n.type)?.label || n.type;
}

// Node types that collapse a subgraph — same set NodeGraph.tsx's context
// menu checks (isGroup/isSceneGroup/isSpaceWarpGroup/isMarchLoopGroup) to
// decide whether "Enter Group" applies. Only plain 'group' supports
// rename/ungroup — the others (3D scene building blocks) have fixed
// semantics and are created/removed as a unit, same restriction desktop
// applies in NodeGraph.tsx's context menu.
const GROUP_TYPES = new Set(['group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup', 'giLitMarchGroup']);

// Node types with no meaningful assign operator — same exclusion list
// desktop's NodeComponent.tsx uses (an anchor/loop-machinery node's output
// isn't something you'd accumulate into).
const ASSIGN_OP_EXCLUDED = new Set(['output', 'vec4Output', 'loopIndex', 'loopCarry', 'group']);

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
function selectableParam(node: GraphNode, key: string) {
  const def = getNodeDefinition(node.type);
  const pd = def?.paramDefs?.[key];
  if (!pd || pd.type !== 'select') return undefined;
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

// ── "Real" (desktop canvas) layout — read-only mirror ──────────────────────
// Unlike computeGraphLayout's synthetic rank grid, this places every node at
// its actual node.position (the same spatial arrangement the desktop canvas
// shows), so the two apps' mental picture of "where things are" matches.
// Horizontal flow (desktop wires run left-socket-to-right-socket), so edges
// use a horizontal bezier — computeGraphLayout's GraphEdges is vertical and
// wouldn't read correctly here.
function computeRealLayout(nodes: GraphNode[]) {
  const pos = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return { pos, width: 0, height: 0, edges: [] as ReturnType<typeof computeGraphLayout>['edges'] };
  const xs = nodes.map(n => n.position.x);
  const ys = nodes.map(n => n.position.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  for (const n of nodes) pos.set(n.id, { x: n.position.x - minX + GRAPH_PAD, y: n.position.y - minY + GRAPH_PAD });
  const width = Math.max(...xs) - minX + GRAPH_NODE_W + GRAPH_PAD * 2;
  const height = Math.max(...ys) - minY + GRAPH_NODE_H + GRAPH_PAD * 2;

  const edges: ReturnType<typeof computeGraphLayout>['edges'] = [];
  for (const n of nodes) {
    const to = pos.get(n.id);
    if (!to) continue;
    for (const [key, inp] of Object.entries(n.inputs)) {
      if (!inp.connection) continue;
      const from = pos.get(inp.connection.nodeId);
      if (!from) continue;
      edges.push({
        x1: from.x + GRAPH_NODE_W, y1: from.y + GRAPH_NODE_H / 2,
        x2: to.x, y2: to.y + GRAPH_NODE_H / 2,
        key: `${inp.connection.nodeId}:${inp.connection.outputKey}->${n.id}:${key}`,
      });
    }
  }
  return { pos, width, height, edges };
}
function GraphEdgesHorizontal({ edges }: { edges: ReturnType<typeof computeGraphLayout>['edges'] }) {
  return (
    <>
      {edges.map(e => {
        const midX = (e.x1 + e.x2) / 2;
        return (
          <path
            key={e.key}
            d={`M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`}
            stroke="#585b70" strokeWidth={1.5} fill="none"
          />
        );
      })}
    </>
  );
}

// ── Read-only node-graph overlay (floats on the shader canvas) ─────────────
// Unlike computeRealLayout (used by the Graph view's "Real" mode, still an
// abstract rank-grid-style chip just positioned at real coordinates), this
// lays out compact but recognizable node cards — a title bar plus per-socket
// port dots on the left/right edges, same visual language desktop's canvas
// uses, just condensed (no sliders/params inside the box) — with edges
// running dot-to-dot instead of box-center-to-box-center.
const OVERLAY_CARD_W = 132, OVERLAY_TITLE_H = 22, OVERLAY_PORT_ROW_H = 14, OVERLAY_PAD = 28;
interface OverlayPort { key: string; type: DataType; label: string; y: number }
interface OverlayNodeLayout { x: number; y: number; w: number; h: number; inputs: OverlayPort[]; outputs: OverlayPort[] }
function computeOverlayLayout(nodes: GraphNode[]) {
  const layouts = new Map<string, OverlayNodeLayout>();
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number; key: string; type: DataType }> = [];
  if (nodes.length === 0) return { layouts, width: 0, height: 0, edges };

  const xs = nodes.map(n => n.position.x);
  const ys = nodes.map(n => n.position.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  for (const n of nodes) {
    const inputs: OverlayPort[] = Object.entries(n.inputs).map(([key, inp], i) => ({
      key, type: inp.type, label: inp.label, y: OVERLAY_TITLE_H + i * OVERLAY_PORT_ROW_H + OVERLAY_PORT_ROW_H / 2,
    }));
    const outputs: OverlayPort[] = Object.entries(n.outputs).map(([key, out], i) => ({
      key, type: out.type, label: out.label, y: OVERLAY_TITLE_H + i * OVERLAY_PORT_ROW_H + OVERLAY_PORT_ROW_H / 2,
    }));
    const rows = Math.max(inputs.length, outputs.length, 1);
    layouts.set(n.id, {
      x: n.position.x - minX + OVERLAY_PAD,
      y: n.position.y - minY + OVERLAY_PAD,
      w: OVERLAY_CARD_W,
      h: OVERLAY_TITLE_H + rows * OVERLAY_PORT_ROW_H,
      inputs, outputs,
    });
  }
  let maxX = 0, maxY = 0;
  for (const l of layouts.values()) { maxX = Math.max(maxX, l.x + l.w); maxY = Math.max(maxY, l.y + l.h); }

  for (const n of nodes) {
    const to = layouts.get(n.id);
    if (!to) continue;
    for (const [key, inp] of Object.entries(n.inputs)) {
      if (!inp.connection) continue;
      const from = layouts.get(inp.connection.nodeId);
      if (!from) continue;
      const toPort = to.inputs.find(p => p.key === key);
      const fromPort = from.outputs.find(p => p.key === inp.connection!.outputKey);
      if (!toPort || !fromPort) continue;
      edges.push({
        x1: from.x + from.w, y1: from.y + fromPort.y,
        x2: to.x, y2: to.y + toPort.y,
        key: `${inp.connection.nodeId}:${inp.connection.outputKey}->${n.id}:${key}`,
        type: inp.type,
      });
    }
  }
  return { layouts, width: maxX + OVERLAY_PAD, height: maxY + OVERLAY_PAD, edges };
}

/**
 * Floats on top of the live shader preview (rendered by App.tsx inside the
 * canvas pane's own relative wrapper), toggled by a button next to the
 * play/pause controls — a read-only mirror of the desktop canvas's actual
 * spatial layout, not the drill-down browser's abstract rank grid. Purely a
 * visual reference for "what does this look like as a real node graph while
 * I watch the render" — no drag, no wiring, no tap-to-navigate; List/Graph
 * already own navigation. Self-contained (reads straight from the store)
 * rather than taking nodes as a prop, since it renders as a sibling of
 * MobileGraphBrowser, not a child of it.
 */
export function MobileNodeGraphOverlay() {
  const open = useNodeGraphStore(s => s.mobileNodeOverlayOpen);
  const setOpen = useNodeGraphStore(s => s.setMobileNodeOverlayOpen);
  const topLevelNodes = useNodeGraphStore(s => s.nodes);
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const nodes = useMemo(
    () => getActiveNodes(topLevelNodes, activeGroupPath) ?? topLevelNodes,
    [topLevelNodes, activeGroupPath],
  );
  const layout = useMemo(() => computeOverlayLayout(nodes), [nodes]);
  if (!open) return null;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 19,
      background: 'rgba(17,17,27,0.74)', backdropFilter: 'blur(1px)', WebkitBackdropFilter: 'blur(1px)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', flexShrink: 0 }}>
        <span style={{ fontSize: '10px', fontWeight: 700, color: '#89b4fa', letterSpacing: '0.06em' }}>
          NODE GRAPH{activeGroupPath.length > 0 ? ' — inside group' : ''} · read-only
        </span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: 'rgba(24,24,37,0.8)', border: '1px solid #45475a', color: '#a6adc8', borderRadius: '5px', width: '22px', height: '22px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
        >✕</button>
      </div>
      {nodes.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: '#585b70' }}>No nodes yet.</div>
      ) : (
        <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
            <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              {layout.edges.map(e => {
                const midX = (e.x1 + e.x2) / 2;
                return (
                  <path
                    key={e.key}
                    d={`M ${e.x1} ${e.y1} C ${midX} ${e.y1}, ${midX} ${e.y2}, ${e.x2} ${e.y2}`}
                    stroke={TYPE_COLORS[e.type] ?? '#585b70'} strokeWidth={1.5} fill="none" opacity={0.85}
                  />
                );
              })}
            </svg>
            {nodes.map(n => {
              const l = layout.layouts.get(n.id);
              if (!l) return null;
              const hasPorts = l.inputs.length > 0 || l.outputs.length > 0;
              return (
                <div
                  key={n.id}
                  style={{
                    position: 'absolute', left: l.x, top: l.y, width: l.w, height: l.h,
                    background: 'rgba(30,30,46,0.92)', border: '1px solid #45475a', borderRadius: '6px',
                  }}
                >
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '5px', height: OVERLAY_TITLE_H, padding: '0 8px',
                    borderBottom: hasPorts ? '1px solid #313244' : 'none', overflow: 'hidden',
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: '50%', background: nodeDotColor(n), flexShrink: 0 }} />
                    <span style={{ fontSize: '10px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(n)}</span>
                  </div>
                  {l.inputs.map(p => (
                    <div
                      key={`i-${p.key}`} title={p.label}
                      style={{
                        position: 'absolute', left: -4, top: p.y - 4, width: 8, height: 8, borderRadius: '50%',
                        background: TYPE_COLORS[p.type] ?? '#888', border: '1px solid #11111b',
                      }}
                    />
                  ))}
                  {l.outputs.map(p => (
                    <div
                      key={`o-${p.key}`} title={p.label}
                      style={{
                        position: 'absolute', right: -4, top: p.y - 4, width: 8, height: 8, borderRadius: '50%',
                        background: TYPE_COLORS[p.type] ?? '#888', border: '1px solid #11111b',
                      }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Where a loose group's folder row should sit among the plain rank rows in
// Home's list: strictly after every node OUTSIDE the group that feeds one of
// its members (never rendered "above" — i.e. earlier in the list than —
// something it's connected to), and otherwise at its most-upstream member's
// own rank. Rank strictly increases along an edge (computeNodeRanks), so an
// external feeder's rank is always < the member it feeds; using the highest
// such feeder + 1 is enough to guarantee the group comes after all of them,
// direct or indirect.
function computeGroupRank(group: LooseGroup, nodes: GraphNode[], nodeRanks: Map<string, number>): number {
  const memberSet = new Set(group.memberIds);
  let maxExternalFeederRank = -1;
  for (const n of nodes) {
    if (!memberSet.has(n.id)) continue;
    for (const input of Object.values(n.inputs)) {
      const srcId = input.connection?.nodeId;
      if (srcId && !memberSet.has(srcId)) {
        const r = nodeRanks.get(srcId) ?? 0;
        if (r > maxExternalFeederRank) maxExternalFeederRank = r;
      }
    }
  }
  if (maxExternalFeederRank >= 0) return maxExternalFeederRank + 1;
  let minMemberRank = Infinity;
  for (const id of group.memberIds) {
    const r = nodeRanks.get(id);
    if (r != null && r < minMemberRank) minMemberRank = r;
  }
  return minMemberRank === Infinity ? 0 : minMemberRank;
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
// Back/forward buttons in the node header — dims and becomes inert (but
// stays in the layout, so the header doesn't jump) when there's nowhere to go.
const navBtnStyle = (enabled: boolean): React.CSSProperties => ({
  flexShrink: 0, background: 'none', border: 'none', color: enabled ? '#89b4fa' : '#3a3a52',
  width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontSize: '17px', lineHeight: 1, cursor: enabled ? 'pointer' : 'default', touchAction: 'manipulation',
});

// ── Socket type icon ─────────────────────────────────────────────────────────
// Used in the node detail view's Inputs/Outputs cards in place of a plain
// color dot: floats get a "#", vectors get their component letters in
// brackets ("[XY]", "[XYZ]", "[XYZW]") with each letter in its own axis
// color, so a socket's shape is readable at a glance instead of just its
// color. Anything else (bool, sampler2D, mat3, …) falls back to the dot.
const AXIS_COLORS: Record<string, string> = { x: '#f38ba8', y: '#a6e3a1', z: '#89b4fa', w: '#cba6f7' };
const ICON_VECTOR_AXES: Record<string, string[]> = { vec2: ['x', 'y'], vec3: ['x', 'y', 'z'], vec4: ['x', 'y', 'z', 'w'] };
function TypeIcon({ type }: { type: string }) {
  if (type === 'float' || type === 'int') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '20px', flexShrink: 0, fontFamily: 'monospace', fontWeight: 700, fontSize: '12px', color: TYPE_COLORS[type] ?? '#888' }}>
        #
      </span>
    );
  }
  const axes = ICON_VECTOR_AXES[type];
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
// ── Inline-viz frame ─────────────────────────────────────────────────────
// NodeInlineViz's ~50 canvases each hardcode their own CSS pixel height
// (36/64/100/...) alongside width:'100%' — sized for desktop's roughly-
// 240px-wide node card, where the aspect ratio comes out close enough to
// each canvas's own backing resolution. Mobile's Info tab is a different,
// wider width that doesn't match any single one of those, so stretching
// them all to it distorts anything not authored wide-and-short (a square
// vector-field grid comes out squashed). Rather than touching ~50 draw
// functions in a file shared with desktop, this reads the actual canvas's
// backing resolution after it mounts — that ratio IS the visualization's
// real intended shape — and sizes this wrapper to match via CSS
// aspect-ratio, overriding the canvas's own fixed height to fill it
// exactly instead of clipping or stretching to the author's original px
// guess. Callers should pass `key={node.id}` so switching nodes remeasures
// fresh rather than reusing a stale ratio.
function InlineVizFrame({ node }: { node: GraphNode }) {
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const canvas = frame?.querySelector('canvas');
    if (!frame || !canvas || !canvas.width || !canvas.height) return;
    frame.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
    canvas.style.height = '100%';
  });
  return (
    // No padding — the aspect-ratio computed above is measured against this
    // box's own border box, so any padding would shrink the content area
    // the canvas actually fills (100% of the *content* box) below what the
    // ratio assumed, squishing it and clipping whatever sits near the
    // canvas's own bottom/right edge. Desktop's own wrapper (VIZ_CONTAINER
    // in NodeInlineViz.tsx) is padding-free for the same reason.
    // Full card width, not an arbitrary cap — it's collapsed behind the
    // VISUAL toggle until you actually want it, so there's no ambient cost
    // to letting a visualization that wants more room (a square field, a
    // taller grid) actually take it; maxHeight is just a safety net against
    // an extreme ratio blowing past a reasonable share of the viewport.
    <div
      ref={frameRef}
      style={{
        background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px',
        overflow: 'hidden', width: '100%', maxHeight: '60vh',
      }}
    >
      <NodeInlineViz node={node} />
    </div>
  );
}
// Node types with no meaningful rendered preview — a terminal sink, a raw
// scope probe, or a type that isn't really "a shader" on its own. Same
// list desktop's own SKIP_PREVIEW (NodeComponent.tsx) excludes from its
// 👁 in-card preview for the same reason.
const SKIP_INLINE_PREVIEW = new Set(['output', 'vec4Output', 'scope', 'textureInput', 'audioInput', 'transformVec', 'videoInput']);
// ── Generic live-render fallback ─────────────────────────────────────────
// For the ~75% of node types with no custom NodeInlineViz entry, this is
// the same fallback desktop uses (NodeComponent.tsx's own isPreviewActive
// branch): an actual rendered shader thumbnail, walking the node's
// upstream ancestors into a self-contained shader (compileNodePreviewShader)
// and rendering it on a shared offscreen-WebGL singleton
// (nodePreviewRenderer). A static snapshot, not a live loop — recomputed
// when the focused node changes, not every frame; INLINE_VIZ_TYPES types
// get true live reactivity from their own canvas draw; this is "show
// something correct" for everything else, same tradeoff desktop makes.
function GenericPreviewViz({ node, nodes }: { node: GraphNode; nodes: GraphNode[] }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    // `nodes` must already be the caller's active scope (getActiveNodes at
    // its activeGroupPath) — a node's upstream ancestors only ever live in
    // that same scope, since subgraphs are self-contained.
    const fs = compileNodePreviewShader(node.id, nodes);
    if (!fs) { setUrl(null); return; }
    let cancelled = false;
    const time = useNodeGraphStore.getState().currentTime ?? 0;
    nodePreviewRenderer.renderNodePreview(node.id, fs, { u_time: { value: time } }, 256)
      .then(dataUrl => { if (!cancelled) setUrl(dataUrl); })
      .catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, node.type]);

  if (!url) return null;
  return (
    <div style={{ width: '100%', aspectRatio: '1', borderRadius: '8px', overflow: 'hidden', border: '1px solid #313244', background: '#11111b' }}>
      <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
    </div>
  );
}
// Tappable, collapsible column header ("▾ INPUTS" / "▸ OUTPUTS").
const sectionHeaderBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '4px', width: '100%',
  background: 'none', border: 'none', padding: '4px 2px',
  fontSize: '11px', fontWeight: 700, color: '#7d8296', letterSpacing: '0.05em',
  cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
};
// Small pill tab, e.g. the Info/Comment toggle under a node's cards.
const smallTabBtnStyle = (active: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 700,
  background: active ? '#313244' : 'none',
  border: active ? '1px solid #89b4fa' : '1px solid #45475a',
  color: active ? '#89b4fa' : '#6c7086',
  cursor: 'pointer', touchAction: 'manipulation',
});

// ── Keyframe canvas editor ──────────────────────────────────────────────────
// Mirrors desktop's Select/Add/Delete/Draw mode toolbar (KeyframeEditorModal.
// tsx) on a plain <canvas> with pointer events instead of mouse-only drag.
// Two simplifications versus desktop, both deliberate for a first mobile
// pass: the view always auto-fits the current keyframes (no manual pan/
// zoom), and easing is chosen from EASING_PRESETS per keyframe instead of
// dragging bezier handles — same underlying Keyframe.ease data either way,
// so desktop can still fine-tune a curve mobile only roughed in.

// Same segment construction + local-time formula as generateKeyframeGLSL
// (compiler/keyframes.ts), evaluated in JS instead of emitted as GLSL, purely
// to draw the preview curve here — the real shader evaluation is fully
// GPU-side and untouched. Kept in lockstep by hand since there's no shared
// source between the two; if that GLSL codegen changes, update this too.
function kfCubicBezierJS(x: number, a: number, b: number, c: number, d: number): number {
  const A = 1 - 3 * c + 3 * a, B = 3 * c - 6 * a, C = 3 * a;
  let t = Math.max(0, Math.min(1, x));
  for (let i = 0; i < 5; i++) {
    const cx = A * t * t * t + B * t * t + C * t;
    const slope = 1 / (3 * A * t * t + 2 * B * t + C);
    t -= (cx - x) * slope;
    t = Math.max(0, Math.min(1, t));
  }
  const E = 1 - 3 * d + 3 * b, F = 3 * d - 6 * b, G = 3 * b;
  return E * t * t * t + F * t * t + G * t;
}
function evalKeyframeCurve(
  keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number, offset: number, loopCount: number | null, t: number,
): number {
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].v;
  const t0 = keyframes[0].t + offset;
  const duration = Math.max(keyframes[keyframes.length - 1].t - keyframes[0].t, 0.0001);
  type Seg = { start: number; end: number; v0: number; v1: number; ease: KeyframeEasing };
  const segs: Seg[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i], b = keyframes[i + 1];
    segs.push({ start: a.t - keyframes[0].t, end: b.t - keyframes[0].t, v0: a.v, v1: b.v, ease: a.ease });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: duration, end: duration + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease });
  }
  const loopSpan = mode === 'interpolate' ? duration + loopBack : duration;
  let lt: number;
  if (mode === 'once') {
    lt = Math.max(0, Math.min(t - t0, duration));
  } else if (loopCount != null) {
    lt = (t - t0) >= loopCount * loopSpan ? loopSpan : (((t - t0) % loopSpan) + loopSpan) % loopSpan;
  } else {
    lt = (((t - t0) % loopSpan) + loopSpan) % loopSpan;
  }
  for (const seg of segs) {
    if (lt < seg.end) {
      const segDur = Math.max(seg.end - seg.start, 0.0001);
      const st = Math.max(0, Math.min(1, (lt - seg.start) / segDur));
      return seg.v0 + (seg.v1 - seg.v0) * kfCubicBezierJS(st, seg.ease.a, seg.ease.b, seg.ease.c, seg.ease.d);
    }
  }
  return segs[segs.length - 1]?.v1 ?? keyframes[keyframes.length - 1].v;
}
// Draw mode: the recorded path (many samples) is reduced to at most 8
// evenly-spaced points with linear easing, same cap and approach desktop's
// downsamplePath uses — GLSL codegen unrolls one if/else branch per segment,
// so an unbounded point count isn't just a UI concern.
function downsampleDrawPath(path: Array<{ t: number; v: number }>): Keyframe[] {
  if (path.length === 0) return [];
  const MAX_POINTS = 8;
  const picked = path.length <= MAX_POINTS
    ? path
    : Array.from({ length: MAX_POINTS }, (_, i) => path[Math.round((i / (MAX_POINTS - 1)) * (path.length - 1))]);
  const out: Keyframe[] = [];
  for (const p of picked) {
    const t = out.length > 0 && p.t <= out[out.length - 1].t ? out[out.length - 1].t + 0.001 : p.t;
    out.push({ t, v: p.v, ease: EASING_PRESETS.linear });
  }
  return out;
}

const KF_PAD = { l: 34, r: 10, t: 10, b: 20 };
const KF_HIT_PX = 20;
const KF_HANDLE_R = 6;
const KF_HANDLE_HIT_PX = 16;
// The snap grid a dragged keyframe's time gravitates toward once it's close
// (aim-assist, not a hard quantize) — half-second increments, same idea as
// desktop's grid snap but always-on and pixel-distance-based rather than a
// modifier key, since there's no keyboard to hold shift with on mobile.
const KF_TIME_SNAP = 0.5;
const KF_TIME_SNAP_PX = 8;
type KfTool = 'select' | 'add' | 'delete' | 'draw';
type KfDrag =
  | { kind: 'move'; index: number }
  | { kind: 'handle'; segIndex: number; which: 'p1' | 'p2' }
  | { kind: 'draw'; path: Array<{ t: number; v: number }> };

// A segment the curve is made of, including the synthetic loop-back segment
// in 'interpolate' mode — mirrors buildSegments in desktop's
// KeyframeEditorModal.tsx exactly (absolute keyframe .t, not shifted to the
// first keyframe like the GLSL-runtime/evalKeyframeCurve convention) so a
// segment's on-canvas position always matches where its keyframes were
// clicked. kfIndex is the keyframe that "owns" this segment's easing.
interface KfSeg { start: number; end: number; v0: number; v1: number; ease: KeyframeEasing; kfIndex: number }
function buildKfSegs(keyframes: Keyframe[], mode: KeyframeLoopMode, loopBack: number): KfSeg[] {
  if (keyframes.length < 2) return [];
  const segs: KfSeg[] = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    segs.push({ start: keyframes[i].t, end: keyframes[i + 1].t, v0: keyframes[i].v, v1: keyframes[i + 1].v, ease: keyframes[i].ease, kfIndex: i });
  }
  if (mode === 'interpolate') {
    const last = keyframes[keyframes.length - 1];
    segs.push({ start: last.t, end: last.t + loopBack, v0: last.v, v1: keyframes[0].v, ease: last.ease, kfIndex: keyframes.length - 1 });
  }
  return segs;
}
function isLinearEase(e: KeyframeEasing): boolean {
  return e.a === 0 && e.b === 0 && e.c === 1 && e.d === 1;
}
// Default for a freshly-curved segment — handles start spread apart (30%/70%
// along the segment) rather than sharing an x-position. CSS's own 'ease'
// preset (EASING_PRESETS.ease) has a === c === 0.25, so both handles sit at
// the same horizontal spot and visually overlap, especially on a short
// segment — not the "coming out at an angle" default that's easy to grab.
const KF_DEFAULT_BEZIER: KeyframeEasing = { a: 0.3, b: 0.0, c: 0.7, d: 1.0 };

function KeyframeCanvasEditor({ keyframes, mode, loopBack, offset, loopCount, valueMin, valueMax, tool, onChange, selectedIndex, onSelect }: {
  keyframes: Keyframe[];
  mode: KeyframeLoopMode;
  loopBack: number;
  offset: number;
  loopCount: number | null;
  valueMin: number;
  valueMax: number;
  tool: KfTool;
  onChange: (next: Keyframe[]) => void;
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 220 });
  const dragRef = useRef<KfDrag | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) setSize({ width: box.width, height: 220 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxT = Math.max(5, ...keyframes.map(k => k.t)) + 1;
  const minT = 0;
  const vSpan = valueMax - valueMin || 1;
  const segs = useMemo(() => buildKfSegs(keyframes, mode, loopBack), [keyframes, mode, loopBack]);
  const easeEditSeg = selectedIndex != null ? (segs.find(s => s.kfIndex === selectedIndex) ?? null) : null;
  const showHandles = easeEditSeg != null && !isLinearEase(easeEditSeg.ease);

  const toX = (t: number) => KF_PAD.l + ((t - minT) / (maxT - minT)) * (size.width - KF_PAD.l - KF_PAD.r);
  const toY = (v: number) => KF_PAD.t + (1 - (v - valueMin) / vSpan) * (size.height - KF_PAD.t - KF_PAD.b);
  const fromX = (x: number) => minT + ((x - KF_PAD.l) / (size.width - KF_PAD.l - KF_PAD.r)) * (maxT - minT);
  const fromY = (y: number) => valueMax - ((y - KF_PAD.t) / (size.height - KF_PAD.t - KF_PAD.b)) * vSpan;
  // Aim-assist: free while dragging, but gravitates to the nearest half-second
  // once the pointer is within a few pixels of it — no keyboard to hold a
  // modifier for a hard snap, so this is always-on instead.
  const snapT = (t: number): number => {
    const grid = Math.round(t / KF_TIME_SNAP) * KF_TIME_SNAP;
    return Math.abs(toX(grid) - toX(t)) < KF_TIME_SNAP_PX ? grid : t;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.strokeStyle = '#24243a';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#585b70';
    ctx.font = '9px monospace';
    const gridStep = Math.max(1, Math.round(maxT / 8));
    for (let gt = 0; gt <= maxT; gt += gridStep) {
      const x = toX(gt);
      ctx.beginPath(); ctx.moveTo(x, KF_PAD.t); ctx.lineTo(x, size.height - KF_PAD.b); ctx.stroke();
      ctx.fillText(`${gt}s`, x - 6, size.height - 6);
    }
    ctx.fillText(valueMax.toFixed(1), 2, toY(valueMax) + 8);
    ctx.fillText(valueMin.toFixed(1), 2, toY(valueMin));

    if (keyframes.length > 0) {
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const steps = 120;
      for (let i = 0; i <= steps; i++) {
        const t = minT + (i / steps) * (maxT - minT);
        const v = Math.max(valueMin, Math.min(valueMax, evalKeyframeCurve(keyframes, mode, loopBack, offset, loopCount, t)));
        const x = toX(t), y = toY(v);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Bezier handles for the selected keyframe's outgoing segment — only
    // once it's actually curved (Linear has nothing to drag). Mirrors
    // desktop's KeyframeEditorModal handle rendering, mapped into this
    // segment's own time/value span rather than the full 0..1 canvas.
    if (showHandles && easeEditSeg) {
      const seg = easeEditSeg;
      const segToX = (localT: number) => toX(seg.start + localT * (seg.end - seg.start));
      const segToY = (localV01: number) => toY(seg.v0 + localV01 * (seg.v1 - seg.v0));
      const p0x = segToX(0), p0y = segToY(0), p3x = segToX(1), p3y = segToY(1);
      const p1x = segToX(seg.ease.a), p1y = segToY(seg.ease.b);
      const p2x = segToX(seg.ease.c), p2y = segToY(seg.ease.d);
      ctx.strokeStyle = '#f38ba888'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.stroke();
      ctx.strokeStyle = '#89b4fa88';
      ctx.beginPath(); ctx.moveTo(p3x, p3y); ctx.lineTo(p2x, p2y); ctx.stroke();
      [[p1x, p1y, '#f38ba8'], [p2x, p2y, '#89b4fa']].forEach(([hx, hy, color]) => {
        ctx.fillStyle = color as string;
        ctx.strokeStyle = '#11111b'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(hx as number, hy as number, KF_HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      });
    }

    keyframes.forEach((kf, i) => {
      const x = toX(kf.t), y = toY(kf.v);
      const isSelected = i === selectedIndex;
      ctx.beginPath();
      ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? '#f9e2af' : '#fab387';
      ctx.fill();
      ctx.strokeStyle = '#181825';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframes, mode, loopBack, offset, loopCount, valueMin, valueMax, selectedIndex, size, maxT, showHandles, easeEditSeg]);

  const hitTest = (x: number, y: number): number | null => {
    let best: number | null = null, bestDist = KF_HIT_PX;
    keyframes.forEach((kf, i) => {
      const d = Math.hypot(toX(kf.t) - x, toY(kf.v) - y);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  };
  const hitTestHandle = (x: number, y: number): 'p1' | 'p2' | null => {
    if (!showHandles || !easeEditSeg) return null;
    const seg = easeEditSeg;
    const segToX = (localT: number) => toX(seg.start + localT * (seg.end - seg.start));
    const segToY = (localV01: number) => toY(seg.v0 + localV01 * (seg.v1 - seg.v0));
    const p1 = { x: segToX(seg.ease.a), y: segToY(seg.ease.b) };
    const p2 = { x: segToX(seg.ease.c), y: segToY(seg.ease.d) };
    if (Math.hypot(x - p1.x, y - p1.y) <= KF_HANDLE_HIT_PX) return 'p1';
    if (Math.hypot(x - p2.x, y - p2.y) <= KF_HANDLE_HIT_PX) return 'p2';
    return null;
  };
  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const clampV = (v: number) => Math.max(valueMin, Math.min(valueMax, v));
  const clampT = (t: number) => Math.max(0, t);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = pointerPos(e);
    if (tool === 'select') {
      const h = hitTestHandle(x, y);
      if (h && easeEditSeg) { dragRef.current = { kind: 'handle', segIndex: easeEditSeg.kfIndex, which: h }; return; }
    }
    const hit = hitTest(x, y);
    if (tool === 'delete') {
      if (hit != null) { onChange(keyframes.filter((_, i) => i !== hit)); onSelect(null); }
      return;
    }
    if (tool === 'draw') {
      dragRef.current = { kind: 'draw', path: [{ t: clampT(fromX(x)), v: clampV(fromY(y)) }] };
      return;
    }
    if (hit != null) {
      onSelect(hit);
      dragRef.current = { kind: 'move', index: hit };
      return;
    }
    if (tool === 'add') {
      const t = clampT(snapT(fromX(x))), v = clampV(fromY(y));
      const fresh = { t, v, ease: KF_DEFAULT_BEZIER };
      const next = [...keyframes, fresh].sort((a, b) => a.t - b.t);
      onChange(next);
      onSelect(next.indexOf(fresh));
      dragRef.current = { kind: 'move', index: next.indexOf(fresh) };
    } else {
      onSelect(null);
    }
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = pointerPos(e);
    if (drag.kind === 'draw') {
      const t = clampT(fromX(x)), v = clampV(fromY(y));
      const last = drag.path[drag.path.length - 1];
      if (!last || Math.hypot(toX(t) - toX(last.t), toY(v) - toY(last.v)) > 4) drag.path.push({ t, v });
      return;
    }
    if (drag.kind === 'handle') {
      const seg = segs.find(s => s.kfIndex === drag.segIndex);
      if (!seg) return;
      // Same clamp desktop's handle drag uses: the time-axis component (a/c)
      // can overshoot slightly past the segment's own [0,1] span, but the
      // value-axis component (b/d) stays fully unclamped — that's how you
      // author a bounce/overshoot curve (see kfCubicBezier in keyframes.ts).
      const localT = Math.max(-0.5, Math.min(1.5, (fromX(x) - seg.start) / Math.max(seg.end - seg.start, 0.0001)));
      const vRange = seg.v1 - seg.v0;
      const localV = (fromY(y) - seg.v0) / (Math.abs(vRange) > 1e-6 ? vRange : 1);
      const next = keyframes.map((k, i) => {
        if (i !== seg.kfIndex) return k;
        const ease = { ...k.ease };
        if (drag.which === 'p1') { ease.a = localT; ease.b = localV; } else { ease.c = localT; ease.d = localV; }
        return { ...k, ease };
      });
      onChange(next);
      return;
    }
    const next = keyframes.map((k, i) => i === drag.index ? { ...k, t: clampT(snapT(fromX(x))), v: clampV(fromY(y)) } : k);
    onChange(next);
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === 'draw') {
      onChange(downsampleDrawPath(drag.path));
      onSelect(null);
      return;
    }
    if (drag.kind === 'handle') return;
    const moved = keyframes[drag.index];
    if (!moved) return;
    const sorted = [...keyframes].sort((a, b) => a.t - b.t);
    onChange(sorted);
    onSelect(sorted.indexOf(moved));
  };

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{ display: 'block', borderRadius: '8px', background: '#11111b', border: '1px solid #313244', touchAction: 'none' }}
      />
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
  // Always the flat top-level list — a group's contents live nested in
  // node.params.subgraph.nodes, never in this array. Everything below reads
  // `nodes`, which is the *active* scope instead (topLevelNodes narrowed by
  // activeGroupPath via getActiveNodes) — addNode/updateNodeParams/
  // connectNodes/disconnectInput/removeNode already all key off the store's
  // own activeGroupPath to decide whether to write into a subgraph, so
  // scoping just the read side here is enough to make every existing
  // wiring/edit flow in this file work unchanged one level inside a group.
  const topLevelNodes = useNodeGraphStore(s => s.nodes);
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const enterGroup = useNodeGraphStore(s => s.enterGroup);
  const exitToRoot = useNodeGraphStore(s => s.exitToRoot);
  const exitToDepth = useNodeGraphStore(s => s.exitToDepth);
  const ungroupNode = useNodeGraphStore(s => s.ungroupNode);
  const groupNodes = useNodeGraphStore(s => s.groupNodes);
  const nodes = useMemo(
    () => getActiveNodes(topLevelNodes, activeGroupPath) ?? topLevelNodes,
    [topLevelNodes, activeGroupPath],
  );
  // LooseGroup — a purely visual cluster (no compile effect, no wiring of
  // its own) scoped the same way `nodes` is. Same getActiveNodes-style
  // narrowing, just for the parallel looseGroups field.
  const topLevelLooseGroups = useNodeGraphStore(s => s.looseGroups);
  const createLooseGroup = useNodeGraphStore(s => s.createLooseGroup);
  const ungroupLoose = useNodeGraphStore(s => s.ungroupLoose);
  const toggleLooseGroupCollapsed = useNodeGraphStore(s => s.toggleLooseGroupCollapsed);
  const renameLooseGroup = useNodeGraphStore(s => s.renameLooseGroup);
  const looseGroups = useMemo(
    () => getActiveLooseGroups(topLevelNodes, topLevelLooseGroups, activeGroupPath),
    [topLevelNodes, topLevelLooseGroups, activeGroupPath],
  );
  // The group node whose subgraph is `nodes` — undefined at the top level.
  // Its own .inputs carries each port's live connection (for the "group
  // inputs as a wiring source" picker and the ps_ externally-driven-param
  // greyed-out check), and its id is what addGroupInputWithSource/exposeGroupOutput
  // etc. need as `groupId`.
  const activeGroupId = activeGroupPath[activeGroupPath.length - 1];
  const parentGroupNode = useMemo(() => {
    if (!activeGroupId) return undefined;
    const parentScope = getActiveNodes(topLevelNodes, activeGroupPath.slice(0, -1)) ?? topLevelNodes;
    return parentScope.find(n => n.id === activeGroupId);
  }, [topLevelNodes, activeGroupPath, activeGroupId]);
  const activeGroupInputPorts = (parentGroupNode?.params?.subgraph as { inputPorts?: import('../../types/nodeGraph').GroupInputPort[] } | undefined)?.inputPorts ?? [];
  const addGroupInputWithSource = useNodeGraphStore(s => s.addGroupInputWithSource);
  const exposeGroupOutput = useNodeGraphStore(s => s.exposeGroupOutput);
  const connectNodes = useNodeGraphStore(s => s.connectNodes);
  const disconnectInput = useNodeGraphStore(s => s.disconnectInput);
  const removeNode = useNodeGraphStore(s => s.removeNode);
  const previewNodeId = useNodeGraphStore(s => s.previewNodeId);
  const setPreviewNodeId = useNodeGraphStore(s => s.setPreviewNodeId);
  const toggleBypass = useNodeGraphStore(s => s.toggleBypass);
  const updateNodeParams = useNodeGraphStore(s => s.updateNodeParams);
  const updateNodeSockets = useNodeGraphStore(s => s.updateNodeSockets);
  const setNodeAssignOp = useNodeGraphStore(s => s.setNodeAssignOp);
  const setNodeAssignInit = useNodeGraphStore(s => s.setNodeAssignInit);
  const toggleNodeCarryMode = useNodeGraphStore(s => s.toggleNodeCarryMode);
  const setNodeTexture = useNodeGraphStore(s => s.setNodeTexture);
  const nodeTextures = useNodeGraphStore(s => s.nodeTextures);
  // Cross-cutting with App.tsx's bottom action bar — see the store field's
  // own comment. mobileKeyframeTool is read here to drive the canvas editor
  // and written from the bottom bar's mode buttons, not from this file.
  const mobileKeyframeEditor = useNodeGraphStore(s => s.mobileKeyframeEditor);
  const setMobileKeyframeEditor = useNodeGraphStore(s => s.setMobileKeyframeEditor);
  const mobileKeyframeTool = useNodeGraphStore(s => s.mobileKeyframeTool);
  const setMobileKeyframeTool = useNodeGraphStore(s => s.setMobileKeyframeTool);

  const [focusStack, setFocusStack] = useState<string[]>([]);
  // Redo history for the ‹/› back/forward buttons in the node header — only
  // populated by goBack (what you stepped away from); any fresh navigation
  // (drilling into a new node, jumping via breadcrumb, going Home) discards
  // it, same as a browser tab's forward history after you follow a new link.
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingSocket | null>(null);
  const [connectPicker, setConnectPicker] = useState<PendingSocket | null>(null);
  // Building a brand-new group port from the group's own settings page (its
  // Inputs/Outputs tabs, viewed from outside): 'choose' shows Connect
  // Existing / Add New Node; 'output' resolves entirely inside the
  // subgraph (a new internal node becomes the port's source, so 'addNew'
  // briefly enters the group — returnPath is where to restore to
  // afterward); 'input' resolves entirely in the current/outer scope (the
  // port's outer source), never touching activeGroupPath, and leaves the
  // port unwired internally — same as wiring any other group input later.
  const [groupPortBuilder, setGroupPortBuilder] = useState<null | {
    groupId: string; dir: 'input' | 'output'; returnPath: string[]; stage: 'choose' | 'pickExisting' | 'addNew';
  }>(null);
  // Home's "+ Add Node" FAB — places a freestanding node with no wiring
  // target, into whatever scope Home is currently showing (root or inside
  // a group), same scoping NodeSearchPalette's own addNode() already does.
  const [homeAddNodeOpen, setHomeAddNodeOpen] = useState(false);
  // Long-press context menu on a Home chip — holds the target node's id.
  const [longPressMenuFor, setLongPressMenuFor] = useState<string | null>(null);
  const [homeGraphView, setHomeGraphView] = useState(false);
  // 'rank' is the synthetic BFS-depth grid (computeGraphLayout); 'real' mirrors
  // the desktop canvas's actual spatial layout (computeRealLayout), read-only.
  const [homeGraphLayoutMode, setHomeGraphLayoutMode] = useState<'rank' | 'real'>('rank');
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
  // Generic node detail: Inputs/Outputs as a tab toggle (was a permanent
  // 2-column split — collapsing one side didn't give the other any more
  // room, since both columns still held flex:1 in the same row) so the
  // active side gets the full card width. Reset to 'inputs' on every node
  // change (below), same as exprMode.
  const [nodeTab, setNodeTab] = useState<'inputs' | 'outputs'>('inputs');
  // Double-tapping an input card's label moves it into this collapsed
  // "Hidden" section — declutters a node whose most-visited state is a few
  // sliders among a handful of always-wired, never-touched sockets (UV,
  // Time, ...). Persisted per-node in node.params.__hiddenInputs (read via
  // hiddenInputKeys below) so it survives navigating away and back, not
  // just local view state. Whether that section itself is expanded is
  // local, reset per node same as nodeTab.
  const [hiddenSectionOpen, setHiddenSectionOpen] = useState(false);
  // Info/Comment toggle under a generic node's cards — defaults to Info,
  // reset alongside the other per-node view state below.
  const [infoTab, setInfoTab] = useState<'info' | 'comment' | 'assign'>('info');
  // The Info tab's inline visualization (NodeInlineViz) is collapsed by
  // default — different node types want very different aspect ratios (a
  // wide equation strip vs. a roughly-square vector field), so rather than
  // reserving a fixed chunk of the card for it on every node, it's opt-in:
  // tap to reveal, sized to whatever that specific visualization actually
  // wants (see InlineVizFrame) instead of a one-size-fits-all box that's
  // in the way when you're not looking at it.
  const [vizExpanded, setVizExpanded] = useState(false);
  // Which keyframe point is selected (for the easing-preset picker) — reset
  // whenever the editor's target (node/socket/axis) changes, below.
  const [kfSelectedIndex, setKfSelectedIndex] = useState<number | null>(null);
  const [kfSelectedFor, setKfSelectedFor] = useState<string | undefined>(undefined);
  // Which float input card is expanded — tapping a card's value opens its
  // full controls (numeric entry, custom max, bidirectional) and collapses
  // any other expanded card, since this is a single shared key rather than
  // a per-card boolean. Same __scMax_<key>/__scBidir_<key> node.params keys
  // desktop's own slider config panel uses (NodeComponent.tsx), so a range
  // customized on one platform carries over to the other.
  const [openSliderConfig, setOpenSliderConfig] = useState<string | null>(null);
  // Track which group scope focusStack/forwardStack belong to — crossing a
  // group boundary (entering via "Enter Group", exiting via a breadcrumb
  // tap) drops both, the same way jumping to a totally different node tree
  // should: old focus-stack node ids belong to a scope that's no longer on
  // screen, so re-showing them would either dangle or (worse) coincidentally
  // resolve to a same-id node in the new scope.
  const [groupPathFor, setGroupPathFor] = useState('');
  // Breadcrumb overflow — the drill-down path can get arbitrarily deep, so
  // only the 4 most recent locations show directly; the rest collapse
  // behind a tappable "…" that lists them here instead of forcing a
  // horizontal scroll to find your way back.
  const [showHiddenPath, setShowHiddenPath] = useState(false);
  // See the groupPathFor effect below — set this immediately before an
  // action that changes activeGroupPath to also land on a specific node's
  // detail in that new scope, instead of that scope's Home.
  const pendingFocusAfterScopeChangeRef = useRef<string | null>(null);
  // Inline "Rename Group" field (plain 'group' type only) — desktop uses
  // window.prompt() for this; not reused here since a native prompt is
  // unreliable inside a Tauri webview (same reason Reset's confirm dialog
  // was replaced with an in-app one).
  const [renamingGroupFor, setRenamingGroupFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  // Loose-group multi-select — Home-only, "pick some chips then tap Group"
  // instead of a real canvas drag-select (mobile has no canvas to drag on).
  // Since loose grouping has no ports/type-compatibility to work out
  // (unlike a real Group), any 2+ ids in the current scope are valid — no
  // desktop-side "discover dangling connections" step to mirror here.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [renamingLooseGroupId, setRenamingLooseGroupId] = useState<string | null>(null);
  const [renameLooseGroupValue, setRenameLooseGroupValue] = useState('');

  const focusedId = focusStack[focusStack.length - 1];
  const focusedNode = focusedId ? nodes.find(n => n.id === focusedId) : undefined;

  const groupPathKey = activeGroupPath.join('/');
  if (groupPathFor !== groupPathKey) {
    setGroupPathFor(groupPathKey);
    // Normally landing on this scope's Home ([]) is exactly right — but a
    // couple of actions (viewing a just-exited group's own ports page,
    // returning to a group's card after "Add Output" placed a new internal
    // node) want to change scope AND land on a specific node's detail in
    // the SAME action. Since this reset runs synchronously during render,
    // whoever wants that has to register it in a ref *before* triggering
    // the scope change — setting focusStack directly from their own
    // event handler would just get overwritten by this same reset one
    // render later.
    const pending = pendingFocusAfterScopeChangeRef.current;
    pendingFocusAfterScopeChangeRef.current = null;
    setFocusStack(pending ? [pending] : []);
    setForwardStack([]);
    setSelectMode(false);
    setSelectedIds([]);
  }

  if (exprModeFor !== focusedId) {
    setExprModeFor(focusedId);
    setExprMode('inputs');
    setNodeTab('inputs');
    setHiddenSectionOpen(false);
    setInfoTab('info');
    setOpenSliderConfig(null);
    setVizExpanded(false);
  }
  // mobileKeyframeEditor lives in the store (App.tsx's bottom bar needs it
  // too), so navigating away without hitting "Done" — breadcrumb, back/
  // forward, Home, drilling into a different node — would otherwise leave
  // it set for a node that's no longer on screen: the keyframe tool
  // buttons would keep showing in the bottom bar with nothing under them
  // to act on. Closing it here, keyed off focus rather than any one
  // navigation action, catches every path that leaves this node. A
  // useEffect, not the render-time-adjustment pattern the resets above
  // use — those only touch this component's own local state, but this
  // setter updates a store field App.tsx also renders from, and React
  // disallows updating another component while this one is still rendering.
  useEffect(() => {
    if (!mobileKeyframeEditor) return;
    if (mobileKeyframeEditor.nodeId !== focusedId) { setMobileKeyframeEditor(null); return; }
    // Also covers the socket itself vanishing while still on this node
    // (e.g. its type changed) — same "nothing left to edit" case.
    if (focusedNode && !focusedNode.inputs[mobileKeyframeEditor.socketKey]) setMobileKeyframeEditor(null);
  }, [mobileKeyframeEditor, focusedId, focusedNode, setMobileKeyframeEditor]);
  const kfTargetKey = mobileKeyframeEditor
    ? `${mobileKeyframeEditor.nodeId}:${mobileKeyframeEditor.socketKey}:${mobileKeyframeEditor.axis ?? ''}`
    : undefined;
  if (kfSelectedFor !== kfTargetKey) {
    setKfSelectedFor(kfTargetKey);
    setKfSelectedIndex(null);
  }

  // Same rank assignment the desktop "Auto Layout" button uses for spatial
  // x position — reused here as row index, so a node's row in this grid
  // always matches the column it would land in on the canvas.
  const rankedRows = useMemo(() => groupNodesByRank(nodes), [nodes]);
  const nodeRanks = useMemo(() => computeNodeRanks(nodes), [nodes]);

  // Connector overlay for the Home list (renderHome) — unlike the graph-
  // diagram view (computeGraphLayout), chips here sit in a natural
  // flex-wrap flow with no synthetic coordinates to draw lines from, so
  // this measures actual chip positions via the DOM instead. Declared here
  // (top level) rather than inside renderHome itself since it's a plain
  // helper function called conditionally — hooks can't live inside it.
  const homeContainerRef = useRef<HTMLDivElement>(null);
  const homeChipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Long-press detection for Home's node chips — a ref (not local closures
  // recreated each render) so a re-render mid-press doesn't orphan a
  // pending timer. Keyed by node id: `fired` stays false while the timer is
  // pending, flips true when it fires, and the entry is only deleted once
  // consumed (see longPressWasFired) — touchend/mouseup must NOT clear an
  // already-fired entry, or the click that follows the release would read
  // it as a plain tap and navigate right after opening the menu.
  const longPressRef = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; fired: boolean; x: number; y: number }>>(new Map());
  const [homeEdges, setHomeEdges] = useState<Array<{ x1: number; y1: number; x2: number; y2: number; key: string }>>([]);
  const [homeSvgSize, setHomeSvgSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const container = homeContainerRef.current;
    if (!container) return;
    const remeasure = () => {
      const cRect = container.getBoundingClientRect();
      const points = new Map<string, { cx: number; top: number; bottom: number }>();
      homeChipRefs.current.forEach((el, id) => {
        const r = el.getBoundingClientRect();
        points.set(id, {
          cx: r.left - cRect.left + container.scrollLeft + r.width / 2,
          top: r.top - cRect.top + container.scrollTop,
          bottom: r.top - cRect.top + container.scrollTop + r.height,
        });
      });
      const edges: Array<{ x1: number; y1: number; x2: number; y2: number; key: string }> = [];
      for (const n of nodes) {
        const to = points.get(n.id);
        if (!to) continue;
        for (const [key, inp] of Object.entries(n.inputs)) {
          if (!inp.connection) continue;
          const from = points.get(inp.connection.nodeId);
          if (!from) continue;
          edges.push({
            x1: from.cx, y1: from.bottom,
            x2: to.cx, y2: to.top,
            key: `${inp.connection.nodeId}:${inp.connection.outputKey}->${n.id}:${key}`,
          });
        }
      }
      setHomeEdges(edges);
      setHomeSvgSize({ width: container.scrollWidth, height: container.scrollHeight });
    };
    remeasure();
    // Re-measure on width changes (device rotation, split-view divider drag,
    // a chip's row rewrapping) — the ResizeObserver, not just the effect's
    // own dependency array, is what catches those.
    const ro = new ResizeObserver(remeasure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [nodes, rankedRows, focusedNode, homeGraphView]);

  // Groups are subgraphs, not just nodes with ports — tapping one should
  // drill straight into its contents the same way tapping a folder does,
  // not stop at a ports-only detail card first. enterGroup updates
  // activeGroupPath, which the groupPathFor effect above turns into a
  // focusStack reset on the next render, so this needs no manual reset here.
  // Sealed groups compile as standalone functions and can't be entered, so
  // those still fall through to the normal detail view (it shows the
  // 🔒 banner). viewGroupPorts below is the escape hatch for reaching an
  // *unsealed* group's own ports (to wire something to/from it) without
  // entering it.
  const pushFocus = (id: string) => {
    const target = nodes.find(n => n.id === id);
    if (target && GROUP_TYPES.has(target.type) && !target.sealed) { enterGroup(id); return; }
    setFocusStack(stack => [...stack, id]); setForwardStack([]);
  };
  const viewGroupPorts = (id: string) => { setFocusStack(stack => [...stack, id]); setForwardStack([]); };
  // ── Long-press gesture (Home chips) ──────────────────────────────────────
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 10;
  const longPressStart = (id: string, x: number, y: number, onLongPress: () => void) => {
    const existing = longPressRef.current.get(id);
    if (existing) clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      const entry = longPressRef.current.get(id);
      if (entry) entry.fired = true;
      onLongPress();
    }, LONG_PRESS_MS);
    longPressRef.current.set(id, { timer, fired: false, x, y });
  };
  const longPressMove = (id: string, x: number, y: number) => {
    const entry = longPressRef.current.get(id);
    if (!entry || entry.fired) return;
    if (Math.abs(x - entry.x) > LONG_PRESS_MOVE_TOLERANCE || Math.abs(y - entry.y) > LONG_PRESS_MOVE_TOLERANCE) {
      clearTimeout(entry.timer);
      longPressRef.current.delete(id);
    }
  };
  const longPressClearPending = (id: string) => {
    const entry = longPressRef.current.get(id);
    if (entry && !entry.fired) { clearTimeout(entry.timer); longPressRef.current.delete(id); }
  };
  // Consumed once by the chip's own onClick — true means the long-press
  // already handled this gesture, so the click shouldn't also navigate.
  const longPressWasFired = (id: string): boolean => {
    const entry = longPressRef.current.get(id);
    if (!entry) return false;
    longPressRef.current.delete(id);
    return entry.fired;
  };
  const toggleSelected = (id: string) => setSelectedIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);
  const commitLooseGroup = () => {
    if (selectedIds.length < 2) return;
    createLooseGroup(selectedIds);
    setSelectMode(false);
    setSelectedIds([]);
  };
  // Real group — same compile-affecting groupNodes() desktop's canvas uses,
  // just reached from mobile's select mode instead of a drag-select. Stays
  // on Home afterward (rather than auto-entering the new group) so its chip
  // is visible in context first.
  const commitRealGroup = () => {
    if (selectedIds.length < 1) return;
    groupNodes(selectedIds);
    setSelectMode(false);
    setSelectedIds([]);
  };
  const jumpTo = (index: number) => { setFocusStack(stack => stack.slice(0, index + 1)); setForwardStack([]); };
  // A full, unambiguous reset of the nav stack, not just "exit to root" —
  // clears any in-flight select mode, a leftover breadcrumb popover, and
  // (defensively) any pending post-scope-change focus a paused action might
  // have registered, so Home always lands you on a completely clean state
  // regardless of how deep or mid-action the navigation was.
  const goHome = () => {
    pendingFocusAfterScopeChangeRef.current = null;
    exitToRoot();
    setFocusStack([]);
    setForwardStack([]);
    setSelectMode(false);
    setSelectedIds([]);
    setShowHiddenPath(false);
  };
  // Tapping a group breadcrumb segment for the level you're ALREADY at (its
  // path doesn't change) must still drop back to that group's own Home —
  // the groupPathFor effect only clears focusStack when activeGroupPath
  // itself changes, so relying on it here would leave a deeper focusStack
  // stuck in place when exitToDepth is a no-op on an unchanged path.
  const jumpToGroupDepth = (depth: number) => { exitToDepth(depth); setFocusStack([]); setForwardStack([]); };
  // From inside a group's Home list, tapping its "fixed" Group Inputs/
  // Outputs row steps back out one level and straight onto that group's
  // own card, open to the matching tab — the same ports page reached from
  // outside via its ⚙ icon, just the other direction.
  const viewParentGroupPorts = (tab: 'inputs' | 'outputs') => {
    if (!activeGroupId) return;
    pendingFocusAfterScopeChangeRef.current = activeGroupId;
    setNodeTab(tab);
    exitToDepth(activeGroupPath.length - 1);
  };
  const goBack = () => {
    if (focusStack.length === 0) return;
    setForwardStack(f => [focusStack[focusStack.length - 1], ...f]);
    setFocusStack(stack => stack.slice(0, -1));
  };
  const goForward = () => {
    if (forwardStack.length === 0) return;
    setFocusStack(stack => [...stack, forwardStack[0]]);
    setForwardStack(f => f.slice(1));
  };
  // Jump forward multiple steps at once by tapping a dimmed breadcrumb item
  // (index within forwardStack) — restores everything up to and including
  // that node, keeping whatever's beyond it as the remaining redo history.
  const goForwardTo = (index: number) => {
    setFocusStack(stack => [...stack, ...forwardStack.slice(0, index + 1)]);
    setForwardStack(f => f.slice(index + 1));
  };

  const downstreamConsumers = (nodeId: string, outputKey: string) =>
    nodes.filter(n => Object.values(n.inputs).some(inp => inp.connection?.nodeId === nodeId && inp.connection.outputKey === outputKey));

  // Mobile-only declutter: an input key moved here stays out of the main
  // list until double-tapped again. "__"-prefixed like every other node-
  // level metadata field in this file (__comment, __scMax_<key>, ...), so
  // it round-trips through save/export/import/undo for free, but desktop
  // has no reason to read it — it's not data the shader needs, just which
  // sockets this node's mobile view has tucked away.
  const hiddenInputKeys = (node: GraphNode): string[] =>
    Array.isArray(node.params.__hiddenInputs) ? node.params.__hiddenInputs as string[] : [];
  const toggleHiddenInput = (node: GraphNode, key: string) => {
    const hidden = hiddenInputKeys(node);
    const next = hidden.includes(key) ? hidden.filter(k => k !== key) : [...hidden, key];
    updateNodeParams(node.id, { __hiddenInputs: next }, { immediate: true });
  };

  // addNode() just ran synchronously before either handler below fires (it's
  // the onNodePlaced callback), so the closure's `nodes` can be one render
  // behind — reading fresh from the store is deliberate, not a mistake to
  // "simplify" away. It has to go through the same activeGroupPath scoping
  // as the component's own `nodes`, though: the store's own .nodes is
  // always the flat top-level list, and a node just placed inside a group
  // only exists in its subgraph, not there.
  const getFreshActiveNodes = (): GraphNode[] => {
    const state = useNodeGraphStore.getState();
    return getActiveNodes(state.nodes, state.activeGroupPath) ?? state.nodes;
  };

  const handleNodePlacedForInput = (newId: string, socket: Extract<PendingSocket, { dir: 'input' }>) => {
    const newNode = getFreshActiveNodes().find(n => n.id === newId);
    if (!newNode) return;
    const outKey = firstCompatibleOutputKey(newNode, socket.type);
    if (outKey) connectNodes(newId, outKey, socket.nodeId, socket.key);
    pushFocus(newId);
  };

  const handleNodePlacedForOutput = (newId: string, socket: Extract<PendingSocket, { dir: 'output' }>) => {
    const newNode = getFreshActiveNodes().find(n => n.id === newId);
    if (!newNode) return;
    const inKey = firstCompatibleInputKey(newNode, socket.type);
    if (inKey) connectNodes(socket.nodeId, socket.key, newId, inKey);
    pushFocus(newId);
  };

  // ── Ghost-suggested connection ───────────────────────────────────────────
  // For an unconnected input, the single best already-placed node that
  // could feed it — same typesCompatible() scan connectCandidates below
  // does for the "Connect Existing" picker, just proactive: surfaced right
  // on the input's own row instead of waiting for a "+" tap to discover it
  // exists. An exact-type match always wins over a coerced one (float→vec2,
  // vec3→vec2, ...); among equally-good candidates, first-in-nodes wins —
  // not a meaningful ordering on its own, just a deterministic one so the
  // suggestion doesn't change between renders.
  const bestConnectCandidate = (targetNodeId: string, type: string): { node: GraphNode; outKey: string } | undefined => {
    let best: { node: GraphNode; outKey: string; exact: boolean } | undefined;
    for (const n of nodes) {
      if (n.id === targetNodeId || wouldCreateCycle(nodes, n.id, targetNodeId)) continue;
      const outKey = firstCompatibleOutputKey(n, type);
      if (!outKey) continue;
      const exact = n.outputs[outKey].type === type;
      if (!best || (exact && !best.exact)) best = { node: n, outKey, exact };
    }
    return best;
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

  // Group input ports compatible with what's being wired — only relevant for
  // dir:'input' pickers opened from inside a group. A port already feeding
  // one internal node can be picked again for another (see GROUP_PORT_SENTINEL
  // in shaderAssembler.ts): one port, many internal targets.
  const groupPortCandidates = useMemo(() => {
    if (!connectPicker || connectPicker.dir !== 'input' || !activeGroupId) return [];
    return activeGroupInputPorts.filter(p => typesCompatible(p.type, connectPicker.type));
  }, [connectPicker, activeGroupId, activeGroupInputPorts]);

  const commitConnectToGroupPort = (portKey: string) => {
    if (!connectPicker || !activeGroupId) return;
    connectNodes(GROUP_PORT_SENTINEL, portKey, connectPicker.nodeId, connectPicker.key);
    setConnectPicker(null);
  };

  // ── Group port builder — "+ Add Input"/"+ Add Output" on a group's own
  // settings page. Both end in picking a source node's first output;
  // "Add Output" requires that node to live inside the subgraph (it's what
  // sends data out), "Add Input" requires it to live outside (it's what
  // feeds the port in) — see the state comment above for why only 'output'
  // ever touches activeGroupPath.
  const groupBuilderNode = groupPortBuilder ? nodes.find(n => n.id === groupPortBuilder.groupId) : undefined;
  const groupBuilderSubgraphNodes = (groupBuilderNode?.params?.subgraph as { nodes?: GraphNode[] } | undefined)?.nodes ?? [];
  const startGroupPortAddNew = () => {
    if (!groupPortBuilder) return;
    if (groupPortBuilder.dir === 'output') enterGroup(groupPortBuilder.groupId);
    setGroupPortBuilder(b => b && { ...b, stage: 'addNew' });
  };
  const commitGroupPortFromNode = (sourceId: string, sourceOutKey: string, sourceType: DataType, sourceLabel: string) => {
    if (!groupPortBuilder) return;
    if (groupPortBuilder.dir === 'input') {
      addGroupInputWithSource(groupPortBuilder.groupId, sourceId, sourceOutKey, sourceType, sourceLabel);
    } else {
      exposeGroupOutput(groupPortBuilder.groupId, sourceId, sourceOutKey, sourceType, sourceLabel);
      // Restore the scope "Add New Node" entered — a no-op if we never left
      // (i.e. "Connect Existing" was used instead), in which case the ref
      // below must stay unset: the groupPathFor effect only consumes it on
      // an actual path change, and a no-op exitToDepth never triggers that,
      // so a set-but-never-consumed ref would wrongly apply itself to some
      // unrelated later scope change instead.
      const leftScope = useNodeGraphStore.getState().activeGroupPath.length !== groupPortBuilder.returnPath.length;
      if (leftScope) pendingFocusAfterScopeChangeRef.current = groupPortBuilder.groupId;
      exitToDepth(groupPortBuilder.returnPath.length);
    }
    setGroupPortBuilder(null);
  };
  const handleGroupPortNodePlaced = (newId: string) => {
    if (!groupPortBuilder) return;
    // addNode() (called by NodeSearchPalette just before this fires) is
    // synchronous, but the component's own `nodes` closure is still the
    // snapshot from the render that opened this sheet — one render behind,
    // same reasoning as getFreshActiveNodes' own comment above. That stale
    // read was the actual bug behind "node got added but the port never
    // did": newNode came back undefined, so this bailed out silently before
    // ever calling commitGroupPortFromNode. Always read fresh, regardless
    // of dir — 'output' already entered the group (see
    // startGroupPortAddNew), 'input' never left the outer scope, but
    // getFreshActiveNodes resolves the correct one either way since it
    // reads activeGroupPath fresh from the store too.
    const newNode = getFreshActiveNodes().find(n => n.id === newId);
    if (!newNode) { setGroupPortBuilder(null); return; }
    const outKey = Object.keys(newNode.outputs)[0];
    if (!outKey) { setGroupPortBuilder(null); return; }
    commitGroupPortFromNode(newId, outKey, newNode.outputs[outKey].type, newNode.outputs[outKey].label);
  };

  // ── Shared node-detail header ────────────────────────────────────────────
  // Used by every "inside a node" view (generic, Expr Block, keyframe
  // editor) — the one fixed element as you scroll/edit below it, styled
  // brighter than everything else to anchor "what node am I in" at a
  // glance. Back/forward step through the drill-down history; Remove is
  // hidden for the Output node (which can't be removed), at Home
  // (unreachable here anyway, since this only renders once focused), and
  // for def.anchored node types (ScenePos/SceneOutput/MarchLoopInputs/
  // MarchLoopOutput) when they're the group's own creation-time instance
  // (_groupOriginal) — the structural anchors the specialized 3D scene
  // group types need to exist. Same def.anchored flag NodeComponent.tsx's
  // 🔒 "Anchored — cannot be deleted" indicator uses on desktop, and the
  // same pair of conditions removeNode's store-level guard checks — a
  // plain 'group' never stamps a def.anchored type on its own content, so
  // this only ever hides Remove where the store would no-op anyway.
  function renderNodeHeader(node: GraphNode) {
    const originalLocked = !!node.params?._groupOriginal && !!getNodeDefinition(node.type)?.anchored;
    const canRemove = node.type !== 'output' && focusStack.length > 0 && !originalLocked;
    const isPreviewActive = previewNodeId === node.id;
    const isBypassed = !!node.bypassed;
    // Same exclusion lists and behavior as desktop's own 👁/⊘ header buttons
    // (NodeComponent.tsx) — previewing/bypassing these primitive/passthrough
    // types isn't meaningful, so they're left out there too.
    const canPreview = !['output', 'vec4Output', 'uv', 'time', 'mouse', 'constant'].includes(node.type);
    const canBypass = !['output', 'vec4Output', 'uv', 'pixelUV', 'time', 'mouse', 'constant'].includes(node.type);
    return (
      <div style={{ padding: '12px', borderBottom: '1px solid #313244', display: 'flex', alignItems: 'center', gap: '4px', background: '#242438' }}>
        <button style={navBtnStyle(focusStack.length > 0)} disabled={focusStack.length === 0} title="Back" onClick={goBack}>‹</button>
        <button style={navBtnStyle(forwardStack.length > 0)} disabled={forwardStack.length === 0} title="Forward" onClick={goForward}>›</button>
        <div style={{ ...dotStyle(nodeDotColor(node)), marginLeft: '4px' }} />
        <div style={{ fontWeight: 700, fontSize: '16px', color: '#ffffff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(node)}</div>
        {isBypassed && (
          <span style={{ fontSize: '9px', color: '#f9e2af', letterSpacing: '0.06em', fontWeight: 700, flexShrink: 0 }}>BYPASS</span>
        )}
        {canPreview && (
          <button
            onClick={() => setPreviewNodeId(isPreviewActive ? null : node.id)}
            title={isPreviewActive ? 'Exit preview (restore full graph)' : 'Preview this node in isolation'}
            style={{
              background: isPreviewActive ? '#a6e3a122' : 'none',
              border: `1px solid ${isPreviewActive ? '#a6e3a155' : '#45475a'}`,
              color: isPreviewActive ? '#a6e3a1' : '#585b70',
              borderRadius: '6px', width: '30px', height: '30px', fontSize: '14px', cursor: 'pointer', touchAction: 'manipulation',
            }}
          >
            👁
          </button>
        )}
        {canBypass && (
          <button
            onClick={() => toggleBypass(node.id)}
            title={isBypassed ? 'Enable node (currently bypassed)' : 'Bypass node (pass input through)'}
            style={{
              background: isBypassed ? '#f9e2af22' : 'none',
              border: `1px solid ${isBypassed ? '#f9e2af55' : '#45475a'}`,
              color: isBypassed ? '#f9e2af' : '#585b70',
              borderRadius: '6px', width: '30px', height: '30px', fontSize: '14px', cursor: 'pointer', touchAction: 'manipulation',
            }}
          >
            ⊘
          </button>
        )}
        {canRemove && (
          <button
            onClick={() => { removeNode(node.id); setFocusStack(stack => stack.slice(0, -1)); }}
            style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
          >
            Remove
          </button>
        )}
      </div>
    );
  }

  // ── Texture Input upload — a plain file input, so on iOS this already
  // opens the native Photos/Camera/Files picker with no extra plumbing.
  // Desktop's NodeComponent.tsx has its own equivalent card; this is
  // mobile's, since the generic Inputs/Outputs tabs below have nowhere to
  // put "pick a file" (uv/color/alpha/uv are ordinary sockets and still
  // wire normally through those tabs — only the upload button is special).
  function renderTextureUploadBanner(node: GraphNode) {
    const thumbnailUrl = node.params._thumbnailUrl as string | undefined;
    const hasTexture = !!nodeTextures[node.id];
    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-picking the same file
      if (!file) return;
      loadImageTextureFromFile(file)
        .then(({ texture, thumbnailDataUrl, imageAspect }) => {
          setNodeTexture(node.id, texture);
          updateNodeParams(node.id, { _thumbnailUrl: thumbnailDataUrl, _imageAspect: imageAspect }, { immediate: true });
        })
        .catch(err => console.error('Failed to load texture image:', err));
    };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '10px' }}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="texture" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '6px', border: '1px solid #45475a', flexShrink: 0 }} />
        ) : (
          <div style={{ width: 48, height: 48, background: '#313244', borderRadius: '6px', border: '1px dashed #45475a', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px' }}>🖼</div>
        )}
        <label style={{
          flex: 1, textAlign: 'center', fontSize: '13px', fontWeight: 600, color: '#89b4fa',
          background: '#89b4fa18', border: '1px solid #89b4fa55', borderRadius: '8px', padding: '10px', cursor: 'pointer', touchAction: 'manipulation',
        }}>
          {hasTexture ? 'Change Image' : 'Choose Image'}
          <input type="file" accept="image/*" onChange={handleFile} style={{ display: 'none' }} />
        </label>
      </div>
    );
  }

  // ── Group entry point — "Enter <Group Label> ›" plus, for a plain 'group'
  // (not the fixed-purpose 3D scene group types), rename/ungroup. Sealed
  // groups compile as a standalone function; entering them is blocked by
  // the store itself, so this shows why instead of a button that no-ops.
  function renderGroupBanner(node: GraphNode) {
    const def = getNodeDefinition(node.type);
    const isPlainGroup = node.type === 'group';
    const isRenaming = renamingGroupFor === node.id;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {node.sealed ? (
          <div style={{ fontSize: '11px', color: '#6c7086', background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '10px' }}>
            🔒 Sealed — compiles as a standalone function, contents aren't editable.
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={() => enterGroup(node.id)}
              style={{
                flex: 1, background: '#89b4fa18', border: '1px solid #89b4fa55', color: '#89b4fa',
                borderRadius: '8px', padding: '10px', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              Enter {def?.label ?? 'Group'} ›
            </button>
            {isPlainGroup && (
              <button
                onClick={() => { setRenamingGroupFor(node.id); setRenameValue(labelFor(node)); }}
                title="Rename"
                style={{ background: 'none', border: '1px solid #45475a', color: '#a6adc8', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
              >✎</button>
            )}
          </div>
        )}
        {isPlainGroup && isRenaming && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { updateNodeParams(node.id, { label: renameValue.trim() || undefined }, { immediate: true }); setRenamingGroupFor(null); }
                if (e.key === 'Escape') setRenamingGroupFor(null);
              }}
              style={{ ...exprTextInputStyle, flex: 1 }}
            />
            <button
              onClick={() => { updateNodeParams(node.id, { label: renameValue.trim() || undefined }, { immediate: true }); setRenamingGroupFor(null); }}
              style={{ background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '6px', padding: '0 12px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
            >Save</button>
          </div>
        )}
        {isPlainGroup && !node.sealed && (
          <button
            onClick={() => { ungroupNode(node.id); setFocusStack(stack => stack.slice(0, -1)); }}
            style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '8px', padding: '8px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
          >
            Ungroup
          </button>
        )}
      </div>
    );
  }

  // ── Node detail (focused) view ───────────────────────────────────────────
  function renderNodeDetail(node: GraphNode) {
    const def = getNodeDefinition(node.type);
    // Most sliderable params (Radius, Width/2...) double as declared input
    // sockets, so they're already in node.inputs. Some paramDefs never do —
    // a group's own Iterations (a group's `inputs` is built entirely from
    // its ports/ps_ sockets, never its own type's paramDefs), and select-type
    // params generally (a dropdown like Menger Sponge's Iterations or Mirror
    // Fold's Symmetry isn't a wireable socket on any node type, so it's
    // never declared in def.inputs either) — so they'd otherwise never get a
    // row here at all. Desktop renders every float/int/select paramDef
    // (subject to paramVisible) unconditionally, so this matches that rather
    // than guessing which ones matter.
    const paramOnlyEntries: Array<[string, GraphNode['inputs'][string]]> = Object.entries(def?.paramDefs ?? {})
      .filter(([key, pd]) => !(key in node.inputs) && (pd.type === 'float' || pd.type === 'int' || pd.type === 'select') && paramVisible(node, pd))
      .map(([key, pd]) => [key, { type: 'float', label: pd.label } as GraphNode['inputs'][string]]);
    const inputEntries = [...Object.entries(node.inputs), ...paramOnlyEntries];
    const outputEntries = Object.entries(node.outputs);
    const hasInputs = inputEntries.length > 0;
    const hasOutputs = outputEntries.length > 0;
    const hidden = hiddenInputKeys(node);
    const visibleInputEntries = inputEntries.filter(([key]) => !hidden.includes(key));
    const hiddenInputEntries = inputEntries.filter(([key]) => hidden.includes(key));
    // Cards used to be forced to half width, permanently, sharing a flex row
    // with the other column even when that column was collapsed to just its
    // header. auto-fit gives each card the full row on a phone (minmax's
    // floor is wider than one phone-width column) while still letting a
    // wide viewport lay out more than one per row.
    const cardGridStyle: React.CSSProperties = {
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '8px',
    };

    const renderInputCard = (key: string, inp: GraphNode['inputs'][string], isHidden: boolean) => {
      // A synthetic paramOnlyEntries row (see above) has no real socket to
      // wire or keyframe — it's a static param the compiler reads straight
      // from node.params, same as e.g. a group's Iterations count.
      const isRealSocket = key in node.inputs;
      const isPortSourced = inp.connection?.nodeId === GROUP_PORT_SENTINEL;
      const sourcePort = isPortSourced ? activeGroupInputPorts.find(p => p.key === inp.connection!.outputKey) : undefined;
      const upstream = (inp.connection && !isPortSourced) ? nodes.find(n => n.id === inp.connection!.nodeId) : undefined;
      // Ghost-suggested wire — only worth computing for an actually-open
      // real socket; an already-wired or group-port-sourced one has nothing
      // to suggest.
      const ghostCandidate = (isRealSocket && !upstream && !isPortSourced)
        ? bestConnectCandidate(node.id, inp.type)
        : undefined;
      // Externally-driven param: this node's own float slider for `key` is
      // exposed as a ps_ socket on the enclosing group, and that socket is
      // currently fed from outside — the outer wire wins at compile time, so
      // the local slider is locked to avoid implying it still does anything.
      const psSocket = parentGroupNode?.inputs?.[`ps_${node.id}_${key}`];
      const isExternallyDriven = !!psSocket?.connection;
      // Keyframes are a third input mode alongside "wired" and "static
      // value" — same eligibility rule desktop uses (NodeComponent.tsx): an
      // unwired float socket, or an unwired vec2/vec3 socket that declares
      // which static params back each axis (most vec2/vec3 sockets are
      // meant to be wired — UV, positions — and don't declare this, so they
      // stay ineligible).
      const isVectorKfType = inp.type === 'vec2' || inp.type === 'vec3';
      const kfAxes = isVectorKfType ? VECTOR_AXES[inp.type as 'vec2' | 'vec3'] : null;
      const kfEligible = isRealSocket && !upstream && !isPortSourced && (inp.type === 'float' || (isVectorKfType && !!inp.axisParams));
      const isKeyframed = kfEligible && (
        inp.type === 'float' ? socketHasKeyframes(node, key) : socketHasVectorKeyframes(node, key, kfAxes ?? [])
      );
      const pd = upstream || isPortSourced || isKeyframed ? undefined : sliderableParam(node, key);
      const val = pd ? currentSliderValue(node, key, pd) : 0;
      const selectPd = upstream || isPortSourced ? undefined : selectableParam(node, key);
      const selectVal = selectPd ? (node.params[key] !== undefined ? String(node.params[key]) : (selectPd.options?.[0]?.value ?? '')) : '';
      return (
        <div key={key} style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TypeIcon type={inp.type} />
            <div
              onDoubleClick={() => toggleHiddenInput(node, key)}
              title={isHidden ? 'Double-tap to unhide' : 'Double-tap to hide'}
              style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', touchAction: 'manipulation' }}
            >{inp.label}</div>
            {!upstream && kfEligible && (
              <button
                style={smallIconBtnStyle(isKeyframed ? '#f9e2af' : '#a6adc8')}
                title={isKeyframed ? 'Edit Keyframes' : 'Add Keyframes'}
                onClick={() => {
                  const axis = kfAxes ? kfAxes[0] : undefined;
                  setMobileKeyframeEditor({ nodeId: node.id, socketKey: key, axis });
                  setMobileKeyframeTool(isKeyframed ? 'select' : 'add');
                }}
              >◆</button>
            )}
            {isRealSocket && !upstream && !isPortSourced && (
              <button style={smallIconBtnStyle('#89b4fa')} title="Wire this input" onClick={() => setPending({ dir: 'input', nodeId: node.id, key, type: inp.type })}>+</button>
            )}
          </div>
          {upstream && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px' }} onClick={() => pushFocus(upstream.id)}>{labelFor(upstream)} ›</button>
              <button
                onClick={() => disconnectInput(node.id, key)}
                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', cursor: 'pointer', padding: '2px', touchAction: 'manipulation' }}
                title="Disconnect"
              >✕</button>
            </div>
          )}
          {/* Sourced from this group's own boundary port rather than another
              internal node — not navigable (there's nothing to drill into),
              but still freely disconnectable, same as any other wire. */}
          {isPortSourced && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px', cursor: 'default', color: '#cba6f7', borderColor: '#cba6f755' }}>
                ⛓ {sourcePort?.label ?? inp.connection!.outputKey}
              </span>
              <button
                onClick={() => disconnectInput(node.id, key)}
                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', cursor: 'pointer', padding: '2px', touchAction: 'manipulation' }}
                title="Disconnect"
              >✕</button>
            </div>
          )}
          {/* Ghost-suggested wire — a preview of the best already-placed
              candidate, not a real connection yet. One tap commits it via
              the exact same connectNodes call the "Connect Existing" picker
              uses; the "+" button above still opens that picker for when
              the guess isn't the one you want. */}
          {ghostCandidate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button
                onClick={() => connectNodes(ghostCandidate.node.id, ghostCandidate.outKey, node.id, key)}
                title="Tap to connect this suggestion"
                style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px', background: 'none', border: '1px dashed #45475a', color: '#6c7086' }}
              >
                ⇢ {labelFor(ghostCandidate.node)}
              </button>
            </div>
          )}
          {isExternallyDriven && (
            <div style={{ fontSize: '10px', color: '#6c7086', fontStyle: 'italic' }}>
              🔒 driven by group input — edit it from outside the group
            </div>
          )}
          {pd && (() => {
            const bidir = node.params[`__scBidir_${key}`] === true;
            const customMax = typeof node.params[`__scMax_${key}`] === 'number' ? node.params[`__scMax_${key}`] as number : null;
            const baseMax = pd.max ?? 1;
            const effMax = customMax ?? baseMax;
            const effMin = bidir ? -effMax : (customMax != null ? 0 : (pd.min ?? 0));
            // Accordion: tapping the value opens this card's full
            // controls and collapses whichever other card was open,
            // since openSliderConfig holds a single key, not a
            // per-card flag.
            const isExpanded = openSliderConfig === key;
            const setCustomMax = (n: number) => {
              const absN = Math.abs(n);
              if (absN > 0) updateNodeParams(node.id, { [`__scMax_${key}`]: absN });
            };
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <input
                    type="range"
                    min={effMin}
                    max={effMax}
                    step={pd.step ?? 0.01}
                    value={Math.max(effMin, Math.min(effMax, val))}
                    disabled={isExternallyDriven}
                    onChange={e => updateNodeParams(node.id, { [key]: parseFloat(e.target.value) }, { immediate: true })}
                    onDoubleClick={() => {
                      const defVal = getNodeDefinition(node.type)?.defaultParams?.[key];
                      updateNodeParams(node.id, { [key]: typeof defVal === 'number' ? defVal : (effMin + effMax) / 2 }, { immediate: true });
                    }}
                    title={isExternallyDriven ? 'Driven by an outer wire into this group — read-only here' : 'Double-tap to reset to default'}
                    style={{ flex: 1, minWidth: 0, opacity: isExternallyDriven ? 0.4 : 1 }}
                  />
                  <button
                    onClick={() => setOpenSliderConfig(o => o === key ? null : key)}
                    title="Tap for range, bidirectional & keyframe controls"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0,
                      background: isExpanded ? '#313244' : 'none',
                      border: isExpanded ? '1px solid #45475a' : '1px solid transparent',
                      borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', touchAction: 'manipulation',
                      color: isExpanded ? '#cdd6f4' : '#a6adc8',
                    }}
                  >
                    <span style={{ fontSize: '10px', minWidth: '30px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {formatSliderValue(val, pd.step)}
                    </span>
                    <span style={{ fontSize: '8px', color: '#585b70' }}>{isExpanded ? '▾' : '▸'}</span>
                  </button>
                </div>
                {isExpanded && (
                  <div style={{ background: '#181825', border: '1px solid #313244', borderRadius: '6px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ fontSize: '9px', color: '#6c7086', width: '28px', flexShrink: 0 }}>Value</span>
                      <input
                        type="number"
                        step={pd.step ?? 0.01}
                        value={val}
                        onChange={e => {
                          const n = parseFloat(e.target.value);
                          if (isNaN(n)) return;
                          if (Math.abs(n) > effMax) setCustomMax(n);
                          updateNodeParams(node.id, { [key]: n }, { immediate: true });
                        }}
                        style={{ ...exprTextInputStyle, width: '64px', minWidth: 0, padding: '3px 5px', fontSize: '10px' }}
                      />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', touchAction: 'manipulation' }}>
                      <input
                        type="checkbox"
                        checked={bidir}
                        onChange={e => updateNodeParams(node.id, { [`__scBidir_${key}`]: e.target.checked }, { immediate: true })}
                        style={{ accentColor: '#cba6f7' }}
                      />
                      <span style={{ fontSize: '9px', color: '#a6adc8' }}>Bidirectional</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                      <span style={{ fontSize: '9px', color: '#6c7086', width: '28px', flexShrink: 0 }}>Max</span>
                      <input
                        type="number"
                        step={pd.step ?? 0.01}
                        value={effMax}
                        onChange={e => {
                          const n = parseFloat(e.target.value);
                          if (!isNaN(n) && n > 0) setCustomMax(n);
                        }}
                        style={{ ...exprTextInputStyle, width: '64px', minWidth: 0, padding: '3px 5px', fontSize: '10px' }}
                      />
                      {customMax != null && (
                        <button
                          onClick={() => updateNodeParams(node.id, { [`__scMax_${key}`]: null }, { immediate: true })}
                          style={{ fontSize: '9px', color: '#585b70', background: 'none', border: '1px solid #313244', borderRadius: '4px', cursor: 'pointer', padding: '3px 6px', touchAction: 'manipulation', flexShrink: 0 }}
                        >Reset</button>
                      )}
                    </div>
                    <span style={{ fontSize: '9px', color: '#585b70' }}>
                      Range: {formatSliderValue(effMin, pd.step)} → {formatSliderValue(effMax, pd.step)}
                    </span>
                  </div>
                )}
              </div>
            );
          })()}
          {selectPd && (
            <select
              value={selectVal}
              onChange={e => updateNodeParams(node.id, { [key]: e.target.value }, { immediate: true })}
              style={{
                background: '#1e1e2e', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '6px',
                padding: '6px 8px', fontSize: '12px', outline: 'none',
              }}
            >
              {(selectPd.options ?? []).map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          )}
        </div>
      );
    };

    const renderOutputCard = (key: string, out: GraphNode['outputs'][string]) => {
      const consumers = downstreamConsumers(node.id, key);
      return (
        <div key={key} style={{ background: '#1e1e2e', border: '1px solid #313244', borderRadius: '8px', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <TypeIcon type={out.type} />
            <div style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{out.label}</div>
            <button style={smallIconBtnStyle('#89b4fa')} title="Add a consumer for this output" onClick={() => setPending({ dir: 'output', nodeId: node.id, key, type: out.type })}>+</button>
          </div>
          {consumers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px' }}>
              {consumers.map(c => (
                <button key={c.id} style={{ ...chipStyle, fontSize: '10px', padding: '3px 8px' }} onClick={() => pushFocus(c.id)}>{labelFor(c)} ›</button>
              ))}
            </div>
          )}
        </div>
      );
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {renderNodeHeader(node)}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {GROUP_TYPES.has(node.type) && renderGroupBanner(node)}
          {node.type === 'textureInput' && renderTextureUploadBanner(node)}

          {(hasInputs || node.type === 'group') && (hasOutputs || node.type === 'group') && (
            <div style={{ display: 'flex', gap: '6px' }}>
              <button style={smallTabBtnStyle(nodeTab === 'inputs')} onClick={() => setNodeTab('inputs')}>Inputs ({inputEntries.length})</button>
              <button style={smallTabBtnStyle(nodeTab === 'outputs')} onClick={() => setNodeTab('outputs')}>Outputs ({outputEntries.length})</button>
            </div>
          )}

          {(hasInputs || node.type === 'group') && (nodeTab === 'inputs' || !hasOutputs) && (
            <div>
              {!hasOutputs && <div style={sectionHeaderBtnStyle}><span>INPUTS</span></div>}
              <div style={cardGridStyle}>
                {visibleInputEntries.map(([key, inp]) => renderInputCard(key, inp, false))}
              </div>
              {node.type === 'group' && (
                <button
                  onClick={() => setGroupPortBuilder({ groupId: node.id, dir: 'input', returnPath: activeGroupPath, stage: 'choose' })}
                  style={{ marginTop: '8px', width: '100%', padding: '8px', borderRadius: '8px', border: '1px dashed #45475a', background: 'none', color: '#89b4fa', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
                >+ Add Input</button>
              )}
              {hiddenInputEntries.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <button style={sectionHeaderBtnStyle} onClick={() => setHiddenSectionOpen(v => !v)}>
                    <span>{hiddenSectionOpen ? '▾' : '▸'} HIDDEN ({hiddenInputEntries.length})</span>
                  </button>
                  {hiddenSectionOpen && (
                    <div style={{ ...cardGridStyle, marginTop: '6px' }}>
                      {hiddenInputEntries.map(([key, inp]) => renderInputCard(key, inp, true))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(hasOutputs || node.type === 'group') && (nodeTab === 'outputs' || !hasInputs) && (
            <div>
              {!hasInputs && <div style={sectionHeaderBtnStyle}><span>OUTPUTS</span></div>}
              <div style={cardGridStyle}>
                {outputEntries.map(([key, out]) => renderOutputCard(key, out))}
              </div>
              {node.type === 'group' && (
                <button
                  onClick={() => setGroupPortBuilder({ groupId: node.id, dir: 'output', returnPath: activeGroupPath, stage: 'choose' })}
                  style={{ marginTop: '8px', width: '100%', padding: '8px', borderRadius: '8px', border: '1px dashed #45475a', background: 'none', color: '#89b4fa', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
                >+ Add Output</button>
              )}
            </div>
          )}

          <div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '6px' }}>
              <button style={smallTabBtnStyle(infoTab === 'info')} onClick={() => setInfoTab('info')}>ℹ Info</button>
              <button style={smallTabBtnStyle(infoTab === 'comment')} onClick={() => setInfoTab('comment')}>✎ Comment</button>
              {!ASSIGN_OP_EXCLUDED.has(node.type) && (
                <button style={smallTabBtnStyle(infoTab === 'assign')} onClick={() => setInfoTab('assign')}>⇄ Assign</button>
              )}
            </div>
            {infoTab === 'info' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontSize: '11px', color: '#585b70', lineHeight: 1.5 }}>
                  {def?.description ?? 'No info for this node.'}
                </div>
                {/* Same live, node-type-specific canvas diagrams desktop
                    shows on the card itself (tone curves, gradient strips,
                    wave shapes, ...) — reused as-is via InlineVizFrame
                    rather than reinvented. For the many node types with no
                    custom diagram, GenericPreviewViz falls back to an
                    actual rendered shader thumbnail (also matching desktop's
                    own behavior) rather than showing nothing. Collapsed by
                    default either way: different node types want very
                    different shapes (a wide equation strip vs. a square
                    vector field vs. a square render), so reserving a fixed
                    chunk of the card for it on every node — even ones you
                    never open it on — is more clutter than it's worth;
                    opt-in instead, sized to whatever ends up shown. */}
                {!SKIP_INLINE_PREVIEW.has(node.type) && (
                  <div>
                    <button
                      onClick={() => setVizExpanded(v => !v)}
                      style={{ ...sectionHeaderBtnStyle, padding: '4px 0' }}
                    >
                      <span>{vizExpanded ? '▾' : '▸'} VISUAL</span>
                    </button>
                    {vizExpanded && (
                      INLINE_VIZ_TYPES.has(node.type)
                        ? <InlineVizFrame key={node.id} node={node} />
                        : <GenericPreviewViz key={node.id} node={node} nodes={nodes} />
                    )}
                  </div>
                )}
              </div>
            )}
            {infoTab === 'comment' && (
              <textarea
                // Same node.params.__comment key desktop's own comment editor
                // uses (NodeComponent.tsx) — a "__"-prefixed metadata field,
                // not a regular node param — so a comment written on either
                // platform shows up on the other for the same node.
                value={(node.params.__comment as string | undefined) ?? ''}
                onChange={e => updateNodeParams(node.id, { __comment: e.target.value }, { immediate: true })}
                placeholder="Add a note…"
                style={{
                  width: '100%', minHeight: '64px', background: '#1e1e2e', border: '1px solid #313244',
                  borderRadius: '8px', padding: '8px', fontSize: '12px', color: '#cdd6f4',
                  fontFamily: 'inherit', resize: 'vertical', outline: 'none', boxSizing: 'border-box',
                }}
              />
            )}
            {infoTab === 'assign' && !ASSIGN_OP_EXCLUDED.has(node.type) && (() => {
              const assignOp = node.assignOp ?? '=';
              const isInsideLoop = !!parentGroupNode && typeof parentGroupNode.params?.iterations === 'number' && (parentGroupNode.params.iterations as number) > 1;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', color: '#a6adc8' }}>Operator</span>
                    <select
                      value={assignOp}
                      onChange={e => setNodeAssignOp(node.id, e.target.value as GraphNode['assignOp'])}
                      title="Declare an accumulator and combine this node's output (+= -= *= /=) instead of overwriting it"
                      style={{
                        background: assignOp !== '=' ? '#313244' : '#1e1e2e',
                        border: `1px solid ${assignOp !== '=' ? '#89b4fa88' : '#45475a'}`,
                        color: assignOp !== '=' ? '#89b4fa' : '#cdd6f4',
                        borderRadius: '6px', padding: '4px 8px', fontSize: '12px', fontFamily: 'monospace',
                      }}
                    >
                      <option value="="> = </option>
                      <option value="+=">+=</option>
                      <option value="-=">-=</option>
                      <option value="*=">*=</option>
                      <option value="/=">/=</option>
                    </select>
                    {isInsideLoop && (
                      <button
                        onClick={() => toggleNodeCarryMode(node.id)}
                        title={node.carryMode ? 'Carry mode ON — output feeds back as input each iteration. Tap to disable.' : 'Enable carry mode — output feeds back as input each iteration'}
                        style={{
                          marginLeft: 'auto',
                          background: node.carryMode ? '#a6e3a122' : 'none', border: `1px solid ${node.carryMode ? '#a6e3a155' : '#45475a'}`,
                          color: node.carryMode ? '#a6e3a1' : '#a6adc8', borderRadius: '6px', padding: '4px 8px', fontSize: '12px', fontFamily: 'monospace',
                        }}
                      >⟳ Carry</button>
                    )}
                  </div>
                  {assignOp !== '=' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#6c7086', flexShrink: 0, fontFamily: 'monospace' }}>init</span>
                      <input
                        type="text"
                        value={node.assignInit ?? ''}
                        onChange={e => setNodeAssignInit(node.id, e.target.value)}
                        placeholder="default (0 or 1)"
                        style={{ ...exprTextInputStyle, flex: 1 }}
                      />
                      {node.assignInit && (
                        <button
                          onClick={() => setNodeAssignInit(node.id, '')}
                          title="Clear init expression (revert to neutral element)"
                          style={{ background: 'none', border: 'none', color: '#585b70', cursor: 'pointer', fontSize: '12px', padding: '2px' }}
                        >✕</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {renderSocketOverlays(node)}
      </div>
    );
  }

  // ── Keyframe editor view ─────────────────────────────────────────────────
  // Replaces the node detail's card content (not the header) while a socket
  // is being keyframed. The Select/Add/Delete/Draw tool buttons live in
  // App.tsx's bottom action bar (mobileKeyframeTool, read above) since
  // there's no keyboard here for desktop's V/C/X/D shortcuts.
  function renderKeyframeEditorView(node: GraphNode) {
    const target = mobileKeyframeEditor;
    const input = target ? node.inputs[target.socketKey] : undefined;
    if (!target || !input) {
      // Socket vanished from under us (e.g. node type changed) — bail out to
      // the normal detail view for this render; the useEffect above clears
      // mobileKeyframeEditor itself (can't do that here mid-render, since
      // it's a store field App.tsx also renders from).
      return renderNodeDetail(node);
    }
    const isVector = input.type === 'vec2' || input.type === 'vec3';
    const axes = isVector ? VECTOR_AXES[input.type as 'vec2' | 'vec3'] : null;
    const axis = target.axis;
    const cfg = axis ? getAxisKeyframeConfig(node, target.socketKey, axis) : getKeyframeConfig(node, target.socketKey);
    const keyframes = cfg?.keyframes ?? [];
    const mode = cfg?.mode ?? 'once';
    const loopBack = cfg?.loopBack ?? 1;
    const offset = cfg?.offset ?? 0;
    const loopCount = cfg?.loopCount ?? null;

    const paramDefKey = axis ? input.axisParams?.[axes!.indexOf(axis)] : target.socketKey;
    const pd = paramDefKey ? getNodeDefinition(node.type)?.paramDefs?.[paramDefKey] : undefined;
    const kfVals = keyframes.map(k => k.v);
    const autoMin = kfVals.length ? Math.min(...kfVals) : 0;
    const autoMax = kfVals.length ? Math.max(...kfVals) : 1;
    const baseMin = pd?.min ?? (autoMin === autoMax ? autoMin - 1 : autoMin);
    const baseMax = pd?.max ?? (autoMin === autoMax ? autoMax + 1 : autoMax);
    // A keyframe's value can be typed in directly (below) and land outside
    // the socket's normal slider range — expand the graph to fit it rather
    // than silently clipping the point off the top/bottom of the canvas.
    const valueMin = Math.min(baseMin, autoMin);
    const valueMax = Math.max(baseMax, autoMax);

    const kfParamName = `__keyframes_${target.socketKey}${axis ? `_${axis}` : ''}`;
    const writeKeyframes = (next: Keyframe[]) => updateNodeParams(node.id, { [kfParamName]: next }, { immediate: true });
    const setMode = (m: KeyframeLoopMode) => updateNodeParams(node.id, { [`__kfMode_${target.socketKey}`]: m }, { immediate: true });
    const setLoopBack = (v: number) => updateNodeParams(node.id, { [`__kfLoopBack_${target.socketKey}`]: v }, { immediate: true });
    const setLoopCount = (v: number | null) => updateNodeParams(node.id, { [`__kfLoopCount_${target.socketKey}`]: v }, { immediate: true });

    const selected = kfSelectedIndex != null ? keyframes[kfSelectedIndex] : undefined;
    // This keyframe's easing only does anything if there's a next segment to
    // ease into — the last keyframe in 'once'/'loop' mode has no outgoing
    // segment, same as desktop's easeEditSeg derivation.
    const hasOutgoingSegment = kfSelectedIndex != null && (
      kfSelectedIndex < keyframes.length - 1 || (mode === 'interpolate' && kfSelectedIndex === keyframes.length - 1)
    );
    const isSelectedLinear = selected ? isLinearEase(selected.ease) : true;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {renderNodeHeader(node)}

        <div style={{ flex: 1, overflowY: 'auto', padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 700, color: '#cdd6f4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {input.label}{axis ? ` · ${axis.toUpperCase()}` : ''}
            </div>
            {keyframes.length > 0 && (
              <button
                onClick={() => writeKeyframes([])}
                style={{ background: 'none', border: '1px solid #f38ba866', color: '#f38ba8', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
              >Clear</button>
            )}
            <button
              onClick={() => setMobileKeyframeEditor(null)}
              style={{ background: 'none', border: '1px solid #45475a', color: '#89b4fa', borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
            >Done</button>
          </div>

          {axes && (
            <div style={{ display: 'flex', gap: '6px' }}>
              {axes.map(a => (
                <button key={a} style={smallTabBtnStyle(axis === a)} onClick={() => setMobileKeyframeEditor({ ...target, axis: a })}>
                  {a.toUpperCase()}
                </button>
              ))}
            </div>
          )}

          <KeyframeCanvasEditor
            keyframes={keyframes}
            mode={mode}
            loopBack={loopBack}
            offset={offset}
            loopCount={loopCount}
            valueMin={valueMin}
            valueMax={valueMax}
            tool={mobileKeyframeTool}
            onChange={writeKeyframes}
            selectedIndex={kfSelectedIndex}
            onSelect={setKfSelectedIndex}
          />

          {keyframes.length === 0 && (
            <div style={{ fontSize: '11px', color: '#585b70' }}>
              Pick "Add" below, then tap in the canvas to place a keyframe — or "Draw" to sketch a curve freehand.
            </div>
          )}

          {selected && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                <span style={{ fontSize: '11px', color: '#6c7086' }}>Value</span>
                <input
                  type="number"
                  step={pd?.step ?? 0.01}
                  value={selected.v}
                  onChange={e => {
                    const n = parseFloat(e.target.value);
                    if (isNaN(n)) return;
                    writeKeyframes(keyframes.map((k, i) => i === kfSelectedIndex ? { ...k, v: n } : k));
                  }}
                  style={{ ...exprTextInputStyle, width: '60px', padding: '4px 6px', fontSize: '11px' }}
                />
              </div>

              {hasOutgoingSegment && (
                <div>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>
                    EASING (this keyframe → next)
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      style={smallTabBtnStyle(isSelectedLinear)}
                      onClick={() => writeKeyframes(keyframes.map((k, i) => i === kfSelectedIndex ? { ...k, ease: EASING_PRESETS.linear } : k))}
                    >Linear</button>
                    <button
                      style={smallTabBtnStyle(!isSelectedLinear)}
                      // Switching on lands on the 'ease' preset — already at an
                      // angle — rather than a degenerate straight line, whose
                      // handles would sit exactly on top of the curve itself
                      // and be hard to grab.
                      onClick={() => { if (isSelectedLinear) writeKeyframes(keyframes.map((k, i) => i === kfSelectedIndex ? { ...k, ease: KF_DEFAULT_BEZIER } : k)); }}
                    >Bezier</button>
                  </div>
                  {!isSelectedLinear && (
                    <div style={{ fontSize: '10px', color: '#585b70', marginTop: '6px' }}>
                      Drag the orange/blue handles on the curve to shape it.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Playback settings only make sense once there's an actual curve
              to play back — an empty keyframe list has nothing to loop. */}
          {keyframes.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', fontWeight: 700, color: '#585b70', letterSpacing: '0.05em', marginBottom: '6px' }}>PLAYBACK</div>
              <div style={{ display: 'flex', gap: '6px' }}>
                {(['once', 'loop', 'interpolate'] as const).map(m => (
                  <button key={m} style={smallTabBtnStyle(mode === m)} onClick={() => setMode(m)}>{m}</button>
                ))}
              </div>
              {mode === 'interpolate' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                  <span style={{ fontSize: '10px', color: '#6c7086' }}>Loop back over</span>
                  <input
                    type="number" min={0.01} step={0.1} value={loopBack}
                    onChange={e => setLoopBack(Math.max(0.01, parseFloat(e.target.value) || 0.01))}
                    style={{ ...exprTextInputStyle, width: '48px', padding: '4px 6px', fontSize: '11px' }}
                  />
                  <span style={{ fontSize: '10px', color: '#6c7086' }}>sec</span>
                </div>
              )}
              {mode !== 'once' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', touchAction: 'manipulation' }}>
                    <input
                      type="checkbox"
                      checked={loopCount === null}
                      onChange={e => setLoopCount(e.target.checked ? null : 3)}
                      style={{ accentColor: '#cba6f7' }}
                    />
                    <span style={{ fontSize: '10px', color: '#a6adc8' }}>Loop forever</span>
                  </label>
                  {loopCount !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '10px', color: '#6c7086' }}>Repeat</span>
                      <input
                        type="number" min={1} step={1} value={loopCount}
                        onChange={e => setLoopCount(Math.max(1, Math.round(parseFloat(e.target.value) || 1)))}
                        style={{ ...exprTextInputStyle, width: '44px', padding: '4px 6px', fontSize: '11px' }}
                      />
                      <span style={{ fontSize: '10px', color: '#6c7086' }}>times</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
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
        {renderNodeHeader(node)}

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
        {/* Group's own (already-created) input ports — this group's boundary
            sockets, reusable as a source just like any other node's output;
            one port can feed any number of internal targets. Creating a NEW
            port happens from the group's own settings page (its "+ Add
            Input"), not here — so this only shows when there's something
            existing to pick. */}
        {connectPicker.dir === 'input' && activeGroupId && groupPortCandidates.length > 0 && (
          <div style={{ padding: '10px 12px', borderBottom: '1px solid #313244' }}>
            <div style={{ fontSize: '10px', color: '#6c7086', marginBottom: '6px', letterSpacing: '0.04em' }}>GROUP INPUTS</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {groupPortCandidates.map(p => (
                <button
                  key={p.key}
                  onClick={() => commitConnectToGroupPort(p.key)}
                  style={{ ...chipStyle, fontSize: '11px', color: '#cba6f7', borderColor: '#cba6f755' }}
                >⛓ {p.label}</button>
              ))}
            </div>
          </div>
        )}
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
                  onClick={() => {
                    if (GROUP_TYPES.has(n.type) && !n.sealed) enterGroup(n.id);
                    else setFocusStack([n.id]);
                    setShowGraphOverlay(false);
                  }}
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
      return (
        <div style={{ flex: 1, position: 'relative', padding: '16px 12px', fontSize: '12px', color: '#585b70' }}>
          No nodes yet.
          {renderAddNodeFab()}
        </div>
      );
    }
    // A grouped node only ever appears inside its own folder entry, never
    // also duplicated in the plain rank grid below.
    const groupedIds = new Set(looseGroups.flatMap(g => g.memberIds));
    // UV/Output pinned to the top/bottom of ROOT Home — the same "always
    // first / always last" convention a group's own fixed ports row below
    // uses, just for the two real node types that anchor every graph (the
    // actual UV source, the single compile-mandatory sink) instead of a
    // group's synthetic port placeholders. Root only: nothing stops a 'uv'
    // node existing inside a plain group's subgraph too, but singleton-at-
    // root is the case this solves, not "pin every uv node anywhere".
    const isAtRoot = activeGroupPath.length === 0;
    const pinnedUvNodes = isAtRoot ? nodes.filter(n => n.type === 'uv') : [];
    const pinnedOutputNodes = isAtRoot ? nodes.filter(n => n.type === 'output') : [];
    const pinnedIds = new Set([...pinnedUvNodes, ...pinnedOutputNodes].map(n => n.id));
    const chipStyleFor = (n: GraphNode) => {
      const selected = selectMode && selectedIds.includes(n.id);
      return {
        display: 'flex', alignItems: 'center', gap: '6px',
        background: selected ? '#313244' : '#1e1e2e',
        border: selected ? '1px solid #cba6f7' : '1px solid #313244',
        borderRadius: '8px', padding: '8px 10px', fontSize: '12px', color: '#cdd6f4',
        cursor: 'pointer', touchAction: 'manipulation',
      } as React.CSSProperties;
    };
    // A real (compile-affecting) group's chip now drills straight into its
    // subgraph on tap (see pushFocus) — this small companion button is the
    // only remaining way to reach its own ports (to wire something to/from
    // it) without entering it, since the ports detail view is no longer the
    // tap target.
    const renderNodeChip = (n: GraphNode, withRef: boolean) => {
      const isUnsealedGroup = GROUP_TYPES.has(n.type) && !n.sealed;
      // Long-press (or mouse-hold, for desktop-browser testing) opens the
      // Delete / "add a node to this socket" menu; a normal tap still just
      // navigates in, same as before — see longPressWasFired.
      const chip = (
        <button
          key={n.id}
          ref={withRef ? (el => { if (el) homeChipRefs.current.set(n.id, el); else homeChipRefs.current.delete(n.id); }) : undefined}
          onClick={() => { if (longPressWasFired(n.id)) return; selectMode ? toggleSelected(n.id) : pushFocus(n.id); }}
          onTouchStart={e => { const t = e.touches[0]; longPressStart(n.id, t.clientX, t.clientY, () => setLongPressMenuFor(n.id)); }}
          onTouchMove={e => { const t = e.touches[0]; longPressMove(n.id, t.clientX, t.clientY); }}
          onTouchEnd={() => longPressClearPending(n.id)}
          onTouchCancel={() => longPressClearPending(n.id)}
          onMouseDown={e => longPressStart(n.id, e.clientX, e.clientY, () => setLongPressMenuFor(n.id))}
          onMouseMove={e => longPressMove(n.id, e.clientX, e.clientY)}
          onMouseUp={() => longPressClearPending(n.id)}
          onMouseLeave={() => longPressClearPending(n.id)}
          onContextMenu={e => e.preventDefault()}
          style={{ ...chipStyleFor(n), WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
        >
          <div style={dotStyle(nodeDotColor(n))} />
          {labelFor(n)}{isUnsealedGroup ? ' ›' : ''}
        </button>
      );
      if (!isUnsealedGroup || selectMode) return chip;
      return (
        <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {chip}
          <button
            onClick={() => viewGroupPorts(n.id)}
            title="View this group's own ports"
            style={{ background: 'none', border: '1px solid #313244', color: '#585b70', borderRadius: '6px', width: '22px', height: '22px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation' }}
          >⚙</button>
        </div>
      );
    };
    // Fixed rows for the group's own boundary ports — a plain group's
    // subgraph has no built-in anchor nodes the way a SceneGroup's scenePos/
    // sceneOutput do, so without these its inputs/outputs are invisible from
    // the inside (you'd only ever see them from the group's own card,
    // outside it). Locked/non-deletable in spirit like those anchors — tap
    // steps back out to that same card, open on the matching tab.
    const renderFixedPortsRow = (dir: 'input' | 'output') => {
      const outputPorts = (parentGroupNode?.params?.subgraph as { outputPorts?: unknown[] } | undefined)?.outputPorts ?? [];
      const count = dir === 'input' ? activeGroupInputPorts.length : outputPorts.length;
      return (
        <div key={`fixed-ports-${dir}`} style={{ padding: '4px 12px', borderBottom: '1px solid #24243a' }}>
          <button
            onClick={() => viewParentGroupPorts(dir === 'input' ? 'inputs' : 'outputs')}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 10px',
              background: '#cba6f712', border: '1px dashed #cba6f755', borderRadius: '8px',
              color: '#cba6f7', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '11px' }}>🔒</span>
            <span style={{ flex: 1 }}>{dir === 'input' ? 'Group Inputs' : 'Group Outputs'}</span>
            <span style={{ color: '#585b70', fontSize: '10px' }}>({count})</span>
          </button>
        </div>
      );
    };
    const renderLooseGroupRow = (g: LooseGroup) => {
      // Store-backed, not local UI state — the collapsed/expanded
      // state is shared with desktop's own compound-box toggle
      // for the same group, not a mobile-only view preference.
      const isOpen = !g.collapsed;
      const isRenaming = renamingLooseGroupId === g.id;
      const members = nodes.filter(n => g.memberIds.includes(n.id));
      return (
        <div key={g.id} style={{ padding: '4px 12px', borderBottom: '1px solid #24243a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 0' }}>
            <button
              onClick={() => toggleLooseGroupCollapsed(g.id)}
              style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px',
                background: 'none', border: 'none', color: '#cdd6f4', fontSize: '12px',
                cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left', padding: '4px 0',
              }}
            >
              <span style={{ fontSize: '10px', color: '#585b70', flexShrink: 0 }}>{isOpen ? '▾' : '▸'}</span>
              <span style={{ flexShrink: 0 }}>📁</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label}</span>
              <span style={{ color: '#585b70', fontSize: '10px', flexShrink: 0 }}>({members.length})</span>
            </button>
            <button
              onClick={() => { setRenamingLooseGroupId(g.id); setRenameLooseGroupValue(g.label); }}
              title="Rename"
              style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
            >✎</button>
            <button
              onClick={() => ungroupLoose(g.id)}
              title="Ungroup (members are unaffected)"
              style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', cursor: 'pointer', padding: '4px', touchAction: 'manipulation' }}
            >✕</button>
          </div>
          {isRenaming && (
            <div style={{ display: 'flex', gap: '6px', paddingBottom: '6px' }}>
              <input
                autoFocus
                type="text"
                value={renameLooseGroupValue}
                onChange={e => setRenameLooseGroupValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { renameLooseGroup(g.id, renameLooseGroupValue.trim() || g.label); setRenamingLooseGroupId(null); }
                  if (e.key === 'Escape') setRenamingLooseGroupId(null);
                }}
                style={{ ...exprTextInputStyle, flex: 1 }}
              />
              <button
                onClick={() => { renameLooseGroup(g.id, renameLooseGroupValue.trim() || g.label); setRenamingLooseGroupId(null); }}
                style={{ background: '#313244', border: '1px solid #45475a', color: '#cdd6f4', borderRadius: '6px', padding: '0 12px', fontSize: '12px', cursor: 'pointer', touchAction: 'manipulation' }}
              >Save</button>
            </div>
          )}
          {isOpen && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingLeft: '20px', paddingBottom: '8px' }}>
              {members.map(n => renderNodeChip(n, false))}
            </div>
          )}
        </div>
      );
    };
    // A pinned row still uses renderNodeChip — these are real nodes (tap
    // navigates in, long-press opens the same context menu), just anchored
    // out of the ordinary BFS-rank flow. withRef:true so they still
    // participate in the connector-line overlay like an ordinary rank row.
    const renderPinnedRow = (tag: 'uv' | 'output', pinnedNodes: GraphNode[]) => (
      <div key={`pinned-${tag}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #24243a' }}>
        <div style={{ width: '14px', flexShrink: 0, fontSize: '9px', fontWeight: 700, color: '#45475a', paddingTop: '9px', textAlign: 'right' }}>{tag === 'uv' ? 'IN' : 'OUT'}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
          {pinnedNodes.map(n => renderNodeChip(n, true))}
        </div>
      </div>
    );
    const renderRankRow = (rank: number, rowNodes: GraphNode[]) => {
      const visible = rowNodes.filter(n => !groupedIds.has(n.id) && !pinnedIds.has(n.id));
      if (visible.length === 0) return null;
      return (
        <div key={`row-${rank}`} style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '8px 12px', borderBottom: '1px solid #24243a' }}>
          <div style={{ width: '14px', flexShrink: 0, fontSize: '10px', color: '#45475a', paddingTop: '9px', textAlign: 'right' }}>{rank}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
            {visible.map(n => renderNodeChip(n, true))}
          </div>
        </div>
      );
    };
    // Loose groups aren't pinned to a fixed "GROUPS" section up top — each
    // is interleaved into the same rank ordering as the plain rows, placed
    // strictly after anything outside it that feeds one of its members, so
    // the list never shows a group above (before) a node it's connected to.
    const isInsidePlainGroup = parentGroupNode?.type === 'group';
    type HomeEntry = { rank: number; render: () => React.ReactNode };
    const entries: HomeEntry[] = [
      ...rankedRows
        .map(({ rank, nodes: rowNodes }) => ({ rank, render: () => renderRankRow(rank, rowNodes) })),
      ...looseGroups.map(g => ({ rank: computeGroupRank(g, nodes, nodeRanks), render: () => renderLooseGroupRow(g) })),
      // Always first (rank -1: the ultimate source anything wired to a port
      // traces back to) and always last (rank Infinity: the ultimate sink).
      ...(isInsidePlainGroup ? [
        { rank: -1, render: () => renderFixedPortsRow('input' as const) },
        { rank: Infinity, render: () => renderFixedPortsRow('output' as const) },
      ] : []),
      ...(pinnedUvNodes.length > 0 ? [{ rank: -1, render: () => renderPinnedRow('uv' as const, pinnedUvNodes) }] : []),
      ...(pinnedOutputNodes.length > 0 ? [{ rank: Infinity, render: () => renderPinnedRow('output' as const, pinnedOutputNodes) }] : []),
    ].sort((a, b) => a.rank - b.rank);
    return (
      <div ref={homeContainerRef} style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
        {/* Connector overlay — measured from actual chip positions (see the
            useLayoutEffect above), not a synthetic layout, since these chips
            sit in a natural flex-wrap flow. z-index:0 under the rows below
            it so a line's endpoint tucks behind the chip it connects to,
            same as the graph-diagram view's edges terminate at a node box's
            edge rather than floating on top of it. */}
        <svg
          width={homeSvgSize.width} height={homeSvgSize.height}
          style={{ position: 'absolute', top: 0, left: 0, zIndex: 0, pointerEvents: 'none' }}
        >
          <GraphEdges edges={homeEdges} />
        </svg>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {entries.map(e => e.render())}
        </div>
        {/* Floating group actions — only while actively selecting. Real
            groups rewire the graph (compile-affecting, same groupNodes()
            desktop's canvas uses); folders are purely visual clustering
            with no wiring of their own. */}
        {selectMode && (
          <div style={{
            position: 'sticky', bottom: 0, left: 0, right: 0, zIndex: 2,
            background: 'rgba(24,24,37,0.95)', backdropFilter: 'blur(8px)',
            borderTop: '1px solid #313244', padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}>
            <span style={{ flex: 1, fontSize: '11px', color: '#a6adc8' }}>
              {selectedIds.length === 0 ? 'Tap nodes to select them' : `${selectedIds.length} selected`}
            </span>
            <button
              onClick={commitRealGroup}
              disabled={selectedIds.length < 1}
              title="Group into a real node — rewires the graph, has its own inputs/outputs"
              style={{
                background: selectedIds.length < 1 ? '#313244' : '#89b4fa18',
                border: `1px solid ${selectedIds.length < 1 ? '#45475a' : '#89b4fa55'}`,
                color: selectedIds.length < 1 ? '#585b70' : '#89b4fa',
                borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                cursor: selectedIds.length < 1 ? 'default' : 'pointer', touchAction: 'manipulation',
              }}
            >
              ⛓ Group{selectedIds.length >= 1 ? ` (${selectedIds.length})` : ''}
            </button>
            <button
              onClick={commitLooseGroup}
              disabled={selectedIds.length < 2}
              title="Cluster visually only — no wiring, no compile effect"
              style={{
                background: selectedIds.length < 2 ? '#313244' : '#cba6f722',
                border: `1px solid ${selectedIds.length < 2 ? '#45475a' : '#cba6f766'}`,
                color: selectedIds.length < 2 ? '#585b70' : '#cba6f7',
                borderRadius: '6px', padding: '6px 14px', fontSize: '12px', fontWeight: 600,
                cursor: selectedIds.length < 2 ? 'default' : 'pointer', touchAction: 'manipulation',
              }}
            >
              📁 Folder{selectedIds.length >= 2 ? ` (${selectedIds.length})` : ''}
            </button>
          </div>
        )}
        {!selectMode && renderAddNodeFab()}
      </div>
    );
  }
  // Floating "+" — the only way to place a completely freestanding node
  // (no pre-existing socket to wire it to). Reuses NodeSearchPalette with
  // no type filter and no spawnPosition, so it lands in whatever scope
  // Home is currently showing (root or inside a group) via addNode()'s own
  // activeGroupPath scoping, same as every other "Add New Node" flow here.
  function renderAddNodeFab() {
    return (
      <>
        <button
          onClick={() => setHomeAddNodeOpen(true)}
          title="Add a new node"
          style={{
            position: 'absolute', right: '14px', bottom: '14px', zIndex: 3,
            width: '44px', height: '44px', borderRadius: '50%',
            background: '#89b4fa', border: 'none', color: '#181825',
            fontSize: '22px', fontWeight: 700, lineHeight: 1, cursor: 'pointer', touchAction: 'manipulation',
            boxShadow: '0 4px 14px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          +
        </button>
        <NodeSearchPalette
          open={homeAddNodeOpen}
          onClose={() => setHomeAddNodeOpen(false)}
          onNodePlaced={id => { setHomeAddNodeOpen(false); pushFocus(id); }}
        />
      </>
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
    const isReal = homeGraphLayoutMode === 'real';
    const layout = isReal ? computeRealLayout(nodes) : computeGraphLayout(nodes, rankedRows);
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Rank (synthetic BFS-depth grid) vs. Real (desktop canvas's actual
            spatial layout, read-only — no dragging, no editing) — tapping a
            node still drills in the same way in either mode. */}
        <div style={{ display: 'flex', gap: '6px', padding: '8px 12px', borderBottom: '1px solid #313244', flexShrink: 0 }}>
          {(['rank', 'real'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setHomeGraphLayoutMode(mode)}
              style={{
                padding: '4px 10px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
                background: homeGraphLayoutMode === mode ? '#313244' : 'none',
                border: `1px solid ${homeGraphLayoutMode === mode ? '#89b4fa' : '#45475a'}`,
                color: homeGraphLayoutMode === mode ? '#89b4fa' : '#6c7086',
                cursor: 'pointer', touchAction: 'manipulation',
              }}
            >
              {mode === 'rank' ? 'Rank' : 'Real (desktop layout)'}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
            <svg width={layout.width} height={layout.height} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              {isReal ? <GraphEdgesHorizontal edges={layout.edges} /> : <GraphEdges edges={layout.edges} />}
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
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', background: '#181825', color: '#cdd6f4', fontFamily: 'system-ui, sans-serif' }}>
      {/* Breadcrumb — the drill-down path (group ancestry + in-node focus
          trail) is unbounded in principle, so it's collapsed to the 4 most
          recent locations behind Home; anything older sits behind a
          tappable "…" instead of forcing a horizontal scroll to get back. */}
      {(() => {
        type BreadcrumbSegment = { key: string; label: string; isCurrent: boolean; onClick: () => void };
        const groupPathSegments: BreadcrumbSegment[] = activeGroupPath.flatMap((id, i) => {
          const parentScope = getActiveNodes(topLevelNodes, activeGroupPath.slice(0, i)) ?? topLevelNodes;
          const n = parentScope.find(nn => nn.id === id);
          if (!n) return [];
          return [{
            key: `grp-${id}`,
            label: labelFor(n),
            isCurrent: i === activeGroupPath.length - 1 && focusStack.length === 0,
            onClick: () => jumpToGroupDepth(i + 1),
          }];
        });
        const focusPathSegments: BreadcrumbSegment[] = focusStack.flatMap((id, i) => {
          const n = nodes.find(nn => nn.id === id);
          if (!n) return [];
          return [{
            key: `foc-${id}-${i}`,
            label: labelFor(n),
            isCurrent: i === focusStack.length - 1,
            onClick: () => jumpTo(i),
          }];
        });
        const allPathSegments = [...groupPathSegments, ...focusPathSegments];
        const BREADCRUMB_VISIBLE = 4;
        const hiddenPathSegments = allPathSegments.length > BREADCRUMB_VISIBLE ? allPathSegments.slice(0, -BREADCRUMB_VISIBLE) : [];
        const visiblePathSegments = allPathSegments.length > BREADCRUMB_VISIBLE ? allPathSegments.slice(-BREADCRUMB_VISIBLE) : allPathSegments;

        return (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px', borderBottom: '1px solid #313244', overflowX: 'auto' }}>
              <button onClick={goHome} style={{ background: 'none', border: 'none', color: activeGroupPath.length === 0 && focusStack.length === 0 ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}>
                Home
              </button>
              {hiddenPathSegments.length > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
                  <button
                    onClick={() => setShowHiddenPath(v => !v)}
                    title={`${hiddenPathSegments.length} more`}
                    style={{ background: showHiddenPath ? '#313244' : 'none', border: 'none', borderRadius: '4px', color: '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', padding: '0 3px' }}
                  >
                    …
                  </button>
                </span>
              )}
              {visiblePathSegments.map(seg => (
                <span key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
                  <button
                    onClick={seg.onClick}
                    style={{ background: 'none', border: 'none', color: seg.isCurrent ? '#89b4fa' : '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
                  >
                    {seg.label}
                  </button>
                </span>
              ))}
              {/* Redo path — where you'd land if you kept tapping ›. Dimmed since
                  it's not where you are, but still tappable to fast-forward back
                  onto it (any OTHER navigation clears this, same as goForward).
                  Not folded into the truncation above — it's rare and short-lived
                  (any navigation away clears it), so it isn't the growth problem
                  being solved here. */}
              {forwardStack.map((id, i) => {
          const n = nodes.find(nn => nn.id === id);
          if (!n) return null;
          return (
            <span key={`fwd-${id}`} style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, opacity: 0.4 }}>
              <span style={{ color: '#585b70', fontSize: '12px' }}>›</span>
              <button
                onClick={() => goForwardTo(i)}
                style={{ background: 'none', border: 'none', color: '#585b70', fontSize: '12px', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
                title="Go forward to here"
              >
                {labelFor(n)}
              </button>
            </span>
          );
        })}
        {/* Select mode — the mobile entry point for creating a loose group,
            since there's no canvas here to drag-select on. Only makes sense
            on the rank-grid list itself, not the graph diagram or a
            focused node's detail. */}
        {!focusedNode && !homeGraphView && (
          <button
            onClick={() => { setSelectMode(v => !v); setSelectedIds([]); }}
            style={{
              marginLeft: 'auto', flexShrink: 0,
              background: selectMode ? '#313244' : 'none', border: '1px solid #45475a', color: selectMode ? '#cba6f7' : '#89b4fa',
              borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation',
            }}
            title="Select nodes to group"
          >
            {selectMode ? 'Cancel' : '☑ Select'}
          </button>
        )}
        <button
          onClick={() => (focusedNode ? setShowGraphOverlay(true) : setHomeGraphView(v => !v))}
          style={{
            marginLeft: focusedNode || homeGraphView ? 'auto' : 0, flexShrink: 0,
            background: !focusedNode && homeGraphView ? '#313244' : 'none', border: '1px solid #45475a', color: '#89b4fa',
            borderRadius: '6px', padding: '4px 8px', fontSize: '11px', cursor: 'pointer', touchAction: 'manipulation',
          }}
          title="See the flow as a connected graph"
        >
          {!focusedNode && homeGraphView ? '☰ List' : '⋈ Graph'}
        </button>
            </div>
            {showHiddenPath && hiddenPathSegments.length > 0 && (
              <>
                <div onClick={() => setShowHiddenPath(false)} style={{ position: 'fixed', inset: 0, zIndex: 29 }} />
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
                  background: '#1e1e2e', border: '1px solid #45475a', borderTop: 'none',
                  padding: '8px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
                }}>
                  {hiddenPathSegments.map(seg => (
                    <button
                      key={seg.key}
                      onClick={() => { seg.onClick(); setShowHiddenPath(false); }}
                      style={{ background: '#313244', border: '1px solid #45475a', borderRadius: '6px', padding: '4px 10px', fontSize: '12px', color: '#cdd6f4', cursor: 'pointer', touchAction: 'manipulation', whiteSpace: 'nowrap' }}
                    >
                      {seg.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {focusedNode
        ? (mobileKeyframeEditor && mobileKeyframeEditor.nodeId === focusedNode.id
            ? renderKeyframeEditorView(focusedNode)
            : (focusedNode.type === 'exprNode' ? renderExprBlockDetail(focusedNode) : renderNodeDetail(focusedNode)))
        : (homeGraphView ? renderHomeGraph() : renderHome())}

      {renderGraphNavigatorOverlay()}
      {renderGroupPortBuilderOverlay()}
      {renderLongPressMenu()}
    </div>
  );

  // ── Long-press context menu — top-level (not nested in renderHome) so it
  // keeps rendering across whatever renderHome does; also lets its own
  // "feed this input"/"add output consumer" rows reuse the exact same
  // pending/setPending → renderSocketOverlays flow every other socket "+"
  // button uses, by jumping focus onto the node first (renderSocketOverlays
  // only renders for the currently-focused node).
  function renderLongPressMenu() {
    if (!longPressMenuFor) return null;
    const node = nodes.find(n => n.id === longPressMenuFor);
    if (!node) return null;
    const originalLocked = !!node.params?._groupOriginal && !!getNodeDefinition(node.type)?.anchored;
    const canDelete = node.type !== 'output' && !originalLocked;
    const openInputs = Object.entries(node.inputs).filter(([, inp]) => !inp.connection);
    const outputs = Object.entries(node.outputs);
    const close = () => setLongPressMenuFor(null);
    const feedInput = (key: string, type: string) => {
      setFocusStack([node.id]); setForwardStack([]);
      setPending({ dir: 'input', nodeId: node.id, key, type });
      close();
    };
    const feedOutput = (key: string, type: string) => {
      setFocusStack([node.id]); setForwardStack([]);
      setPending({ dir: 'output', nodeId: node.id, key, type });
      close();
    };
    const rowBtnStyle: React.CSSProperties = {
      display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '9px 10px',
      background: '#181825', border: '1px solid #313244', borderRadius: '8px', marginBottom: '6px',
      color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left',
    };
    const sectionLabelStyle: React.CSSProperties = {
      fontSize: '10px', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
      color: '#6c7086', margin: '10px 0 6px',
    };
    return (
      <div
        onClick={close}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 46, display: 'flex', alignItems: 'flex-end' }}
      >
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '80%', overflowY: 'auto', background: '#1e1e2e', borderRadius: '16px 16px 0 0', border: '1px solid #45475a', padding: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <div style={dotStyle(nodeDotColor(node))} />
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#ffffff', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelFor(node)}</div>
          </div>
          {canDelete && (
            <button
              onClick={() => { removeNode(node.id); close(); }}
              style={{ ...rowBtnStyle, border: '1px solid #f38ba866', color: '#f38ba8' }}
            >
              🗑 Delete
            </button>
          )}
          {openInputs.length > 0 && (
            <>
              <div style={sectionLabelStyle}>Add a node to an open input</div>
              {openInputs.map(([key, inp]) => (
                <button key={key} onClick={() => feedInput(key, inp.type)} style={rowBtnStyle}>
                  <div style={dotStyle(TYPE_COLORS[inp.type] ?? '#888')} />
                  {inp.label}
                </button>
              ))}
            </>
          )}
          {outputs.length > 0 && (
            <>
              <div style={sectionLabelStyle}>Add a node consuming an output</div>
              {outputs.map(([key, out]) => (
                <button key={key} onClick={() => feedOutput(key, out.type)} style={rowBtnStyle}>
                  <div style={dotStyle(TYPE_COLORS[out.type] ?? '#888')} />
                  {out.label}
                </button>
              ))}
            </>
          )}
          {!canDelete && openInputs.length === 0 && outputs.length === 0 && (
            <div style={{ fontSize: '11px', color: '#585b70', padding: '4px 0' }}>Nothing available for this node.</div>
          )}
        </div>
      </div>
    );
  }

  // ── Group port builder overlay — top-level (not nested in a node's own
  // detail) since "Add Output" → "Add New Node" briefly enters the group,
  // which swaps the whole dispatch away from the group's own detail view
  // (focusStack resets to []); this needs to keep rendering across that.
  function renderGroupPortBuilderOverlay() {
    if (!groupPortBuilder) return null;
    const dirLabel = groupPortBuilder.dir === 'input' ? 'Input' : 'Output';
    const scopeHint = groupPortBuilder.dir === 'input'
      ? 'from outside the group'
      : 'from inside the group';
    return (
      <div
        onClick={() => setGroupPortBuilder(null)}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 45, display: 'flex', alignItems: 'flex-end' }}
      >
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '80%', overflowY: 'auto', background: '#1e1e2e', borderRadius: '16px 16px 0 0', border: '1px solid #45475a', padding: '16px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#89b4fa', marginBottom: '4px' }}>
            Add {dirLabel}
          </div>
          {groupPortBuilder.stage === 'choose' && (
            <>
              <div style={{ fontSize: '11px', color: '#6c7086', marginBottom: '12px' }}>
                Pick the node {scopeHint} that supplies this port’s value.
              </div>
              <button
                style={{ width: '100%', padding: '12px', marginBottom: '8px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={() => setGroupPortBuilder(b => b && { ...b, stage: 'pickExisting' })}
              >
                Connect Existing Node
              </button>
              <button
                style={{ width: '100%', padding: '12px', background: '#313244', border: '1px solid #45475a', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation' }}
                onClick={startGroupPortAddNew}
              >
                Add New Node
              </button>
            </>
          )}
          {groupPortBuilder.stage === 'pickExisting' && (() => {
            const candidates = groupPortBuilder.dir === 'output'
              ? groupBuilderSubgraphNodes
              : nodes.filter(n => n.id !== groupPortBuilder.groupId && !wouldCreateCycle(nodes, n.id, groupPortBuilder.groupId));
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {candidates.length === 0 && (
                  <div style={{ fontSize: '11px', color: '#585b70', padding: '8px 0' }}>
                    {groupPortBuilder.dir === 'output' ? 'No nodes inside this group yet — try "Add New Node" instead.' : 'No compatible nodes yet — try "Add New Node" instead.'}
                  </div>
                )}
                {candidates.map(n => {
                  const outKey = Object.keys(n.outputs)[0];
                  if (!outKey) return null;
                  return (
                    <button
                      key={n.id}
                      onClick={() => commitGroupPortFromNode(n.id, outKey, n.outputs[outKey].type, n.outputs[outKey].label)}
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px', background: '#181825', border: '1px solid #313244', borderRadius: '8px', color: '#cdd6f4', fontSize: '13px', cursor: 'pointer', touchAction: 'manipulation', textAlign: 'left' }}
                    >
                      <div style={dotStyle(nodeDotColor(n))} />
                      {labelFor(n)}
                    </button>
                  );
                })}
              </div>
            );
          })()}
        </div>
        {groupPortBuilder.stage === 'addNew' && (
          <NodeSearchPalette
            open
            onClose={() => setGroupPortBuilder(null)}
            onNodePlaced={handleGroupPortNodePlaced}
          />
        )}
      </div>
    );
  }
}
