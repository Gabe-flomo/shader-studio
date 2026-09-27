/**
 * App settings on the Files page: readable names and categories for stored
 * preferences (unknown keys under Other), the App settings group in the
 * Settings section, what Reset all resets, and that a reset removes the key
 * with an exact undo while downloads still carry the settings.
 */
import { describe, it, expect } from 'vitest';
import { describeSetting, groupSettings, labelFromKey, resetAllKeys, settingLabel } from '../appSettings';
import { APP_SETTINGS_ID, buildInventory, countLeaves } from '../inventory';
import { expandRemoval, memoryKV, removeNodes } from '../mutate';
import { everythingSnapshot, selectionSnapshot } from '../profileZip';

const KV = () => memoryKV({
  'shader-studio:Sunset': JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }] }),
  'shader-studio:theme': 'dark',
  'shader-studio:shortcuts': JSON.stringify({ save: 'mod+s', open: 'mod+o' }),
  'shader-studio:settings:linkedOpen': 'always',
  'shader-studio:cameraDevice': 'cam-1',
  'shader-studio:play:split': '0.5',
  'shader-studio:finish-looks': JSON.stringify([{ id: 'l1', name: 'Warm' }]),
  'shader-studio:settings:somethingNew': '1',
  'codePanel_height': '240',
  'shader-studio:discover:learned-roles': JSON.stringify({ a: 'colour' }),
  'shader-studio:kaggle': JSON.stringify({ key: 'secret' }),
});

describe('labels and categories', () => {
  it('names known keys and puts them in a category', () => {
    expect(describeSetting('shader-studio:theme')).toMatchObject({ label: 'Theme', category: 'appearance' });
    expect(describeSetting('shader-studio:shortcuts')).toMatchObject({ label: 'Keyboard shortcuts', category: 'appearance' });
    expect(describeSetting('shader-studio:settings:linkedOpen')).toMatchObject({ label: 'Opening a linked presentation', category: 'present' });
    expect(describeSetting('shader-studio:cameraDevice')).toMatchObject({ label: 'Camera', category: 'devices' });
    expect(describeSetting('shader-studio:play:split')).toMatchObject({ label: 'Split view', category: 'play' });
    expect(describeSetting('shader-studio:finish-looks')).toMatchObject({ category: 'finish', data: true });
    expect(describeSetting('codePanel_height').category).toBe('studio');
  });
  it('families by prefix, and anything unknown under Other with a name from its key', () => {
    expect(describeSetting('shader-studio:play:someNewThing')).toMatchObject({ label: 'Some new thing', category: 'play' });
    expect(describeSetting('shader-studio:present:sampleStill:abc').category).toBe('present');
    expect(describeSetting('shader-studio:settings:somethingNew')).toMatchObject({ label: 'Something new', category: 'other' });
    expect(labelFromKey('playfield:fancy-mode')).toBe('Fancy mode');
    expect(settingLabel('shader-studio:kaggle')).toBe('Kaggle sign-in');
  });
  it('groups in category order, sorted by name', () => {
    const g = groupSettings(['shader-studio:settings:somethingNew', 'shader-studio:theme', 'shader-studio:shortcuts', 'shader-studio:play:split'].map(key => ({ key, size: 1 })));
    expect(g.map(c => c.label)).toEqual(['Appearance and keys', 'Play', 'Other']);
    expect(g[0].items.map(i => i.info.label)).toEqual(['Keyboard shortcuts', 'Theme']);
  });
  it('Reset all leaves what you made or installed', () => {
    expect(resetAllKeys(['shader-studio:theme', 'shader-studio:finish-looks', 'playfield:gate-session', 'shader-studio-nodepacks:installed', 'codePanel_height']))
      .toEqual(['shader-studio:theme', 'codePanel_height']);
  });
});

describe('the App settings group', () => {
  it('takes the preferences out of the Settings section’s top level into one App settings group, by category', async () => {
    const inv = await buildInventory(KV());
    const settings = inv.byId.get('section:settings')!;
    expect(settings.children!.map(c => c.label)).toEqual(['Learned parameter roles', 'Sign-ins', 'App settings']);
    const app = inv.byId.get(APP_SETTINGS_ID)!;
    expect(app.treeLeaf).toBe(true);
    expect(app.children!.map(c => c.label)).toEqual(['Appearance and keys', 'Studio', 'Play', 'Present', 'Camera, MIDI and OSC', 'Other']);
    expect(countLeaves(app.children)).toBe(7);
    // Readable names, never the raw key as the detail.
    const shortcuts = inv.byId.get('setting:shader-studio:shortcuts')!;
    expect(shortcuts).toMatchObject({ label: 'Keyboard shortcuts', detail: '2 custom shortcuts' });
    for (const c of app.children!) for (const n of c.children!) expect(n.detail ?? '').not.toMatch(/^shader-studio|^playfield/);
    expect(app.size).toBe(app.children!.reduce((n, c) => n + c.size, 0));
  });

  it('resetting one removes its key, and undo puts it back exactly', async () => {
    const kv = KV();
    const inv = await buildInventory(kv);
    const res = removeNodes(kv, expandRemoval(inv, ['setting:shader-studio:theme']));
    expect(kv.get('shader-studio:theme')).toBeNull();
    expect(kv.get('shader-studio:cameraDevice')).toBe('cam-1');
    res.undo();
    expect(kv.get('shader-studio:theme')).toBe('dark');
  });

  it('Reset all (every item but the data) removes those keys only; graphs, roles and sign-ins stay; undo restores all', async () => {
    const kv = KV();
    const before = new Map(kv.data);
    const inv = await buildInventory(kv);
    const items = inv.byId.get(APP_SETTINGS_ID)!.children!.flatMap(c => c.children!);
    const ids = items.filter(n => resetAllKeys([(n.ref as { key: string }).key]).length).map(n => n.id);
    const res = removeNodes(kv, expandRemoval(inv, ids));
    expect([...kv.data.keys()].sort()).toEqual(['shader-studio:Sunset', 'shader-studio:discover:learned-roles', 'shader-studio:finish-looks', 'shader-studio:kaggle']);
    res.undo();
    expect(new Map(kv.data)).toEqual(before);
  });

  it('downloads still carry the settings: everything, and choosing the Settings section', async () => {
    const kv = KV();
    const inv = await buildInventory(kv);
    expect(Object.keys(everythingSnapshot(kv).items)).toEqual(expect.arrayContaining(['shader-studio:theme', 'shader-studio:shortcuts', 'codePanel_height']));
    const sel = selectionSnapshot(kv, inv, ['section:settings']);
    expect(Object.keys(sel.snapshot.items)).toEqual(expect.arrayContaining(['shader-studio:theme', 'shader-studio:cameraDevice', 'shader-studio:discover:learned-roles']));
    expect(Object.keys(sel.snapshot.items)).not.toContain('shader-studio:kaggle');
  });
});
