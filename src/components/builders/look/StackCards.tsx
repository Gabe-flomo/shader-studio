/**
 * StackCards — an ordered stack of cards for the scene builders' Look grade and Effects page
 * (builders/look/stack.ts): add a card from the row of kinds, drag a card (or use its arrows) to
 * change the order, switch it off, open it for its settings. Each number is the builders' slider,
 * so right-click offers the Play menu of the node param it builds (once built).
 */
import { useState } from 'react';
import { useTokens } from '../../../theme/themeStore';
import { alpha, radius } from '../../../theme/tokens';
import { Button, IconButton } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { Toggle } from '../../ui/Choice';
import { Select } from '../../ui/Select';
import { ColorSwatch } from '../../ui/ColorPicker';
import { BuilderSlider } from '../BuilderSlider';
import { BuilderNote } from '../BuilderWindow';
import { TexturePicker } from '../TexturePicker';
import { Row } from '../../sceneBuilder/controls';
import type { TexSource } from '../../../builders/textures';
import {
  moveStackItem, newStackItem, nextStackId, paramShown, placeStackItem, stackSummary, stackValue,
  type LookParam, type StackItem, type StackKindDef,
} from '../../../builders/look/stack';
import type { Vec3 } from '../../../builders/look/palette';

export type LazyParam = () => { nodeId: string; key: string } | { missing: string };

export interface StackCardsProps {
  /** Names the stack in data attributes and drag data ('grade', 'fx'). */
  name: string;
  items: readonly StackItem[];
  defs: readonly StackKindDef[];
  /** Changes the stack: `fn` gets a copy and returns the new list. `key` coalesces a drag into one undo step. */
  onEdit: (fn: (items: StackItem[]) => StackItem[], key?: string) => void;
  /** The node param a setting builds (right-click → Play menu). */
  playParam?: (it: StackItem, key: string) => LazyParam | undefined;
  /** Id prefix for new items ('gr', 'fx'). */
  idPrefix: string;
  /** The scene's pictures (an item that reads one). */
  sources?: readonly TexSource[];
  onAddSource?: (src: TexSource) => void;
  /** What to say when the stack is empty. */
  empty: string;
}

const edited = (items: StackItem[], id: string, fn: (x: StackItem) => void) => items.map(x => {
  if (x.id !== id) return x;
  const y = { ...x, params: { ...x.params } };
  fn(y);
  return y;
});

function ParamRow({ p, it, set, play }: { p: LookParam; it: StackItem; set: (v: StackItem['params'][string], key?: string) => void; play?: LazyParam }) {
  const v = stackValue(it, p);
  if (p.type === 'select') {
    return (
      <Row label={p.label} hint={p.hint}>
        <Select ariaLabel={p.label} value={String(v)} options={p.options ?? []} onChange={x => set(x)} />
      </Row>
    );
  }
  if (p.type === 'colour') {
    return (
      <Row label={p.label} hint={p.hint}>
        <ColorSwatch value={v as Vec3} label={p.label} onChange={rgb => set([rgb[0], rgb[1], rgb[2]], p.key)} />
      </Row>
    );
  }
  if (p.type === 'rgb') {
    const c = v as Vec3;
    return (
      <Row label={p.label} hint={p.hint}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
          {(['R', 'G', 'B'] as const).map((ax, i) => (
            <BuilderSlider key={ax} value={c[i]} min={p.min ?? 0} max={p.max ?? 1} step={p.step ?? 0.01} ariaLabel={`${p.label} ${ax}`} defaultValue={(p.def as Vec3)[i]}
              onChange={n => { const next = [...c] as Vec3; next[i] = n; set(next, `${p.key}:${i}`); }} />
          ))}
        </div>
      </Row>
    );
  }
  return (
    <Row label={p.deg ? <>{p.label} <span style={{ opacity: 0.6 }}>°</span></> : p.label} hint={p.hint}>
      <BuilderSlider value={v as number} min={p.min ?? 0} max={p.max ?? 1} step={p.integer ? 1 : p.step ?? 0.01} integer={p.integer} ariaLabel={p.label}
        defaultValue={p.def as number} rangeKey={`look:${it.kind}:${p.key}`} lazyParam={play} onChange={n => set(n, p.key)} />
    </Row>
  );
}

