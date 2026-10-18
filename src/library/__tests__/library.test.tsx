// @vitest-environment jsdom
/**
 * The Library and the one preset store (docs/library.md, docs/presets.md "One preset store"):
 *  - the Library lists every type from the stores they already live in (fixtures written the way
 *    each old panel wrote them);
 *  - renames, deletes and undo through the facade write to the right store, and nothing else;
 *  - an export imports back unchanged (round trip), never overwriting what is there;
 *  - every preset kind's adapter reads old data as it is, and a write keeps the record's own fields;
 *  - <PresetMenu> saves, renames and deletes; the Library's filters show only types with items;
 *  - listing and showing never write anything (no data loss for existing keys).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '../../presets/presetKinds';
import '../appLibrary';
import {
  deleteItem, exportItems, exportText, graphNames, importText, listEverything, listLibrary, onlyLibraryThings, renameGraph, renameItem, withUndo,
  type LibraryItem,
} from '../libraryFacade';
import { builtInPresets, listPresets, presetKinds, removePreset, renamePreset, savePreset } from '../../presets/presetStore';
import { builderPresets, PRESET_BUILDER_KINDS } from '../../builders/userPresets';
import { getMembership, moveItemsToFolder, createFolder } from '../../utils/assetFolders';
import { defaultLayer } from '../../types/playLayers';
import { PresetMenu } from '../../components/presets/PresetMenu';
import { Library } from '../../components/library/Library';
import { GraphsList } from '../../components/library/GraphsList';
import { LIBRARY_CATEGORIES, listAddable, mediaItems } from '../libraryCategories';
import { mediaNodeFor, placeMedia } from '../mediaPlacement';
import { useNodeGraphStore } from '../../store/useNodeGraphStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ── Fixtures: each type stored the way its old panel stored it ───────────────

const graph = (name: string, savedAt = 1000) => JSON.stringify({ nodes: [{ id: 'n1', type: 'uv', position: { x: 0, y: 0 }, inputs: {}, outputs: {}, params: {} }], version: 2, savedAt, name });
const FIXTURES: Record<string, string> = {
  'shader-studio:Sunset': graph('Sunset'),
  'shader-studio-versions:Sunset': JSON.stringify([{ version: 1, payload: graph('Sunset', 500), savedAt: 500 }]),
  'shader-studio:Rings': graph('Rings', 2000),
  'shader-studio:gp:gp_1': JSON.stringify({ id: 'gp_1', label: 'Glow group', description: 'Soft glow', subgraph: { nodes: [], inputPorts: [], outputPorts: [] }, savedAt: 10 }),
  'shader-studio:tp:tp_1': JSON.stringify({ id: 'tp_1', label: 'Swirl', outputType: 'vec2', exprX: 'x*cos(t)', exprY: 'y', exprZ: 'z', exprW: 'w', savedAt: 11, extraField: 'kept' }),
  'shader-studio:cfp:cfp_1': JSON.stringify({ id: 'cfp_1', label: 'Wave', inputs: [{ name: 'x', type: 'float' }], outputType: 'float', body: 'sin(x)', glslFunctions: '', savedAt: 12 }),
  'shader-studio:ep:ep_1': JSON.stringify({ id: 'ep_1', label: 'Ripple', inputs: [], outputType: 'float', lines: [], result: '0.0', savedAt: 13 }),
  'shader-studio:kfp:kfp_1': JSON.stringify({ id: 'kfp_1', label: 'Ease in', keyframes: [{ t: 0, v: 0, ease: { type: 'linear' } }], savedAt: 14 }),
  'shader-studio:un:un_1': JSON.stringify({ id: 'un_1', label: 'My blur', category: 'My Nodes', fnName: 'my_blur', functionCode: 'vec3 my_blur(vec3 c){return c;}', helperFunctions: [], implicitGlobals: [], inputs: [], outputs: [{ key: 'out', label: 'Out', type: 'vec3' }], params: [], savedAt: 15 }),
  'shader-studio:glsl-shaders': JSON.stringify([{ id: 'sh_1', name: 'Plasma', code: 'void main(){}', group: 'Tests', note: 'warm' }, { id: 'sh_2', name: 'Noise', code: 'void main(){}' }]),
  'playfield:scene-builder-presets': JSON.stringify([{ id: 'up_1', name: 'Glass room', recipe: 'room', thumb: null, createdAt: 16 }]),
  'playfield:builder-presets:2d': JSON.stringify([{ id: 'up_2', name: 'Rings 2D', recipe: '{}', thumb: 'data:image/jpeg;base64,x', createdAt: 17 }]),
  'shader-studio:layer-sets': JSON.stringify([{ id: 'lset_1', name: 'Ring set', savedAt: 18, note: 'two rings', play: { layers: [defaultLayer('shape', 'A', 'Ring')] }, media: [], excluded: [] }]),
  'shader-studio:drum-kits': JSON.stringify([{ id: 'kit_1', name: 'Dusty', savedAt: 19, pads: [] }]),
  'shader-studio:finish-effects': JSON.stringify([{ id: 'fx_1', name: 'Tint', savedAt: 20, code: 'vec3 effect(vec3 c){return c;}' }]),
  'shader-studio:finish-looks': JSON.stringify([{ id: 'look_1', name: 'Warm', values: { warmth: 0.2 }, tone: 'none', savedAt: 21 }]),
  'shader-studio:palette-presets': JSON.stringify([{ id: 'pp_1', name: 'Sea', kind: 'cosine', cosine: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.1, 0.2] }, savedAt: 22 }]),
  'shader-studio-backgrounds:palettes': JSON.stringify([{ id: 'pal_1', name: 'Dusk', stops: [{ pos: 0, color: [0, 0, 0] }, { pos: 1, color: [1, 1, 1] }], style: 'gradient', createdAt: 23 }]),
};

function seed(extra: Record<string, string> = {}): void {
  for (const [k, v] of Object.entries({ ...FIXTURES, ...extra })) localStorage.setItem(k, v);
  for (const k of PRESET_BUILDER_KINDS) builderPresets(k).getState().reload();
  useNodeGraphStore.setState({ groupPresets: [] });
}
const snapshot = () => Object.fromEntries(Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!).map(k => [k, localStorage.getItem(k)]));
const find = (items: LibraryItem[], name: string) => items.find(i => i.name === name)!;

beforeEach(() => { localStorage.clear(); for (const k of PRESET_BUILDER_KINDS) builderPresets(k).setState({ presets: [] }); });

// ── Listing ───────────────────────────────────────────────────────────────────

describe('the Library lists every type from the stores they live in', () => {
  it('graphs, presets, functions, Expression Blocks, keyframes, my nodes and shaders', () => {
    seed();
    const all = listEverything();
    expect(all.graphs.map(g => g.name).sort()).toEqual(['Rings', 'Sunset']);
    expect(all.functions.map(f => f.name)).toEqual(['Wave']);
    expect(all.expressions.map(f => f.name)).toEqual(['Ripple']);
    expect(all.keyframes.map(f => f.name)).toEqual(['Ease in']);
    expect(all.nodes.map(f => f.name)).toEqual(['My blur']);
    expect(all.shaders.map(f => [f.name, f.group ?? ''])).toEqual([['Plasma', 'Tests'], ['Noise', '']]);
    // Presets: one of each kind, by its kind, not the three with their own filters.
    const kinds = Object.fromEntries(all.presets.map(p => [p.kind, p.name]));
    expect(kinds).toEqual({
      group: 'Glow group', transform: 'Swirl', 'builder:3d': 'Glass room', 'builder:2d': 'Rings 2D', layerSet: 'Ring set', drumKit: 'Dusty',
      finishEffect: 'Tint', finishLook: 'Warm', palette: 'Sea', bgPalette: 'Dusk',
    });
    // Each item says where its folders are: the scopes the old lists used.
    expect(find(all.graphs, 'Sunset').folderScope).toBe('graphs');
    expect(find(all.functions, 'Wave').folderScope).toBe('functions');
    expect(find(all.presets, 'Glow group').folderScope).toBe('presets:group');
    expect(find(all.presets, 'Swirl').folderScope).toBe('presets:transform');
    expect(find(all.nodes, 'My blur').folderScope).toBe('presets:usernodes');
    expect(find(all.presets, 'Rings 2D').thumb).toBe('data:image/jpeg;base64,x');
    expect(find(all.presets, 'Ring set').hint).toBe('two rings');
  });

  it('skips what isn’t one of them (settings, corrupt records) and never writes while listing', () => {
    seed({ 'shader-studio:settings:theme': JSON.stringify({ nodes: [] }), 'shader-studio:tp:bad': '{not json', 'shader-studio:drum-kits': JSON.stringify([{ id: 'k', name: 'No pads' }]) });
    const before = snapshot();
    const all = listEverything();
    expect(graphNames()).not.toContain('settings:theme');
    expect(all.presets.filter(p => p.kind === 'transform').map(p => p.name)).toEqual(['Swirl']);
    expect(all.presets.some(p => p.kind === 'drumKit')).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  it('every builder, Play, Finish and colour kind is registered over the key it always had', () => {
    const keys = Object.fromEntries(presetKinds().map(k => [k.id, k.storage.t === 'list' ? k.storage.key : k.storage.prefix]));
    expect(keys).toMatchObject({
      group: 'shader-studio:gp:', transform: 'shader-studio:tp:', customFn: 'shader-studio:cfp:', expr: 'shader-studio:ep:', keyframe: 'shader-studio:kfp:',
      'builder:3d': 'playfield:scene-builder-presets', 'builder:agents': 'playfield:builder-presets:agents',
      layerSet: 'shader-studio:layer-sets', rackPreset: 'shader-studio:rack-presets', drumKit: 'shader-studio:drum-kits',
      finishStack: 'shader-studio:finish-presets', finishEffect: 'shader-studio:finish-effects', finishLook: 'shader-studio:finish-looks',
      palette: 'shader-studio:palette-presets', bgPalette: 'shader-studio-backgrounds:palettes', spaceBlock: 'shader-studio:space-blocks',
    });
    // Built-ins come with their kinds.
    expect(builtInPresets('group').length).toBeGreaterThan(0);
    expect(builtInPresets('drumKit').length).toBeGreaterThan(0);
    // A builder's built-ins are its strip's own cards (builders/stripPresets.ts), not the kind's.
    expect(builtInPresets('builder:agents')).toEqual([]);
  });
});

// ── Writing ───────────────────────────────────────────────────────────────────

describe('renames and deletes through the facade write to the right store', () => {
  it('a preset rename changes only its name field, in its own key', () => {
    seed();
    const before = snapshot();
    expect(renameItem(find(listLibrary('presets'), 'Swirl'), 'Twirl').ok).toBe(true);
    const after = snapshot();
    const changed = Object.keys(after).filter(k => after[k] !== before[k]);
    expect(changed).toEqual(['shader-studio:tp:tp_1']);
    expect(JSON.parse(after['shader-studio:tp:tp_1']!)).toEqual({ ...JSON.parse(FIXTURES['shader-studio:tp:tp_1']), label: 'Twirl' });
  });

  it('list kinds keep every other record and field as stored', () => {
    seed({ 'shader-studio:finish-looks': JSON.stringify([{ id: 'look_1', name: 'Warm', values: { warmth: 0.2 }, tone: 'none', savedAt: 21, custom: 1 }, { id: 'look_2', name: 'Cold', values: {}, tone: 'aces', savedAt: 22 }]) });
    expect(renamePreset('finishLook', 'look_2', 'Ice').ok).toBe(true);
    expect(JSON.parse(localStorage.getItem('shader-studio:finish-looks')!)).toEqual([
      { id: 'look_1', name: 'Warm', values: { warmth: 0.2 }, tone: 'none', savedAt: 21, custom: 1 },
      { id: 'look_2', name: 'Ice', values: {}, tone: 'aces', savedAt: 22 },
    ]);
  });

  it('a builder preset goes through its builder’s store (memory and storage)', () => {
    seed();
    expect(renameItem(find(listLibrary('presets'), 'Glass room'), 'Crystal').ok).toBe(true);
    expect(builderPresets('3d').getState().presets[0].name).toBe('Crystal');
    expect(JSON.parse(localStorage.getItem('playfield:scene-builder-presets')!)[0].name).toBe('Crystal');
    const { result } = deleteItem(find(listLibrary('presets'), 'Crystal'));
    expect(result.ok).toBe(true);
    expect(builderPresets('3d').getState().presets).toEqual([]);
  });

  it('a graph rename carries its versions and its folder; the name must be free', () => {
    seed();
    const f = createFolder('graphs', 'Warm ones');
    moveItemsToFolder('graphs', ['Sunset'], f.id);
    expect(renameGraph('Sunset', 'Rings').ok).toBe(false);
    expect(renameGraph('Sunset', 'Dusk').ok).toBe(true);
    expect(localStorage.getItem('shader-studio:Sunset')).toBeNull();
    expect(localStorage.getItem('shader-studio:Dusk')).toBe(FIXTURES['shader-studio:Sunset']);
    expect(localStorage.getItem('shader-studio-versions:Dusk')).toBe(FIXTURES['shader-studio-versions:Sunset']);
    expect(localStorage.getItem('shader-studio-versions:Sunset')).toBeNull();
    expect(getMembership('graphs')).toEqual({ Dusk: f.id });
  });

  it('a delete can be undone exactly, for every type', () => {
    seed();
    const before = snapshot();
    const all = listEverything();
    for (const it of [find(all.graphs, 'Sunset'), find(all.functions, 'Wave'), find(all.expressions, 'Ripple'), find(all.keyframes, 'Ease in'), find(all.nodes, 'My blur'), find(all.shaders, 'Plasma'), find(all.presets, 'Ring set'), find(all.presets, 'Glow group'), find(all.presets, 'Dusk')]) {
      const { result, undo } = deleteItem(it);
      expect(result.ok, it.name).toBe(true);
      expect(listLibrary(it.type).some(x => x.id === it.id), it.name).toBe(false);
      undo();
      expect(listLibrary(it.type).some(x => x.id === it.id), it.name).toBe(true);
    }
    expect(snapshot()).toEqual(before);
  });

  it('withUndo puts back added, changed and removed keys', () => {
    localStorage.setItem('a', '1'); localStorage.setItem('b', '2');
    const { undo, keys } = withUndo(() => { localStorage.setItem('a', 'x'); localStorage.removeItem('b'); localStorage.setItem('c', '3'); return { ok: true }; });
    expect(keys.sort()).toEqual(['a', 'b', 'c']);
    undo();
    expect([localStorage.getItem('a'), localStorage.getItem('b'), localStorage.getItem('c')]).toEqual(['1', '2', null]);
  });
});

// ── Export and import ─────────────────────────────────────────────────────────

describe('export and import', () => {
  it('round trip: what was exported comes back exactly, into the stores it came from', () => {
    seed();
    const f = createFolder('functions', 'Waves');
    moveItemsToFolder('functions', ['cfp_1'], f.id);
    const all = listEverything();
    const picked = [find(all.graphs, 'Sunset'), find(all.functions, 'Wave'), find(all.nodes, 'My blur'), find(all.shaders, 'Plasma'), find(all.presets, 'Swirl'), find(all.presets, 'Ring set'), find(all.presets, 'Rings 2D')];
    const text = exportText(picked);
    expect(onlyLibraryThings(text)).toBe(true);
    const snap = exportItems(picked);
    // Only what was picked: the other shader and graph stay out.
    expect(JSON.parse(snap.items['shader-studio:glsl-shaders'])).toHaveLength(1);
    expect(snap.items['shader-studio:Rings']).toBeUndefined();
    expect(snap.items['shader-studio-versions:Sunset']).toBe(FIXTURES['shader-studio-versions:Sunset']);

    localStorage.clear();
    for (const k of PRESET_BUILDER_KINDS) builderPresets(k).getState().reload();
    const r = importText(text);
    expect(r.ok).toBe(true);
    for (const k of ['shader-studio:Sunset', 'shader-studio-versions:Sunset', 'shader-studio:cfp:cfp_1', 'shader-studio:un:un_1', 'shader-studio:tp:tp_1']) expect(localStorage.getItem(k), k).toBe(FIXTURES[k]);
    expect(JSON.parse(localStorage.getItem('shader-studio:glsl-shaders')!)).toEqual([JSON.parse(FIXTURES['shader-studio:glsl-shaders'])[0]]);
    expect(JSON.parse(localStorage.getItem('shader-studio:layer-sets')!)).toEqual(JSON.parse(FIXTURES['shader-studio:layer-sets']));
    // The builders' lists (outside the library's own keys) come back too, and their store sees it.
    expect(JSON.parse(localStorage.getItem('playfield:builder-presets:2d')!)).toEqual(JSON.parse(FIXTURES['playfield:builder-presets:2d']));
    expect(builderPresets('2d').getState().presets.map(p => p.name)).toEqual(['Rings 2D']);
    expect(getMembership('functions')).toEqual({ cfp_1: f.id });
  });

  it('importing never overwrites: a taken graph name comes in as “(imported)”, a preset you have is kept', () => {
    seed();
    const text = exportText([find(listLibrary('graphs'), 'Sunset'), find(listLibrary('presets'), 'Swirl')]);
    localStorage.setItem('shader-studio:Sunset', graph('Sunset', 9999));
    renamePreset('transform', 'tp_1', 'Mine');
    const r = importText(text);
    expect(r.ok && r.renamed).toEqual(['Sunset (imported)']);
    expect(JSON.parse(localStorage.getItem('shader-studio:Sunset')!).savedAt).toBe(9999);
    expect(JSON.parse(localStorage.getItem('shader-studio:tp:tp_1')!).label).toBe('Mine');
  });

  it('a library.json with settings in it isn’t taken as a Library export', () => {
    expect(onlyLibraryThings(JSON.stringify({ kind: 'shader-studio-library', version: 1, savedAt: 0, items: { 'shader-studio:theme': 'dark' } }))).toBe(false);
  });
});

// ── The preset store ─────────────────────────────────────────────────────────

describe('PresetStore', () => {
  it('saves a new preset where its kind always kept them, readable by the old code', async () => {
    const r = savePreset('keyframe', 'Bounce', { keyframes: [{ t: 0, v: 1, ease: { type: 'linear' } }] });
    expect(r.ok).toBe(true);
    const raw = JSON.parse(localStorage.getItem(`shader-studio:kfp:${r.id}`)!);
    expect(raw).toMatchObject({ id: r.id, label: 'Bounce', keyframes: [{ t: 0, v: 1 }] });
    const { loadKeyframePresets } = await import('../../store/useNodeGraphStore');
    expect(loadKeyframePresets().map(p => p.label)).toEqual(['Bounce']);
    const r2 = savePreset('finishLook', 'Night', { values: { warmth: -0.2 }, tone: 'aces' });
    const { loadSavedLooks } = await import('../../components/play/finish/savedLooks');
    expect(loadSavedLooks().map(l => [l.id, l.name])).toEqual([[r2.id, 'Night']]);
  });

  it('a delete removes the preset and its folder membership', () => {
    seed();
    const f = createFolder('presets:transform', 'Twists');
    moveItemsToFolder('presets:transform', ['tp_1'], f.id);
    expect(removePreset('transform', 'tp_1').ok).toBe(true);
    expect(localStorage.getItem('shader-studio:tp:tp_1')).toBeNull();
    expect(getMembership('presets:transform')).toEqual({});
    expect(listPresets('transform')).toEqual([]);
  });
});

// ── UI ───────────────────────────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
};
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; });
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => Array.from(document.querySelectorAll(sel)) as HTMLElement[];
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const submit = (sel: string) => act(() => { ($(sel) as HTMLFormElement).requestSubmit(); });

describe('<PresetMenu>', () => {
  it('saves, applies, renames and deletes a preset of its kind', () => {
    const applied: string[] = [];
    mount(<PresetMenu kind="transform" noun="transform" getData={() => ({ outputType: 'vec2', exprX: 'y', exprY: 'x', exprZ: 'z', exprW: 'w' })} onApply={p => applied.push(p.name)} />);
    click($('[data-preset-menu-button="transform"]'));
    click($('[data-preset-save]'));
    type($('[data-preset-save-form] input') as HTMLInputElement, 'Flip');
    submit('[data-preset-save-form]');
    const [p] = listPresets('transform');
    expect(p).toMatchObject({ name: 'Flip', record: { exprX: 'y', exprY: 'x', label: 'Flip' } });
    expect(JSON.parse(localStorage.getItem(`shader-studio:tp:${p.id}`)!).label).toBe('Flip');
    // Apply it.
    click($(`[data-preset-item="${p.id}"] button`));
    expect(applied).toEqual(['Flip']);
    // Rename and delete from the list.
    click($('[data-preset-menu-button="transform"]'));
    click($(`[data-preset-item="${p.id}"] [aria-label="Rename Flip"]`));
    type($(`[data-preset-rename-form="${p.id}"] input`) as HTMLInputElement, 'Swap');
    submit(`[data-preset-rename-form="${p.id}"]`);
    expect(listPresets('transform')[0].name).toBe('Swap');
    click($(`[data-preset-item="${p.id}"] [aria-label="Delete Swap"]`));
    expect(listPresets('transform')).toEqual([]);
  });

  it('lists the kind’s built-ins before yours', () => {
    mount(<PresetMenu kind="drumKit" onApply={() => {}} />);
    click($('[data-preset-menu-button="drumKit"]'));
    expect($$('[data-preset-builtin]').length).toBe(builtInPresets('drumKit').length);
  });
});

describe('what the Library lists (library/libraryCategories.ts)', () => {
  it('only what goes on the graph: no graphs, shaders, builder presets, Play, Finish or keyframe presets', () => {
    seed({ 'shader-studio:kfp:kfp_1': FIXTURES['shader-studio:kfp:kfp_1'] });
    const all = listAddable();
    const names = Object.values(all).flat().map(i => i.name);
    expect(names).toEqual(expect.arrayContaining(['Glow group', 'Swirl', 'Wave', 'Ripple', 'My blur', 'Sea']));
    for (const gone of ['Sunset', 'Rings', 'Plasma', 'Noise', 'Glass room', 'Rings 2D', 'Ring set', 'Dusty', 'Tint', 'Warm', 'Dusk', 'Ease in']) expect(names).not.toContain(gone);
    expect(all.groups.map(i => i.name)).toEqual(['Glow group']);
    expect(all.builtInGroups.length).toBe(builtInPresets('group').length);
  });

  it('group presets come first, then the rest of the presets, then media', () => {
    expect(LIBRARY_CATEGORIES.map(c => c.id)).toEqual(['groups', 'builtInGroups', 'nodes', 'functions', 'expressions', 'transforms', 'palettes', 'images', 'videos', 'sounds']);
    expect(LIBRARY_CATEGORIES.filter(c => c.section === 'Media').map(c => c.id)).toEqual(['images', 'videos', 'sounds']);
  });

  it('media: pictures, videos and sounds apart; splats are not media', () => {
    const m = mediaItems(
      [{ id: 'img1', name: 'Beach', width: 10, height: 10, type: 'image/png', bytes: 1, createdAt: 1, thumb: 'data:x' }],
      [{ id: 'v1', name: 'Clip', type: 'video/mp4', bytes: 1, createdAt: 1 }, { id: 's1', name: 'Kick', type: 'audio/wav', bytes: 1, createdAt: 1 }, { id: 'sp1', name: 'Scan', type: 'model/x-splat', bytes: 1, createdAt: 1 }],
    );
    expect(m.images.map(i => [i.id, i.media])).toEqual([['img1', 'image']]);
    expect(m.videos.map(i => [i.id, i.media])).toEqual([['v1', 'video']]);
    expect(m.sounds.map(i => [i.id, i.media])).toEqual([['s1', 'sound']]);
  });

  it('a media drop makes the node that plays it: picture → Texture, video → Texture (video), sound → Audio Source with the file, paused', () => {
    expect(mediaNodeFor({ kind: 'image', id: 'img1', name: 'Beach' })).toEqual({ type: 'textureInput', params: { libraryId: 'img1', _imageName: 'Beach' } });
    expect(mediaNodeFor({ kind: 'video', id: 'v1', name: 'Clip' })).toMatchObject({ type: 'videoInput', params: { videoId: 'v1' } });
    expect(mediaNodeFor({ kind: 'sound', id: 's1', name: 'Kick' })).toEqual({ type: 'audioSource', params: { source: 'file', sampleId: 's1', _fileName: 'Kick', playing: false } });
  });

  it('placing a picture adds a Texture node at the drop point and wires it into an empty Output', () => {
    useNodeGraphStore.setState({ activeGroupPath: [], nodes: [{ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' }, alpha: { type: 'float', label: 'Alpha' } }, outputs: {}, params: {} }] as never });
    const id = placeMedia({ kind: 'image', id: 'img1', name: 'Beach' }, { x: 120, y: 80 })!;
    const after = useNodeGraphStore.getState().nodes;
    const tex = after.find(n => n.id === id)!;
    expect(tex).toMatchObject({ type: 'textureInput', position: { x: 120, y: 80 }, params: expect.objectContaining({ libraryId: 'img1' }) });
    expect(after.find(n => n.type === 'output')!.inputs.color.connection).toEqual({ nodeId: id, outputKey: 'color' });
    // A sound is not wired (it has no picture) and starts paused.
    const snd = placeMedia({ kind: 'sound', id: 's1', name: 'Kick' }, { x: 0, y: 300 })!;
    expect(useNodeGraphStore.getState().nodes.find(n => n.id === snd)).toMatchObject({ type: 'audioSource', params: expect.objectContaining({ sampleId: 's1', playing: false }) });
  });
});

describe('<Library>', () => {
  it('looks like the Nodes list: sections, category rows with counts, group presets first; a category opens into pills', () => {
    seed();
    mount(<Library size="full" />);
    expect($$('[data-library-section]').map(s => s.dataset.librarySection)).toEqual(['Presets']);
    const rows = $$('[data-library-category-row]').map(r => r.dataset.libraryCategoryRow);
    expect(rows[0]).toBe('groups');
    expect(rows).toEqual(['groups', 'builtInGroups', 'nodes', 'functions', 'expressions', 'transforms', 'palettes']);
    expect($('[data-library-category-row="groups"]')!.textContent).toContain('1');
    // Nothing that isn't for the graph.
    const text = $('[data-library]')!.textContent!;
    for (const gone of ['Graphs', 'Shaders', 'Ring set', 'Glass room', 'Keyframe']) expect(text).not.toContain(gone);
    click($('[data-library-category-row="groups"]'));
    expect($('[data-library-open="groups"]')).toBeTruthy();
    expect($$('[data-library-item]').map(p => p.textContent)).toEqual(['Glow group']);
    click($('[data-library-item="gp_1"]'));
    expect($('[data-library-preview="gp_1"]')!.textContent).toContain('Add to graph');
    click($('[aria-label="Back to categories"]'));
    expect($('[data-library-category-row="groups"]')).toBeTruthy();
  });

  it('search shows matching pills under their category', () => {
    seed();
    mount(<Library size="rail" />);
    type($('[aria-label="Search the Library"]') as HTMLInputElement, 'wave');
    const hits = $$('[data-library-item]');
    expect(hits.find(p => p.textContent === 'Wave')?.dataset.libraryCategory).toBe('functions');
    // Each hit under its category's heading, and nothing else saved (Sunset, Plasma) shows.
    expect($$('[data-library-section]').map(s => s.dataset.librarySection)).toContain('functions');
    expect($('[data-library]')!.textContent).not.toContain('Sunset');
  });

  it('shows one short line when nothing of yours is saved (the built-in groups are still there)', () => {
    mount(<Library size="rail" />);
    expect($('[data-library]')!.textContent).toContain('Nothing of yours here yet');
    expect($$('[data-library-category-row]').map(r => r.dataset.libraryCategoryRow)).toEqual(['builtInGroups']);
  });

  it('showing the Library writes nothing', () => {
    seed();
    const before = snapshot();
    mount(<Library size="full" />);
    expect(snapshot()).toEqual(before);
  });
});

describe('Load (the top bar’s graphs list)', () => {
  it('lists saved graphs only', () => {
    seed();
    mount(<GraphsList />);
    const text = $('[data-graphs-list]')!.textContent!;
    expect(text).toContain('Sunset');
    expect(text).toContain('Rings');
    for (const gone of ['Glow group', 'Wave', 'Plasma', 'My blur', 'Ring set', 'Glass room', 'Sea']) expect(text).not.toContain(gone);
  });
});

describe('Storage is on the Files page only', () => {
  it('the Storage card (LibraryCard) is drawn by the Files home and nowhere else', () => {
    const files = import.meta.glob('../../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const users = Object.entries(files).filter(([path, src]) => !path.includes('__tests__') && /<LibraryCard\b/.test(src)).map(([path]) => path.replace(/^(\.\.\/)+/, 'src/'));
    expect(users).toEqual(['src/components/files/HomeView.tsx']);
    // And the Storage panel itself only inside it (no settings tab, no phone menu sheet).
    const panels = Object.entries(files).filter(([path, src]) => !path.includes('__tests__') && /<LibraryPanel\b/.test(src)).map(([path]) => path.replace(/^(\.\.\/)+/, 'src/'));
    expect(panels).toEqual(['src/components/shell/LibraryPanel.tsx']);
  });
});
