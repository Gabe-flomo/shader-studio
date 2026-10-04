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
import { VideoEditor } from './layers/VideoEditor';
import { DrumPadEditor } from './layers/DrumPadEditor';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNarrow } from '../../hooks/useNarrow';
import { useThemeMode, useTokens } from '../../theme/themeStore';
import { accentColor } from '../../theme/categories';
import type { LayerKindDef } from '../../types/layerKinds';
import { GROUP_COLOURS } from '../../types/layerGroups';
import { extraRelationshipsOf, relationshipNesting, RELATION_ROLE_LABEL } from '../../play/relationshipNesting';
import type { RelationRole } from '../../types/playLayers';
import { addKindLayer } from '../../play/layerKinds';
import { AddLayerMenu } from './layers/AddLayerMenu';
import { SaveSetDialog } from './layers/SaveSetDialog';
import { addLayerSetToPlay } from './presetsUi';
import { P5ImportDialog, type P5ImportResult } from './layers/P5Import';
import { p5LayerRecord } from './layers/p5Layer';
import { BUILTIN_LAYER, type BuiltinVariant } from './layers/addLayerCatalog';
import { script3dDefaults } from '../../types/playLayers';
import { alpha, fontFamily, radius } from '../../theme/tokens';
import { backgroundLayerOf, layerNumericProps, defaultLayer, layerTarget, parseActionTarget, parseLayerTarget, pictureHidden as isPictureHidden, type PlayControl, type PlayLayer, type PlayLayerKind, type PlayRecord } from '../../types/play';
import { buildTree, childrenOf, containerOf, groupLayerIds, groupOfLayer, groupPath, newLayerHome, type ItemRef, type LayerGroup, type TreeNode } from '../../types/layerGroups';
import { playId } from '../../play/playControls';
import { handFeed } from '../../lib/handFeed';
import { addHandPath, addNullFor, backgroundMenuItems, driveWithNull, duplicateLayer, layerMenuItems, layerNullDrives, removeLayer, renameLayer, resetLayer } from './layerOps';
import { canMove, placeNewLayer, createGroup, duplicateGroup, moveItem, moveItemTo, orderedItems, removeGroup, takeOutOfGroup, ungroup } from './groupOps';
import { BackgroundEditor } from './layers/BackgroundEditor';
import { GroupCard } from './layers/GroupCard';
import { layerLook } from './layers/layerLook';
import { addBackground, thisGraphSource } from '../../play/backgroundQueue';
import { toast } from '../ui/toastStore';
import { askConfirm } from '../ui/dialogStore';
import { SoloButton, SoloStrip } from './Solo';
import { LayerPortsView } from './LayerPortsView';
import { Section } from './layers/Section';
import { BigEditorScaffold } from './layers/BigEditorScaffold';
import { clampLayersSplitRatio, LAYERS_SPLIT_DEFAULT_RATIO, usePlayUi } from './playUi';
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
  type EditorContext, ClonerEditor, RelationshipEditor, ScriptEditor } from './layers/editors';
import { AgentsEditor } from './layers/AgentsEditor';
import { MotionEditor } from './layers/MotionEditor';
import { WaterEditor } from './layers/WaterEditor';
import { motionSourceStart } from '../../play/motionLayers';
import { RulesSummary } from './rules/RulesSummary';
import { startRule } from './playSplit';
import { layerPositionPair } from '../../play/pairs';
import { DataLayerEditor } from './layers/DataLayerEditor';
import { MatteMaskBar } from './layers/MatteMask';
import { matteMaskSummary } from '../../play/mattes';
import { displaceUsers, matteUsers } from '../../types/playLayers';
import { dragFileCount, dragHasFiles } from '../../play/layerDrop';
import { addDroppedLayers, dropLabel } from './dropLayers';
import { appDropMakers } from './dropMakers';
import { startOverMenuItem } from '../../play/startOver';

const KIND = BUILTIN_LAYER;

/** Dragging a row to reorder it: the drag's data type, and which row it is (dragover can't read the data). */
const ROW_TYPE = 'application/x-playfield-row';
let draggingRow: ItemRef | null = null;

const sameItem = (a: ItemRef, b: ItemRef) => a.kind === b.kind && a.id === b.id;
const nodeItem = (n: TreeNode): ItemRef => (n.kind === 'layer' ? { kind: 'layer', id: n.layer.id } : { kind: 'group', id: n.group.id });

