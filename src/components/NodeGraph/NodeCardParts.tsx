import { useEffect, useState, type ReactNode } from 'react';
import { getActiveNodes, useNodeGraphStore } from '../../store/useNodeGraphStore';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';
import { evaluateKeyframes, getKeyframeConfig } from '../../compiler/keyframes';
import { RulerSlider } from '../ui/RulerSlider';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { IconButton } from '../ui/Button';
import type { IconName } from '../ui/iconPaths';
import { subscribeTimeTick } from '../../lib/timeTick';

// Building blocks shared by the node cards (standard, group and special cards).

type Tint = 'accent' | 'success' | 'warning' | 'expr' | 'fn';

/**
 * 26px header/footer button. Stops mousedown so pressing it never starts a node drag. `on`
 * tints it (preview = success, bypass = warning, open editors = their kind colour).
 */
export function CardButton({
  icon, label, onClick, onContextMenu, on = false, tint = 'accent', tone,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  on?: boolean;
  tint?: Tint;
  tone?: 'danger';
}) {
  const tk = useTokens();
  const color = {
    accent: tk.accent.base, success: tk.status.success, warning: tk.status.warningText, expr: tk.kind.expr, fn: tk.kind.fn,
  }[tint];
  const bg = tint === 'warning' ? alpha(tk.status.warning, 0.16) : alpha(color, 0.12);
  return (
    <IconButton
      icon={icon}
      label={label}
      size="sm"
      tone={tone}
      aria-pressed={on || undefined}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onContextMenu={onContextMenu ? e => { e.preventDefault(); e.stopPropagation(); onContextMenu(e); } : undefined}
      style={on ? { background: bg, color } : undefined}
    />
  );
}

export function CardDivider() {
  const tk = useTokens();
  return <span style={{ width: 1, height: 16, background: tk.border.default, margin: '0 3px', flexShrink: 0 }} />;
}

/** Caps badge in the header ("BYPASS", "DEPRECATED"). */
export function CardBadge({ children, tone = 'warning' }: { children: ReactNode; tone?: 'warning' | 'muted' }) {
  const tk = useTokens();
  const warn = tone === 'warning';
  return (
    <span style={{
      fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', borderRadius: 5, padding: '2px 6px', flexShrink: 0,
      color: warn ? tk.status.warningText : tk.text.muted, background: warn ? alpha(tk.status.warning, 0.16) : tk.bg.field,
    }}>{children}</span>
  );
}

/** Param name at the start of a row: fixed 66px so the rulers line up. */
export function ParamLabel({ children, title, muted = false, onClick }: { children: ReactNode; title?: string; muted?: boolean; onClick?: () => void }) {
  const tk = useTokens();
  return (
    <span
      title={title}
      role={onClick ? 'link' : undefined}
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      onMouseEnter={onClick ? e => { e.currentTarget.style.textDecoration = 'underline'; } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.textDecoration = 'none'; } : undefined}
      style={{
        // 66px keeps rulers aligned; a longer label ("Angle offset") may take a little more
        minWidth: 66, maxWidth: 92, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: muted ? tk.text.faint : tk.text.secondary, fontSize: 12.5, cursor: onClick ? 'pointer' : undefined,
        textUnderlineOffset: 2,
      }}
    >{children}</span>
  );
}

/**
 * Stands in for a control whose value comes from a wire: shows where it comes from ("← Sin", or
 * "← Sin · Output" when that node has several outputs); the compiled expression is in the tooltip.
 * Clicking it goes to the source node.
 */
export function WiredChip({ source, expr, locked = false }: {
  source?: { nodeId: string; outputKey: string };
  expr?: string;
  locked?: boolean;
}) {
  const tk = useTokens();
  const label = useNodeGraphStore(s => (source ? sourceLabelOf(s.nodes, s.activeGroupPath, source.nodeId, source.outputKey) : null));
  const revealNode = useNodeGraphStore(s => s.revealNode);
  const text = label ?? (expr ? `= ${expr}` : 'wired');
  const goTo = source && !source.nodeId.startsWith('__') ? () => revealNode([], source.nodeId) : undefined;
  return (
    <span
      title={expr ? `${label ? `${label}\n` : ''}= ${expr}` : undefined}
      role={goTo ? 'link' : undefined}
      onClick={goTo ? e => { e.stopPropagation(); goTo(); } : undefined}
      style={{
        flex: 1, minWidth: 0, height: 28, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px',
        borderRadius: 7, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
        font: label ? `500 12px ${fontFamily.ui}` : `500 11.5px ${fontFamily.mono}`, cursor: goTo ? 'pointer' : undefined,
        color: locked ? tk.text.faint : tk.accent.text, background: locked ? tk.bg.field : tk.bg.selected,
      }}
    >
      {label && <span aria-hidden style={{ opacity: 0.7 }}>←</span>}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
    </span>
  );
}

/** "Sin" or "Sin · Output" for the node feeding a wire, looked up at the level being shown */
function sourceLabelOf(nodes: GraphNode[], path: string[], nodeId: string, outputKey: string): string | null {
  if (nodeId === '__group_input__') return 'Group input';
  const scope = path.length > 0 ? (getActiveNodes(nodes, path) ?? nodes) : nodes;
  const src = scope.find(n => n.id === nodeId) ?? nodes.find(n => n.id === nodeId);
  if (!src) return null;
  const name = (typeof src.params?.label === 'string' && src.params.label.trim()) || getNodeDefinition(src.type)?.label || src.type;
  const outs = Object.keys(src.outputs);
  return outs.length > 1 ? `${name} · ${src.outputs[outputKey]?.label ?? outputKey}` : name;
}

/** Small round socket for a group's surfaced param (typed colour; filled when wired). */
export function ParamSocket({ color, wired, register, onMouseUp, touch = false }: {
  color: string;
  wired: boolean;
  register: (el: HTMLDivElement | null) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  touch?: boolean;
}) {
  const tk = useTokens();
  const s = touch ? 16 : 10;
  return (
    <div
      ref={register}
      onMouseUp={onMouseUp}
      style={{
        position: 'absolute', left: -s / 2, top: '50%', width: s, height: s, marginTop: -s / 2, boxSizing: 'border-box',
        borderRadius: '50%', border: `2px solid ${color}`, background: wired ? color : tk.bg.panel, cursor: 'crosshair',
        boxShadow: wired ? `0 0 0 2px ${tk.bg.panel}` : undefined,
      }}
    />
  );
}


/**
 * Greyed ruler for a keyframed param: the chip follows the animated value live (it listens to
 * the preview's time tick), and hovering explains why it won't drag.
 */
export function KeyframedRuler({ node, socketKey, label, min, max, step, touch = false }: {
  node: GraphNode;
  socketKey: string;
  label: string;
  min: number;
  max: number;
  step: number;
  touch?: boolean;
}) {
  const cfg = getKeyframeConfig(node, socketKey);
  const [time, setTime] = useState(0);
  useEffect(() => subscribeTimeTick(setTime), []);
  const value = cfg ? evaluateKeyframes(cfg, time) : 0;
  const summary = cfg
    ? `${cfg.keyframes.length} ${cfg.keyframes.length === 1 ? 'key' : 'keys'} · ${cfg.mode === 'once' ? 'plays once' : cfg.mode === 'loop' ? 'loops' : 'smooth loop'}. Edit them from the ◆ socket.`
    : undefined;
  return (
    <RulerSlider
      value={value}
      min={Math.min(min, value)}
      max={Math.max(max, value)}
      step={step}
      onChange={() => {}}
      keyframed={{ summary }}
      ariaLabel={label}
      touch={touch}
    />
  );
}
