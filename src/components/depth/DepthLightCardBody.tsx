/**
 * The Depth Light card's own lines (docs/depth-node.md "Link to a scene object"): what the light follows, "Link to
 * scene object…" (a list of the shapes and Translate 3D nodes in the Scene Groups the graph draws), Unlink, and
 * "Add a light" (another Depth Light chained after this one, linked to another object). The edits are pure
 * (nodes/sceneLink.ts) and land as one undo step each.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { Button } from '../ui/Button';
import { addLinkedLight, lightLinkOf, linkableScenes, linkColourSource, linkLight, linkTargets, staticCentre, unlinkLight, unlinkedTargets } from '../../nodes/sceneLink';

// Which picker is open on which card: outside the component, so it survives the card re-rendering when it is selected.
const usePicker = create<Record<string, 'link' | 'add' | null>>(() => ({}));

const sceneName = (s: GraphNode) => (typeof s.params.label === 'string' && s.params.label) || 'Scene Group';
const fmt = (v: number[]) => v.map(x => (Math.round(x * 100) / 100).toString()).join(', ');

export function DepthLightCardBody({ node }: { node: GraphNode; touch?: boolean }) {
  const tk = useTokens();
  const inGroup = useNodeGraphStore(s => s.activeGroupPath.length > 0);
  const picking = usePicker(s => s[node.id] ?? null);
  const setPicking = (v: 'link' | 'add' | null | ((p: 'link' | 'add' | null) => 'link' | 'add' | null)) =>
    usePicker.setState(s => ({ [node.id]: typeof v === 'function' ? v(s[node.id] ?? null) : v }));
  const link = lightLinkOf(node);
  // Narrow selectors (the perf rules): the whole graph only while the picker is open.
  const nodes = useNodeGraphStore(s => (picking ? s.nodes : null));
  const hasScenes = useNodeGraphStore(s => s.nodes.some(n => n.type === 'sceneGroup'));
  const linkedScene = useNodeGraphStore(s => (link ? s.nodes.find(n => n.id === link.scene) : undefined));
  const scenes = useMemo(() => (nodes ? linkableScenes(nodes, node) : []), [nodes, node]);
  const line = { fontSize: 11.5, color: tk.text.muted, lineHeight: 1.45 } as const;
  if (inGroup) return null;

  const stillWired = !!link && node.inputs.lightPos?.connection?.nodeId === link.scene;
  const colour = link && linkedScene ? linkColourSource(useNodeGraphStore.getState().nodes, linkedScene, link.object) : null;

  const pick = (sceneId: string, objectId: string, label: string) => {
    const st = useNodeGraphStore.getState();
    if (picking === 'add') st.rewriteTopLevel((ns, nextId) => addLinkedLight(ns, node.id, sceneId, objectId, nextId())?.nodes ?? null, `Added a light following ${label}`);
    else st.rewriteTopLevel(ns => linkLight(ns, node.id, sceneId, objectId), `Linked the light to ${label}`);
    setPicking(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 8px' }} onMouseDown={e => e.stopPropagation()}>
      {link && linkedScene && stillWired ? (
        <span style={line} data-testid="depth-light-link">
          Follows <b style={{ color: tk.text.primary }}>{link.label}</b> in {sceneName(linkedScene)}{colour ? ', and takes its colour' : ''}. It moves when the object does (its sliders, Play, time).
        </span>
      ) : (
        <span style={line}>Light position: {node.inputs.lightPos?.connection ? 'wired' : 'the sliders below'}. Link it to a shape in the scene to have it follow.</span>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" disabled={!hasScenes} onClick={() => setPicking(p => (p === 'link' ? null : 'link'))}
          title={hasScenes ? 'Pick a shape or Translate inside a Scene Group: the light goes where it is, and takes its colour when it has one' : 'No Scene Group in the graph'}>
          {link ? 'Link to another object…' : 'Link to scene object…'}
        </Button>
        {link && <Button size="sm" variant="ghost" onClick={() => useNodeGraphStore.getState().rewriteTopLevel(ns => unlinkLight(ns, node.id), 'Unlinked the light')}>Unlink</Button>}
        <Button size="sm" variant="ghost" disabled={!hasScenes} onClick={() => setPicking(p => (p === 'add' ? null : 'add'))}
          title="Another Depth Light after this one (chained), linked to another object: one light each">
          Add a light
        </Button>
      </div>
      {picking && (
        <div role="listbox" aria-label={picking === 'add' ? 'Object for the new light' : 'Object to follow'} data-testid="depth-light-picker"
          style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 6, borderRadius: radius.md, background: tk.bg.subtle, maxHeight: 220, overflowY: 'auto' }}>
          <span style={line}>{picking === 'add' ? 'The new light follows:' : 'Follow:'}</span>
          {scenes.map(s => {
            const free = new Set(unlinkedTargets(nodes ?? [], s).map(t => t.id));
            const targets = linkTargets(s);
            return (
              <div key={s.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ ...line, fontWeight: 600, color: tk.text.primary }}>{sceneName(s)}</span>
                {targets.length === 0 && <span style={line}>No shapes or Translate 3D nodes inside.</span>}
                {targets.map(t => (
                  <button key={t.id} type="button" role="option" aria-selected={link?.object === t.id} onClick={() => pick(s.id, t.id, t.label)}
                    style={{ all: 'unset', cursor: 'pointer', padding: '4px 6px', borderRadius: radius.control, fontSize: 12, color: tk.text.primary, background: link?.object === t.id ? tk.bg.hover : 'transparent', display: 'flex', gap: 6 }}>
                    <span style={{ flex: 1 }}>{t.label}{!free.has(t.id) ? ' (has a light)' : ''}</span>
                    <span style={{ color: tk.text.faint, fontVariantNumeric: 'tabular-nums' }}>{t.kind === 'translate' ? 'at' : 'centre'} {fmt(staticCentre(s, t.id))}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
