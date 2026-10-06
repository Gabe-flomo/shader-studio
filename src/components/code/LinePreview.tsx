/**
 * Line previews in the code editors (docs/node-previews.md, "Line previews"): a ▶ on each input,
 * line and Return opens a panel under the lines with that variable's value over the whole picture,
 * computed on the GPU with the block's real inputs. It is the eye preview pointed at a temporary
 * probe (lib/nodePreview/lineProbe.ts): the same value path, async readback, Show as and Detail.
 * ↑ / ↓ (or the panel's ⌃ ⌄ buttons, for touch) walk the inputs, the lines and Return while the
 * panel is open.
 */
import { useEffect, useRef } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { ValuePreview } from '../NodeGraph/ValuePreview';
import { previewBus } from '../../lib/nodePreview/previewBus';
import { valueKey } from '../../lib/nodePreview/valueField';
import { applyProbe, probeSteps, resolveProbe, sameTarget, stepProbe, useLineProbe, type ProbeTarget } from '../../lib/nodePreview/lineProbe';
import { Select } from '../ui/Select';

// The eye's node before a probe took it, given back when the probe ends.
let eyeBefore: { had: boolean; id: string | null } = { had: false, id: null };

/** Show `target` of `node` in the line preview (the eye moves onto the block for it). */
export function startLineProbe(node: GraphNode, target: ProbeTarget) {
  const st = useNodeGraphStore.getState();
  const lp = useLineProbe.getState();
  if (!lp.probe) eyeBefore = { had: true, id: st.previewNodeId };
  lp.set({ nodeId: node.id, target });
  if (st.previewNodeId !== node.id) st.setPreviewNodeId(node.id); // compiles
  else st.compile();
}

/** End the probe: the eye goes back to what it showed before. */
export function stopLineProbe() {
  const lp = useLineProbe.getState();
  if (!lp.probe) return;
  const nodeId = lp.probe.nodeId;
  lp.set(null);
  const st = useNodeGraphStore.getState();
  const back = eyeBefore.had ? eyeBefore.id : nodeId;
  eyeBefore = { had: false, id: null };
  if (st.previewNodeId === nodeId && back !== nodeId) st.setPreviewNodeId(back);
  else st.compile();
}

/** The ▶ next to an input, a line or Return. */
export function ProbeButton({ node, target, label }: { node: GraphNode; target: ProbeTarget; label: string }) {
  const tk = useTokens();
  const on = useLineProbe(s => !!s.probe && s.probe.nodeId === node.id && sameTarget(s.probe.target, target));
  return (
    <button type="button" data-probe={JSON.stringify(target)} aria-pressed={on} aria-label={label} title={`${label} (↑ / ↓ step while it's open)`}
      onMouseDown={e => e.preventDefault()}
      onClick={() => (on ? stopLineProbe() : startLineProbe(node, target))}
      style={{
        width: 26, height: 26, flexShrink: 0, padding: 0, border: 0, borderRadius: radius.sm, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: on ? alpha(tk.accent.base, 0.14) : 'none', color: on ? tk.accent.base : tk.text.faint,
      }}>
      <Icon name="play" size={12} />
    </button>
  );
}

