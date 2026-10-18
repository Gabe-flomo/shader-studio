// @vitest-environment jsdom
/**
 * Builder sections and presets (docs/scene-builder.md, "Folding sections" and "Your presets"):
 *  - a folding section shows its summary while folded, starts open only when it is the primary one,
 *    and is remembered per section, across remounts and in local storage;
 *  - every builder keeps its own presets: saved with a picture, loaded back as exactly the same
 *    spec, renamed, deleted, and never seen by another builder;
 *  - the strip's save form and cards (UserPresets), and the built-ins each strip keeps.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MAX_REMEMBERED_SECTIONS, SECTION_FOLD_KEY, sectionOpen, useSectionFold } from '../sectionFold';
import {
  MAX_USER_PRESETS, PRESET_BUILDER_KINDS, builderPresets, presetStorageKey, presetTextToSpec, specToPresetText, type PresetBuilderKind,
} from '../userPresets';
import { USER_PRESETS_KEY, useUserScenePresets } from '../../sceneBuilder/userPresets';
import { Card } from '../../components/sceneBuilder/controls';
import { BuilderFold } from '../../components/builders/BuilderTabBar';
import { UserPresets } from '../../components/builders/UserPresets';
import { STRIP_TEMPLATE_KEYS } from '../../components/sceneBuilder/SceneBuilderModal';
import { blankPixels, captureViewportThumb } from '../../components/builders/viewportThumb';
import { useSceneBuilder2D } from '../../sceneBuilder2d/store';
import { surpriseScene2D } from '../../sceneBuilder2d/surprise';
import { useGridBuilder } from '../../gridScene/store';
import { surpriseGridScene } from '../../gridScene/surprise';
import { GRID_TEMPLATES } from '../../gridScene/templates';
import { useWarpBuilder } from '../../warpBuilder/store';
import { surpriseWarp } from '../../warpBuilder/spec';
import { useSplatBuilder } from '../../splatBuilder/store';
import { surpriseSplatScene } from '../../splatBuilder/surprise';
import { normalizeSpec } from '../../splatBuilder/spec';
import { SPLAT_TEMPLATES } from '../../splatBuilder/templates';
import { useTimeCubeBuilder } from '../../timeCubeBuilder/store';
import { blankSpec } from '../../timeCubeBuilder/spec';
import { surpriseTimeCube } from '../../timeCubeBuilder/surprise';
import { TC_PRESETS } from '../../timeCubeBuilder/presets';
import { GRID_DEFAULTS } from '../../gridRules/spec';
import { gridRulesPresetOf } from '../../components/gridRules/GridRulesEditor';
import { parseRecipe, printRecipe } from '../../sceneBuilder/recipe';
import { SCENE_TEMPLATES } from '../../sceneBuilder/templates';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = (el: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
};
const unmount = () => { act(() => root?.unmount()); host?.remove(); root = null; host = null; };
const $ = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const click = (el: Element | null) => act(() => { (el as HTMLElement).click(); });
const type = (el: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
  localStorage.clear();
  useSectionFold.setState({ open: {} });
  for (const k of PRESET_BUILDER_KINDS) builderPresets(k).setState({ presets: [] });
});
afterEach(unmount);

describe('folding sections', () => {
  it('a folded section shows its summary, not its settings; the primary one starts open', () => {
    mount(<div>
      <Card id="t:primary" title="Palette" summary="sunset" defaultOpen><span data-body="primary" /></Card>
      <Card id="t:other" title="Glow" summary="density 0.6"><span data-body="other" /></Card>
    </div>);
    expect($('[data-body="primary"]')).toBeTruthy();
    expect($('[data-sb-card="t:primary"] [data-card-summary]')!.textContent).toBe('');
    expect($('[data-body="other"]')).toBeNull();
    expect($('[data-sb-card="t:other"] [data-card-summary]')!.textContent).toBe('density 0.6');
  });

  it('opening or folding is remembered per section: across remounts and in local storage', () => {
    mount(<div>
      <Card id="t:a" title="A" summary="a"><span data-body="a" /></Card>
      <Card id="t:b" title="B" summary="b" defaultOpen><span data-body="b" /></Card>
    </div>);
    click($('[data-sb-card="t:a"] [aria-expanded]'));
    click($('[data-sb-card="t:b"] [aria-expanded]'));
    expect($('[data-body="a"]')).toBeTruthy();
    expect($('[data-body="b"]')).toBeNull();
    unmount();
    mount(<div>
      <Card id="t:a" title="A" summary="a"><span data-body="a" /></Card>
      <Card id="t:b" title="B" summary="b" defaultOpen><span data-body="b" /></Card>
      <Card id="t:c" title="C" summary="c"><span data-body="c" /></Card>
    </div>);
    expect($('[data-body="a"]')).toBeTruthy();
    expect($('[data-body="b"]')).toBeNull();
    expect($('[data-body="c"]')).toBeNull(); // another section keeps its own default
    expect(JSON.parse(localStorage.getItem(SECTION_FOLD_KEY)!)).toEqual({ 't:a': true, 't:b': false });
  });

  it('the small folds share the same memory, folded by default', () => {
    mount(<BuilderFold foldKey="t:fold" title="Ageing" summary="ageing 0.1"><span data-body="fold" /></BuilderFold>);
    expect($('[data-fold="t:fold"]')!.textContent).toContain('ageing 0.1');
    expect($('[data-body="fold"]')).toBeNull();
    click($('[data-fold="t:fold"] button'));
    expect($('[data-body="fold"]')).toBeTruthy();
    expect(sectionOpen('t:fold')).toBe(true);
  });

  it('keeps at most MAX_REMEMBERED_SECTIONS choices, dropping the oldest', () => {
    const set = useSectionFold.getState().setOpen;
    for (let i = 0; i < MAX_REMEMBERED_SECTIONS + 5; i++) set(`s${i}`, true);
    const open = useSectionFold.getState().open;
    expect(Object.keys(open)).toHaveLength(MAX_REMEMBERED_SECTIONS);
    expect(open.s0).toBeUndefined();
    expect(open[`s${MAX_REMEMBERED_SECTIONS + 4}`]).toBe(true);
  });
});

/** Each builder: a rich scene to save, and how it loads back into the builder's store. */
const BUILDERS: Array<{ kind: PresetBuilderKind; make: () => unknown; load: (text: string) => unknown }> = [
  { kind: '2d', make: () => surpriseScene2D(7), load: t => { useSceneBuilder2D.getState().replace(presetTextToSpec(t)!); return useSceneBuilder2D.getState().scene; } },
  { kind: 'grid', make: () => surpriseGridScene(7), load: t => { useGridBuilder.getState().replace(presetTextToSpec(t)!); return useGridBuilder.getState().spec; } },
  { kind: 'warp', make: () => surpriseWarp(7), load: t => { useWarpBuilder.getState().replace(presetTextToSpec(t)!); return useWarpBuilder.getState().spec; } },
  { kind: 'splat', make: () => surpriseSplatScene(7), load: t => { useSplatBuilder.getState().replace(normalizeSpec(presetTextToSpec(t)!)); return useSplatBuilder.getState().spec; } },
  { kind: 'timecube', make: () => surpriseTimeCube(7, blankSpec()), load: t => { useTimeCubeBuilder.getState().replace(presetTextToSpec(t)!); return useTimeCubeBuilder.getState().spec; } },
  { kind: 'gridRules', make: () => gridRulesPresetOf({ ...GRID_DEFAULTS, bornMask: 8, surviveMask: 12, afterglow: 0.4 }), load: t => presetTextToSpec(t) },
];

