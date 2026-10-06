/**
 * SceneTree — the scene as a tree in the builder's left panel: combine groups
 * (with their operator) holding shapes and other groups. Click to select; drag
 * a row onto another to reorder (its top or bottom edge) or nest (the middle
 * of a group); warps show as small tags on the item they bend.
 */
import { useState, type DragEvent } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import { moveItem, addGroup, addShape } from '../../sceneBuilder/edit';
import { SHAPES, SHAPE_BY_KIND, WARP_BY_KIND, itemName, opLabel, type SceneItem, type SceneSpec } from '../../sceneBuilder/spec';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Icon } from '../ui/Icon';
import { Button } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { BuilderLabel, BuilderNote } from '../builders/BuilderWindow';
import { rgbCss } from './controls';

type Where = 'before' | 'after' | 'into';

const OP_GLYPH: Record<string, string> = { union: '∪', subtract: '−', intersect: '∩' };

function TreeRow({ spec, item, depth, drag, setDrag }: {
  spec: SceneSpec; item: SceneItem; depth: number;
  drag: { id: string | null; over: { id: string; where: Where } | null };
  setDrag: (d: { id: string | null; over: { id: string; where: Where } | null }) => void;
}) {
  const tk = useTokens();
  const selectedId = useSceneBuilder(s => s.selectedId);
  const select = useSceneBuilder(s => s.select);
  const setTab = useSceneBuilder(s => s.setTab);
  const edit = useSceneBuilder(s => s.edit);
  const isRoot = item.id === spec.root.id;
  const selected = selectedId === item.id;
  const over = drag.over?.id === item.id ? drag.over.where : null;
  const onDragOver = (e: DragEvent) => {
    if (!drag.id || drag.id === item.id) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    const where: Where = item.type === 'group' && (isRoot || (y > 0.28 && y < 0.72)) ? 'into' : y < 0.5 ? 'before' : 'after';
    if (drag.over?.id !== item.id || drag.over.where !== where) setDrag({ ...drag, over: { id: item.id, where } });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = drag.id;
    const where = drag.over?.where;
    setDrag({ id: null, over: null });
    if (!id || !where) return;
    edit(d => { moveItem(d, id, item.id, where); });
  };
  const kindDef = item.type === 'shape' ? SHAPE_BY_KIND[item.kind] : null;
  return (
    <>
      <div
        data-tree-item={item.id}
        draggable={!isRoot}
        onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; setDrag({ id: item.id, over: null }); }}
        onDragEnd={() => setDrag({ id: null, over: null })}
        onDragOver={onDragOver}
        onDragLeave={() => { if (drag.over?.id === item.id) setDrag({ ...drag, over: null }); }}
        onDrop={onDrop}
        onClick={() => { select(item.id); setTab(item.type === 'group' ? 'combine' : 'shapes'); }}
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 7, minHeight: 30, padding: `3px 8px 3px ${8 + depth * 16}px`,
          borderRadius: radius.md, cursor: isRoot ? 'default' : 'grab', userSelect: 'none',
          background: selected ? tk.bg.selected : over === 'into' ? tk.bg.hover : 'none',
          boxShadow: over === 'into' ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
          opacity: drag.id === item.id ? 0.45 : 1,
        }}>
        {over === 'before' && <span style={{ position: 'absolute', left: 8 + depth * 16, right: 6, top: -1, height: 2, borderRadius: 1, background: tk.accent.base }} />}
        {over === 'after' && <span style={{ position: 'absolute', left: 8 + depth * 16, right: 6, bottom: -1, height: 2, borderRadius: 1, background: tk.accent.base }} />}
        {item.type === 'group' ? (
          <span title={opLabel(item)} style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: tk.bg.field, color: tk.text.secondary, font: `700 13px ${fontFamily.mono}` }}>
            {OP_GLYPH[item.op]}{item.k > 0 ? <sub style={{ fontSize: 8 }}>~</sub> : null}
          </span>
        ) : (
          <span style={{ width: 12, height: 12, margin: '0 4px', borderRadius: item.kind === 'sphere' ? '50%' : 3, flexShrink: 0, background: item.kind === 'custom' ? 'transparent' : rgbCss(item.color), boxShadow: `inset 0 0 0 1px rgba(0,0,0,0.18)`, border: item.kind === 'custom' ? `1.5px dashed ${tk.text.faint}` : undefined }} />
        )}
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 12.5, fontWeight: item.type === 'group' ? 600 : 500, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isRoot ? 'Scene' : itemName(spec, item)}
          </span>
          <span style={{ fontSize: 11, color: tk.text.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.type === 'group' ? `${opLabel(item)}${item.k > 0 ? ` · k ${item.k}` : ''} · ${item.children.length} item${item.children.length === 1 ? '' : 's'}` : kindDef?.label ?? item.label ?? 'custom'}
            {item.type === 'shape' && item.glass && spec.look.mode === 'glass' ? ' · glass' : ''}
          </span>
        </span>
        {item.warps.length > 0 && (
          <span title={item.warps.map(w => WARP_BY_KIND[w.kind]?.label ?? w.label ?? w.kind).join(' → ')}
            onClick={e => { e.stopPropagation(); select(item.id); setTab('warps'); }}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 6, background: tk.bg.selected, color: tk.accent.text, font: `600 10.5px ${fontFamily.ui}`, cursor: 'pointer' }}>
            <Icon name="wave" size={11} />{item.warps.length}
          </span>
        )}
      </div>
      {item.type === 'group' && item.children.map(c => <TreeRow key={c.id} spec={spec} item={c} depth={depth + 1} drag={drag} setDrag={setDrag} />)}
    </>
  );
}

export function SceneTree() {
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const setTab = useSceneBuilder(s => s.setTab);
  const [drag, setDrag] = useState<{ id: string | null; over: { id: string; where: Where } | null }>({ id: null, over: null });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 12px' }}>
      <BuilderLabel meta="drag to reorder or nest">Scene</BuilderLabel>
      <div style={{ display: 'flex', gap: 6 }}>
        <Button size="sm" icon="plus" onClick={e => setMenu({ x: e.clientX, y: e.clientY })}>Shape</Button>
        <Button size="sm" icon="layers" title="A combine group: around the selected item, or a new empty one"
          onClick={() => { let id = ''; edit(d => { id = addGroup(d, selectedId).id; }); select(id); setTab('combine'); }}>Group</Button>
      </div>
      <div role="tree" aria-label="Scene tree" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TreeRow spec={spec} item={spec.root} depth={0} drag={drag} setDrag={setDrag} />
      </div>
      {spec.root.children.length === 0 && <BuilderNote>Add a shape, pick a template, or type a recipe.</BuilderNote>}
      {menu && (
        <Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)} title="Add a shape" items={SHAPES.map(s => ({
          label: s.label, hint: s.blurb,
          onSelect: () => { let id = ''; edit(d => { id = addShape(d, s.kind, selectedId).id; }); select(id); setTab('shapes'); },
        }))} />
      )}
    </div>
  );
}