/** The panel: header (which line, its range), the preview with Show as, and the stepping keys. */
export function LinePreviewPanel({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const probe = useLineProbe(s => (s.probe && s.probe.nodeId === node.id ? s.probe : null));
  const eyeHere = useNodeGraphStore(s => s.previewNodeId === node.id);
  const errors = useNodeGraphStore(s => s.glslErrors.length);
  const rangeRef = useRef<HTMLSpanElement>(null);

  // The eye moved to another node: this probe is over
  useEffect(() => { if (probe && !eyeHere) useLineProbe.getState().set(null); }, [probe, eyeHere]);
  // Closing the editor ends the probe
  useEffect(() => () => { if (useLineProbe.getState().probe?.nodeId === node.id) stopLineProbe(); }, [node.id]);

  // Step to the next (1) or previous (-1) input, line or Return
  const step = (dir: 1 | -1) => {
    const cur = useLineProbe.getState().probe;
    if (cur?.nodeId !== node.id) return;
    const next = stepProbe(node, cur.target, dir);
    if (!sameTarget(next, cur.target)) startLineProbe(node, next);
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  // ↑ / ↓ step through the inputs, lines and Return (not while typing in a field)
  useEffect(() => {
    if (!probe) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable || el.getAttribute('role') === 'listbox')) return;
      e.preventDefault();
      e.stopPropagation();
      stepRef.current(e.key === 'ArrowDown' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [probe, node]);

  // The header's range, from each readback (no re-render)
  useEffect(() => {
    if (!probe) return;
    const paint = () => {
      const f = previewBus.get();
      const el = rangeRef.current;
      if (!el) return;
      el.textContent = f && f.nodeId === node.id ? ` · range ${valueKey(f.stats, f.field.type, 'raw')}` : '';
    };
    paint();
    return previewBus.subscribe(paint);
  }, [probe, node.id]);

  if (!probe) return null;
  const resolved = resolveProbe(node, probe.target);
  const applied = applyProbe(node, probe.target);
  const problem = 'error' in applied ? applied.error : null;
  return (
    <div data-line-preview="" style={{ border: `1px solid ${tk.border.default}`, borderRadius: radius.lg, overflow: 'hidden', background: tk.bg.subtle }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px 7px 12px', borderBottom: `1px solid ${tk.border.subtle}`, background: tk.bg.panel }}>
        <Icon name="play" size={12} style={{ color: tk.accent.base, flexShrink: 0 }} />
        <span data-line-preview-head="" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: `500 12px ${fontFamily.mono}`, color: tk.text.primary }}>
          {'error' in resolved ? 'Preview' : resolved.label}
          <span ref={rangeRef} style={{ color: tk.text.muted }} />
        </span>
        {/* ↑ / ↓ as buttons too: a touch screen has no arrow keys (and they keep the code's focus) */}
        {(['up', 'down'] as const).map(dir => (
          <button key={dir} type="button" data-probe-step={dir} aria-label={dir === 'up' ? 'Preview the line above (↑)' : 'Preview the line below (↓)'}
            title={dir === 'up' ? 'Previous: the line above (↑)' : 'Next: the line below (↓)'}
            onMouseDown={e => e.preventDefault()}
            onClick={() => step(dir === 'down' ? 1 : -1)}
            style={{ width: 26, height: 26, border: 0, borderRadius: radius.sm, background: 'none', color: tk.text.muted, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon name={dir === 'up' ? 'chevU' : 'chevD'} size={14} />
          </button>
        ))}
        <button type="button" aria-label="Close the line preview" title="Close (the eye goes back to what it showed)" onClick={stopLineProbe}
          style={{ width: 26, height: 26, border: 0, borderRadius: radius.sm, background: 'none', color: tk.text.faint, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="close" size={13} />
        </button>
      </div>
      {(problem || errors > 0) && (
        <div data-line-preview-error="" style={{ padding: '6px 12px', font: `500 12px/1.4 ${fontFamily.ui}`, color: tk.status.warningText, background: alpha(tk.status.danger, 0.06) }}>
          {problem ? `${problem} The picture is the last one that worked.` : 'This doesn’t compile yet, so the picture is the last one that did.'}
        </div>
      )}
      <ValuePreview node={node} />
    </div>
  );
}

/**
 * Custom Function: its body is free-form GLSL, so instead of a ▶ per line a picker lists what can be
 * previewed: the inputs, each named local the body declares (float / vec2 / vec3 / vec4), and Return.
 */
export function ProbePicker({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const probe = useLineProbe(s => (s.probe && s.probe.nodeId === node.id ? s.probe : null));
  const steps = probeSteps(node);
  const keyOf = (t: ProbeTarget) => (t.kind === 'local' ? `local:${t.name}` : JSON.stringify(t));
  const labelOf = (t: ProbeTarget) => {
    const r = resolveProbe(node, t);
    return 'error' in r ? keyOf(t) : r.label;
  };
  const current = probe ? keyOf(probe.target) : '';
  return (
    <div data-probe-picker="" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ font: `500 12px ${fontFamily.ui}`, color: tk.text.muted }}>Preview a variable</span>
      <Select
        ariaLabel="Variable to preview"
        mono
        value={current}
        style={{ minWidth: 220, maxWidth: '100%' }}
        options={[...(current ? [] : [{ value: '', label: 'Choose…' }]), ...steps.map(t => ({ value: keyOf(t), label: labelOf(t) }))]}
        onChange={v => { const t = steps.find(s => keyOf(s) === v); if (t) startLineProbe(node, t); }}
      />
    </div>
  );
}