function StackCard({ it, def, index, count, props }: { it: StackItem; def: StackKindDef; index: number; count: number; props: StackCardsProps }) {
  const tk = useTokens();
  const [open, setOpen] = useState(index === count - 1);
  const [dragOver, setDragOver] = useState(false);
  const mime = `text/x-look-${props.name}`;
  const up = (fn: (x: StackItem) => void, key?: string) => props.onEdit(items => edited(items, it.id, fn), key && `${props.name}:${it.id}:${key}`);
  const pictureShown = def.picture && (!def.picture.showWhen || def.picture.showWhen.is.includes(String(it.params[def.picture.showWhen.key])));
  return (
    <div data-look-stack-card={it.id} data-look-kind={it.kind} draggable
      onDragStart={ev => { ev.dataTransfer.setData(mime, it.id); ev.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={ev => { if (ev.dataTransfer.types.includes(mime)) { ev.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={ev => { ev.preventDefault(); setDragOver(false); const id = ev.dataTransfer.getData(mime); if (id && id !== it.id) props.onEdit(items => placeStackItem(items, id, it.id)); }}
      style={{
        borderRadius: radius.control, background: tk.bg.panel, flexShrink: 0, overflow: 'hidden', opacity: it.on ? 1 : 0.6,
        boxShadow: dragOver ? `inset 0 3px 0 ${tk.accent.base}, inset 0 0 0 1px ${tk.border.default}` : `inset 0 0 0 1px ${tk.border.default}`,
      }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px 6px 8px', minHeight: 42, cursor: 'pointer' }}>
        <Icon name="grip" size={13} style={{ color: tk.text.faint, cursor: 'grab', flexShrink: 0 }} />
        <span style={{ width: 18, height: 18, borderRadius: 5, background: alpha(tk.accent.base, 0.14), color: tk.accent.text, fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{index + 1}</span>
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 13 }}>{def.label}</b>
          <span data-look-stack-summary style={{ fontSize: 11.5, color: tk.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{stackSummary(it, def)}</span>
        </span>
        <span onClick={ev => ev.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Toggle checked={it.on} onChange={on => up(x => { x.on = on; })} />
          <IconButton icon="chevU" size="sm" label="Earlier (applied before)" disabled={index === 0} onClick={() => props.onEdit(items => moveStackItem(items, it.id, -1))} />
          <IconButton icon="chevD" size="sm" label="Later (applied after)" disabled={index === count - 1} onClick={() => props.onEdit(items => moveStackItem(items, it.id, 1))} />
          <IconButton icon="trash" size="sm" label="Remove" onClick={() => props.onEdit(items => items.filter(x => x.id !== it.id))} />
        </span>
      </div>
      {open && (
        <div style={{ padding: '4px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, borderTop: `1px solid ${tk.border.subtle}` }}>
          <BuilderNote>{def.blurb}</BuilderNote>
          {def.params.filter(p => paramShown(it, p, def)).map(p => (
            <ParamRow key={p.key} p={p} it={it} play={props.playParam?.(it, p.key)} set={(v, key) => up(x => { x.params[p.key] = v; }, key)} />
          ))}
          {pictureShown && props.sources && props.onAddSource && (
            <Row label="Picture" hint="Its red pushes the picture sideways, its green up and down (mid-grey stays still). A Shader Texture moves it.">
              <TexturePicker id={`${props.name}-${it.id}`} sources={props.sources} value={it.tex} onAdd={props.onAddSource} none="No picture"
                onChange={name => up(x => { x.tex = name; })} />
            </Row>
          )}
        </div>
      )}
    </div>
  );
}

export function StackCards(props: StackCardsProps) {
  const tk = useTokens();
  const byKind = Object.fromEntries(props.defs.map(d => [d.kind, d]));
  const [endOver, setEndOver] = useState(false);
  const mime = `text/x-look-${props.name}`;
  return (
    <div data-look-stack={props.name} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {props.defs.map(d => (
          <Button key={d.kind} size="sm" variant="ghost" icon="plus" title={d.blurb} data-look-add={d.kind}
            onClick={() => props.onEdit(items => [...items, newStackItem(d, nextStackId(items, props.idPrefix))])}>{d.label}</Button>
        ))}
      </div>
      {props.items.length === 0 && <BuilderNote>{props.empty}</BuilderNote>}
      {props.items.map((it, i) => byKind[it.kind] && <StackCard key={it.id} it={it} def={byKind[it.kind]} index={i} count={props.items.length} props={props} />)}
      {props.items.length > 1 && (
        <div onDragOver={ev => { if (ev.dataTransfer.types.includes(mime)) { ev.preventDefault(); setEndOver(true); } }} onDragLeave={() => setEndOver(false)}
          onDrop={ev => { ev.preventDefault(); setEndOver(false); const id = ev.dataTransfer.getData(mime); if (id) props.onEdit(items => placeStackItem(items, id, null)); }}
          style={{ height: 18, borderRadius: radius.sm, boxShadow: endOver ? `inset 0 3px 0 ${tk.accent.base}` : 'none' }}>
          <BuilderNote style={{ fontSize: 11 }}>Drag a card to change the order: the top one is applied first.</BuilderNote>
        </div>
      )}
    </div>
  );
}