describe('your presets, per builder', () => {
  for (const b of BUILDERS) {
    it(`${b.kind}: saved with its picture, loaded back exactly, renamed and deleted`, () => {
      const spec = b.make();
      const store = builderPresets(b.kind);
      const { preset, stored } = store.getState().add('  Mine  ', specToPresetText(spec), 'data:image/jpeg;base64,abc');
      expect(stored).toBe(true);
      expect(preset.name).toBe('Mine');
      expect(JSON.parse(localStorage.getItem(presetStorageKey(b.kind))!)[0]).toMatchObject({ name: 'Mine', thumb: 'data:image/jpeg;base64,abc' });
      // Loads as exactly the scene saved, and editing the loaded scene never touches the preset.
      const loaded = b.load(store.getState().presets[0].recipe);
      expect(loaded).toEqual(spec);
      expect(loaded).not.toBe(spec);
      store.getState().rename(preset.id, 'Renamed');
      expect(store.getState().presets[0].name).toBe('Renamed');
      store.getState().rename(preset.id, '   ');
      expect(store.getState().presets[0].name).toBe('Renamed');
      store.getState().remove(preset.id);
      expect(store.getState().presets).toEqual([]);
      expect(JSON.parse(localStorage.getItem(presetStorageKey(b.kind))!)).toEqual([]);
    });
  }

  it('each builder sees only its own presets, in its own storage', () => {
    builderPresets('2d').getState().add('Two', '{}', null);
    builderPresets('grid').getState().add('Grid', '{}', null);
    expect(builderPresets('2d').getState().presets.map(p => p.name)).toEqual(['Two']);
    expect(builderPresets('grid').getState().presets.map(p => p.name)).toEqual(['Grid']);
    for (const k of ['3d', 'warp', 'gridRules', 'splat', 'timecube'] as const) expect(builderPresets(k).getState().presets).toEqual([]);
    expect(new Set(PRESET_BUILDER_KINDS.map(presetStorageKey)).size).toBe(PRESET_BUILDER_KINDS.length);
  });

  it('the 3D builder keeps its key and its store: presets saved before still show', () => {
    expect(USER_PRESETS_KEY).toBe('playfield:scene-builder-presets');
    expect(useUserScenePresets).toBe(builderPresets('3d'));
    const spec = parseRecipe(SCENE_TEMPLATES.find(t => t.key === 'orb')!.recipe).spec;
    useUserScenePresets.getState().add('Orb', printRecipe(spec), null);
    expect(JSON.parse(localStorage.getItem('playfield:scene-builder-presets')!)[0].name).toBe('Orb');
  });

  it('at most MAX_USER_PRESETS per builder, the oldest first to go', () => {
    const s = builderPresets('warp');
    for (let i = 0; i < MAX_USER_PRESETS + 2; i++) s.getState().add(`w${i}`, '{}', null);
    expect(s.getState().presets).toHaveLength(MAX_USER_PRESETS);
    expect(s.getState().presets[0].name).toBe('w2');
  });

  it('a Grid Rules preset keeps the rule, not the node label or runtime state', () => {
    const kept = gridRulesPresetOf({ ...GRID_DEFAULTS, label: 'My grid', bornMask: 8 });
    expect(kept.bornMask).toBe(8);
    expect('label' in kept).toBe(false);
  });

  it('the built-ins each strip keeps: four in the 3D builder, none in the Warp builder, the rest as before', () => {
    expect(STRIP_TEMPLATE_KEYS).toEqual(['room', 'orb', 'blobs', 'glass']);
    expect(GRID_TEMPLATES.length).toBeGreaterThan(0);
    expect(SPLAT_TEMPLATES.length).toBeGreaterThan(0);
    expect(TC_PRESETS.length).toBeGreaterThan(0);
  });
});

