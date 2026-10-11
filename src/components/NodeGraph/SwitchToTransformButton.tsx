/**
 * "→ Transform" on an old transform card (Transform 2D, UV Transform 2D, Rotate 2D, Translate / Rotate /
 * Scale 3D, the 4D ones): replaces it in place with the universal Transform that gives the same picture
 * (nodes/toTransform.ts, docs/transform-node.md). Disabled, with why, when part of it can't be carried
 * exactly. Right-click: switch every old transform node in the graph.
 */
import { useMemo } from 'react';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { planToTransform } from '../../nodes/toTransform';

export function SwitchToTransformButton({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const play = useNodeGraphStore(s => s.play);
  // The group the card is in (its own card may set this node's settings: `<id>::<key>`).
  const parentParams = useNodeGraphStore(s => {
    let level = s.nodes;
    let parent: GraphNode | undefined;
    for (const id of s.activeGroupPath) {
      parent = level.find(n => n.id === id);
      const sg = parent?.params.subgraph as SubgraphData | undefined;
      if (!sg) return undefined;
      level = sg.nodes;
    }
    return parent?.params;
  });
  const reason = useMemo(() => {
    const plan = planToTransform([], node, {
      playTargets: k => (play.controls ?? []).some(c => { const p = c.target.split('::'); return p[p.length - 2] === node.id && p[p.length - 1] === k; }),
      groupOverride: k => !!parentParams && `${node.id}::${k}` in parentParams,
    });
    return plan ? (plan.ok ? null : plan.reason ?? 'It can\'t be switched exactly') : 'Not a transform node';
  }, [node, play, parentParams]);
  const off = !!reason;
  return (
    <button
      type="button"
      data-switch-to-transform={off ? 'off' : 'on'}
      aria-disabled={off || undefined}
      title={off
        ? `Can't switch to Transform: ${reason}. Nothing was changed.`
        : 'Switch to Transform: the same picture from the one Transform node, wires, settings and keyframes kept (one undo step). Right-click: switch every old transform node in the graph.'}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => { e.stopPropagation(); if (!off) useNodeGraphStore.getState().switchToTransform([node.id]); }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); useNodeGraphStore.getState().switchToTransform('all'); }}
      style={{
        flexShrink: 0, height: 22, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px 0 6px',
        border: 0, borderRadius: 11, cursor: off ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: off ? 0.5 : 1,
        background: off ? tk.bg.field : alpha(tk.accent.base, 0.12), color: off ? tk.text.faint : tk.accent.text,
        font: `600 11.5px ${fontFamily.ui}`,
      }}
    >
      <Icon name="bidir" size={12} />
      Transform
    </button>
  );
}
