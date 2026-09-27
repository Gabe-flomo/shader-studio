/**
 * Links between saved graphs and presentations (present/links.ts): both sides
 * agree after link and unlink, deleting or renaming one side leaves the other
 * intact, imports under new names keep their links, old records read as
 * unlinked, and what loading a linked graph or presentation does.
 */
import { describe, expect, it, vi } from 'vitest';

// The samples module pulls in the graph store, which reads storage when it's made.
vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return 0; }, clear: () => m.clear(),
  });
});
import {
  decideOnGraphLoad, decideOnPresentationOpen, EXAMPLE_PRESENTATION_LINKS, fixImportedLinks, graphDeleted, link, linkedGraphsOf,
  linkedPresentationsOf, normalizeLinks, presentationDeleted, presentationRenamed, graphRenamed, reconcilePresentation, unlink, type LinkKV,
} from '../links';
import { parsePresentation } from '../../types/presentation';
import { importLibrary, type KV } from '../../utils/library';
import { EXAMPLE_INDEX } from '../../store/exampleIndex';
import { memoryKV, removeNodes } from '../../files/mutate';
import { buildInventory } from '../../files/inventory';
import { buildProfileZip, everythingSnapshot, installMerge, readProfile } from '../../files/profileZip';

function memKV(init: Record<string, string> = {}): KV & LinkKV & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, keys: () => [...data.keys()], get: k => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
}
const G = (name: string) => `shader-studio:${name}`;
const P = (name: string) => `shader-studio-presentation:${name}`;
const graph = (extra: object = {}) => JSON.stringify({ nodes: [{ id: 'n1', type: 'output', params: {} }], looseGroups: [], savedAt: 1, version: 1, ...extra });
const pres = (title: string, extra: object = {}) => JSON.stringify({ version: 1, title, steps: [{ id: 's1', columns: 1, blocks: [] }], sources: [], createdAt: 1, updatedAt: 1, ...extra });
const read = (kv: LinkKV, key: string) => JSON.parse(kv.get(key)!) as Record<string, unknown>;