export function LayersPanel({ play, touch, exposedTargets, onChange, onExpose, top, split = false, big = false, extras = true }: {
  play: PlayRecord;
  touch: boolean;
  /** Targets that already have a control (their + is shown pressed). */
  exposedTargets: Set<string>;
  onChange: (fn: (p: PlayRecord) => PlayRecord) => void;
  /** Add a control for a numeric layer property. */
  onExpose: (control: PlayControl) => void;
  /** Scrolls with the list, above the layers (phones put the notes here). */
  top?: ReactNode;
  /** Wide (the Play split view's big panel): the list of layers on the left, the selected layer's editor on the right. */
  split?: boolean;
  /** In the split view's big panel (wide or not): big editors (the drum pads') show in full. */
  big?: boolean;
  /** Actions and Signals under the list (the rail's full-width pages give them pages of their own). */
  extras?: boolean;
}) {
  const tk = useTokens();
  const mode = useThemeMode();
  const addRef = useRef<HTMLSpanElement>(null);
  const emptyAddRef = useRef<HTMLSpanElement>(null);
  const emptySetsRef = useRef<HTMLSpanElement>(null);
  // Which button opened the Add layer menu: the header's, or one of the empty state's (so it
  // drops down under whichever was pressed). 'sets' also jumps the menu to its Layer sets section.
  const [menuAnchor, setMenuAnchor] = useState<'header' | 'empty' | 'sets' | null>(null);
  const menu = menuAnchor !== null;
  const menuAnchorRef = menuAnchor === 'empty' ? emptyAddRef : menuAnchor === 'sets' ? emptySetsRef : addRef;
  const pageMoreRef = useRef<HTMLSpanElement>(null);
  const [pageMore, setPageMore] = useState<{ x: number; y: number } | null>(null);
  const [importingP5, setImportingP5] = useState(false);
  const addP5 = (r: P5ImportResult) => {
    setImportingP5(false);
    const id = playId('layer');
    let made: PlayLayer;
    try { made = p5LayerRecord(r.patch, r.startAt, id); } catch (e) { toast.error('The sketch does not compile', { message: (e as Error)?.message ?? String(e) }); return; }
    onChange(p => { const next = { ...p, layers: [...p.layers, made] }; return placeNewLayer(next, id, entered); });
    leaveSealed();
    setSelected(id);
    toast.success(`Imported “${r.title}”`, { message: `${1 + (r.patch.files.length)} file${r.patch.files.length ? 's' : ''} · open the Sketch editor from the layer to see its code and console.` });
  };
  const selected = usePlayUi(s => s.selected), setSelected = usePlayUi(s => s.select), revealTick = usePlayUi(s => s.revealTick);
  const mask = usePlayUi(s => s.mask);
  const alwaysExpand = usePlayUi(s => s.alwaysExpandCards), setAlwaysExpand = usePlayUi(s => s.setAlwaysExpandCards);
  const [drawing, setDrawing] = useState<ShapeDrawing | null>(null);
  useEffect(() => { playOverlay.setEditing(true, selected, mask); }, [selected, mask]);
  // A mask picked (or drawn) on the picture opens in its layer's card.
  useEffect(() => playOverlay.onMaskSelect((layerId, maskId) => { const ui = usePlayUi.getState(); if (ui.selected !== layerId) ui.select(layerId); ui.setMask(maskId); }), []);
  useEffect(() => () => { playOverlay.setEditing(false); playOverlay.cancelDrawing(); }, []);
  useEffect(() => playOverlay.onDrawing(d => setDrawing(d ? { ...d } : null)), []);
  // A layer clicked on the picture is selected here too.
  useEffect(() => playOverlay.onSelect(id => usePlayUi.getState().reveal(id)), []);

  // Image and video files dragged over the list: a drop adds them as layers (into the group it shows).
  const [fileDrag, setFileDrag] = useState<string | null>(null);
  const fileDragOver = (e: React.DragEvent) => {
    if (!dragHasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const label = dropLabel(dragFileCount(e.dataTransfer), 'list');
    if (label !== fileDrag) setFileDrag(label);
  };
  useEffect(() => { if (!fileDrag) return; const end = () => setFileDrag(null); window.addEventListener('dragend', end); window.addEventListener('drop', end); return () => { window.removeEventListener('dragend', end); window.removeEventListener('drop', end); }; }, [fileDrag]);

  // Groups: the rows the list shows (the whole list, or inside the group it has entered).
  const tree = useMemo(() => buildTree(play), [play]);
  const enteredRaw = usePlayUi(s => s.entered), enter = usePlayUi(s => s.enter);
  const entered = enteredRaw && play.groups?.some(g => g.id === enteredRaw) ? enteredRaw : '';
  const path = entered ? groupPath(play.groups, entered) : [];
  // A new layer doesn't join a sealed group (a Granulator's grain nulls): the list goes to where it landed.
  const leaveSealed = () => { if (!entered) return; const home = newLayerHome(play.groups, entered); if (home !== entered) enter(home); };
  const rows = childrenOf(tree, entered);
  const inside = path[path.length - 1];
  const hiddenAbove = path.some(g => g.hidden);
  const stripe = inside ? accentColor(inside.colour, mode) : undefined;

  // Relationship layers' members, tucked under their row (relationshipNesting.ts): only among the
  // layers this view shows, so a member nests only when its relationship is in the same list.
  const nesting = useMemo(
    () => relationshipNesting(rows.flatMap(n => (n.kind === 'layer' ? [n.layer] : []))),
    [rows],
  );
  const relIds = useMemo(() => Array.from(nesting.byRelationship.keys()), [nesting]);
  const relColour = (id: string) => accentColor(GROUP_COLOURS[Math.max(0, relIds.indexOf(id)) % GROUP_COLOURS.length], mode);
  const relFolded = usePlayUi(s => s.folded);
  const toggleRelFold = usePlayUi(s => s.toggleFold);
  // Selecting a relationship highlights its members (faintly); selecting a member outlines the
  // relationship row(s) it belongs to.
  const selectedRelMemberships = selected ? nesting.byMember.get(selected) ?? [] : [];

  const addKind = (k: LayerKindDef) => {
    const id = playId('layer');
    onChange(p => { const next = addKindLayer(p, k, id); return placeNewLayer(next, id, entered); });
    leaveSealed();
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
    // A hand path: fingertip nulls (the missing ones) and a filled path between them; tracking starts.
    if (variant === 'handPath') {
      const id = playId('layer');
      onChange(p => { const next = addHandPath(p, id).play; return placeNewLayer(next, id, entered); });
      leaveSealed();
      if (handFeed.getStatus() === 'off') void handFeed.start();
      setSelected(id);
      return;
    }
    // A p5.js sketch: the importer says what it will be first.
    if (variant === 'p5import') { setImportingP5(true); return; }
    // A 3D Script is a Script layer in 3D, starting from the 3D starter.
    const is3d = variant === 'script3d';
    const n = play.layers.filter(l => l.kind === kind && (kind !== 'script' || (l.kind === 'script' && (l.mode === '3d') === is3d))).length + 1;
    const id = playId('layer');
    const made0 = defaultLayer(kind, id, `${is3d ? '3D Script' : KIND[kind].label} ${n}`);
    // A Motion layer starts on the camera when there is one, else on the setup's first Video layer.
    const made = made0.kind === 'motion' ? { ...made0, ...motionSourceStart(play.layers) } : made0;
    // Added while the list shows a group: it goes in that group (not a sealed one: a Granulator's grain nulls).
    onChange(p => { const next = { ...p, layers: [...p.layers, is3d ? ({ ...made, ...script3dDefaults() } as PlayLayer) : made] }; return placeNewLayer(next, id, entered); });
    leaveSealed();
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
      { label: 'Save as a set…', icon: 'layers', hint: 'Its layers with their controls, mappings and actions, to add anywhere', onSelect: () => setSavingSet(groupLayerIds(play, g.id)) },
      { label: 'Ungroup', hint: `${MOD}⇧G · the layers stay where they are`, onSelect: () => onChange(p => ungroup(p, g.id)) },
      'separator',
      { label: 'Move up', hint: 'Drawn earlier', disabled: !canMove(play, item, -1), onSelect: () => onChange(p => moveItem(p, item, -1)) },
      { label: 'Move down', hint: 'Drawn later, on top', disabled: !canMove(play, item, 1), onSelect: () => onChange(p => moveItem(p, item, 1)) },
      'separator',
      { label: 'Delete group and its layers', hint: 'With the controls and mappings that use them', danger: true, onSelect: () => { void askConfirm(`Delete “${g.label}”?`, { message: `Its ${groupLayerIds(play, g.id).length} layers go too, with the controls, mappings and actions that use them.`, confirmLabel: 'Delete', danger: true }).then(ok => { if (ok) onChange(p => removeGroup(p, g.id)); }); } },
    ];
  };
  const [duplicating, setDuplicating] = useState<LayerGroup | null>(null);
  // "Save as a set…": the layers picked (a picked group brings every layer inside it), or the selected one.
  const [savingSet, setSavingSet] = useState<string[] | null>(null);
  const pickedLayerIds = (): string[] => {
    const items = picked.length ? picked : selectedInView && backgroundLayerOf(play)?.id !== selected ? [selectedInView] : [];
    const ids = new Set(items.flatMap(i => (i.kind === 'group' ? groupLayerIds(play, i.id) : [i.id])));
    return play.layers.filter(l => ids.has(l.id) && l.kind !== 'background').map(l => l.id);
  };
  const saveSet = () => { const ids = pickedLayerIds(); if (ids.length) setSavingSet(ids); };
  const duplicateGroupAs = (g: LayerGroup, withControls: boolean) => {
    let made = '';
    onChange(p => { const r = duplicateGroup(p, g.id, withControls); made = r.id; return r.play; });
    setDuplicating(null);
    if (made) requestAnimationFrame(() => listRef.current?.querySelector(`[data-group-id="${CSS.escape(made)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  };

  // Rows dragged to a new place among their neighbours.
  const [dropAt, setDropAt] = useState<{ key: string; where: 'before' | 'after' } | null>(null);
  const layerCount = play.layers.length;

  // A layer's card: its row in the list and, split, its editor beside the list.
  const rowProps = (l: PlayLayer, nested: boolean): LayerRowProps => {
    const it: ItemRef = { kind: 'layer', id: l.id };
    return {
      layer: l,
      layers: play.layers,
      play,
      onChangePlay: onChange,
      canUp: canMove(play, it, -1),
      canDown: canMove(play, it, 1),
      touch,
      selected: selected === l.id,
      stripe,
      dim: hiddenAbove,
      pictureHidden: isPictureHidden(play.display),
      drawing: drawing?.layerId === l.id && !drawing.mask ? drawing.mode : null,
      maskDrawing: drawing?.layerId === l.id && drawing.mask ? drawing.mode : null,
      matteOf: matteUsers(play.layers, l.id),
      nested,
      exposedTargets,
      big,
      onSelect: () => setSelected(l.id),
      onPatch: fn => patch(l.id, fn),
      revealTick: selected === l.id ? revealTick : 0,
      onRemove: () => remove(l.id),
      onRename: label => onChange(p => renameLayer(p, l.id, label)),
      onDuplicate: () => duplicate(l.id),
      onReset: () => reset(l.id),
      onCreateNull: key => createNull(l.id, key),
      onMove: dir => onChange(p => moveItem(p, it, dir)),
      groupItems: l.kind === 'background' ? [] : [
        { label: 'Group', hint: `${MOD}G · in a new group of its own`, onSelect: () => onChange(p => createGroup(p, [it]).play) },
        ...(entered ? [{ label: 'Take out of group', hint: `Into ${path.length > 1 ? `“${path[path.length - 2].label}”` : 'the main list'}`, onSelect: () => onChange(p => takeOutOfGroup(p, l.id)) }] : []),
      ],
      onExpose: key => expose(l, key),
      onExposeControl: onExpose,
      onDriveNull: key => driveNull(l, key),
      onPairXY: key => { onChange(p => layerPositionPair(p, l.id, key).play); toast.success('Added as a position', { message: 'Two sliders and an XY pad on the Controls tab; map the pointer or a null onto both.' }); },
    };
  };

  // A row's drag-to-reorder shell, for a layer at its own spot in the list or nested under its
  // relationship (nesting is display-only: dragging it still reorders the real list).
  const rowShellFor = (it: ItemRef, k: string, pickable: boolean, children: ReactNode) => (
    <RowShell
      key={k}
      picked={isPicked(it)}
      selectMode={selectMode}
      pickable={pickable}
      touch={touch}
      drop={dropAt?.key === k ? dropAt.where : null}
      onPick={how => pick(it, how)}
      onLongPress={() => { anchor.current = it; setPicked(isPicked(it) ? picked : [...picked, it], true); }}
      onDragStart={() => { draggingRow = it; }}
      onDragOver={where => { if (!draggingRow || sameItem(draggingRow, it) || containerOf(play, draggingRow) !== containerOf(play, it)) return false; if (dropAt?.key !== k || dropAt.where !== where) setDropAt({ key: k, where }); return true; }}
      onDragEnd={() => { draggingRow = null; setDropAt(null); }}
      onDrop={where => { const from = draggingRow; draggingRow = null; setDropAt(null); if (from) onChange(p => moveItemTo(p, from, it, where)); }}
    >
      {children}
    </RowShell>
  );

  // Split: the list beside the selected layer's editor, with a draggable divider between them
  // (LAYERS_SPLIT_MIN_LIST_PX/LAYERS_SPLIT_MIN_EDITOR_PX so neither collapses; playUi.ts remembers the ratio).
  const editing = split ? play.layers.find(l => l.id === selected) : undefined;
  const splitAreaRef = useRef<HTMLDivElement>(null);
  const [splitTotal, setSplitTotal] = useState(0);
  useEffect(() => {
    if (!split) return;
    const el = splitAreaRef.current;
    if (!el) return;
    const measure = () => setSplitTotal(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [split]);
  const storedSplitRatio = usePlayUi(s => s.layersSplitRatio), setStoredSplitRatio = usePlayUi(s => s.setLayersSplitRatio);
  const [dragSplitRatio, setDragSplitRatio] = useState<number | null>(null);
  const splitRatio = clampLayersSplitRatio(dragSplitRatio ?? storedSplitRatio, splitTotal || undefined);
  const startSplitDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const area = splitAreaRef.current;
    if (!area) return;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let latest = splitRatio;
    const onMove = (ev: PointerEvent) => {
      const rect = area.getBoundingClientRect();
      latest = clampLayersSplitRatio((ev.clientX - rect.left) / rect.width, rect.width);
      setDragSplitRatio(latest);
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      setDragSplitRatio(null);
      setStoredSplitRatio(latest);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  };
  const nudgeSplit = (dir: -1 | 1) => {
    const step = splitTotal > 0 ? 16 / splitTotal : 0.02;
    setStoredSplitRatio(clampLayersSplitRatio(splitRatio + dir * step, splitTotal || undefined));
  };
  const wrapSplit = (list: ReactNode) => !split ? list : (
    <div ref={splitAreaRef} style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {list}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the layer list"
        aria-valuenow={Math.round(splitRatio * 100)}
        tabIndex={0}
        title="Drag to resize · double-click for the default width"
        onPointerDown={startSplitDrag}
        onDoubleClick={() => setStoredSplitRatio(LAYERS_SPLIT_DEFAULT_RATIO)}
        onKeyDown={e => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeSplit(-1); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); nudgeSplit(1); }
          else if (e.key === 'Enter') { e.preventDefault(); setStoredSplitRatio(LAYERS_SPLIT_DEFAULT_RATIO); }
        }}
        style={{ flexShrink: 0, width: 9, margin: '0 -4px', cursor: 'col-resize', touchAction: 'none', position: 'relative', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span aria-hidden style={{ width: 1, height: '100%', background: tk.border.default }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '6px 16px 16px' }}>
        {editing
          ? <LayerRow key={editing.id} {...rowProps(editing, false)} />
          : (
            <div style={{ margin: '18px 4px', padding: '16px 14px', borderRadius: radius.lg, border: `1px dashed ${tk.border.strong}`, color: tk.text.muted, lineHeight: 1.5 }}>
              {play.layers.length ? 'Pick a layer in the list to edit it here.' : 'Add a layer and edit it here.'}
            </div>
          )}
      </div>
    </div>
  );

  return (
    <>
      <div style={{ minHeight: 44, flexShrink: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, rowGap: 4, padding: '6px 8px 6px 14px', boxSizing: 'border-box', borderBottom: `1px solid ${tk.border.default}`, background: tk.bg.panel }}>
        <span style={{ font: `650 13px ${fontFamily.ui}` }}>Layers</span>
        {layerCount > 0 && <span style={{ color: tk.text.faint, font: `500 11.5px ${fontFamily.mono}` }}>{layerCount}</span>}
        <span style={{ flex: 1 }} />
        {/* Add layer comes first among the optional buttons, so it's never the one pushed off when the
            header is narrow (the list column of a split view, a medium panel width). */}
        <span ref={addRef} style={{ display: 'inline-flex' }}>
          <Button size="sm" icon="plus" aria-expanded={menuAnchor === 'header'} onClick={() => setMenuAnchor(a => (a === 'header' ? null : 'header'))}>Add layer</Button>
        </span>
        {!split && layerCount > 4 && !selectMode && (
          <Tooltip label="Always expand cards" description="Off: with this many layers, an unselected card shows only its header — it opens when you pick it, so the list isn't a wall of every card's settings at once.">
            <Button size="sm" variant={alwaysExpand ? 'primary' : 'ghost'} onClick={() => setAlwaysExpand(!alwaysExpand)}>Always expand</Button>
          </Tooltip>
        )}
        {layerCount > 1 && !selectMode && (
          <Tooltip label="Select layers to group" description={`Or ⇧-click and ${MOD}-click cards, then ${MOD}G.`}>
            <Button size="sm" variant="ghost" onClick={() => setPicked(picked, true)}>Select</Button>
          </Tooltip>
        )}
        {menu && (
          <AddLayerMenu
            play={play}
            touch={touch}
            anchorRef={menuAnchorRef}
            initialSection={menuAnchor === 'sets' ? 'sets' : undefined}
            onAdd={add}
            onAddKind={addKind}
            onAddSet={set => addLayerSetToPlay(set)}
            onChange={onChange}
            onClose={() => setMenuAnchor(null)}
          />
        )}
        {importingP5 && <P5ImportDialog onCreate={addP5} onClose={() => setImportingP5(false)} />}
        <span ref={pageMoreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More" size="sm" tooltip={false} onClick={() => { const r = pageMoreRef.current?.getBoundingClientRect(); setPageMore(r ? { x: r.right - 200, y: r.bottom + 4 } : null); }} />
        </span>
        {pageMore && <Menu x={pageMore.x} y={pageMore.y} minWidth={200} onClose={() => setPageMore(null)} items={[
          { label: 'Save as a set…', icon: 'layers', disabled: !pickedLayerIds().length, hint: picked.length ? `The ${picked.length} picked, with their controls and mappings` : 'The selected layer (⇧/⌘-click to pick more)', onSelect: () => { setPageMore(null); saveSet(); } },
          'separator',
          startOverMenuItem(() => setPageMore(null)),
        ]} />}
        {savingSet && <SaveSetDialog play={play} layerIds={savingSet} onClose={saved => { setSavingSet(null); if (saved) clearPicks(); }} />}
      </div>
      {(picked.length > 0 || selectMode) && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px 6px 14px', borderBottom: `1px solid ${tk.border.default}`, background: alpha(tk.accent.base, 0.08) }}>
          <span style={{ flex: 1, minWidth: 0, color: tk.text.secondary, font: `600 12px ${fontFamily.ui}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {picked.length ? `${picked.length} selected` : touch ? 'Tap layers to select' : 'Click layers to select'}
          </span>
          {picked.some(i => i.kind === 'group') && <Button size="sm" variant="ghost" onClick={ungroupPicked} title={`Ungroup (${MOD}⇧G)`}>Ungroup</Button>}
          <Button size="sm" variant="ghost" icon="layers" disabled={!picked.length} onClick={saveSet} title="The picked layers with their controls, mappings and actions, to add in any setup">Save as a set…</Button>
          <Button size="sm" variant="primary" icon="folder" disabled={!picked.length} onClick={groupPicked} title={`Group (${MOD}G)`}>Group</Button>
          <Button size="sm" variant="ghost" onClick={clearPicks}>{selectMode ? 'Done' : 'Clear'}</Button>
        </div>
      )}
      {wrapSplit(<div ref={listRef} data-layer-list=""
        onDragEnter={fileDragOver} onDragOver={fileDragOver}
        onDragLeave={e => { if (fileDrag && !e.currentTarget.contains(e.relatedTarget as Node | null)) setFileDrag(null); }}
        onDrop={e => {
          if (!dragHasFiles(e.dataTransfer)) return;
          e.preventDefault();
          setFileDrag(null);
          void addDroppedLayers(Array.from(e.dataTransfer.files), null, onChange, appDropMakers, entered);
        }}
        style={{ ...(split
          ? { flex: `0 0 ${(splitRatio * 100).toFixed(2)}%`, minWidth: 0, overflowY: 'auto', padding: '6px 12px 12px 16px', borderRight: `1px solid ${tk.border.default}` }
          : { flex: 1, minHeight: play.notes && !top ? 110 : 0, overflowY: 'auto', padding: '6px 12px 12px' }),
        ...(fileDrag ? { boxShadow: `inset 0 0 0 2px ${tk.accent.base}`, background: alpha(tk.accent.base, 0.06) } : {}) }}>
        {fileDrag && (
          // Files dragged over the list: what a drop does.
          <div data-layer-drop="" style={{ position: 'sticky', top: 0, zIndex: 3, margin: '4px 0 6px', padding: '8px 12px', borderRadius: radius.md, background: tk.accent.base, color: '#fff', font: `600 12.5px ${fontFamily.ui}`, textAlign: 'center', pointerEvents: 'none' }}>{fileDrag}</div>
        )}
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
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span ref={emptyAddRef} style={{ display: 'inline-flex' }}>
                <Button size="sm" variant="primary" icon="plus" aria-expanded={menuAnchor === 'empty'} onClick={() => setMenuAnchor(a => (a === 'empty' ? null : 'empty'))}>Add layer</Button>
              </span>
              <span ref={emptySetsRef} style={{ display: 'inline-flex' }}>
                <Button size="sm" variant="ghost" icon="layers" aria-expanded={menuAnchor === 'sets'} onClick={() => setMenuAnchor(a => (a === 'sets' ? null : 'sets'))}>Layer sets…</Button>
              </span>
            </div>
          </div>
        ) : rows.map((n, i) => {
          const item = nodeItem(n);
          const k = `${item.kind}:${item.id}`;
          const prev = rows[i - 1];
          // A relationship's members render nested under it (below), not at their own spot.
          if (n.kind === 'layer' && nesting.byMember.has(n.layer.id)) return null;
          const rowShell = rowShellFor(item, k, !(n.kind === 'layer' && n.layer.kind === 'background'), (
            n.kind === 'group' ? (
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
              const members = nesting.byRelationship.get(l.id);
              return (
                <LayerRow
                  {...rowProps(l, prev?.kind === 'layer' && prev.layer.trackMatte?.id === l.id)}
                  headerOnly={split}
                  relOutline={selectedRelMemberships.includes(l.id) ? relColour(l.id) : undefined}
                  relMembers={members?.length ? { count: members.length, colour: relColour(l.id), collapsed: !!relFolded[`rel:${l.id}`], onToggle: () => toggleRelFold(`rel:${l.id}`, !relFolded[`rel:${l.id}`]) } : undefined}
                />
              );
            })()
          ));
          if (n.kind !== 'layer' || n.layer.kind !== 'relationship') return rowShell;
          const members = nesting.byRelationship.get(n.layer.id) ?? [];
          if (!members.length || relFolded[`rel:${n.layer.id}`]) return rowShell;
          const colour = relColour(n.layer.id);
          return (
            <Fragment key={k}>
              {rowShell}
              {members.map(m => {
                const ml = play.layers.find(x => x.id === m.id);
                if (!ml) return null;
                const mItem: ItemRef = { kind: 'layer', id: ml.id };
                const mk = `layer:${ml.id}`;
                const extra = extraRelationshipsOf(nesting, ml.id);
                return rowShellFor(mItem, mk, ml.kind !== 'background', (
                  <LayerRow
                    {...rowProps(ml, false)}
                    headerOnly={split}
                    relNest={{ colour, role: m.role, extra: extra.length, relLabel: n.layer.label }}
                    relHighlight={selected === n.layer.id}
                  />
                ));
              })}
            </Fragment>
          );
        })}
        {!entered && extras && <RulesSummary play={play} />}
      </div>)}
      {duplicating && <DuplicateGroupDialog group={duplicating} play={play} onPick={w => duplicateGroupAs(duplicating, w)} onClose={() => setDuplicating(null)} />}
    </>
  );
}

