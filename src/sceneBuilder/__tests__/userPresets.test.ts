/** Your own 3D Scene Builder presets (sceneBuilder/userPresets.ts): saved, kept, renamed, deleted, and loadable. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mem = new Map<string, string>();
vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (globalThis as unknown as { __mem: Map<string, string> }).__mem?.get(k) ?? null,
    setItem: (k: string, v: string) => { (globalThis as unknown as { __mem: Map<string, string> }).__mem?.set(k, v); },
    removeItem: () => {}, key: () => null, length: 0, clear: () => {},
  };
});
(globalThis as unknown as { __mem: Map<string, string> }).__mem = mem;

import { MAX_USER_PRESETS, USER_PRESETS_KEY, useUserScenePresets } from '../userPresets';
import { parseRecipe, printRecipe } from '../recipe';
import { SCENE_TEMPLATES } from '../templates';
import { STRIP_TEMPLATE_KEYS } from '../../components/sceneBuilder/SceneBuilderModal';

beforeEach(() => { mem.clear(); useUserScenePresets.setState({ presets: [] }); });

describe('your scene presets', () => {
  it('saves a scene as a recipe with its picture, and keeps it in local storage', () => {
    const spec = parseRecipe(SCENE_TEMPLATES.find(t => t.key === 'orb')!.recipe).spec;
    const { preset, stored } = useUserScenePresets.getState().add('  Blue orb  ', printRecipe(spec), 'data:image/jpeg;base64,xx');
    expect(stored).toBe(true);
    expect(preset.name).toBe('Blue orb');
    expect(JSON.parse(mem.get(USER_PRESETS_KEY)!)[0]).toMatchObject({ name: 'Blue orb', thumb: 'data:image/jpeg;base64,xx' });
    // It loads back as the same scene.
    expect(printRecipe(parseRecipe(preset.recipe).spec)).toBe(printRecipe(spec));
  });

  it('renames and deletes', () => {
    const s = useUserScenePresets.getState();
    const { preset } = s.add('One', 'sphere', null);
    useUserScenePresets.getState().rename(preset.id, 'Uno');
    expect(useUserScenePresets.getState().presets[0].name).toBe('Uno');
    useUserScenePresets.getState().remove(preset.id);
    expect(useUserScenePresets.getState().presets).toEqual([]);
    expect(JSON.parse(mem.get(USER_PRESETS_KEY)!)).toEqual([]);
  });

  it('a blank name gets one; at most MAX_USER_PRESETS are kept, the oldest go first', () => {
    for (let i = 0; i < MAX_USER_PRESETS + 3; i++) useUserScenePresets.getState().add(i === 0 ? '   ' : `p${i}`, 'sphere', null);
    const list = useUserScenePresets.getState().presets;
    expect(list).toHaveLength(MAX_USER_PRESETS);
    expect(list[0].name).toBe('p3');
  });

  it('the strip keeps four built-ins: the GI-lit room, the volumetric orb and two more', () => {
    expect(STRIP_TEMPLATE_KEYS).toEqual(['room', 'orb', 'blobs', 'glass']);
    for (const k of STRIP_TEMPLATE_KEYS) expect(SCENE_TEMPLATES.some(t => t.key === k)).toBe(true);
  });
});
