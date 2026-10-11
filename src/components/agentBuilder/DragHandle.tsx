/**
 * DragHandle — a handle on an Agent Builder diagram that you drag to change a setting
 * (docs/agent-builder.md "Dragging the diagrams"): the feelers, Born's shape, the turn and wobble,
 * the view ring, the forces' arrows, an orbit, a field layer.
 *
 * A drag writes the same values its slider writes, live, and is one undo step (the builder's
 * `DiagramEdit.begin` marks the history, `end` folds every write since into one step). The handle is
 * a soft dot until the pointer is over it, then a ring with its cursor and a hint; while dragged it
 * is filled.
 */
import { useRef, useState } from 'react';
import type { AgentRuleSet } from '../../agentRules/spec';
import type { Pt } from '../../agentBuilder/diagram';

/** What a diagram may change, given by the builder (absent: the diagram is only drawn). */
export interface DiagramEdit {
  /** A drag starts: the setting it moves (lit in the diagram and the inspector) and the undo step's words. */
  begin(o: { label: string; setting?: string; card?: string }): void;
  /** The drag ends: its writes become one undo step. */
  end(): void;
  /** The rule set as it is now, the kind being edited, and a live rule edit (the cards' own path). */
  set: AgentRuleSet;
  sp: number;
  rules(next: AgentRuleSet): void;
  /** A setting on a node round the group (the Emit's place and size). */
  setup(nodeId: string | undefined, patch: Record<string, unknown>): void;
  emitId?: string;
}

/** Where the pointer is in the diagram's own SVG (viewport pixels). */
function inSvg(e: { clientX: number; clientY: number; currentTarget: Element }): Pt {
  const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement);
  const b = svg.getBoundingClientRect();
  return { x: e.clientX - b.left, y: e.clientY - b.top };
}

export function DragHandle({ id, at, edit, label, setting, card, hint, onMove, onStart, onEnd, colour = '#fff', cursor = 'grab', size = 6, quiet = false }: {
  id: string;
  /** Where it is drawn (viewport pixels). */
  at: Pt;
  edit: DiagramEdit;
  /** The undo step's words ("Dragged the feelers"). */
  label: string;
  setting?: string;
  card?: string;
  /** Its hover hint. */
  hint: string;
  /** The pointer at `p` now, pressed at `start` (viewport pixels). */
  onMove: (p: Pt, start: Pt) => void;
  onStart?: () => void;
  onEnd?: () => void;
  colour?: string;
  cursor?: string;
  size?: number;
  /** Draw nothing of its own until hovered (the drawing under it is the handle). */
  quiet?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [drag, setDrag] = useState(false);
  const live = useRef({ onMove, onEnd, edit });
  live.current = { onMove, onEnd, edit };
  const start = useRef<Pt | null>(null);
  const finish = () => {
    if (!start.current) return;
    start.current = null;
    setDrag(false);
    live.current.onEnd?.();
    live.current.edit.end();
  };
  const big = hover || drag;
  return (
    <g data-drag-handle={id} data-dragging={drag ? '' : undefined} style={{ pointerEvents: 'all', cursor: drag ? 'grabbing' : cursor, touchAction: 'none' }}
      onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}
      onPointerDown={e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        start.current = inSvg(e);
        setDrag(true);
        onStart?.();
        edit.begin({ label, setting, card });
      }}
      onPointerMove={e => { if (start.current) live.current.onMove(inSvg(e), start.current); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <title>{hint}</title>
      <circle cx={at.x} cy={at.y} r={Math.max(14, size + 6)} fill="transparent" />
      {big && <circle cx={at.x} cy={at.y} r={size + 6} fill="none" stroke={colour} strokeOpacity={0.55} strokeWidth={1.5} />}
      {/* Quiet: the drawing itself is the handle (a feeler's tip); only the hover ring shows. */}
      {(!quiet || drag) && <circle data-handle-dot cx={at.x} cy={at.y} r={big ? size + 1.5 : size * 0.75} fill={drag ? colour : 'rgba(13,13,18,0.75)'} stroke={colour} strokeWidth={big ? 2.2 : 1.6} opacity={big ? 1 : 0.8} fillOpacity={quiet ? 0.35 : 1} />}
    </g>
  );
}
