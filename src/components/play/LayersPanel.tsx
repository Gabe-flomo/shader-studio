/**
 * LayersPanel — the Play page's Layers tab: things drawn over the picture by
 * the layer kit (play/kit). Add a layer, edit it here (each kind has its own
 * editor in layers/editors.tsx), and press the small + next to any number to
 * make it a control (target `layer:<id>::<key>`) you can map and drive.
 * Below the layers, actions fire things on triggers.
 *
 * Layers can be put in groups (types/layerGroups.ts, groupOps.ts): pick
 * cards with ⇧/⌘-click (Select, or a long press, on a phone) and Group (⌘G).
 * A group shows as one card; entering it lists its layers. Rows drag to a
 * new place among their neighbours.
 *
 * While this tab is open the overlay is in editing mode: shapes can be
 * dragged and invisible zones are outlined.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { accentColor } from '../../theme/categories';
import type { LayerKindDef } from '../../types/layerKinds';
import { addKindLayer } from '../../play/layerKinds';
import { AddLayerMenu } from './layers/AddLayerMenu';
import { BUILTIN_LAYER, type BuiltinVariant } from './layers/addLayerCatalog';
import { script3dDefaults } from '../../types/playLayers';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { backgroundLayerOf, layerNumericProps, SENSOR_READS_FOR, defaultLayer, layerTarget, parseActionTarget, parseLayerTarget, pictureHidden as isPictureHidden, type PlayControl, type PlayLayer, type PlayLayerKind, type PlayRecord } from '../../types/play';
import { buildTree, childrenOf, containerOf, groupLayerIds, groupOfLayer, groupPath, type ItemRef, type LayerGroup, type TreeNode } from '../../types/layerGroups';
import { playId } from '../../play/playControls';
import { addNullFor, backgroundMenuItems, driveWithNull, duplicateLayer, layerMenuItems, layerNullDrives, removeLayer, renameLayer, resetLayer } from './layerOps';
import { addToGroup, canMove, createGroup, duplicateGroup, moveItem, moveItemTo, orderedItems, removeGroup, takeOutOfGroup, ungroup } from './groupOps';
import { BackgroundEditor } from './layers/BackgroundEditor';
import { GroupCard } from './layers/GroupCard';
import { layerLook } from './layers/layerLook';
import { addBackground, thisGraphSource } from '../../play/backgroundQueue';
import { toast } from '../ui/toastStore';
import { askConfirm } from '../ui/dialogStore';
import { SoloButton, SoloStrip } from './Solo';
import { LayerReadings } from './MapToMenu';
import { Section } from './layers/Section';
import { usePlayUi } from './playUi';
import { NOTE_REF_TYPE, noteRef } from './noteRefs';
import { playOverlay, type ShapeDrawing } from '../../play/overlay';
import { Button, IconButton } from '../ui/Button';
import { Toggle } from '../ui/Choice';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { Menu, type MenuItem } from '../ui/Menu';
import { Modal } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';
import { makeFieldKit } from './layers/fields';
import {
  AudioEditor, BodiesEditor, BrushEditor, CameraEditor, ContoursEditor, GlyphsEditor, ImageEditor, LensEditor, NullEditor, ParticlesEditor, ShapeEditor, TextEditor,
  type EditorContext, ClonerEditor, ScriptEditor } from './layers/editors';
import { ActionsSection } from './layers/ActionsSection';
import { DataLayerEditor } from './layers/DataLayerEditor';
import { MatteMaskBar } from './layers/MatteMask';
import { matteMaskSummary } from '../../play/mattes';
import { matteUsers } from '../../types/playLayers';

const KIND = BUILTIN_LAYER;

/** Dragging a row to reorder it: the drag's data type, and which row it is (dragover can't read the data). */
const ROW_TYPE = 'application/x-playfield-row';
let draggingRow: ItemRef | null = null;

const sameItem = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id;
const nodeItem = (n: TreeNode): ItemRef => (n.kind === 'layer' ? { kind: 'layer', id: n.layer.id } : { kind: 'group', id: n.group.id });

