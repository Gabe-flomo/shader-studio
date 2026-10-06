/**
 * SuggestionStrip — the selected node's next moves (docs/suggestions.md): the top few moves for
 * what it carries (a distance, a space, a colour…), ranked by your own graphs and by what its
 * preview shows, each with a one-line why. A click applies the move in place (one undo step).
 *
 * It sits under the card (above it when there is no room below), so it never covers a socket:
 * sockets are on the card's left and right edges. Hidden while dragging, while a starter-recipe
 * offer is open, on a locked canvas, and with the × (the canvas toolbar's Suggestions button
 * brings it back). No scrim, no focus taken.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Tooltip } from '../ui/Tooltip';
import { portalGuard } from '../ui/portalGuard';
import { toast } from '../ui/toastStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useRecipeOffer } from '../../store/recipeOfferStore';
import { getCardSize, isDragging } from './socketRegistry';
import { previewBus } from '../../lib/nodePreview/previewBus';
import { measureField, suggestionsFor, subscribeLearning, learningVersion, type OutputMeasurement, type RankedMove } from '../../suggestions';
import { setSuggestionsShown, useSuggestionsShown } from '../../suggestions/settings';
import type { GraphNode } from '../../types/nodeGraph';

const WIDTH = 300;
const GAP = 10;
const MARGIN = 8;
const LIMIT = 5;

export function SuggestionStrip({ nodes, canvasRef, pan, zoom, readOnly }: {
  nodes: GraphNode[];
  canvasRef: RefObject<HTMLDivElement | null>;
  pan: { x: number; y: number };
  zoom: number;
  readOnly?: boolean;
}) {
  const on = useSuggestionsShown();
  const selectedId = useNodeGraphStore(s => (s.selectedNodeIds.length <= 1 ? s.selectedNodeId : null));
  const offerOpen = useRecipeOffer(s => !!s.offer);
  const node = selectedId ? nodes.find(n => n.id === selectedId) : undefined;
  if (!on || readOnly || !node || offerOpen) return null;
  return <Strip key={node.id} node={node} nodes={nodes} canvasRef={canvasRef} pan={pan} zoom={zoom} />;
}

/** The latest preview measurement of this node, refreshed at most once a second. */
function useMeasurement(nodeId: string): OutputMeasurement | null {
  const [m, setM] = useState<OutputMeasurement | null>(null);
  useEffect(() => {
    let last = 0;
    const take = () => {
      const f = previewBus.get();
      if (!f || f.nodeId !== nodeId) { setM(prev => (prev ? null : prev)); return; }
      const now = performance.now();
      if (now - last < 1000) return;
      last = now;
      setM(measureField(f.nodeId, f.outputKey, f.field, f.stats));
    };
    take();
    return previewBus.subscribe(take);
  }, [nodeId]);
  return m;
}

