/**
 * "→ Transform" on an old transform card (Transform 2D, UV Transform 2D, Rotate 2D, Translate / Rotate /
 * Scale 3D, the 4D ones): replaces it in place with the universal Transform that gives the same picture
 * (nodes/toTransform.ts, docs/transform-node.md). Disabled, with why, when part of it can't be carried.
 *
 * A switch that is the same picture up to float rounding (an angle carried from radians to degrees:
 * UV Transform 2D, Rotate 2D's slider, Rotate 3D) asks first: the pill opens a note with Switch / Keep.
 * Right-click: switch every old transform node in the graph; when some of them differ by rounding, a
 * short list shows which are exact and which aren't, to leave the inexact ones out.
 */
import { useMemo, useRef, useState } from 'react';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { INEXACT_NOTE, planToTransform, previewSwitchAll, switchAllChoice, type SwitchAllPreview } from '../../nodes/toTransform';

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
  const { reason, inexact } = useMemo(() => {
    const plan = planToTransform([], node, {
      playTargets: k => (play.controls ?? []).some(c => { const p = c.target.split('::'); return p[p.length - 2] === node.id && p[p.length - 1] === k; }),
      groupOverride: k => !!parentParams && `${node.id}::${k}` in parentParams,
    });
    return { reason: plan ? (plan.ok ? null : plan.reason ?? 'It can\'t be switched exactly') : 'Not a transform node', inexact: plan?.ok ? plan.inexact ?? null : null };
  }, [node, play, parentParams]);
  const off = !!reason;
  const pillRef = useRef<HTMLButtonElement>(null);
  const [asking, setAsking] = useState(false);
  const [all, setAll] = useState<SwitchAllPreview | null>(null);

  const switchAll = () => {
    const st = useNodeGraphStore.getState();
    const preview = previewSwitchAll(st.nodes, st.play);
    // All exact (or nothing to switch): as before, straight away. Some off by rounding: show the list first.
    if (!preview.inexact.length) { st.switchToTransform('all'); return; }
    setAll(preview);
  };

  return (
    <>
      <button
        ref={pillRef}
        type="button"
        data-switch-to-transform={off ? 'off' : inexact ? 'inexact' : 'on'}
        aria-disabled={off || undefined}
        aria-expanded={inexact ? asking : undefined}
        title={off
          ? `Can't switch to Transform: ${reason}. Nothing was changed.`
          : inexact
            ? `Switch to Transform: ${inexact}. Click to choose. Right-click: switch every old transform node in the graph.`
            : 'Switch to Transform: the same picture from the one Transform node, wires, settings and keyframes kept (one undo step). Right-click: switch every old transform node in the graph.'}
        onMouseDown={e => e.stopPropagation()}
        onClick={e => {
          e.stopPropagation();
          if (off) return;
          if (inexact) { setAsking(a => !a); return; }
          useNodeGraphStore.getState().switchToTransform([node.id]);
        }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); switchAll(); }}
        style={{
          flexShrink: 0, height: 22, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '0 8px 0 6px',
          border: 0, borderRadius: 11, cursor: off ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: off ? 0.5 : 1,
          background: off ? tk.bg.field : alpha(tk.accent.base, 0.12), color: off ? tk.text.faint : tk.accent.text,
          font: `600 11.5px ${fontFamily.ui}`,
        }}
      >
        <Icon name="bidir" size={12} />
        Transform{inexact ? ' ≈' : ''}
      </button>
      {asking && inexact && (
        <Popover anchorRef={pillRef} onClose={() => setAsking(false)} align="end" width={260} padding={10}>
          <div data-switch-to-transform-note onMouseDown={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ font: `600 12px ${fontFamily.ui}`, color: tk.text.primary }}>{INEXACT_NOTE}</div>
            <div style={{ font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.muted }}>
              Its angle converts from radians to degrees, so the result can differ by about one part in a million. You won&rsquo;t see it in the picture.
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Keep</Button>
              <Button size="sm" variant="primary" onClick={() => { setAsking(false); useNodeGraphStore.getState().switchToTransform([node.id]); }}>Switch</Button>
            </div>
          </div>
        </Popover>
      )}
      {all && <SwitchAllDialog preview={all} onClose={() => setAll(null)} />}
    </>
  );
}

/**
 * Switch all, when some switches differ by rounding: the exact ones and the rounding ones in two groups,
 * each with a switch for the group and a box per node, and the ones that can't switch with why.
 */
export function SwitchAllDialog({ preview, onClose }: { preview: SwitchAllPreview; onClose: () => void }) {
  const tk = useTokens();
  const [exact, setExact] = useState(true);
  const [inexact, setInexact] = useState(true);
  const [offIds, setOffIds] = useState<ReadonlySet<string>>(new Set());
  const chosen = switchAllChoice(preview, { exact, inexact, off: offIds });
  const flip = (id: string) => setOffIds(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const go = () => {
    onClose();
    if (chosen.size) useNodeGraphStore.getState().switchToTransform([...chosen]);
  };
  const group = (title: string, hint: string, on: boolean, setOn: (v: boolean) => void, items: SwitchAllPreview['exact'], testId: string) => items.length > 0 && (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderTop: `1px solid ${tk.border.subtle}` }}>
      <Toggle checked={on} onChange={setOn} label={<span style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>{title} ({items.length})</span>} />
      <div style={{ font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.muted }}>{hint}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 4 }}>
        {items.map(x => (
          <label key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 8, font: `12px ${fontFamily.ui}`, color: on ? tk.text.secondary : tk.text.faint, cursor: on ? 'pointer' : 'default' }}>
            <input type="checkbox" disabled={!on} checked={on && !offIds.has(x.id)} onChange={() => flip(x.id)} style={{ margin: 0, accentColor: tk.accent.base }} />
            {x.label}
          </label>
        ))}
      </div>
    </div>
  );
  return (
    <Modal
      title="Switch all to Transform"
      subtitle="Each old transform node becomes one Transform, as one undo step"
      icon="bidir"
      onClose={onClose}
      width={440}
      footer={(
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
          <Button variant="ghost" onClick={onClose}>Keep all</Button>
          <Button variant="primary" disabled={!chosen.size} onClick={go}>{chosen.size ? `Switch ${chosen.size}` : 'Nothing to switch'}</Button>
        </div>
      )}
    >
      <div style={{ padding: '4px 20px 12px' }}>
        {group('Exact', 'The same numbers before and after.', exact, setExact, preview.exact, 'switch-all-exact')}
        {group('Tiny rounding difference', `${INEXACT_NOTE}: an angle converts from radians to degrees (about one part in a million).`, inexact, setInexact, preview.inexact, 'switch-all-inexact')}
        {preview.skipped.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '10px 0', borderTop: `1px solid ${tk.border.subtle}` }}>
            <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.primary }}>Can&rsquo;t switch ({preview.skipped.length})</div>
            {preview.skipped.map(x => (
              <div key={x.id} style={{ font: `12px/1.45 ${fontFamily.ui}`, color: tk.text.muted }}><b style={{ color: tk.text.secondary }}>{x.label}</b>: {x.reason}</div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
