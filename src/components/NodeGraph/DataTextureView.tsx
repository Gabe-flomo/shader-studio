/**
 * A Data Texture's preview (docs/data-texture.md, "Preview"): the card's thumbnail with its view
 * (Raw / Range / Channels / Arrows, lib/thumbView.ts), and the big window it opens: a large view
 * with the exact stored value under the cursor, the inputs and outputs editor, and the storage settings.
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import type { GraphNode } from '../../types/nodeGraph';
import { passThumbRegistry } from '../../lib/passRunner';
import { THUMB_MODES, bigThumbKey, type ThumbMode } from '../../lib/thumbView';
import { getNodeDefinition } from '../../nodes/definitions';
import { fieldsOf } from '../../nodes/definitions/dataTexture';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { Button } from '../ui/Button';
import { NumberInput } from './NumberInput';
import { DataTextureCardBody } from './DataTextureCardBody';

const VIEW_LABELS: Record<ThumbMode, string> = { raw: 'Raw', range: 'Range', channels: 'Channels', arrows: 'Arrows' };
const VIEW_HINTS: Record<ThumbMode, string> = {
  raw: 'The stored colour as it is, clipped to 0…1.',
  range: 'Each channel from Min…Max to black…white: negative and large values show.',
  channels: 'r, g, b and a side by side, each from Min…Max.',
  arrows: 'r and g as a vector at each place: an arrow per cell, over its length in grey.',
};

export const viewOf = (n: GraphNode) => {
  const mode = (THUMB_MODES as readonly string[]).includes(String(n.params.previewView)) ? (n.params.previewView as ThumbMode) : 'raw';
  const lo = Number.isFinite(Number(n.params.previewMin)) ? Number(n.params.previewMin) : -1;
  const hi = Number.isFinite(Number(n.params.previewMax)) ? Number(n.params.previewMax) : 1;
  return { mode, lo, hi };
};

/** A canvas the runner draws a node's texture into, with the node's view. */
function ViewCanvas({ node, regKey, width, style, onProbe }: {
  node: GraphNode; regKey: string; width: number; style?: React.CSSProperties;
  onProbe?: (value: number[] | null, at: [number, number] | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { mode, lo, hi } = viewOf(node);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    passThumbRegistry.register(regKey, c);
    return () => passThumbRegistry.unregister(regKey);
  }, [regKey]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.dataset.view = mode; c.dataset.lo = String(lo); c.dataset.hi = String(hi); c.dataset.w = String(width);
  }, [mode, lo, hi, width]);
  // The value under the cursor: the runner reads the texel (`probe`) and writes it back (`probeValue`).
  useEffect(() => {
    if (!onProbe) return;
    const t = setInterval(() => {
      const c = ref.current;
      if (!c?.dataset.probe) return;
      const v = (c.dataset.probeValue ?? '').split(',').map(Number);
      onProbe(v.length === 4 ? v : null, c.dataset.probe.split(',').map(Number) as [number, number]);
    }, 150);
    return () => clearInterval(t);
  }, [onProbe]);
  const move = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c || !onProbe) return;
    const r = c.getBoundingClientRect();
    let u = (e.clientX - r.left) / r.width, v = 1 - (e.clientY - r.top) / r.height;
    // Channels shows four strips: the cursor's place within its strip.
    if (mode === 'channels') u = (u * 4) % 1;
    u = Math.min(1, Math.max(0, u)); v = Math.min(1, Math.max(0, v));
    c.dataset.probe = `${u.toFixed(4)},${v.toFixed(4)}`;
  };
  const leave = () => { const c = ref.current; if (c) { delete c.dataset.probe; delete c.dataset.probeValue; } onProbe?.(null, null); };
  return <canvas ref={ref} width={width} height={Math.round(width * 9 / 16)} onMouseMove={move} onMouseLeave={leave}
    style={{ display: 'block', background: '#000', borderRadius: 3, imageRendering: 'pixelated', ...style }} />;
}

/** View chips (and Min…Max when the view uses them). */
function ViewControls({ node, compact = false, extra }: { node: GraphNode; compact?: boolean; extra?: React.ReactNode }) {
  const tk = useTokens();
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const { mode, lo, hi } = viewOf(node);
  const chip = (on: boolean) => ({
    padding: compact ? '1px 6px' : '3px 9px', borderRadius: radius.sm, border: 0, cursor: 'pointer',
    background: on ? tk.bg.selected : tk.bg.field, color: on ? tk.accent.text : tk.text.muted, font: `600 ${compact ? 10 : 11.5}px ${fontFamily.ui}`,
  });
  const num = { width: compact ? 46 : 64, font: `500 ${compact ? 10 : 11.5}px ${fontFamily.mono}` };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} onMouseDown={e => e.stopPropagation()}>
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {THUMB_MODES.map(m => (
        <button key={m} type="button" style={chip(m === mode)} title={VIEW_HINTS[m]} aria-pressed={m === mode}
          onClick={() => update(node.id, { previewView: m })}>{VIEW_LABELS[m]}</button>
      ))}
      {extra}
    </div>
    {mode !== 'raw' && <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ font: `500 ${compact ? 10 : 11.5}px ${fontFamily.ui}`, color: tk.text.faint }}>Min</span>
        <NumberInput value={lo} step={0.1} style={num} title="The value shown as black (Arrows: the scale)" onCommit={v => update(node.id, { previewMin: v })} />
        <span style={{ font: `500 ${compact ? 10 : 11.5}px ${fontFamily.ui}`, color: tk.text.faint }}>Max</span>
        <NumberInput value={hi} step={0.1} style={num} title="The value shown as white" onCommit={v => update(node.id, { previewMax: v })} />
      </div>}
    </div>
  );
}