describe('the strip: + Save this scene, load, rename, delete', () => {
  it('saves with a name and a picture (the builder\'s own when the viewport has none), and loads only here', () => {
    const loads: string[] = [];
    mount(<div>
      <UserPresets kind="2d" getRecipe={() => '{"scene":1}'} onLoad={t => loads.push(t)} fallbackThumb={() => 'data:image/jpeg;base64,pic'} />
      <div data-other><UserPresets kind="grid" getRecipe={() => '{}'} onLoad={() => {}} /></div>
    </div>);
    click($('[data-user-presets="2d"] [data-save-preset]'));
    type($('[data-save-preset-form="2d"] input') as HTMLInputElement, 'Sunset rings');
    act(() => { ($('[data-save-preset-form="2d"]') as HTMLFormElement).requestSubmit(); });
    const [p] = builderPresets('2d').getState().presets;
    expect(p).toMatchObject({ name: 'Sunset rings', recipe: '{"scene":1}', thumb: 'data:image/jpeg;base64,pic' });
    // Its card: the picture, the name; a click loads it.
    expect(($(`[data-user-preset="${p.id}"] img`) as HTMLImageElement).src).toBe('data:image/jpeg;base64,pic');
    click($(`[data-user-preset="${p.id}"] [data-preset]`));
    expect(loads).toEqual(['{"scene":1}']);
    // The Grid builder's strip doesn't show it.
    expect(document.querySelectorAll('[data-other] [data-user-preset]').length).toBe(0);
    // Rename, then delete.
    click($(`[data-rename-preset="${p.id}"]`));
    type($(`[data-rename-preset-form="${p.id}"] input`) as HTMLInputElement, 'Dusk');
    act(() => { ($(`[data-rename-preset-form="${p.id}"]`) as HTMLFormElement).requestSubmit(); });
    expect(builderPresets('2d').getState().presets[0].name).toBe('Dusk');
    click($(`[data-delete-preset="${p.id}"]`));
    expect(builderPresets('2d').getState().presets).toEqual([]);
  });

  it('a named preview canvas that is folded away gives way to the builder\'s own picture, not another canvas', () => {
    const other = document.createElement('canvas');
    other.width = 400; other.height = 300;
    document.body.appendChild(other);
    try {
      expect(captureViewportThumb(document.body, () => 'data:own', '[data-scene2d-preview]')).toBe('data:own');
    } finally { other.remove(); }
  });

  it('a blank name gets one', () => {
    mount(<UserPresets kind="warp" noun="warp" getRecipe={() => '{}'} onLoad={() => {}} />);
    click($('[data-save-preset]'));
    act(() => { ($('[data-save-preset-form]') as HTMLFormElement).requestSubmit(); });
    expect(builderPresets('warp').getState().presets[0].name).toBe('My warp 1');
  });

  it('an empty picture (one colour, or see-through) is not kept as the thumbnail', () => {
    expect(blankPixels(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 0]))).toBe(true);
    expect(blankPixels(new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255]))).toBe(true);
    expect(blankPixels(new Uint8ClampedArray([10, 20, 30, 255, 200, 20, 30, 255]))).toBe(false);
  });
});
