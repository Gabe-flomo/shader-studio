/**
 * SceneTree — the scene as a tree in the builder's left panel (docs/scene-builder.md, "The tree").
 *
 * Every combine is a box: its operator badge (∪ union, − subtract, ∩ intersect; smooth ones
 * with their k) over the shapes and groups inside it, indented with a guide line, so
 * "smooth-union(a, b), then intersect with c, then subtract d" reads top to bottom. Shapes
 * show their picture and colour; any item's modifiers show as small chips.
 *
 * Click to select (⌘ / Shift-click to pick several); Wrap in… puts a group around what is
 * picked. On a desktop, drag a row onto another to reorder (its top or bottom edge) or nest (the
 * middle of a group), and drag a shape from the gallery onto a row to add it there. On a touch
 * screen the selected row has buttons instead (a mouse sees them on hover): ▲ ▼, Into (the
 * group above), Out.
 */
import { useRef, useState, type DragEvent } from 'react';
import { useSceneBuilder } from '../../sceneBuilder/store';
import {
  addShape, canMoveInto, canMoveOut, insertShape, moveBy, moveIntoPrevious, moveItem, moveOut, wrapItems,
} from '../../sceneBuilder/edit';
import { SHAPE_BY_KIND, findItem, itemName, modifierSummary, opLabel, type GroupSpec, type SceneItem, type SceneSpec } from '../../sceneBuilder/spec';
import { GALLERY_SHAPES, type GalleryShape } from '../../sceneBuilder/thumbnails';
import { useTokens } from '../../theme/themeStore';
import { fontFamily, radius } from '../../theme/tokens';
import { Button, IconButton } from '../ui/Button';
import { Menu } from '../ui/Menu';
import { Popover } from '../ui/Popover';
import { BuilderLabel, EmptyHelp } from '../builders/BuilderWindow';
import { parseRecipe } from '../../sceneBuilder/recipe';
import { NO_DRAG, OP_GLYPH, rgbCss } from './controls';
import { SHAPE_DRAG, ShapeGallery, ShapeThumb } from './ShapeGallery';

type Where = 'before' | 'after' | 'into';
type DragState = { id: string | null; over: { id: string; where: Where } | null };

/** The six combines, for Wrap in… */
const WRAPS: Array<{ op: GroupSpec['op']; k: number; label: string; hint: string }> = [
  { op: 'union', k: 0, label: 'Union', hint: 'Both: the nearer surface wins.' },
  { op: 'union', k: 0.3, label: 'Smooth union', hint: 'Melted together like putty.' },
  { op: 'subtract', k: 0, label: 'Subtract', hint: 'The first, with the rest cut out of it.' },
  { op: 'subtract', k: 0.3, label: 'Smooth subtract', hint: 'A cut with a softened edge.' },
  { op: 'intersect', k: 0, label: 'Intersect', hint: 'Only where they all overlap.' },
  { op: 'intersect', k: 0.3, label: 'Smooth intersect', hint: 'The overlap, with a rounded crease.' },
];

const opWord = (g: GroupSpec) => (g.k > 0 ? `smooth ${g.op}` : g.op);

