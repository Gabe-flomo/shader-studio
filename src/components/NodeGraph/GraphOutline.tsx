/**
 * GraphOutline — a list view of the current scope's nodes, in the order the
 * shader evaluates them, with a step-through mode.
 *
 * Click a row to select the node and centre the canvas on it. Double-click a
 * group to enter it. "Step through" walks the graph one node at a time: each
 * step isolates that node in the preview (the same as the eye button), selects
 * it, centres it, and — with the Generated code panel open — highlights its
 * GLSL lines, so you can watch the picture build up node by node.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { getNodeDefinitionFor } from '../../nodes/definitions';
import { topologicalSort } from '../../compiler/topoSort';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { categoryColor } from '../../theme/categories';
import { IconButton, Button } from '../ui/Button';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { explainPreview, previewLegend } from '../../lib/previewExplain';

const GROUP_TYPES = new Set(['group', 'sceneGroup', 'spaceWarpGroup', 'marchLoopGroup', 'giLitMarchGroup']);
const OUTPUT_TYPES = new Set(['output', 'vec4Output']);

function labelOf(n: GraphNode): string {
  const def = getNodeDefinitionFor(n);
  return (typeof n.params.label === 'string' && n.params.label.trim()) || def?.label || n.type;
}

/** Evaluation order for the list; falls back to canvas order if the graph has a cycle. */
function evaluationOrder(nodes: readonly GraphNode[]): GraphNode[] {
  try { return topologicalSort([...nodes]); } catch { return [...nodes]; }
}