describe('links stay consistent', () => {
  it('link writes both sides, once', () => {
    const kv = memKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson') });
    expect(link('Rings', 'Lesson', kv)).toBe(true);
    expect(link('Rings', 'Lesson', kv)).toBe(true);
    expect(read(kv, G('Rings')).linkedPresentations).toEqual(['Lesson']);
    expect(read(kv, P('Lesson')).linkedGraphs).toEqual(['Rings']);
    expect(linkedPresentationsOf('Rings', kv)).toEqual(['Lesson']);
    expect(linkedGraphsOf('Lesson', kv)).toEqual(['Rings']);
  });

  it('won’t link to something that isn’t saved', () => {
    const kv = memKV({ [G('Rings')]: graph() });
    expect(link('Rings', 'Nope', kv)).toBe(false);
    expect(read(kv, G('Rings')).linkedPresentations).toBeUndefined();
  });

  it('unlink removes both sides and leaves the records as they were before links', () => {
    const before = { [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson') };
    const kv = memKV(before);
    link('Rings', 'Lesson', kv);
    unlink('Rings', 'Lesson', kv);
    expect(kv.get(G('Rings'))).toBe(before[G('Rings')]);
    expect(kv.get(P('Lesson'))).toBe(before[P('Lesson')]);
  });

  it('a graph can have several presentations and a presentation several graphs', () => {
    const kv = memKV({ [G('A')]: graph(), [G('B')]: graph(), [P('One')]: pres('One'), [P('Two')]: pres('Two') });
    link('A', 'One', kv); link('A', 'Two', kv); link('B', 'One', kv);
    expect(linkedPresentationsOf('A', kv)).toEqual(['One', 'Two']);
    expect(linkedGraphsOf('One', kv)).toEqual(['A', 'B']);
    unlink('A', 'One', kv);
    expect(linkedPresentationsOf('A', kv)).toEqual(['Two']);
    expect(linkedGraphsOf('One', kv)).toEqual(['B']);
  });
});

describe('one side goes, the other stays', () => {
  it('deleting a graph removes only the link from its presentations', () => {
    const kv = memKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson') });
    link('Rings', 'Lesson', kv);
    graphDeleted('Rings', kv);
    kv.data.delete(G('Rings'));
    expect(kv.get(P('Lesson'))).not.toBeNull();
    expect(read(kv, P('Lesson')).linkedGraphs).toBeUndefined();
    expect(parsePresentation(read(kv, P('Lesson')))?.steps.length).toBe(1);
  });

  it('deleting a presentation removes only the link from its graphs', () => {
    const kv = memKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson') });
    link('Rings', 'Lesson', kv);
    presentationDeleted('Lesson', kv);
    kv.data.delete(P('Lesson'));
    expect(read(kv, G('Rings')).linkedPresentations).toBeUndefined();
    expect(read(kv, G('Rings')).nodes).toHaveLength(1);
  });

  it('Undo of a delete puts the links back where the graph is still here', () => {
    const kv = memKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson', { linkedGraphs: ['Rings', 'Gone'] }) });
    reconcilePresentation('Lesson', kv);
    expect(read(kv, P('Lesson')).linkedGraphs).toEqual(['Rings']);
    expect(read(kv, G('Rings')).linkedPresentations).toEqual(['Lesson']);
  });

  it('a partner deleted behind our back (in Finder, say) just isn’t listed', () => {
    const kv = memKV({ [G('Rings')]: graph({ linkedPresentations: ['Lesson', 'Gone'] }), [P('Lesson')]: pres('Lesson', { linkedGraphs: ['Rings'] }) });
    expect(linkedPresentationsOf('Rings', kv)).toEqual(['Lesson']);
  });

  it('the Files page removing a graph unlinks it, and its Undo relinks', async () => {
    const kv = memoryKV({ [G('Rings')]: graph({ linkedPresentations: ['Lesson'] }), [P('Lesson')]: pres('Lesson', { linkedGraphs: ['Rings'] }) });
    const inv = await buildInventory(kv);
    const node = [...inv.byId.values()].find(n => n.kind === 'graph' && n.label === 'Rings')!;
    expect(node.linked).toEqual(['Lesson']);
    expect([...inv.byId.values()].find(n => n.kind === 'presentation')!.linked).toEqual(['Rings']);
    const r = removeNodes(kv, [node]);
    expect(kv.get(G('Rings'))).toBeNull();
    expect(JSON.parse(kv.get(P('Lesson'))!).linkedGraphs).toBeUndefined();
    r.undo();
    expect(JSON.parse(kv.get(P('Lesson'))!).linkedGraphs).toEqual(['Rings']);
    expect(JSON.parse(kv.get(G('Rings'))!).linkedPresentations).toEqual(['Lesson']);
  });
});

describe('renames', () => {
  it('a renamed presentation is still linked from its graphs', () => {
    const kv = memKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson') });
    link('Rings', 'Lesson', kv);
    kv.set(P('Lesson 2'), kv.get(P('Lesson'))!); kv.data.delete(P('Lesson'));
    presentationRenamed('Lesson', 'Lesson 2', kv);
    expect(linkedPresentationsOf('Rings', kv)).toEqual(['Lesson 2']);
    expect(linkedGraphsOf('Lesson 2', kv)).toEqual(['Rings']);
  });

  it('a renamed graph is still linked from its presentations', () => {
    const kv = memKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson') });
    link('Rings', 'Lesson', kv);
    kv.set(G('Circles'), kv.get(G('Rings'))!); kv.data.delete(G('Rings'));
    graphRenamed('Rings', 'Circles', kv);
    expect(linkedGraphsOf('Lesson', kv)).toEqual(['Circles']);
  });
});

describe('imports keep links under new names', () => {
  it('fixImportedLinks maps names and drops links to things not in the import', () => {
    const kv = memKV({
      [G('Rings (imported)')]: graph({ linkedPresentations: ['Lesson', 'Elsewhere'] }),
      [P('Lesson (2)')]: pres('Lesson (2)', { linkedGraphs: ['Rings'] }),
      [P('Elsewhere')]: pres('Elsewhere'),
    });
    fixImportedLinks(kv, new Map([['Rings', 'Rings (imported)']]), new Map([['Lesson', 'Lesson (2)']]), { graphs: ['Rings (imported)'], presentations: ['Lesson (2)'] });
    expect(read(kv, G('Rings (imported)')).linkedPresentations).toEqual(['Lesson (2)']);
    expect(read(kv, P('Lesson (2)')).linkedGraphs).toEqual(['Rings (imported)']);
    expect(read(kv, P('Elsewhere')).linkedGraphs).toBeUndefined();
  });

  it('a library import whose names are taken remaps both sides', () => {
    const mine = memKV({ [G('Rings')]: graph({ note: 'mine' }), [P('Lesson')]: pres('Lesson', { steps: [{ id: 'x', columns: 1, blocks: [] }, { id: 'y', columns: 1, blocks: [] }] }) });
    const r = importLibrary({ kind: 'shader-studio-library', version: 1, savedAt: 1, items: {
      [G('Rings')]: graph({ linkedPresentations: ['Lesson'] }),
      [P('Lesson')]: pres('Lesson', { linkedGraphs: ['Rings'] }),
    } } as never, mine);
    expect(r.renamed).toEqual(['Rings (imported)']);
    expect(r.renamedPresentations).toEqual(['Lesson (2)']);
    expect(read(mine, G('Rings (imported)')).linkedPresentations).toEqual(['Lesson (2)']);
    expect(read(mine, P('Lesson (2)')).linkedGraphs).toEqual(['Rings (imported)']);
    // Yours are untouched.
    expect(read(mine, G('Rings')).linkedPresentations).toBeUndefined();
    expect(read(mine, P('Lesson')).linkedGraphs).toBeUndefined();
  });

  it('a profile ZIP merged into storage that has the names remaps both sides', async () => {
    const theirs = memoryKV({ [G('Rings')]: graph({ play: { controls: [1] }, linkedPresentations: ['Lesson'] }), [P('Lesson')]: pres('Lesson', { linkedGraphs: ['Rings'] }) });
    const zip = await buildProfileZip(everythingSnapshot(theirs), { scope: 'everything' });
    const mine = memoryKV({ [G('Rings')]: graph(), [P('Lesson')]: pres('Lesson', { steps: [{ id: 'x', columns: 1, blocks: [] }, { id: 'y', columns: 1, blocks: [] }] }) });
    installMerge(readProfile(zip.bytes), mine);
    expect(JSON.parse(mine.get(G('Rings (2)'))!).linkedPresentations).toEqual(['Lesson (2)']);
    expect(JSON.parse(mine.get(P('Lesson (2)'))!).linkedGraphs).toEqual(['Rings (2)']);
    expect(JSON.parse(mine.get(G('Rings'))!).linkedPresentations).toBeUndefined();
  });
});

describe('migration', () => {
  it('old records (no field, or junk) read as unlinked', () => {
    expect(normalizeLinks(undefined)).toEqual([]);
    expect(normalizeLinks('Lesson')).toEqual([]);
    expect(normalizeLinks(['A', 3, '', 'A', 'B'])).toEqual(['A', 'B']);
    const kv = memKV({ [G('Old')]: graph(), [P('Old deck')]: pres('Old deck') });
    expect(linkedPresentationsOf('Old', kv)).toEqual([]);
    expect(linkedGraphsOf('Old deck', kv)).toEqual([]);
  });

  it('a presentation keeps its linked graphs through parsePresentation, and has none when absent', () => {
    expect(parsePresentation(JSON.parse(pres('A', { linkedGraphs: ['Rings', 'Rings', 7] })))?.linkedGraphs).toEqual(['Rings']);
    expect(parsePresentation(JSON.parse(pres('A')))?.linkedGraphs).toBeUndefined();
  });
});

describe('what loading does', () => {
  it('a graph with a presentation: ask offers, always opens, never is quiet', () => {
    const linked = ['Lesson'];
    expect(decideOnGraphLoad({ setting: 'ask', linked, openPresentation: null })).toEqual({ kind: 'offer', name: 'Lesson', others: 0 });
    expect(decideOnGraphLoad({ setting: 'open', linked, openPresentation: 'Other' })).toEqual({ kind: 'open', name: 'Lesson', others: 0 });
    expect(decideOnGraphLoad({ setting: 'never', linked, openPresentation: null })).toEqual({ kind: 'none' });
  });

  it('nothing when there is no link, or its presentation is already open', () => {
    expect(decideOnGraphLoad({ setting: 'ask', linked: [], openPresentation: null })).toEqual({ kind: 'none' });
    expect(decideOnGraphLoad({ setting: 'open', linked: ['A', 'Lesson'], openPresentation: 'Lesson' })).toEqual({ kind: 'none' });
    expect(decideOnGraphLoad({ setting: 'ask', linked: ['A', 'B'], openPresentation: null })).toEqual({ kind: 'offer', name: 'A', others: 1 });
  });

  it('a presentation with a graph: never replaces unsaved work without asking', () => {
    const linked = ['Rings'];
    expect(decideOnPresentationOpen({ setting: 'open', linked, currentGraph: 'Other', graphDirty: false })).toEqual({ kind: 'open', name: 'Rings', others: 0 });
    expect(decideOnPresentationOpen({ setting: 'open', linked, currentGraph: 'Other', graphDirty: true })).toEqual({ kind: 'offer', name: 'Rings', others: 0 });
    expect(decideOnPresentationOpen({ setting: 'ask', linked, currentGraph: null, graphDirty: false })).toEqual({ kind: 'offer', name: 'Rings', others: 0 });
    expect(decideOnPresentationOpen({ setting: 'never', linked, currentGraph: null, graphDirty: false })).toEqual({ kind: 'none' });
    expect(decideOnPresentationOpen({ setting: 'ask', linked, currentGraph: 'Rings', graphDirty: true })).toEqual({ kind: 'none' });
  });
});

describe('examples', () => {
  it('declare links to sample presentations that exist, from examples that exist', async () => {
    const { SAMPLE_PRESENTATIONS } = await import('../samples');
    const titles = new Set(SAMPLE_PRESENTATIONS.map(s => s.title));
    const entries = Object.entries(EXAMPLE_PRESENTATION_LINKS);
    expect(entries.length).toBeGreaterThan(20);
    for (const [key, list] of entries) {
      expect(EXAMPLE_INDEX[key], key).toBeDefined();
      for (const t of list) expect(titles.has(t), t).toBe(true);
    }
  });
});