/** The badge on a group: its sign, its operator and its blend radius. */
function OpBadge({ g }: { g: GroupSpec }) {
  const tk = useTokens();
  return (
    <span data-op-badge={`${g.k > 0 ? 'smooth-' : ''}${g.op}`} title={opLabel(g)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 7px 0 5px', borderRadius: 6, flexShrink: 0, background: tk.bg.selected, color: tk.accent.text, font: `650 11px ${fontFamily.ui}` }}>
      <span style={{ font: `700 14px ${fontFamily.mono}`, lineHeight: 1 }}>{OP_GLYPH[g.op]}</span>
      {opWord(g)}
      {g.k > 0 && <span style={{ font: `600 10.5px ${fontFamily.mono}`, opacity: 0.85 }}>k {g.k}</span>}
    </span>
  );
}

/** An item's modifiers on its row: the first few as small chips. */
function MiniChips({ item }: { item: SceneItem }) {
  const tk = useTokens();
  const selectWarp = useSceneBuilder(s => s.selectWarp);
  const setTab = useSceneBuilder(s => s.setTab);
  if (!item.warps.length) return null;
  const shown = item.warps.slice(0, 3);
  return (
    <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 2 }}>
      {shown.map(w => (
        <span key={w.id} data-tree-chip={w.kind} title={`${modifierSummary(w).label} ${modifierSummary(w).value}`.trim()}
          onClick={e => { e.stopPropagation(); selectWarp(item.id, w.id); setTab('shapes'); }}
          style={{ padding: '0 6px', height: 17, display: 'inline-flex', alignItems: 'center', borderRadius: 9, background: tk.bg.field, color: tk.text.secondary, boxShadow: `inset 0 0 0 1px ${tk.border.default}`, font: `600 10px ${fontFamily.ui}`, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {modifierSummary(w).label.toLowerCase()}
        </span>
      ))}
      {item.warps.length > shown.length && <span style={{ font: `600 10px ${fontFamily.ui}`, color: tk.text.faint, alignSelf: 'center' }}>+{item.warps.length - shown.length}</span>}
    </span>
  );
}

/** The selected row's buttons: step it, nest it, take it out (and the only way on a touch screen). */
function RowActions({ spec, id }: { spec: SceneSpec; id: string }) {
  const tk = useTokens();
  const edit = useSceneBuilder(s => s.edit);
  const hit = findItem(spec, id);
  if (!hit?.parent) return null;
  const i = hit.parent.children.indexOf(hit.item);
  const btn = (icon: 'chevU' | 'chevD' | 'chevR' | 'chevL', label: string, disabled: boolean, run: (d: SceneSpec) => void) => (
    <IconButton icon={icon} size="sm" tooltip={!NO_DRAG} label={label} disabled={disabled} onClick={e => { e.stopPropagation(); edit(run); }} />
  );
  return (
    <span data-row-actions onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, background: tk.bg.selected, borderRadius: 6 }}>
      {btn('chevU', 'Move up', i === 0, d => { moveBy(d, id, -1); })}
      {btn('chevD', 'Move down', i === hit.parent.children.length - 1, d => { moveBy(d, id, 1); })}
      {btn('chevR', 'Move into the group above', !canMoveInto(spec, id), d => { moveIntoPrevious(d, id); })}
      {btn('chevL', 'Move out of its group', !canMoveOut(spec, id), d => { moveOut(d, id); })}
    </span>
  );
}