type LayerRowProps = Omit<Parameters<typeof LayerRow>[0], 'headerOnly'>;

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

function LayerRow({ layer: l, layers, play, onChangePlay, canUp, canDown, touch, selected, stripe, dim, groupItems, pictureHidden, drawing, maskDrawing, matteOf, nested, exposedTargets, revealTick, onSelect, onPatch, onRemove, onRename, onDuplicate, onReset, onCreateNull, onMove, onExpose, onExposeControl, onDriveNull, onPairXY, headerOnly = false, big = false, relNest, relHighlight, relMembers, relOutline }: {
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
  onPairXY: (key: string) => void;
  /** Just the card's header: the split view lists layers this way and edits the selected one beside the list. */
  headerOnly?: boolean;
  /** In the split view's big panel. */
  big?: boolean;
  /** This row is a relationship's member, nested (display-only) under its row: the relationship's colour and label, this member's role, and how many other relationships it also belongs to. */
  relNest?: { colour: string; role: RelationRole; extra: number; relLabel: string };
  /** Its relationship (a `relNest` row's parent, or a relationship row itself when it is the one selected) is selected: highlight faintly. */
  relHighlight?: boolean;
  /** This is a relationship layer with members nested under it: how many, its colour, and the fold state. */
  relMembers?: { count: number; colour: string; collapsed: boolean; onToggle: () => void };
  /** A member of this relationship is selected: outline the row in the relationship's colour. */
  relOutline?: string;
}) {
  const tk = useTokens();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(l.label);
  // With more than a handful of layers, an unselected card is just its header row (name, kind, visibility) —
  // it opens on selection, so the list doesn't turn into a wall of every card's settings at once. A manual
  // fold/unfold (the chevron) sticks until the layer's selected state changes again; "Always expand cards"
  // (the Layers header) turns the whole thing off.
  const alwaysExpand = usePlayUi(s => s.alwaysExpandCards);
  const manyLayers = !headerOnly && layers.length > 4;
  const collapsedByDefault = manyLayers && !alwaysExpand;
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  useEffect(() => { setManualOpen(null); }, [selected]);
  const open = manualOpen !== null ? manualOpen : !collapsedByDefault || selected;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => setManualOpen(typeof next === 'function' ? next(open) : next);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLSpanElement>(null);
  // Shown from elsewhere (a link in the notes, the picture's menu): open it.
  const [seenTick, setSeenTick] = useState(revealTick);
  if (revealTick !== seenTick) { setSeenTick(revealTick); if (revealTick) setOpen(true); }
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== l.label) onRename(t); else setDraft(l.label); };
  const set = (p: Record<string, unknown>) => onPatch(x => ({ ...x, ...p } as PlayLayer));
  const f = makeFieldKit({ l, tk, touch, exposedTargets, set, onExpose, onExposeControl, onDriveNull, onPairXY });
  const ctx: EditorContext = {
    layers,
    act: (kind, amount = 1) => playOverlay.act({ do: kind, layerId: l.id, amount }),
    drawing,
    startDrawing: mode => { onSelect(); playOverlay.startDrawing(l.id, mode); },
    cancelDrawing: () => playOverlay.cancelDrawing(),
    createNull: onCreateNull,
    play,
    changePlay: onChangePlay,
    big,
    touch,
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
    case 'video': body = <VideoEditor f={f} ctx={ctx} pictureHidden={pictureHidden} />; break;
    case 'drumpad': body = <DrumPadEditor f={f} ctx={ctx} />; break;
    case 'particles': body = <ParticlesEditor f={f} ctx={ctx} />; break;
    case 'shape': body = <ShapeEditor f={f} ctx={ctx} />; break;
    case 'audio': body = <AudioEditor f={f} />; break;
    case 'glyphs': body = <GlyphsEditor f={f} ctx={ctx} />; break;
    case 'contours': body = <ContoursEditor f={f} />; break;
    case 'lens': body = <LensEditor f={f} ctx={ctx} />; break;
    case 'brush': body = <BrushEditor f={f} ctx={ctx} />; break;
    case 'bodies': body = <BodiesEditor f={f} ctx={ctx} />; break;
    case 'relationship': body = <RelationshipEditor f={f} ctx={ctx} />; break;
    case 'agents': body = <AgentsEditor f={f} ctx={ctx} />; break;
    case 'motion': body = <MotionEditor f={f} ctx={ctx} />; break;
    case 'water': body = <WaterEditor f={f} ctx={ctx} />; break;
    case 'cloner': body = <ClonerEditor f={f} ctx={ctx} />; break;
    case 'script': body = <ScriptEditor f={f} ctx={ctx} />; break;
    case 'background': body = <BackgroundEditor f={f} ctx={ctx} />; break;
    case 'data': body = <DataLayerEditor f={f} ctx={ctx} />; break;
  }
  // The Background layer stays at the bottom: it doesn't move, and there is only one.
  const isBackground = l.kind === 'background';

  const shows = open && !headerOnly;
  const summary = !shows ? matteMaskSummary(play, l) : '';
  const reveal = usePlayUi(s => s.reveal);

  // Relationship nesting: a member row indents under its relationship's row (12px on a phone, 18px
  // otherwise — the same as a group's children), with a connector and a role chip.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const relIndent = narrow ? 12 : 18;
  // A narrow card keeps its name readable: Move up / Move down go into the ⋯ menu.
  const headRef = useRef<HTMLDivElement>(null);
  const tight = useNarrow(headRef, 300);
  const moveItems: MenuItem[] = tight && !isBackground && !headerOnly ? [
    { label: 'Move up (drawn earlier)', icon: 'chevU', disabled: !canUp, onSelect: () => onMove(-1) },
    { label: 'Move down (drawn later, on top)', icon: 'chevD', disabled: !canDown, onSelect: () => onMove(1) },
    'separator',
  ] : [];

  return (
    <div
      data-layer-id={l.id}
      onPointerDownCapture={onSelect}
      style={{
        position: 'relative', padding: '8px 10px 10px', marginTop: nested || relNest ? 4 : 6, marginLeft: relNest ? relIndent : nested ? 18 : 0, borderRadius: radius.card,
        background: relHighlight && relNest ? alpha(relNest.colour, 0.1) : tk.bg.panel,
        boxShadow: `inset 0 0 0 ${selected ? 1.5 : relOutline ? 1.5 : 1}px ${selected ? tk.accent.base : relOutline ?? tk.border.default}`,
        // A hidden matte is still at work: it isn't dimmed like a hidden layer.
        opacity: (l.visible || matteOf.length) && !dim ? 1 : 0.6,
      }}
    >
      {stripe && <span aria-hidden style={{ position: 'absolute', left: 3, top: 10, bottom: 10, width: 3, borderRadius: 2, background: stripe }} />}
      {/* Tucked under the layer it is the matte of, joined by an elbow (After Effects' track matte column). */}
      {nested && <span aria-hidden style={{ position: 'absolute', left: -12, top: -5, width: 11, height: 23, borderLeft: `1.5px solid ${tk.text.faint}`, borderBottom: `1.5px solid ${tk.text.faint}`, borderBottomLeftRadius: 7, opacity: 0.7 }} />}
      {/* Tucked under its relationship's row: display-only — dragging it out doesn't remove it, only the editor does. */}
      {relNest && (
        <Tooltip label={`Drawn in its own place; grouped here because “${relNest.relLabel}” moves it`}>
          <span aria-hidden style={{ position: 'absolute', left: -(relIndent - 6), top: -5, width: relIndent - 7, height: 23, borderLeft: `1.5px solid ${relNest.colour}`, borderBottom: `1.5px solid ${relNest.colour}`, borderBottomLeftRadius: 7, opacity: 0.8 }} />
        </Tooltip>
      )}
      <div
        ref={headRef}
        draggable={!editing}
        onDragStart={e => { e.dataTransfer.setData(NOTE_REF_TYPE, noteRef('layer', l.id)); e.dataTransfer.setData('text/plain', noteRef('layer', l.id)); e.dataTransfer.effectAllowed = 'copyMove'; }}
        title="Drag to move it in the list, or onto the notes to link it"
        style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 26 }}
      >
        {!headerOnly && <IconButton icon={open ? 'chevD' : 'chevR'} label={open ? 'Collapse layer' : 'Expand layer'} size="sm" tooltip={false} onClick={() => setOpen(o => !o)} style={{ marginLeft: -6 }} />}
        <Tooltip label={look.label} description={look.hint}><Icon name={look.icon} size={14} style={{ color: look.color, flexShrink: 0 }} /></Tooltip>
        {editing ? (
          <Field autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(l.label); setEditing(false); } }} height={26} style={{ flex: 1 }} />
        ) : (
          <button type="button" title={headerOnly ? 'Edit' : 'Rename'} onClick={() => { if (headerOnly) return; setDraft(l.label); setEditing(true); }} style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 0, background: 'none', padding: 0, cursor: headerOnly ? 'pointer' : 'text', color: tk.text.primary, font: `600 12.5px ${fontFamily.ui}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</button>
        )}
        {relNest && (
          <>
            <Tooltip label={`Grouped under “${relNest.relLabel}”`}>
              <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: relNest.colour, flexShrink: 0 }} />
            </Tooltip>
            <span style={{ flexShrink: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', padding: '2px 6px', borderRadius: 999, background: alpha(relNest.colour, 0.16), color: relNest.colour, font: `650 10px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>{RELATION_ROLE_LABEL[relNest.role]}</span>
            {relNest.extra > 0 && (
              <Tooltip label={`In ${relNest.extra} other relationship${relNest.extra === 1 ? '' : 's'} too`}>
                <span style={{ flexShrink: 0, padding: '2px 5px', borderRadius: 999, background: tk.bg.field, color: tk.text.faint, font: `650 10px ${fontFamily.ui}`, whiteSpace: 'nowrap' }}>+{relNest.extra}</span>
              </Tooltip>
            )}
          </>
        )}
        {l.kind !== 'null' && !isBackground && <SoloButton kind="layer" id={l.id} />}
        <span title={matteOf.length ? (l.visible ? 'Showing on its own too. Off: only as the matte' : 'Hidden, working as the matte. On: show it on its own too') : l.visible ? 'Hide' : 'Show'} style={{ display: 'inline-flex' }}>
          <Toggle checked={l.visible} onChange={visible => set({ visible })} />
        </span>
        {/* A header-only row leaves moving to dragging and to the editor beside it, so the name has room. */}
        {!isBackground && !headerOnly && !tight && <IconButton icon="chevU" label="Move up (drawn earlier)" size="sm" disabled={!canUp} tooltip={false} onClick={() => onMove(-1)} />}
        {!isBackground && !headerOnly && !tight && <IconButton icon="chevD" label="Move down (drawn later, on top)" size="sm" disabled={!canDown} tooltip={false} onClick={() => onMove(1)} />}
        <span ref={moreRef} style={{ display: 'inline-flex' }}>
          <IconButton icon="more" label="More: duplicate, reset, delete" size="sm" tooltip={false} onClick={() => { const r = moreRef.current?.getBoundingClientRect(); setMenu(r ? { x: r.right - 220, y: r.bottom + 4 } : null); }} />
        </span>
        {menu && <Menu x={menu.x} y={menu.y} minWidth={220} onClose={() => setMenu(null)} items={isBackground ? backgroundMenuItems({ onReset, onRemove }) : [...moveItems, ...groupItems, 'separator', ...layerMenuItems({ onDuplicate, onReset, onRemove, onRule: () => startRule({ layerId: l.id }) })]} />}
      </div>
      {relMembers && (
        <button
          type="button"
          onClick={relMembers.onToggle}
          title={relMembers.collapsed ? 'Show its members' : 'Hide its members'}
          style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 0 0 20px', padding: '2px 0', border: 0, background: 'none', cursor: 'pointer', color: tk.text.faint, font: `11.5px ${fontFamily.ui}` }}
        >
          <Icon name={relMembers.collapsed ? 'chevR' : 'chevD'} size={12} />
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: relMembers.colour, flexShrink: 0 }} />
          <span>{relMembers.count} member{relMembers.count === 1 ? '' : 's'}</span>
        </button>
      )}
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
      {displaceUsers(play.layers, l.id).length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '2px 0 0 20px', color: tk.text.faint, font: `11.5px ${fontFamily.ui}`, minWidth: 0 }}>
          <Icon name="curve" size={13} style={{ color: tk.accent.base }} />
          <span style={{ whiteSpace: 'nowrap' }}>Displaces</span>
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displaceUsers(play.layers, l.id).map((u, k) => (
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
      {shows && (
        <>
          <MatteMaskBar f={f} play={play} changePlay={onChangePlay} drawing={maskDrawing} onSelect={onSelect} />
          {/* The editor's Sections as tabs (or stacked, with Show all): docs/editor-layout.md. */}
          <BigEditorScaffold scope={`layer:${l.id}`} compact={!big}>
            {body}
            {!isBackground && (
              <Section kind={l.kind} title="Accepts and emits" hint={l.kind === 'audio'
                ? 'What drives it, and what it gives out: how loud each part of the sound is right now (Map… sends one to a control: bass to size, treble to sparkle), and the signals it can send.'
                : 'What drives it (its numbers, its buttons) and what it gives out: what it measures right now (Map… sends it to a control, Signal watches it), the signals it can send, its position.'}>
                <LayerPortsView layer={l} />
              </Section>
            )}
          </BigEditorScaffold>
          {l.kind !== 'null' && l.kind !== 'drumpad' && !isBackground && f.toggle('Shader', 'toShader', 'Seen by the Layers node', 'Include this layer in what the graph\'s Layers node reads (its colour, alpha and distance), so shader effects like SDF Glow can use it.')}
        </>
      )}
    </div>
  );
}