export function LayersPanel({ play, touch, exposedTargets, onChange, onExpose, top }: {
  play: PlayRecord;
  touch: boolean;
  /** Targets that already have a control (their + is shown pressed). */
  exposedTargets: Set<string>;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** Add a control for a numeric layer property. */
  onExpose: (control: PlayControl) => void;
  /** Scrolls with the list, above the layers (phones put the notes here). */
  top?: ReactNode;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const addRef = useRef<HTMLSpanElement>(null);
  const [menu, setMenu] = useState(false);
  const selected = usePlayUi(s => s.selected), setSelected = usePlayUi(s => s.select), revealTick = usePlayUi(s => s.revealTick);
  const mask = usePlayUi(s => s.mask);
  const [drawing, setDrawing] = useState<ShapeDrawing | null>(null);
  useEffect(() => { playOverlay.setEditing(true, selected, mask); }, [selected, mask]);
  // A mask picked (or drawn) on the picture opens in its layer's card.
  useEffect(() => playOverlay.onMaskSelect((layerId, maskId) => { const ui = usePlayUi.getState(); if (ui.selected !== layerId) ui.select(layerId); ui.setMask(maskId); }), []);
  useEffect(() => () => { playOverlay.setEditing(false); playOverlay.cancelDrawing(); }, []);
  useEffect(() => playOverlay.onDrawing(d => setDrawing(d ? { ...d } : null)), []);
  // A layer clicked on the picture is selected here too.
  useEffect(() => playOverlay.onSelect(id => usePlayUi.getState().reveal(id)), []);

  // Groups: the rows the list shows (the whole list, or inside the group it has entered).
  const tree = useMemo(() => buildTree(play), [play]);
  const enteredRaw = usePlayUi(s => s.entered), enter = usePlayUi(s => s.enter);
  const entered = enteredRaw && play.groups?.some(g => g.id === enteredRaw) ? enteredRaw : '';
  const path = entered ? groupPath(play.groups, entered) : [];
  const rows = childrenOf(tree, entered);
  const inside = path[path.length - 1];
  const hiddenAbove = path.some(g => g.hidden);
  const stripe = inside ? accentColor(inside.colour, mode) : undefined;

  const addKind = (k: LayerKindDef) => {
    const id = playId('layer');
    onChange(p => { const next = addKindLayer(p, k, id); return entered ? addToGroup(next, id, entered) : next; });
    setSelected(id);
  };
  const add = (kind: PlayLayerKind, variant?: BuiltinVariant) => {
    if (kind === 'background') {
      // One per setup, at the bottom. A new one starts with this graph, so the picture stays as it was.
      const there = backgroundLayerOf(play);
      if (there) { enter(''); usePlayUi.getState().reveal(there.id); toast.info('This setup has a Background layer', { message: 'Add sources to its queue.' }); return; }
      const id = playId('layer');
      onChange(p => addBackground(p, [thisGraphSource()], id).play);
      enter('');
      setSelected(id);
      return;
    }
    // A 3D Script is a Script layer in 3D, starting from the 3D starter.
    const is3d = variant === 'script3d';
    const n = play.layers.filter(l => l.kind === kind && (kind !== 'script' || (l.kind === 'script' && (l.mode === '3d') === is3d))).length + 1;
    const id = playId('layer');
    const made = defaultLayer(kind, id, `${is3d ? '3D Script' : KIND[kind].label} ${n}`);
    // Added while the list shows a group: it goes in that group.
    onChange(p => { const next = { ...p, layers: [...p.layers, is3d ? ({ ...made, ...script3dDefaults() } as PlayLayer) : made] }; return entered ? addToGroup(next, id, entered) : next; });
    setSelected(id);
  };
  const patch = (id: string, fn: (l: PlayLayer) => PlayLayer) => onChange(p => ({ ...p, layers: p.layers.map(l => l.id === id ? fn(l) : l) }));
  const remove = (id: string) => onChange(p => removeLayer(p, id));
  const duplicate = (id: string) => { let made = ''; onChange(p => { const r = duplicateLayer(p, id); made = r.id; return r.play; }); if (made) setSelected(made); };
  const reset = (id: string) => onChange(p => resetLayer(p, id));
  const createNull = (id: string, key: string) => onChange(p => addNullFor(p, id, key).play);
  // A property's control plus a null on the picture that drives it, in one go.
  const driveNull = (l: PlayLayer, key: string) => {
    const r = layerNullDrives(l, key);
    if (!r) return;
    onChange(p => driveWithNull(p, r.drives, r.label).play);
    toast.success(`Added “${r.label}”`, { message: 'Drag the dot on the picture to change the value.' });
  };
  // Asked to show a layer (a link in the notes, the picture's menu): open its group and scroll to it.
  const listRef = useRef<HTMLDivElement>(null);
  // Going into (or out of) a group starts at the top of its list; a layer asked for is then scrolled to, once it shows.
  const groupsRef = useRef(play.groups);
  useEffect(() => { groupsRef.current = play.groups; });
  const pendingReveal = useRef(false);
  useEffect(() => {
    if (!revealTick) return;
    pendingReveal.current = true;
    const ui = usePlayUi.getState();
    const home = groupOfLayer(groupsRef.current).get(ui.selected) ?? '';
    if (home !== ui.entered) ui.enter(home);
  }, [revealTick]);
  const crumbRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current, crumb = crumbRef.current;
    // Inside a group, its list starts under the way back (on a phone the notes scroll away above it).
    if (!list) return;
    list.scrollTop = 0;
    if (crumb) list.scrollTop = Math.max(0, crumb.getBoundingClientRect().top - list.getBoundingClientRect().top - 6);
  }, [entered]);
  useEffect(() => {
    if (!pendingReveal.current || !selected) return;
    const el = listRef.current?.querySelector(`[data-layer-id="${CSS.escape(selected)}"]`);
    if (!el) return;
    pendingReveal.current = false;
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealTick, selected, entered]);
  const expose = (l: PlayLayer, key: string) => {
    const def = layerNumericProps(l).find(d => d.key === key);
    if (!def) return;
    onExpose({ id: playId('ctl'), target: layerTarget(l.id, key), kind: 'float', label: `${l.label} · ${def.label}`, min: def.min, max: def.max, ...(def.step ? { step: def.step } : {}) });
  };

  // Picking rows to group: ⇧/⌘-click (or Select, and a long press, on a phone). Picks belong to the view they were made in.
  const [pickState, setPickState] = useState<{ view: string; items: ItemRef[]; mode: boolean }>({ view: '', items: [], mode: false });
  const picked = pickState.view === entered ? pickState.items : [];
  const selectMode = pickState.view === entered && pickState.mode;
  const anchor = useRef<ItemRef | null>(null);
  const setPicked = (items: ItemRef[], modeOn = selectMode) => setPickState({ view: entered, items, mode: modeOn });
  const order = orderedItems(rows);
  const isPicked = (it: ItemRef) => picked.some(x => sameItem(x, it));
  const selectedInView = order.find(it => it.kind === 'layer' && it.id === selected);
  const pick = (it: ItemRef, how: 'toggle' | 'range') => {
    if (it.kind === 'layer' && play.layers.find(l => l.id === it.id)?.kind === 'background') return;
    const base = picked;
    if (how === 'range') {
      // A first ⇧-click runs from the layer already selected, as in a file list.
      if (!base.length) anchor.current = selectedInView && backgroundLayerOf(play)?.id !== selected ? selectedInView : null;
      const from = anchor.current && order.some(x => sameItem(x, anchor.current!)) ? anchor.current : base[base.length - 1] ?? it;
      const a = order.findIndex(x => sameItem(x, from)), b = order.findIndex(x => sameItem(x, it));
      const span = order.slice(Math.min(a, b), Math.max(a, b) + 1).filter(x => !(x.kind === 'layer' && play.layers.find(l => l.id === x.id)?.kind === 'background'));
      setPicked([...base.filter(x => !span.some(y => sameItem(x, y))), ...span]);
      return;
    }
    anchor.current = it;
    setPicked(isPicked(it) ? base.filter(x => !sameItem(x, it)) : [...base.filter(x => !sameItem(x, it)), it]);
  };
  const clearPicks = () => setPickState({ view: entered, items: [], mode: false });
  const groupPicked = (): boolean => {
    const items = picked.length ? picked : selectedInView && backgroundLayerOf(play)?.id !== selected ? [selectedInView] : [];
    if (!items.length) return false;
    let made = '';
    onChange(p => { const r = createGroup(p, items); made = r.id; return r.play; });
    clearPicks();
    if (made) requestAnimationFrame(() => listRef.current?.querySelector(`[data-group-id="${CSS.escape(made)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return true;
  };
  const ungroupPicked = (): boolean => {
    const groups = picked.filter(i => i.kind === 'group').map(i => i.id);
    if (groups.length) { onChange(p => groups.reduce(ungroup, p)); clearPicks(); return true; }
    if (entered) { const up = path[path.length - 2]?.id ?? ''; onChange(p => ungroup(p, entered)); enter(up); return true; }
    return false;
  };
  // ⌘G groups, ⌘⇧G ungroups (before the Studio's own ⌘G, which groups nodes), Esc lets go of the picks.
  const keys = useRef({ groupPicked, ungroupPicked, clear: clearPicks, any: false });
  useEffect(() => { keys.current = { groupPicked, ungroupPicked, clear: clearPicks, any: picked.length > 0 || selectMode }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Escape' && keys.current.any) { keys.current.clear(); return; }
      if (e.code !== 'KeyG' || !(e.metaKey || e.ctrlKey) || e.altKey || e.repeat) return;
      if (e.shiftKey ? keys.current.ungroupPicked() : keys.current.groupPicked()) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const groupMenu = (g: LayerGroup): MenuItem[] => {
    const item: ItemRef = { kind: 'group', id: g.id };
    return [
      { label: 'Duplicate…', hint: 'Its layers alone, or with their controls and mappings', onSelect: () => setDuplicating(g) },
      { label: 'Ungroup', hint: `${MOD}⇧G · the layers stay where they are`, onSelect: () => onChange(p => ungroup(p, g.id)) },
      'separator',
      { label: 'Move up', hint: 'Drawn earlier', disabled: !canMove(play, item, -1), onSelect: () => onChange(p => moveItem(p, item, -1)) },
      { label: 'Move down', hint: 'Drawn later, on top', disabled: !canMove(play, item, 1), onSelect: () => onChange(p => moveItem(p, item, 1)) },
      'separator',
      { label: 'Delete group and its layers', hint: 'With the controls and mappings that use them', danger: true, onSelect: () => { void askConfirm(`Delete “${g.label}”?`, { message: `Its ${groupLayerIds(play, g.id).length} layers go too, with the controls, mappings and actions that use them.`, confirmLabel: 'Delete', danger: true }).then(ok => { if (ok) onChange(p => removeGroup(p, g.id)); }); } },
    ];
  };
  const [duplicating, setDuplicating] = useState<LayerGroup | null>(null);
  const duplicateGroupAs = (g: LayerGroup, withControls: boolean) => {
    let made = '';
    onChange(p => { const r = duplicateGroup(p, g.id, withControls); made = r.id; return r.play; });
    setDuplicating(null);
    if (made) requestAnimationFrame(() => listRef.current?.querySelector(`[data-group-id="${CSS.escape(made)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  // Rows dragged to a new place among their neighbours.
  const [dropAt, setDropAt] = useState<{ key: string; where: 'before' | 'after' } | null>(null);
  const layerCount = play.layers.length;

  return (
    <>
      <div style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px 0 14px', borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel }}>
        <span style={{ font: `650 13px ${fontFamily.ui}` }}>Layers</span>
        {layerCount > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{layerCount}</span>}
        <span style={{ flex: 1 }} />
        {layerCount > 1 && !selectMode && (
          <Tooltip label="Select layers to group" description={`Or ⇧-click and ${MOD}-click cards, then ${MOD}G.`}>
            <Button size="sm" variant="ghost" onClick={() => setPicked(picked, true)}>Select</Button>
          </Tooltip>
        )}
        <span ref={addRef} style={{ display: 'inline-flex' }}>
          <Button size="sm" icon="plus" aria-expanded={menu} onClick={() => setMenu(m => !m)}>Add layer</Button>
        </span>
        {menu && <AddLayerMenu play={play} touch={touch} anchorRef={addRef} onAdd={add} onAddKind={addKind} onChange={onChange} onClose={() => setMenu(false)} />}
      </div>
      {(picked.length > 0 || selectMode) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 14px', borderBottom: `1px solid ${tk.border.default}`, background: alpha(tk.accent.base, 0.08) }}>
          <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `600 12px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {picked.length ? `${picked.length} selected` : touch ? 'Tap layers to select' : 'Click layers to select'}
          </span>
          {picked.some(i => i.kind === 'group') && <Button size="sm" variant="ghost" onClick={ungroupPicked} title={`Ungroup (${MOD}⇧G)`}>Ungroup</Button>}
          <Button size="sm" variant="primary" icon="folder" disabled={!picked.length} onClick={groupPicked} title={`Group (${MOD}G)`}>Group</Button>
          <Button size="sm" variant="ghost" onClick={clearPicks}>{selectMode ? 'Done' : 'Clear'}</Button>
        </div>
      )}
      <div ref={listRef} style={{ flex: 1, minHeight: play.notes && !top ? 110 : 0, overflowY: 'auto', padding: '6px 12px 12px' }}>
        {top && <div style={{ margin: '0 -12px' }}>{top}</div>}
        <SoloStrip kind="layer" total={play.layers.filter(l => l.kind !== 'null').length} />
        {inside && (
          // Inside a group: where we are, and the way back. The picture doesn't change.
          <div ref={crumbRef} style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 2, margin: '6px 0 2px', padding: '3px 8px 3px 2px', borderRadius: radius.md, background: `linear-gradient(${alpha(stripe!, 0.12)}, ${alpha(stripe!, 0.12)}), ${tk.bg.subtle}`, boxShadow: `0 -6px 0 ${tk.bg.subtle}`, minWidth: 0 }}>
            <IconButton icon="chevL" label="Back" size="sm" tooltip={false} onClick={() => enter(path[path.length - 2]?.id ?? '')} />
            <nav aria-label="Group" style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, flex: 1, font: `600 12px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {[{ id: '', label: 'Layers' }, ...path].map((g, k) => {
                const last = k === path.length;
                return (
                  <span key={g.id || 'root'} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: last ? 0 : undefined, flexShrink: last ? 1 : 0 }}>
                    {k > 0 && <span style={{ color: tk.text.faint }}>›</span>}
                    {last
                      ? <><Icon name="folder" size={13} style={{ color: stripe, flexShrink: 0 }} /><span style={{ color: tk.text.primary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{g.label}</span></>
                      : <button type="button" onClick={() => enter(g.id)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: 'inherit' }}>{g.label}</button>}
                  </span>
                );
              })}
            </nav>
            {hiddenAbove && <span style={{ flexShrink: 0, color: tk.text.faint, font: `600 11px ${fontFamily.ui}` }}>Hidden</span>}
          </div>
        )}
        {play.layers.length === 0 ? (
          <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
            <div style={{ font: `600 12.5px ${fontFamily.ui}`, color: tk.text.secondary, marginBottom: 4 }}>No layers yet</div>
            Layers sit on top of the picture: particles that flow along it, shapes that act as walls and emitters, text, images, falling letters, a brush, audio, ASCII, contours, a lens, your camera. Every number can be a control, and actions fire them from keys, beats and notes.
          </div>
        ) : rows.map((n, i) => {
          const item = nodeItem(n);
          const k = `${item.kind}:${item.id}`;
          const prev = rows[i - 1];
          return (
            <RowShell
              key={k}
              picked={isPicked(item)}
              selectMode={selectMode}
              pickable={!(n.kind === 'layer' && n.layer.kind === 'background')}
              touch={touch}
              drop={dropAt?.key === k ? dropAt.where : null}
              onPick={how => pick(item, how)}
              onLongPress={() => { anchor.current = item; setPicked(isPicked(item) ? picked : [...picked, item], true); }}
              onDragStart={() => { draggingRow = item; }}
              onDragOver={where => { if (!draggingRow || sameItem(draggingRow, item) || containerOf(play, draggingRow) !== containerOf(play, item)) return false; if (dropAt?.key !== k || dropAt.where !== where) setDropAt({ key: k, where }); return true; }}
              onDragEnd={() => { draggingRow = null; setDropAt(null); }}
              onDrop={where => { const from = draggingRow; draggingRow = null; setDropAt(null); if (from) onChange(p => moveItemTo(p, from, item, where)); }}
            >
              {n.kind === 'group' ? (
                <GroupCard
                  group={n.group}
                  play={play}
                  touch={touch}
                  hiddenAbove={hiddenAbove}
                  onChange={onChange}
                  onEnter={() => enter(n.group.id)}
                  menuItems={groupMenu(n.group)}
                />
              ) : (() => {
                const l = n.layer;
                const it: ItemRef = { kind: 'layer', id: l.id };
                return (
                  <LayerRow
                    layer={l}
                    layers={play.layers}
                    play={play}
                    onChangePlay={onChange}
                    canUp={canMove(play, it, -1)}
                    canDown={canMove(play, it, 1)}
                    touch={touch}
                    selected={selected === l.id}
                    stripe={stripe}
                    dim={hiddenAbove}
                    pictureHidden={isPictureHidden(play.display)}
                    drawing={drawing?.layerId === l.id && !drawing.mask ? drawing.mode : null}
                    maskDrawing={drawing?.layerId === l.id && drawing.mask ? drawing.mode : null}
                    matteOf={matteUsers(play.layers, l.id)}
                    nested={prev?.kind === 'layer' && prev.layer.trackMatte?.id === l.id}
                    exposedTargets={exposedTargets}
                    onSelect={() => setSelected(l.id)}
                    onPatch={fn => patch(l.id, fn)}
                    revealTick={selected === l.id ? revealTick : 0}
                    onRemove={() => remove(l.id)}
                    onRename={label => onChange(p => renameLayer(p, l.id, label))}
                    onDuplicate={() => duplicate(l.id)}
                    onReset={() => reset(l.id)}
                    onCreateNull={key => createNull(l.id, key)}
                    onMove={dir => onChange(p => moveItem(p, it, dir))}
                    groupItems={l.kind === 'background' ? [] : [
                      { label: 'Group', hint: `${MOD}G · in a new group of its own`, onSelect: () => onChange(p => createGroup(p, [it]).play) },
                      ...(entered ? [{ label: 'Take out of group', hint: `Into ${path.length > 1 ? `“${path[path.length - 2].label}”` : 'the main list'}`, onSelect: () => onChange(p => takeOutOfGroup(p, l.id)) }] : []),
                    ]}
                    onExpose={key => expose(l, key)}
                    onExposeControl={onExpose}
                    onDriveNull={key => driveNull(l, key)}
                  />
                );
              })()}
            </RowShell>
          );
        })}
        {!entered && <ActionsSection play={play} onChange={onChange} />}
      </div>
      {duplicating && <DuplicateGroupDialog group={duplicating} play={play} onPick={w => duplicateGroupAs(duplicating, w)} onClose={() => setDuplicating(null)} />}
    </>
  );
}

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/**
 * A row of the list, around a layer's or a group's card: picking it (⇧/⌘-click,
 * or a tap in select mode, or a long press on a phone), and dropping a dragged
 * row before or after it.
 */
function RowShell({ picked, selectMode, pickable, touch, drop, onPick, onLongPress, onDragStart, onDragOver, onDragEnd, onDrop, children }: {
  picked: boolean;
  selectMode: boolean;
  pickable: boolean;
  touch: boolean;
  drop: 'before' | 'after' | null;
  onPick: (how: 'toggle' | 'range') => void;
  onLongPress: () => void;
  onDragStart: () => void;
  /** Can the dragged row land here? */
  onDragOver: (where: 'before' | 'after') => boolean;
  onDragEnd: () => void;
  onDrop: (where: 'before' | 'after') => void;
  children: ReactNode;
}) {
  const tk = useTokens();
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const where = (e: React.DragEvent) => { const r = e.currentTarget.getBoundingClientRect(); return e.clientY < r.top + r.height / 2 ? 'before' as const : 'after' as const; };
  const cancelPress = () => { if (press.current) window.clearTimeout(press.current.timer); };
  return (
    <div
      style={{ position: 'relative' }}
      onPointerDownCapture={e => {
        // A modifier click picks; it doesn't select or start editing.
        if (pickable && !touch && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.stopPropagation(); return; }
        if (pickable && e.pointerType !== 'mouse' && !selectMode) {
          const x = e.clientX, y = e.clientY;
          press.current = { x, y, fired: false, timer: window.setTimeout(() => { if (press.current) press.current.fired = true; navigator.vibrate?.(10); onLongPress(); }, 480) };
        }
      }}
      onPointerMoveCapture={e => { const p = press.current; if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { cancelPress(); press.current = null; } }}
      onPointerUpCapture={cancelPress}
      onPointerCancelCapture={() => { cancelPress(); press.current = null; }}
      onClickCapture={e => {
        const long = press.current?.fired;
        press.current = null;
        if (long) { e.stopPropagation(); e.preventDefault(); return; }
        if (!pickable) return;
        if (selectMode) { e.stopPropagation(); e.preventDefault(); onPick(e.shiftKey ? 'range' : 'toggle'); return; }
        if (!touch && (e.shiftKey || e.metaKey || e.ctrlKey)) { e.stopPropagation(); e.preventDefault(); onPick(e.shiftKey ? 'range' : 'toggle'); }
      }}
      onDragStart={e => { if (!pickable) return; e.dataTransfer.setData(ROW_TYPE, '1'); e.dataTransfer.effectAllowed = 'copyMove'; onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={e => { if (!e.dataTransfer.types.includes(ROW_TYPE)) return; if (onDragOver(where(e))) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
      onDrop={e => { if (!e.dataTransfer.types.includes(ROW_TYPE)) return; e.preventDefault(); onDrop(where(e)); }}
    >
      {children}
      {picked && <span aria-hidden style={{ position: 'absolute', inset: '6px 0 0', borderRadius: radius.card, boxShadow: `inset 0 0 0 2px ${tk.accent.base}`, background: alpha(tk.accent.base, 0.06), pointerEvents: 'none' }} />}
      {selectMode && pickable && (
        <span aria-hidden style={{ position: 'absolute', top: 0, right: -5, width: 18, height: 18, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', background: picked ? tk.accent.base : tk.bg.panel, boxShadow: `inset 0 0 0 1.5px ${picked ? tk.accent.base : tk.border.strong}`, color: tk.ink.text, pointerEvents: 'none' }}>
          {picked && <Icon name="check" size={12} />}
        </span>
      )}
      {drop && <span aria-hidden style={{ position: 'absolute', left: 4, right: 4, height: 2, borderRadius: 1, background: tk.accent.base, ...(drop === 'before' ? { top: 2 } : { bottom: -4 }), pointerEvents: 'none' }} />}
    </div>
  );
}

/** Duplicate a group: its layers alone, or with the controls, mappings and actions on them. */
function DuplicateGroupDialog({ group, play, onPick, onClose }: { group: LayerGroup; play: PlayRecord; onPick: (withControls: boolean) => void; onClose: () => void }) {
  const tk = useTokens();
  const mode = useThemeMode();
  const ids = new Set(groupLayerIds(play, group.id));
  const controls = play.controls.filter(c => { const t = parseLayerTarget(c.target) ?? parseActionTarget(c.target); return !!t && ids.has(t.layerId); });
  const cids = new Set(controls.map(c => c.id));
  const mappings = play.mappings.filter(m => cids.has(m.controlId)).length;
  const actions = (play.actions ?? []).filter(a => ids.has(a.layerId)).length;
  const hooked = [controls.length && `${controls.length} control${controls.length === 1 ? '' : 's'}`, mappings && `${mappings} mapping${mappings === 1 ? '' : 's'}`, actions && `${actions} action${actions === 1 ? '' : 's'}`].filter(Boolean).join(', ');
  const option = (title: string, text: string, withControls: boolean, primary: boolean) => (
    <button
      type="button"
      autoFocus={primary}
      onClick={() => onPick(withControls)}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', borderRadius: radius.lg, border: 0, cursor: 'pointer', background: tk.bg.panel, boxShadow: `inset 0 0 0 1px ${primary ? tk.border.strong : tk.border.default}` }}
    >
      <div style={{ color: tk.text.primary, font: `650 13px ${fontFamily.ui}` }}>{title}</div>
      <div style={{ marginTop: 3, color: tk.text.muted, font: `12px/1.45 ${fontFamily.ui}` }}>{text}</div>
    </button>
  );
  return (
    <Modal title={`Duplicate “${group.label}”`} subtitle={`${ids.size} layer${ids.size === 1 ? '' : 's'}`} icon="folder" iconColor={accentColor(group.colour, mode)} width={420} onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button variant="ghost" onClick={onClose}>Cancel</Button></>}>
      <div style={{ padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {option('Layers only', 'The layers with their settings. Links between them (a matte, a null they follow) point at the copies. No controls, mappings or actions: hook them up yourself.', false, !hooked)}
        {option('With controls and mappings', hooked
          ? `Also copies ${hooked}, pointed at the new layers.`
          : 'Nothing drives these layers yet, so this is the same as Layers only.', true, !!hooked)}
      </div>
    </Modal>
  );
}

function LayerRow({ layer: l, layers, play, onChangePlay, canUp, canDown, touch, selected, stripe, dim, groupItems, pictureHidden, drawing, maskDrawing, matteOf, nested, exposedTargets, revealTick, onSelect, onPatch, onRemove, onRename, onDuplicate, onReset, onCreateNull, onMove, onExpose, onExposeControl, onDriveNull }: {
  layer: PlayLayer;
  layers: PlayLayer[];
  play: PlayRecord;
  onChangePlay: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** Can it move up or down among its neighbours (not out of its group, not under the Background layer)? */
  canUp: boolean;
  canDown: boolean;
  touch: boolean;
  selected: boolean;
  /** Inside a group: the group's colour, down the card's left edge. */
  stripe?: string;
  /** Inside a hidden group: shown dimmed. */
  dim: boolean;
  /** Group, and take out of its group. */
  groupItems: MenuItem[];
  pictureHidden: boolean;
  drawing: 'polygon' | 'lasso' | null;
  /** A mask outline is being drawn for this layer. */
  maskDrawing: 'polygon' | 'lasso' | null;
  /** The layers using this one as their matte. */
  matteOf: PlayLayer[];
  /** It sits right after the layer it is the matte of: shown tucked under it. */
  nested: boolean;
  exposedTargets: Set<string>;
  onSelect: () => void;
  onPatch: (fn: (l: PlayLayer) => PlayLayer) => void;
  revealTick: number;
  onRemove: () => void;
  onRename: (label: string) => void;
  onDuplicate: () => void;
  onReset: () => void;
  onCreateNull: (key: string) => void;
  onMove: (dir: -1 | 1) => void;
  onExpose: (key: string) => void;
  onExposeControl: (control: PlayControl) => void;
  onDriveNull: (key: string) => void;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(l.label);
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  // Shown from elsewhere (a link in the notes, the picture's menu): open it.
  const [seenTick, setSeenTick] = useState(revealTick);
  if (revealTick !== seenTick) { setSeenTick(revealTick); if (revealTick) setOpen(true); }
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== l.label) onRename(t); else setDraft(l.label); };
  const set = (p: Record<string, unknown>) => onPatch(x => ({ ...x, ...p } as PlayLayer));
  const f = makeFieldKit({ l, tk, touch, exposedTargets, set, onExpose, onExposeControl, onDriveNull });
  const ctx: EditorContext = {
    layers,
    act: (kind, amount = 1) => playOverlay.act({ do: kind, layerId: l.id, amount }),
    drawing,
    startDrawing: mode => { onSelect(); playOverlay.startDrawing(l.id, mode); },
    cancelDrawing: () => playOverlay.cancelDrawing(),
    createNull: onCreateNull,
    play,
    changePlay: onChangePlay,
  };
  // A layer made from a saved kind shows the kind's icon, colour and name.
  const mode = useThemeMode();
  const look = layerLook(l, play.layerKinds, mode, tk.text.faint);
  let body: ReactNode = null;
  switch (l.kind) {
    case 'null': body = <NullEditor f={f} ctx={ctx} />; break;
    case 'text': body = <TextEditor f={f} ctx={ctx} pictureHidden={pictureHidden} />; break;
    case 'image': body = <ImageEditor f={f} pictureHidden={pictureHidden} />; break;
    case 'camera': body = <CameraEditor f={f} pictureHidden={pictureHidden} />; break;
    case 'particles': body = <ParticlesEditor f={f} ctx={ctx} />; break;
    case 'shape': body = <ShapeEditor f={f} ctx={ctx} />; break;
    case 'audio': body = <AudioEditor f={f} />; break;
    case 'glyphs': body = <GlyphsEditor f={f} ctx={ctx} />; break;
    case 'contours': body = <ContoursEditor f={f} />; break;
    case 'lens': body = <LensEditor f={f} ctx={ctx} />; break;
    case 'brush': body = <BrushEditor f={f} ctx={ctx} />; break;
    case 'bodies': body = <BodiesEditor f={f} ctx={ctx} />; break;
    case 'cloner': body = <ClonerEditor f={f} ctx={ctx} />; break;
    case 'script': body = <ScriptEditor f={f} ctx={ctx} />; break;
    case 'background': body = <BackgroundEditor f={f} ctx={ctx} />; break;
    case 'data': body = <DataLayerEditor f={f} ctx={ctx} />; break;
  }
  // The Background layer stays at the bottom: it doesn't move, and there is only one.
  const isBackground = l.kind === 'background';

  const summary = !open ? matteMaskSummary(play, l) : '';
  const reveal = usePlayUi(s => s.reveal);

  return (
    <div
      data-layer-id={l.id}
      onPointerDownCapture={onSelect}
      style={{
        position: 'relative', padding: '8px 10px 10px', marginTop: nested ? 4 : 6, marginLeft: nested ? 18 : 0, borderRadius: radius.card, background: tk.bg.panel,
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : 1}px ${selected ? tk.accent.base : tk.border.default}`,
        // A hidden matte is still at work: it isn't dimmed like a hidden layer.
        opacity: (l.visible || matteOf.length) && !dim ? 1 : 0.6,
      }}
    >
      {stripe && <span aria-hidden style={{ position: 'absolute', left: 3, top: 10, bottom: 10, width: 3, borderRadius: 2, background: stripe }} />}
      {/* Tucked under the layer it is the matte of, joined by an elbow (After Effects' track matte column). */}
      {nested && <span aria-hidden style={{ position: 'absolute', left: -12, top: -5, width: 11, height: 23, borderLeft: `1.5px solid ${tk.text.faint}`, borderBottom: `1.5px solid ${tk.text.faint}`, borderBottomLeftRadius: 7, opacity: 0.7 }} />}
      <div
        draggable={!editing}
        onDragStart={e => { e.dataTransfer.setData(NOTE_REF_TYPE, noteRef('layer', l.id)); e.dataTransfer.setData('text/plain', noteRef('layer', l.id)); e.dataTransfer.effectAllowed = 'copyMove'; }}
        title="Drag to move it in the list, or onto the notes to link it"
        style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}
      >
        <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse layer' : 'Expand layer'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />
        <Tooltip label={look.label} description={look.hint}><Icon name={look.icon} size={14} style={{ color: look.color, flexShrink: 0 }} /></Tooltip>
        {editing ? (
          <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(l.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button type="button" title="Rename" onClick={() => { setDraft(l.label); setEditing(true); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</button>
        )}
        {l.kind !== 'null' && !isBackground && <SoloButton kind="layer" id={l.id} />}
        <span title={matteOf.length ? (l.visible ? 'Showing on its own too. Off: only as the matte' : 'Hidden, working as the matte. On: show it on its own too') : l.visible ? 'Hide' : 'Show'} style={{ display: 'inline-flex' }}>
          <Toggle checked={l.visible} onChange={visible => set({ visible })} />
        </span>
        {!isBackground && <IconButton icon="chevU" label="Move up (drawn earlier)" size="sm" disabled={!canUp} tooltip={false} onClick={() => onMove(-1)} />}
        {!isBackground && <IconButton icon="chevD" label="Move down (drawn later, on top)" size="sm" disabled={!canDown} tooltip={false} onClick={() => onMove(1)} />}
        <span ref={moreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More: duplicate, reset, delete" size="sm" tooltip={false} onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 220, y: r.bottom + 4 } : null); }} />
        </span>
        {menu && <Menu x={menu.x} y={menu.y} minWidth={220} onClose={() => setMenu(null)} items={isBackground ? backgroundMenuItems({ onReset, onRemove }) : [...groupItems, 'separator', ...layerMenuItems({ onDuplicate, onReset, onRemove })]} />}
      </div>
      {matteOf.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 0 0 20px', color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, minWidth: 0 }}>
          <Icon name="link" size={13} style={{ color: tk.accent.base }} />
          <span style={{ whiteSpace: 'nowrap' }}>Matte for</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {matteOf.map((u, k) => (
              <span key={u.id}>
                {k > 0 && ', '}
                <button type="button" onClick={() => reveal(u.id)} style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', color: tk.accent.text, font: 'inherit' }}>{u.label}</button>
              </span>
            ))}
          </span>
          {!l.visible && <span style={{ whiteSpace: 'nowrap' }}>· hidden</span>}
        </div>
      )}
      {summary && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 0 0 20px', color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <Icon name={l.trackMatte ? 'link' : 'mask'} size={13} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{summary}</span>
        </div>
      )}
      {open && (
        <>
          <MatteMaskBar f={f} play={play} changePlay={onChangePlay} drawing={maskDrawing} onSelect={onSelect} />
          {body}
          {SENSOR_READS_FOR[l.kind] && l.kind !== 'null' && (
            <Section kind={l.kind} title={l.kind === 'audio' ? 'Bands' : 'Readings'} hint={l.kind === 'audio'
              ? 'How loud each part of the sound is right now. Map… sends one to a control: bass to size, treble to sparkle.'
              : 'What this layer measures right now. Map… sends it to a control.'}>
              <LayerReadings layer={l} />
            </Section>
          )}
          {l.kind !== 'null' && !isBackground && f.toggle('Shader', 'toShader', 'Seen by the Layers node', 'Include this layer in what the graph\'s Layers node reads (its colour, alpha and distance), so shader effects like SDF Glow can use it.')}
        </>
      )}
    </div>
  );
}