export function GraphOutline({ nodes, top, onClose }: { nodes: readonly GraphNode[]; top: number; onClose: () => void }) {
  // Drag the panel by its header; the offset from the default corner is remembered
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(() => {
    try { const raw = localStorage.getItem('shader-studio:settings:outlinePos'); return raw ? JSON.parse(raw) as { dx: number; dy: number } : null; } catch { return null; }
  });
  const dragStart = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragStart.current = { x: e.clientX, y: e.clientY, dx: drag?.dx ?? 0, dy: drag?.dy ?? 0 };
    const move = (ev: PointerEvent) => {
      const s0 = dragStart.current; if (!s0) return;
      setDrag({ dx: s0.dx + (ev.clientX - s0.x), dy: Math.max(-top + 8, s0.dy + (ev.clientY - s0.y)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setDrag(d => { try { if (d) localStorage.setItem('shader-studio:settings:outlinePos', JSON.stringify(d)); } catch { /* private mode */ } return d; });
      dragStart.current = null;
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const tk = useTokens();
  const mode = useThemeMode();
  const activeGroupPath = useNodeGraphStore(s => s.activeGroupPath);
  const selectedNodeId = useNodeGraphStore(s => s.selectedNodeId);
  const previewNodeId = useNodeGraphStore(s => s.previewNodeId);
  const selectNode = useNodeGraphStore(s => s.selectNode);
  const setSelectedNodeId = useNodeGraphStore(s => s.setSelectedNodeId);
  const setPreviewNodeId = useNodeGraphStore(s => s.setPreviewNodeId);
  const revealNode = useNodeGraphStore(s => s.revealNode);
  const enterGroup = useNodeGraphStore(s => s.enterGroup);

  const [query, setQuery] = useState('');
  const ordered = useMemo(() => evaluationOrder(nodes), [nodes]);
  const steps = useMemo(() => ordered.filter(n => !OUTPUT_TYPES.has(n.type)), [ordered]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ordered.filter(n => labelOf(n).toLowerCase().includes(q) || n.type.toLowerCase().includes(q)) : ordered;
  }, [ordered, query]);

  // ── Step-through ────────────────────────────────────────────────────────────
  // `stepIdx` indexes `steps`; `steps.length` is the final result (no isolation).
  // The step is tied to the scope it started in, so entering or leaving a
  // group ends the walk without an effect.
  const scopeKey = activeGroupPath.join('/');
  const [step, setStep] = useState<{ scope: string; idx: number } | null>(null);
  const stepIdx = step && step.scope === scopeKey ? step.idx : null;
  const setStepIdx = (idx: number | null) => setStep(idx === null ? null : { scope: scopeKey, idx });
  const stepping = stepIdx !== null;
  const previewStats = useNodeGraphStore(s => s.previewStats);
  const stepNode = stepping && stepIdx !== null && stepIdx < steps.length ? steps[stepIdx] : null;
  const stepCaption = stepNode ? (explainPreview(stepNode, getNodeDefinitionFor(stepNode), previewStats) ?? previewLegend(stepNode, getNodeDefinitionFor(stepNode))) : null;
  const goTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(steps.length, idx));
    setStepIdx(clamped);
    if (clamped === steps.length) {
      setPreviewNodeId(null);
      const out = ordered.find(n => OUTPUT_TYPES.has(n.type));
      if (out) { setSelectedNodeId(out.id); selectNode(out.id, false); revealNode(activeGroupPath, out.id); }
      return;
    }
    const n = steps[clamped];
    setSelectedNodeId(n.id);
    selectNode(n.id, false);
    setPreviewNodeId(n.id);
    revealNode(activeGroupPath, n.id);
  };
  const stopStepping = () => { setStepIdx(null); if (previewNodeId) setPreviewNodeId(null); };
  // Closing the panel mid-walk drops the isolation too.
  const steppingRef = useRef(false);
  useEffect(() => { steppingRef.current = stepping; }, [stepping]);
  useEffect(() => () => { if (steppingRef.current) setPreviewNodeId(null); }, [setPreviewNodeId]);

  const listRef = useRef<HTMLDivElement>(null);
  const activeId = stepping ? (stepIdx === steps.length ? null : steps[stepIdx!]?.id) : selectedNodeId;
  useEffect(() => {
    if (!activeId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-outline-id="${activeId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!stepping) return;
    if (e.key === 'ArrowRight' || e.key === ']') { e.preventDefault(); goTo(stepIdx! + 1); }
    if (e.key === 'ArrowLeft' || e.key === '[') { e.preventDefault(); goTo(stepIdx! - 1); }
    if (e.key === 'Escape') { e.preventDefault(); stopStepping(); }
  };

  return (
    <div
      role="region"
      aria-label="Graph outline"
      tabIndex={-1}
      onKeyDown={onKey}
      onMouseDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      style={{
        position: 'absolute', top: top + (drag?.dy ?? 0), right: 16 - (drag?.dx ?? 0), width: 280, maxHeight: `calc(100% - ${top + (drag?.dy ?? 0) + 16}px)`, zIndex: 20,
        display: 'flex', flexDirection: 'column', borderRadius: 12, overflow: 'hidden',
        background: tk.bg.panel, boxShadow: tk.shadow.float, font: `12.5px ${fontFamily.ui}`, color: tk.text.primary,
      }}
    >
      <div onPointerDown={onHeaderPointerDown} title="Drag to move the panel" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 8px 8px 12px', borderBottom: `1px solid ${tk.border.subtle}`, cursor: 'grab', touchAction: 'none' }}>
        <Icon name="layoutGraph" size={15} style={{ color: tk.text.muted }} />
        <b style={{ fontSize: 13, flex: 1 }}>Outline</b>
        <span style={{ fontSize: 11.5, color: tk.text.faint }}>{ordered.length} nodes</span>
        <IconButton icon="close" label="Close outline" size="sm" onClick={() => { stopStepping(); onClose(); }} />
      </div>

      {/* Step-through controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px', background: stepping ? tk.bg.selected : tk.bg.subtle, borderBottom: `1px solid ${tk.border.subtle}` }}>
        {stepping ? (
          <>
            <IconButton icon="chevL" label="Previous node ([ or ←)" size="sm" disabled={stepIdx === 0} onClick={() => goTo(stepIdx! - 1)} />
            <span style={{ flex: 1, textAlign: 'center', font: `600 12px ${fontFamily.mono}`, color: tk.accent.base }}>
              {stepIdx === steps.length ? 'Final result' : `${stepIdx! + 1} / ${steps.length}`}
            </span>
            <IconButton icon="chevR" label="Next node (] or →)" size="sm" disabled={stepIdx === steps.length} onClick={() => goTo(stepIdx! + 1)} />
            <Button size="sm" variant="ghost" onClick={stopStepping}>Done</Button>
          </>
        ) : (
          <>
            <Button size="sm" icon="play" style={{ flex: 1 }} disabled={steps.length === 0} onClick={() => goTo(0)}
              title="Walk the graph one node at a time: each step shows that node's output in the preview">
              Step through
            </Button>
            <span style={{ fontSize: 11, color: tk.text.faint, lineHeight: 1.3, flex: 1.4 }}>Shows what each node adds, first to last.</span>
          </>
        )}
      </div>
      {stepping && (
        <div style={{ padding: '6px 12px', fontSize: 11.5, color: tk.text.muted, borderBottom: `1px solid ${tk.border.subtle}`, lineHeight: 1.4 }}>
          {stepCaption ?? <>The preview shows this node on its own. Open <b>Generated code</b> to see its GLSL lines highlighted.</>}
        </div>
      )}

      <div style={{ padding: '6px 8px 4px' }}>
        <Field placeholder="Find a node…" height={28} value={query} onChange={e => setQuery(e.target.value)}
          leading={<Icon name="search" size={13} style={{ color: tk.text.faint }} />} />
      </div>

      <div ref={listRef} style={{ overflowY: 'auto', padding: '0 6px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {shown.length === 0 && <div style={{ padding: '8px 6px', color: tk.text.faint }}>No nodes match.</div>}
        {shown.map(n => {
          const def = getNodeDefinitionFor(n);
          const isGroup = GROUP_TYPES.has(n.type);
          const isOut = OUTPUT_TYPES.has(n.type);
          const active = n.id === activeId;
          const stepNo = steps.indexOf(n);
          return (
            <button
              key={n.id}
              type="button"
              data-outline-id={n.id}
              onClick={() => {
                if (stepping && stepNo >= 0) { goTo(stepNo); return; }
                setSelectedNodeId(n.id); selectNode(n.id, false); revealNode(activeGroupPath, n.id);
              }}
              onDoubleClick={() => { if (isGroup) { stopStepping(); enterGroup(n.id); } }}
              title={isGroup ? `${labelOf(n)} · double-click to enter` : def?.description ? String(def.description) : labelOf(n)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px', border: 0, borderRadius: radius.md, textAlign: 'left',
                cursor: 'pointer', color: tk.text.primary, font: `12.5px ${fontFamily.ui}`,
                background: active ? tk.bg.selected : 'transparent',
                boxShadow: active ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
              }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = tk.bg.hover; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ width: 20, textAlign: 'right', font: `500 10.5px ${fontFamily.mono}`, color: tk.text.faint, flexShrink: 0 }}>
                {isOut ? '=' : stepNo + 1}
              </span>
              <span style={{ width: 8, height: 8, borderRadius: isGroup ? 2 : '50%', flexShrink: 0, background: categoryColor(def?.category ?? 'Utility', mode) }} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{labelOf(n)}</span>
              {isGroup && <Icon name="chevR" size={13} style={{ color: tk.text.faint }} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
