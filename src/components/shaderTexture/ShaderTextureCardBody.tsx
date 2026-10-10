/**
 * The Shader Texture's card body and the panel shown while you are inside one
 * (docs/texture-builder.md). Both show the texture live: the pass runner draws a thumbnail of each
 * pass into the canvas registered under its node id (lib/passRunner.ts passThumbRegistry), and a
 * Shader Texture's pass has the node's id. Only one of the two is mounted at a time (the card is
 * off screen while you are inside), so they share the key.
 */
import { useEffect, useRef, useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useTokens } from '../../theme/themeStore';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { passThumbRegistry } from '../../lib/passRunner';
import { getPerfSnapshot } from '../../lib/perfStats';
import { SHADER_TEXTURE_SIZES, SHADER_TEXTURE_STARTERS, shaderTextureUpdate } from '../../nodes/definitions/shaderTexture';
import { restartShaderTexture } from '../../nodes/shaderTextureStarters';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const UPDATE_TEXT = { change: 'on change', frame: 'every frame', once: 'once' } as const;

/** Registers a canvas for the node's live texture; returns its ref and a status line (size, GPU time). */
function useLiveTexture(nodeId: string) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    passThumbRegistry.register(nodeId, c);
    return () => passThumbRegistry.unregister(nodeId);
  }, [nodeId]);
  const [status, setStatus] = useState('');
  useEffect(() => {
    const read = () => {
      const st = useNodeGraphStore.getState();
      const p = (st.programMap?.passes ?? st.passes)?.find(q => q.nodeId === nodeId && !q.hidden);
      const ms = p ? getPerfSnapshot().passes.find(r => r.name === `pass:${p.slug}`)?.avg : undefined;
      const size = ref.current?.dataset.size;
      const text = [size, ms == null ? null : `${ms.toFixed(2)} ms GPU when drawn`].filter(Boolean).join(' · ');
      setStatus(prev => (prev === text ? prev : text));
    };
    read();
    const t = setInterval(read, 500);
    return () => clearInterval(t);
  }, [nodeId]);
  return { ref, status };
}

function summary(node: GraphNode): string {
  const size = SHADER_TEXTURE_SIZES.find(s => s.value === String(node.params.size ?? '512'))?.label ?? '512 × 512';
  return `${size} · updates ${UPDATE_TEXT[shaderTextureUpdate(node.params.update)]}`;
}

/** On the card: the texture, Edit inside, and Start from (top level only). */
export function ShaderTextureCardBody({ node, onEnterGroup }: { node: GraphNode; onEnterGroup?: (id: string) => void }) {
  const tk = useTokens();
  const { ref, status } = useLiveTexture(node.id);
  const topLevel = useNodeGraphStore(s => s.activeGroupPath.length === 0 && s.nodes.some(n => n.id === node.id));
  const btn = {
    font: `500 11px ${MONO}`, padding: '3px 8px', borderRadius: 6, cursor: 'pointer',
    background: tk.bg.field, color: tk.text.secondary, border: `1px solid ${tk.border.default}`,
  } as const;
  const restart = (starter: string) => {
    useNodeGraphStore.getState().rewriteTopLevel((nodes, nextId) => restartShaderTexture(nodes, node.id, starter, nextId), `Started ${typeof node.params.label === 'string' ? node.params.label : 'Shader Texture'} over from ${starter}`);
  };
  return (
    <div data-shader-texture-card style={{ padding: '6px 10px 8px', borderBottom: `1px solid ${tk.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 6 }}
      onMouseDown={e => e.stopPropagation()}>
      <canvas ref={ref} width={128} height={128}
        onDoubleClick={() => onEnterGroup?.(node.id)}
        title="The texture this node draws. Double-click to edit its graph."
        style={{ display: 'block', width: 128, height: 128, margin: '0 auto', background: '#000', borderRadius: 4, cursor: 'pointer' }} />
      <div style={{ fontSize: 10, color: tk.text.faint, fontFamily: MONO, textAlign: 'center' }}>{summary(node)}{status ? <><br />{status}</> : null}</div>
      <button type="button" style={{ ...btn, background: tk.ink.base, color: tk.ink.text, border: 'none' }} onClick={() => onEnterGroup?.(node.id)}>
        Edit inside
      </button>
      {topLevel && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: tk.text.faint, fontFamily: MONO }}>Start from</span>
          {SHADER_TEXTURE_STARTERS.map(s => (
            <button key={s.value} type="button" style={btn} title={`Replace the graph inside with the ${s.label.toLowerCase()} starter (undo brings it back)`}
              onClick={() => restart(s.value)}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Inside a Shader Texture: its live texture, what it is and a way back out. */
export function ShaderTextureInsidePanel({ node, top }: { node: GraphNode; top: number }) {
  const tk = useTokens();
  const { ref, status } = useLiveTexture(node.id);
  const exitGroup = useNodeGraphStore(s => s.exitGroup);
  return (
    <div data-shader-texture-inside style={{
      position: 'absolute', top, right: 12, zIndex: 20, width: 220, padding: 10, borderRadius: 10,
      background: tk.bg.panel, boxShadow: '0 6px 24px rgba(0,0,0,0.18)', border: `1px solid ${tk.border.subtle}`,
      display: 'flex', flexDirection: 'column', gap: 6, color: tk.text.secondary, fontSize: 12, userSelect: 'none',
    }} onMouseDown={e => e.stopPropagation()}>
      <strong style={{ fontSize: 12 }}>{typeof node.params.label === 'string' && node.params.label ? node.params.label : 'Shader Texture'}</strong>
      <canvas ref={ref} width={128} height={128} style={{ display: 'block', width: 200, height: 200, background: '#000', borderRadius: 6, imageRendering: node.params.filter === 'nearest' ? 'pixelated' : 'auto' }} />
      <div style={{ fontSize: 10, color: tk.text.faint, fontFamily: MONO }}>{summary(node)}{status ? <><br />{status}</> : null}</div>
      <div style={{ fontSize: 11, lineHeight: 1.4, color: tk.text.muted }}>
        What reaches Texture Output is drawn into this texture. UV runs −1 to 1 across its square.
      </div>
      <button type="button" onClick={() => exitGroup()} style={{
        font: `500 11px ${MONO}`, padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: tk.bg.field, color: tk.text.secondary, border: `1px solid ${tk.border.default}`,
      }}>Done (Esc)</button>
    </div>
  );
}