function TreeRow({ spec, item, depth, drag, setDrag, picked, onPick }: {
  spec: SceneSpec; item: SceneItem; depth: number;
  drag: DragState; setDrag: (d: DragState) => void;
  picked: Set<string>; onPick: (id: string, add: boolean) => void;
}) {
  const tk = useTokens();
  const selectedId = useSceneBuilder(s => s.selectedId);
  const select = useSceneBuilder(s => s.select);
  const edit = useSceneBuilder(s => s.edit);
  const isRoot = item.id === spec.root.id;
  const selected = selectedId === item.id;
  const isPicked = picked.has(item.id) && !selected;
  const over = drag.over?.id === item.id ? drag.over.where : null;
  // The step / nest buttons: always on a touch screen, on hover with a mouse (they'd crowd the chips).
  const [hover, setHover] = useState(false);
  const onDragOver = (e: DragEvent) => {
    const fromGallery = e.dataTransfer.types.includes(SHAPE_DRAG);
    if (!fromGallery && (!drag.id || drag.id === item.id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = fromGallery ? 'copy' : 'move';
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
    if (!where) return;
    const shape = e.dataTransfer.getData(SHAPE_DRAG);
    if (shape) {
      const g = GALLERY_SHAPES.find(x => x.key === shape);
      if (!g) return;
      let newId = '';
      edit(d => { const sh = insertShape(d, g.kind, item.id, where); if (g.size) Object.assign(sh.size, structuredClone(g.size)); newId = sh.id; });
      select(newId);
      return;
    }
    if (id) edit(d => { moveItem(d, id, item.id, where); });
  };
  const indent = 6;
  return (
    <div role="treeitem" aria-selected={selected} aria-expanded={item.type === 'group' ? true : undefined} style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        data-tree-item={item.id}
        draggable={!isRoot && !NO_DRAG}
        onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; setDrag({ id: item.id, over: null }); }}
        onDragEnd={() => setDrag({ id: null, over: null })}
        onDragOver={onDragOver}
        onDragLeave={() => { if (drag.over?.id === item.id) setDrag({ ...drag, over: null }); }}
        onDrop={onDrop}
        onClick={e => onPick(item.id, e.metaKey || e.ctrlKey || e.shiftKey)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative', display: 'flex', alignItems: 'center', gap: 7, minHeight: item.type === 'group' ? 34 : 38, padding: `3px 6px 3px ${indent}px`,
          borderRadius: radius.md, cursor: isRoot ? 'default' : NO_DRAG ? 'pointer' : 'grab', userSelect: 'none',
          background: selected ? tk.bg.selected : isPicked ? tk.bg.hover : over === 'into' ? tk.bg.hover : 'none',
          boxShadow: over === 'into' || isPicked ? `inset 0 0 0 1.5px ${tk.accent.base}` : 'none',
          opacity: drag.id === item.id ? 0.45 : 1,
        }}>
        {over === 'before' && <span style={{ position: 'absolute', left: indent, right: 6, top: -1, height: 2, borderRadius: 1, background: tk.accent.base }} />}
        {over === 'after' && <span style={{ position: 'absolute', left: indent, right: 6, bottom: -1, height: 2, borderRadius: 1, background: tk.accent.base }} />}
        {item.type === 'group' ? (
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <OpBadge g={item} />
              <span style={{ minWidth: 0, fontSize: 12, fontWeight: 600, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isRoot ? 'Scene' : item.name || ''}
              </span>
              <span style={{ fontSize: 11, color: tk.text.faint, whiteSpace: 'nowrap' }}>{item.children.length}</span>
            </span>
            <MiniChips item={item} />
          </span>
        ) : (
          <>
            <span style={{ position: 'relative', flexShrink: 0, display: 'flex' }}>
              {item.kind === 'custom'
                ? <span style={{ width: 24, height: 24, borderRadius: 6, border: `1.5px dashed ${tk.text.faint}`, boxSizing: 'border-box' }} />
                : <ShapeThumb kind={item.kind} size={26} />}
              {item.kind !== 'custom' && <span title="Its colour" style={{ position: 'absolute', right: -2, bottom: -1, width: 9, height: 9, borderRadius: '50%', background: rgbCss(item.color), boxShadow: `0 0 0 1.5px ${tk.bg.panel}` }} />}
            </span>
            <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: 12.5, fontWeight: 500, color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {itemName(spec, item)}
                {item.name && <span style={{ color: tk.text.faint, fontWeight: 400 }}> · {SHAPE_BY_KIND[item.kind]?.label ?? item.label ?? 'custom'}</span>}
                {item.glass && spec.look.mode === 'glass' && <span style={{ color: tk.text.faint, fontWeight: 400 }}> · glass</span>}
              </span>
              <MiniChips item={item} />
            </span>
          </>
        )}
        {selected && !isRoot && (NO_DRAG || hover) && <RowActions spec={spec} id={item.id} />}
      </div>
      {item.type === 'group' && (
        <div role="group" style={{ display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 13, paddingLeft: 6, borderLeft: `1.5px solid ${selected ? tk.accent.base : tk.border.strong}` }}>
          {item.children.map(c => <TreeRow key={c.id} spec={spec} item={c} depth={depth + 1} drag={drag} setDrag={setDrag} picked={picked} onPick={onPick} />)}
          {item.children.length === 0 && (
            <div data-tree-empty={item.id}
              onDragOver={e => { if (e.dataTransfer.types.includes(SHAPE_DRAG) || drag.id) { e.preventDefault(); if (drag.over?.id !== item.id) setDrag({ ...drag, over: { id: item.id, where: 'into' } }); } }}
              onDrop={onDrop}
              style={{ padding: '6px 8px', margin: '2px 0', borderRadius: radius.md, border: `1px dashed ${over === 'into' ? tk.accent.base : tk.border.strong}`, color: tk.text.faint, fontSize: 11.5 }}>
              {NO_DRAG ? 'Empty: select an item below it and tap › to move it in.' : 'Empty: drop shapes or groups here.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SceneTree() {
  const tk = useTokens();
  const spec = useSceneBuilder(s => s.spec);
  const selectedId = useSceneBuilder(s => s.selectedId);
  const edit = useSceneBuilder(s => s.edit);
  const select = useSceneBuilder(s => s.select);
  const setTab = useSceneBuilder(s => s.setTab);
  const [drag, setDrag] = useState<DragState>({ id: null, over: null });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [wrapMenu, setWrapMenu] = useState<{ x: number; y: number } | null>(null);
  const [gallery, setGallery] = useState(false);
  const addRef = useRef<HTMLSpanElement>(null);
  // What Wrap in… wraps: the picked rows and the selected one.
  const chosen = [...new Set([...picked, ...(selectedId ? [selectedId] : [])])].filter(id => id !== spec.root.id && findItem(spec, id));
  const onPick = (id: string, add: boolean) => {
    if (add && id !== spec.root.id) {
      setPicked(p => {
        const next = new Set(p);
        if (selectedId && selectedId !== spec.root.id) next.add(selectedId);
        if (next.has(id) && id !== selectedId) next.delete(id); else next.add(id);
        return next;
      });
    } else setPicked(new Set());
    select(id);
    setTab('shapes');
  };
  const wrap = (op: GroupSpec['op'], k: number) => {
    let id = '';
    edit(d => { id = wrapItems(d, chosen, op, k)?.id ?? ''; });
    setPicked(new Set());
    if (id) { select(id); setTab('shapes'); }
  };
  const addFromGallery = (g: GalleryShape) => {
    let id = '';
    edit(d => { const sh = addShape(d, g.kind, selectedId); if (g.size) Object.assign(sh.size, structuredClone(g.size)); id = sh.id; });
    select(id);
    setTab('shapes');
    setGallery(false);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '16px 12px' }}>
      <BuilderLabel meta={NO_DRAG ? 'tap to select' : 'drag to reorder or nest'}
        hint="Every shape and combine group, top to bottom. Click to edit; ⌘ or Shift-click to pick several and Wrap them in a group. Drag a row onto another to reorder or nest it, or a shape from the gallery onto a row to add it there.">
        Scene
      </BuilderLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <span ref={addRef} style={{ display: 'inline-flex' }}><Button size="sm" icon="plus" onClick={() => setGallery(g => !g)} aria-expanded={gallery}>Shape</Button></span>
        <Button size="sm" icon="layers" title={chosen.length ? `Put a combine group around ${chosen.length === 1 ? 'the selected item' : `the ${chosen.length} picked items`}` : 'A new, empty combine group'}
          onClick={e => setWrapMenu({ x: e.clientX, y: e.clientY })}>
          {chosen.length ? `Wrap ${chosen.length > 1 ? `${chosen.length} ` : ''}in…` : 'Group…'}
        </Button>
      </div>
      {picked.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: tk.text.muted }}>
          {chosen.length} picked
          <button type="button" onClick={() => setPicked(new Set())} style={{ border: 0, background: 'none', color: tk.accent.text, cursor: 'pointer', font: `600 11.5px ${fontFamily.ui}`, padding: 0 }}>Clear</button>
        </div>
      )}
      <div role="tree" aria-label="Scene tree" aria-multiselectable style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <TreeRow spec={spec} item={spec.root} depth={0} drag={drag} setDrag={setDrag} picked={picked} onPick={onPick} />
      </div>
      {spec.root.children.length === 0 && <EmptyHelp id="tree" onExample={ex => { if ('recipe' in ex.insert) { const r = parseRecipe(ex.insert.recipe); edit(d => { d.root.children.push(...r.spec.root.children); }); } }} />}
      {gallery && (
        <Popover anchorRef={addRef} onClose={() => setGallery(false)} width={300} padding={8}>
          <div style={{ maxHeight: 360, overflow: 'auto' }}>
            <ShapeGallery onPick={addFromGallery} size={44} minTile={64} />
          </div>
        </Popover>
      )}
      {wrapMenu && (
        <Menu x={wrapMenu.x} y={wrapMenu.y} onClose={() => setWrapMenu(null)} title={chosen.length ? 'Wrap in…' : 'A new group'} items={WRAPS.map(w => ({
          label: w.label, hint: w.hint, onSelect: () => wrap(w.op, w.k),
        }))} />
      )}
    </div>
  );
}