function Strip({ node, nodes, canvasRef, pan, zoom }: {
  node: GraphNode;
  nodes: GraphNode[];
  canvasRef: RefObject<HTMLDivElement | null>;
  pan: { x: number; y: number };
  zoom: number;
}) {
  const tk = useTokens();
  const ref = useRef<HTMLDivElement>(null);
  const learned = useSyncExternalStore(subscribeLearning, learningVersion, learningVersion);
  const measurement = useMeasurement(node.id);
  const moves = useMemo<RankedMove[]>(() => {
    void learned;
    try { return suggestionsFor(node, nodes, { measurement, limit: LIMIT }); } catch { return []; }
  }, [node, nodes, measurement, learned]);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => { setDragging(isDragging(node.id)); raf = requestAnimationFrame(tick); };
    const down = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); };
    const up = () => { cancelAnimationFrame(raf); setDragging(false); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointerup', up, true); };
  }, [node.id]);

  // Under the card, left-aligned with it; above when there is no room below. Always on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    const view = canvasRef.current?.getBoundingClientRect();
    if (!el || !view) return;
    const size = getCardSize(node.id) ?? { w: 360, h: 200 };
    const r = el.getBoundingClientRect();
    const left = view.left + pan.x + node.position.x * zoom;
    const top = view.top + pan.y + node.position.y * zoom;
    const bottom = top + size.h * zoom;
    let y = bottom + GAP;
    if (y + r.height > view.bottom - MARGIN && top - GAP - r.height >= view.top + MARGIN) y = top - GAP - r.height;
    const x = Math.max(view.left + MARGIN, Math.min(left, view.right - r.width - MARGIN));
    el.style.left = `${x}px`;
    el.style.top = `${Math.max(view.top + MARGIN, Math.min(y, view.bottom - r.height - MARGIN))}px`;
    // Off screen entirely (the card scrolled away): hide rather than pin to an edge.
    el.style.visibility = bottom < view.top || top > view.bottom || left > view.right || left + size.w * zoom < view.left ? 'hidden' : 'visible';
  });

  if (!moves.length || dragging) return null;

  const apply = (m: RankedMove) => {
    useNodeGraphStore.getState().applySuggestion(node.id, m.key, m.side, m.move.id, m.args ?? {});
  };
  const hide = () => {
    setSuggestionsShown(false);
    toast.info('Suggestions hidden', { message: 'The Suggestions button in the canvas toolbar brings them back.' });
  };

  return createPortal(
    <div
      {...portalGuard}
      ref={ref}
      role="toolbar"
      aria-label="Suggestions"
      data-suggestion-strip={node.id}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left: -9999, top: 0, zIndex: 880, width: WIDTH, maxWidth: `calc(100vw - ${MARGIN * 2}px)`, boxSizing: 'border-box',
        background: tk.bg.panel, color: tk.text.primary, border: `1px solid ${tk.border.default}`, borderRadius: radius.lg,
        boxShadow: tk.shadow.popover, font: `12px ${fontFamily.ui}`, overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 4px 3px 9px' }}>
        <Icon name="bolt" size={12} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <Tooltip label="Suggestions learn from your graphs" description="Ranked by what you wire in your own saved graphs (imports count half, recent wiring counts too); the bundled examples only help while there is little of yours. It all stays on this device. Reset learning is in Files → App settings → Studio.">
          <span style={{ fontSize: 11, color: tk.text.muted, cursor: 'default' }}>Next · <span style={{ color: tk.text.faint }}>learns from your graphs</span></span>
        </Tooltip>
        <span style={{ marginLeft: 'auto' }} />
        <IconButton icon="close" size="sm" label="Hide suggestions" onClick={hide} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 5px 5px' }}>
        {moves.map(m => <MoveRow key={`${m.move.id}:${m.key}`} move={m} onClick={() => apply(m)} />)}
      </div>
    </div>,
    document.body,
  );
}

function MoveRow({ move, onClick }: { move: RankedMove; onClick: () => void }) {
  const tk = useTokens();
  const [hover, setHover] = useState(false);
  const tone = move.reason === 'output' ? tk.status.warning : move.reason === 'you' ? tk.accent.base : tk.text.faint;
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={`${move.move.label}: ${move.why}${move.side === 'in' ? ` (in front of ${move.key})` : ''}`}
      data-move={move.move.id}
      style={{
        display: 'flex', alignItems: 'baseline', gap: 7, width: '100%', boxSizing: 'border-box', minWidth: 0,
        padding: '4px 7px', textAlign: 'left', cursor: 'pointer', borderRadius: radius.control, border: 0,
        background: hover ? tk.bg.hover : 'transparent', font: `12px ${fontFamily.ui}`,
      }}
    >
      <span style={{ width: 5, height: 5, borderRadius: 3, flexShrink: 0, alignSelf: 'center', background: move.reason === 'kind' ? alpha(tk.text.faint, 0.5) : tone }} />
      <span style={{ fontWeight: 600, color: tk.text.primary, whiteSpace: 'nowrap', flexShrink: 0 }}>{move.move.label}</span>
      <span style={{ fontSize: 11, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{move.why}</span>
    </button>
  );
}

/** The canvas toolbar's Suggestions toggle. */
export function SuggestionsToggle() {
  const on = useSuggestionsShown();
  return <IconButton icon="bolt" size="sm" active={on} label={on ? 'Hide the suggestions under the selected node' : 'Suggestions: next moves under the selected node, learned from your graphs'} onClick={() => setSuggestionsShown(!on)} />;
}