/** The card's preview: the texture in its view, the view chips, and Open for the big window. */
export function DataTextureThumb({ node }: { node: GraphNode }) {
  const tk = useTokens();
  const [open, setOpen] = useState(false);
  const live = useNodeGraphStore(s => s.nodes.find(n => n.id === node.id)) ?? node;
  return (
    <div style={{ padding: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ViewCanvas node={live} regKey={live.id} width={128} style={{ maxWidth: '100%', maxHeight: 120, margin: '0 auto' }} />
      <ViewControls node={live} compact extra={
        <button type="button" onMouseDown={e => e.stopPropagation()} onClick={() => setOpen(true)} title="Open a big view, the value under the cursor and the editor"
          style={{ marginLeft: 'auto', border: 0, borderRadius: radius.sm, background: tk.bg.field, color: tk.text.primary, font: `600 10px ${fontFamily.ui}`, padding: '1px 7px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Open ↗
        </button>
      } />
      {open && createPortal(<DataTextureWindow nodeId={live.id} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}

const fmt = (v: number) => (Number.isFinite(v) ? (Math.abs(v) >= 1000 || (v !== 0 && Math.abs(v) < 0.001) ? v.toExponential(3) : v.toFixed(4)) : '—');

/** The big window: a large view with the exact value under the cursor, the editor and the storage settings. */
export function DataTextureWindow({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const tk = useTokens();
  const node = useNodeGraphStore(s => s.nodes.find(n => n.id === nodeId));
  const update = useNodeGraphStore(s => s.updateNodeParams);
  const [probe, setProbe] = useState<{ v: number[]; at: [number, number] } | null>(null);
  if (!node) return null;
  const defs = getNodeDefinition('dataTexture')!.paramDefs!;
  const label = typeof node.params.label === 'string' && node.params.label.trim() ? node.params.label.trim() : 'Data Texture';
  // What a stored texel means: Range storage is undone, and each channel named by the input it holds.
  const range = node.params.storage === 'range';
  const lo = Number(node.params.rangeMin ?? -1), hi = Number(node.params.rangeMax ?? 1);
  const decode = (v: number) => (range ? lo + v * (hi - lo) : v);
  const owner = new Map<string, string>();
  for (const f of fieldsOf(node)) [...f.channels].forEach((c, i) => owner.set(c, f.type === 'float' ? f.name : `${f.name}.${'xyzw'[i]}`));
  const setting = (key: string) => {
    const d = defs[key];
    if (d.showWhen && node.params[d.showWhen.param] !== d.showWhen.value) return null;
    return (
      <label key={key} style={{ display: 'grid', gridTemplateColumns: '90px 1fr', alignItems: 'center', gap: 8 }} title={d.hint}>
        <span style={{ color: tk.text.muted }}>{d.label}</span>
        {d.type === 'select'
          ? <Select ariaLabel={d.label} value={String(node.params[key])} options={d.options!} onChange={v => update(nodeId, { [key]: v })} />
          : <NumberInput value={Number(node.params[key] ?? 0)} step={d.step} onCommit={v => update(nodeId, { [key]: v })} />}
      </label>
    );
  };
  return (
    <Modal title={label} subtitle="Data Texture · what is stored, and how it reads back" icon="table" width={1180} height={720} onClose={onClose}
      headerActions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div style={{ display: 'flex', gap: 16, padding: 16, height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ViewControls node={node} />
          <ViewCanvas node={node} regKey={bigThumbKey(nodeId)} width={768} style={{ maxWidth: '100%', maxHeight: 'calc(100% - 110px)', width: 'auto', height: 'auto', alignSelf: 'center', cursor: 'crosshair' }}
            onProbe={(v, at) => setProbe(v && at ? { v, at } : null)} />
          <div style={{ font: `500 12px ${fontFamily.mono}`, color: tk.text.secondary, minHeight: 36, lineHeight: 1.5 }}>
            {probe ? <>
              <div style={{ color: tk.text.faint }}>at ({probe.at[0].toFixed(3)}, {probe.at[1].toFixed(3)}){range ? ` · Range ${lo}…${hi} undone` : ''}</div>
              <div>{[...'rgba'].map((c, i) => <span key={c} style={{ marginRight: 14 }}><b>{c}</b> {fmt(decode(probe.v[i]))}{owner.has(c) ? <span style={{ color: tk.text.faint }}> {owner.get(c)}</span> : null}</span>)}</div>
            </> : <span style={{ color: tk.text.faint }}>Hover the picture to read the stored value there, exactly.</span>}
          </div>
        </div>
        <div style={{ flex: '0 0 400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ border: `1px solid ${tk.border.default}`, borderRadius: radius.md, paddingTop: 6 }}>
            <DataTextureCardBody node={node} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, font: `500 12px ${fontFamily.ui}` }}>
            <span style={{ font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase', color: tk.text.faint }}>Storage</span>
            {['format', 'read', 'storage', 'rangeMin', 'rangeMax', 'scale', 'wrap'].map(setting)}
          </div>
        </div>
      </div>
    </Modal>
  );
}
