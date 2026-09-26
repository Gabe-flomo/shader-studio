/**
 * ConstantsModal — the editor for a Constants card: one row per entry with its
 * name, type, value(s) and whether it's live (a slider) or fixed. Applying
 * rewrites the card's entries, params and output sockets in one undo step;
 * wires to an output that no longer exists are dropped.
 */
import { useState } from 'react';
import type { GraphNode } from '../../types/nodeGraph';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';
import { constantsItems, rangeFor, type ConstantsItem, type ConstantsItemType } from '../../nodes/definitions/constants';
import { NumberInput } from './NumberInput';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';

const TYPES: { value: ConstantsItemType; label: string }[] = [{ value: 'float', label: 'number' }, { value: 'vec2', label: 'vec2' }, { value: 'vec3', label: 'vec3' }, { value: 'color', label: 'colour' }];
const COUNT: Record<ConstantsItemType, number> = { float: 1, vec2: 2, vec3: 3, color: 3 };

const slug = (label: string, taken: Set<string>): string => {
  let k = label.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'value';
  const base = k; let i = 2;
  while (taken.has(k)) k = `${base}_${i++}`;
  return k;
};
const hex = (v: number[]) => '#' + v.map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('');
const fromHex = (h: string): number[] | null => { const m = /^#?([0-9a-f]{6})$/i.exec(h.trim()); if (!m) return null; return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255); };

export function ConstantsModal({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  const tk = useTokens();
  const setConstantsItems = useNodeGraphStore(s => s.setConstantsItems);
  const [items, setItems] = useState<ConstantsItem[]>(() => constantsItems(node).map(it => ({ ...it, value: Array.isArray(it.value) ? [...it.value] : it.value })));
  const update = (i: number, patch: Partial<ConstantsItem>) => setItems(list => list.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  const retype = (i: number, type: ConstantsItemType) => {
    const it = items[i]; const n = COUNT[type];
    const cur = Array.isArray(it.value) ? it.value : [it.value];
    const value = n === 1 ? cur[0] ?? 0 : Array.from({ length: n }, (_, k) => cur[k] ?? (type === 'color' ? 0.5 : 0));
    update(i, { type, value });
  };
  const add = () => {
    const taken = new Set(items.map(it => it.key));
    const key = slug(`k${items.length + 1}`, taken);
    setItems([...items, { key, label: key, type: 'float', value: 1, slider: false }]);
  };
  const rename = (i: number, label: string) => {
    const taken = new Set(items.filter((_, k) => k !== i).map(it => it.key));
    update(i, { label, key: slug(label, taken) });
  };
  const apply = () => { setConstantsItems(node.id, items); onClose(); };

  const cell = { color: tk.text.faint, font: `600 10px ${fontFamily.ui}`, letterSpacing: '0.06em', textTransform: 'uppercase' as const };
  return (
    <Modal
      title="Constants"
      subtitle="Named values, each an output. Fixed until its slider is on."
      icon="hash"
      width={640}
      onClose={onClose}
      footer={
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <Button size="sm" icon="plus" onClick={add}>Add a value</Button>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="primary" onClick={apply} disabled={items.length === 0}>Apply</Button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1.2fr) 96px minmax(180px, 2fr) 72px 28px', gap: '6px 8px', alignItems: 'center' }}>
        <span style={cell}>Name</span><span style={cell}>Type</span><span style={cell}>Value</span><span style={cell}>Live</span><span />
        {items.map((it, i) => (
          <RowFragment key={i} it={it} onLabel={l => rename(i, l)} onType={t => retype(i, t)} onValue={v => update(i, { value: v })} onSlider={on => update(i, { slider: on, ...(on && it.type === 'float' && it.min === undefined ? rangeFor(it.value as number) : {}) })} onRemove={() => setItems(items.filter((_, k) => k !== i))} />
        ))}
      </div>
      {items.length === 0 && <div style={{ color: tk.text.faint, padding: '14px 0 4px' }}>No values yet. Add one.</div>}
      <div style={{ marginTop: 14, padding: '8px 10px', borderRadius: radius.md, background: tk.bg.subtle, color: tk.text.muted, fontSize: 11.5, lineHeight: 1.5 }}>
        A fixed value is baked into the shader and only changes here. A live value gets a slider on the card, can be keyframed, and can be a Play control. This card takes no inputs.
      </div>
    </Modal>
  );
}

function RowFragment({ it, onLabel, onType, onValue, onSlider, onRemove }: { it: ConstantsItem; onLabel: (l: string) => void; onType: (t: ConstantsItemType) => void; onValue: (v: number | number[]) => void; onSlider: (on: boolean) => void; onRemove: () => void }) {
  const tk = useTokens();
  const vals = Array.isArray(it.value) ? it.value : [it.value];
  const num = { width: 62, height: 28, borderRadius: radius.md, border: 0, background: tk.bg.field, color: tk.text.primary, font: `500 12px ${fontFamily.mono}`, textAlign: 'center' as const };
  return (
    <>
      <Field value={it.label} height={30} onChange={e => onLabel(e.target.value)} aria-label="Name" placeholder="name" />
      <Select ariaLabel="Type" value={it.type} height={30} onChange={v => onType(v as ConstantsItemType)} options={TYPES} />
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {it.type === 'color' && <input type="color" aria-label="Colour" value={hex(vals)} onChange={e => { const c = fromHex(e.target.value); if (c) onValue(c); }} style={{ width: 34, height: 28, padding: 0, border: 0, borderRadius: radius.md, background: 'transparent', cursor: 'pointer' }} />}
        {vals.map((v, k) => (
          <NumberInput key={k} value={v} step={it.type === 'color' ? 0.01 : undefined} onCommit={n => onValue(vals.length === 1 ? n : vals.map((x, j) => (j === k ? n : x)))} format={n => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''))} style={num} aria-label={`Value ${k + 1}`} />
        ))}
      </div>
      <Toggle checked={it.slider} onChange={onSlider} label={it.slider ? 'live' : 'fixed'} />
      <IconButton icon="trash" label="Remove" size="sm" tone="danger" onClick={onRemove} />
    </>
  );
}
