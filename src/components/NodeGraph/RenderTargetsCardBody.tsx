/**
 * The Render Targets card's editor (nodes/definitions/renderTargets.ts, docs/render-targets.md): one
 * row per target (name, what it stores, its precision, how it reads), up to four, all drawn at once.
 */
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { FIELD_TYPES } from '../../nodes/definitions/dataTexture';
import { MAX_TARGETS, targetsOf, type RenderTarget } from '../../nodes/definitions/renderTargets';

const FORMATS: Array<[RenderTarget['format'], string]> = [['float', 'full float'], ['half', 'half'], ['byte', '8-bit']];
const READS: Array<[RenderTarget['read'], string]> = [['exact', 'exact'], ['smooth', 'smooth']];

export function RenderTargetsCardBody({ node, touch = false }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const targets = targetsOf(node);
  const set = (t: RenderTarget[]) => update(node.id, { targets: t });
  const edit = (i: number, patch: Partial<RenderTarget>) => set(targets.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const field = {
    padding: touch ? '6px 7px' : '3px 5px', border: `1px solid ${tk.border.default}`, borderRadius: radius.sm,
    background: tk.bg.field, color: tk.text.primary, font: `500 11.5px ${fontFamily.ui}`, minWidth: 0,
  } as const;
  return (
    <div style={{ padding: '4px 12px 8px 16px', display: 'flex', flexDirection: 'column', gap: 6 }} onMouseDown={e => e.stopPropagation()}>
      <span style={{ font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>
        Targets: drawn together, once per pixel
      </span>
      {targets.map((t, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ font: `700 10.5px ${fontFamily.mono}`, color: tk.text.faint, width: 12 }}>{i + 1}</span>
          <input aria-label={`Target ${i + 1} name`} value={t.name} style={{ ...field, flex: 1 }} onChange={e => edit(i, { name: e.target.value })} />
          <select aria-label={`Target ${i + 1} type`} value={t.type} style={field} onChange={e => edit(i, { type: e.target.value as RenderTarget['type'] })}>
            {FIELD_TYPES.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
          <select aria-label={`Target ${i + 1} precision`} value={t.format} style={field} title="How exactly it keeps values" onChange={e => edit(i, { format: e.target.value as RenderTarget['format'] })}>
            {FORMATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select aria-label={`Target ${i + 1} read`} value={t.read} style={field} title="Exact: one texel, never blended (data). Smooth: blended (pictures)." onChange={e => edit(i, { read: e.target.value as RenderTarget['read'] })}>
            {READS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {targets.length > 1 && (
            <button type="button" aria-label={`Remove target ${i + 1}`} onClick={() => set(targets.filter((_, j) => j !== i))}
              style={{ border: 0, background: 'transparent', color: tk.text.faint, cursor: 'pointer', font: `600 13px ${fontFamily.ui}`, padding: '0 2px' }}>×</button>
          )}
        </div>
      ))}
      {targets.length < MAX_TARGETS && (
        <button type="button" onClick={() => set([...targets, { name: `target ${targets.length + 1}`, type: 'vec4', format: 'half', read: 'smooth' }])}
          style={{ alignSelf: 'flex-start', padding: touch ? '7px 9px' : '3px 8px', border: `1px dashed ${tk.border.strong}`, borderRadius: radius.sm, background: 'transparent', color: tk.text.muted, font: `600 11px ${fontFamily.ui}`, cursor: 'pointer' }}>
          + Target
        </button>
      )}
      <span style={{ fontSize: 11, lineHeight: 1.4, color: tk.text.muted }}>
        Each target is a texture output and its last frame. Read them with Read channels. The picture above is target 1.
      </span>
    </div>
  );
}
