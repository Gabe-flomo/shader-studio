/**
 * My blocks (savedBlocks.ts): saving a block keeps its lines, sliders, Run × and picture; rename,
 * duplicate and delete; sharing as text; Random opts in; recipes name it (`my="…"`) and carry its
 * lines so they still work where it isn't saved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); },
    key: () => null, get length() { return m.size; }, clear: () => m.clear(),
  });
  return m;
});

import { unzlibSync } from 'fflate';
import {
  SAVED_BLOCKS_KEY, blockThumbnail, deleteSavedBlock, duplicateSavedBlock, encodePng, exportSavedBlock, findSavedBlock, importSavedBlock, loadSavedBlocks,
  renameSavedBlock, saveSavedBlock, savedBlockFrom, sceneOpFromSaved,
} from '../savedBlocks';
import { blockMap, type SpaceBlock } from '../blocks';
import { BLOCK_LIBRARY, blockFromEntry, randomChoices } from '../blockLibrary';
import { emptyScene, newBlockOp, newCombineOp } from '../spec';
import { parseRecipe2D, printRecipe2D } from '../recipe';
import { renderWarpThumbnail } from '../thumbnails';
import { buildStandalone2D } from '../build';

const wobble: SpaceBlock = {
  name: 'My block',
  lines: [{ target: 'uv.x', op: '+=', rhs: 'amp * sin(y * freq + t)' }, { target: 'uv', op: '*=', rhs: '1 + 0.2 * length(uv)' }],
  params: [{ name: 'amp', value: 0.15, min: 0, max: 0.5 }, { name: 'freq', value: 9, min: 0, max: 30 }],
  times: 2,
};

beforeEach(() => store.clear());

describe('saving a block', () => {
  it('round-trips its lines, sliders (names, values, ranges) and Run ×', () => {
    const s = savedBlockFrom({ block: wobble }, { name: 'Wobble rings', blurb: 'Rows wobble, rings swell.', category: 'waves' })!;
    expect(saveSavedBlock(s).ok).toBe(true);
    const [back] = loadSavedBlocks();
    expect(back.name).toBe('Wobble rings');
    expect(back.blurb).toBe('Rows wobble, rings swell.');
    expect(back.category).toBe('waves');
    expect(back.random).toBe(false);
    expect(back.block!.lines).toEqual(wobble.lines);
    expect(back.block!.params).toEqual(wobble.params);
    expect(back.block!.times).toBe(2);
    expect(back.block!.name).toBe('Wobble rings');
  });

  it('draws the library’s warped-grid picture and stores it as a PNG', () => {
    const s = savedBlockFrom({ block: wobble }, { name: 'Wobble rings' })!;
    expect(s.thumb).toMatch(/^data:image\/png;base64,/);
    const bytes = Uint8Array.from(atob(s.thumb.split(',')[1]), c => c.charCodeAt(0));
    expect([...bytes.slice(1, 4)].map(c => String.fromCharCode(c)).join('')).toBe('PNG');
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(16)).toBe(64);
    // Its pixels are the library renderer's.
    const idatLen = dv.getUint32(33);
    const raw = unzlibSync(bytes.slice(41, 41 + idatLen));
    const want = renderWarpThumbnail(blockMap({ ...wobble, name: 'Wobble rings' }, 1), 64);
    for (const [x, y] of [[0, 0], [10, 20], [40, 33], [63, 63]]) {
      const o = y * (1 + 64 * 3) + 1 + x * 3, p = (y * 64 + x) * 4;
      expect([raw[o], raw[o + 1], raw[o + 2]]).toEqual([want[p], want[p + 1], want[p + 2]]);
    }
    expect(blockThumbnail({ block: blockFromEntry(BLOCK_LIBRARY[0]) })).not.toBe(s.thumb);
    expect(encodePng(new Uint8ClampedArray(4 * 4), 2, 2).length).toBeGreaterThan(40);
  });

  it('saves a combine whole: both sides and how they join', () => {
    const op = newCombineOp('p1', blockFromEntry(BLOCK_LIBRARY[0]), wobble, 'blend', 0.3);
    saveSavedBlock(savedBlockFrom({ combine: op.combine }, { name: 'Two moves' })!);
    const back = findSavedBlock('two moves')!;
    expect(back.combine!.mode).toBe('blend');
    expect(back.combine!.amount).toBe(0.3);
    expect(back.combine!.b.lines).toEqual(wobble.lines);
    expect(back.combine!.a.lib).toBeUndefined();
    expect(back.thumb).toMatch(/^data:image\/png/);
    expect(sceneOpFromSaved(back).combine!.my).toBe('Two moves');
  });

  it('saving under a taken name replaces it (editing), keeping its id', () => {
    const first = savedBlockFrom({ block: wobble }, { name: 'Wobble' })!;
    saveSavedBlock(first);
    saveSavedBlock(savedBlockFrom({ block: { ...wobble, times: 5 } }, { name: 'wobble' })!);
    const list = loadSavedBlocks();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(first.id);
    expect(list[0].block!.times).toBe(5);
  });

  it('renames, duplicates and deletes', () => {
    const s = savedBlockFrom({ block: wobble }, { name: 'Wobble' })!;
    saveSavedBlock(s);
    saveSavedBlock(savedBlockFrom({ block: wobble }, { name: 'Other' })!);
    expect(renameSavedBlock(s.id, 'Other').ok).toBe(false);
    expect(renameSavedBlock(s.id, 'Wobble rings').ok).toBe(true);
    expect(findSavedBlock('Wobble rings')!.block!.name).toBe('Wobble rings');
    expect(duplicateSavedBlock(s.id).copy!.name).toBe('Wobble rings copy');
    expect(duplicateSavedBlock(s.id).copy!.name).toBe('Wobble rings copy 2');
    expect(loadSavedBlocks()).toHaveLength(4);
    deleteSavedBlock(s.id);
    expect(findSavedBlock('Wobble rings')).toBeNull();
    expect(loadSavedBlocks()).toHaveLength(3);
  });

  it('ignores junk in storage', () => {
    store.set(SAVED_BLOCKS_KEY, JSON.stringify([null, { name: '' }, { name: 'x', block: { lines: [{ target: 'nope', op: '=', rhs: '1' }] } }, 'str']));
    const list = loadSavedBlocks();
    expect(list).toHaveLength(1);
    expect(list[0].block!.lines).toEqual([]);
    expect(list[0].thumb).toMatch(/^data:image\/png/);
  });
});

describe('sharing', () => {
  it('exports as text and imports under a free name, with a fresh picture', () => {
    const s = savedBlockFrom({ block: wobble }, { name: 'Wobble', category: 'trig' })!;
    saveSavedBlock(s);
    const text = exportSavedBlock(s);
    expect(text).not.toContain('base64');
    const r = importSavedBlock(text, loadSavedBlocks());
    expect(r.block!.name).toBe('Wobble 2');
    expect(r.block!.category).toBe('trig');
    expect(r.block!.thumb).toBe(blockThumbnail({ block: r.block!.block }));
    expect(importSavedBlock('nope').error).toMatch(/isn’t a shared block/);
    expect(importSavedBlock('{"kind":"other"}').error).toMatch(/isn’t a shared space block/);
  });
});

describe('Random', () => {
  it('offers a saved block only when it is opted in', () => {
    const s = savedBlockFrom({ block: wobble }, { name: 'Wobble', random: true })!;
    const entry = { id: 'my:Wobble', name: 'Wobble', category: 'trig' as const, blurb: '', lines: s.block!.lines, params: s.block!.params, times: 2 };
    let seen = false;
    for (let k = 0; k < 200 && !seen; k++) {
      const got = randomChoices(Math.random, 3, [], [entry]);
      const mine = got.find(b => b.my === 'Wobble');
      if (mine) { seen = true; expect(mine.lib).toBeUndefined(); expect(mine.lines).toEqual(wobble.lines); }
    }
    expect(seen).toBe(true);
    for (let k = 0; k < 20; k++) expect(randomChoices(Math.random, 3).some(b => b.my)).toBe(false);
  });
});

describe('in a recipe', () => {
  it('names a saved block and embeds its lines; round-trips', () => {
    const s = savedBlockFrom({ block: wobble }, { name: 'Wobble rings' })!;
    saveSavedBlock(s);
    const scene = emptyScene();
    scene.space.push(newBlockOp('p1', sceneOpFromSaved(s).block!));
    const text = printRecipe2D(scene);
    expect(text).toContain('space-block my="Wobble rings" {uv.x += amp * sin(y * freq + t); uv *= 1 + 0.2 * length(uv)} amp=0.15 freq=9 times=2');
    const back = parseRecipe2D(text);
    expect(back.errors).toEqual([]);
    expect(back.scene.space[0].block!.my).toBe('Wobble rings');
    expect(back.scene.space[0].block!.name).toBe('Wobble rings');
    expect(printRecipe2D(back.scene)).toBe(text);
  });

  it('works where the block isn’t saved: the embedded lines', () => {
    const r = parseRecipe2D('space-block my="Wobble rings" {uv.x += amp * sin(y * 4)} amp=0.2');
    expect(r.errors).toEqual([]);
    expect(r.scene.space[0].block!.lines[0].rhs).toBe('amp * sin(y * 4)');
    expect(r.scene.space[0].block!.params[0].value).toBe(0.2);
    expect(buildStandalone2D(r.scene).nodes.some(n => String(n.type).toLowerCase().includes('expr'))).toBe(true);
  });

  it('a name alone looks it up, with its sliders set; unknown names say so', () => {
    saveSavedBlock(savedBlockFrom({ block: wobble }, { name: 'Wobble rings' })!);
    const r = parseRecipe2D('space-block my="Wobble rings" amp=0.3');
    expect(r.errors).toEqual([]);
    const b = r.scene.space[0].block!;
    expect(b.lines).toEqual(wobble.lines);
    expect(b.params.find(p => p.name === 'amp')!.value).toBe(0.3);
    expect(b.times).toBe(2);
    expect(parseRecipe2D('space-block my="Wobble rings" ampp=1').errors[0].message).toMatch(/Did you mean “amp”/);
    expect(parseRecipe2D('space-block my="Wobble ring"').errors[0].message).toMatch(/isn't one of your saved blocks.*Did you mean “Wobble rings”/);
  });

  it('a saved combine prints its name with both sides, and a name alone looks it up', () => {
    const op = newCombineOp('p1', blockFromEntry(BLOCK_LIBRARY[0]), wobble, 'multiply');
    const s = savedBlockFrom({ combine: op.combine }, { name: 'Pair' })!;
    saveSavedBlock(s);
    const c = sceneOpFromSaved(s).combine!;
    const added = newCombineOp('p1', c.a, c.b, c.mode, c.amount);
    added.combine!.my = c.my;
    const scene = emptyScene();
    scene.space.push(added);
    const text = printRecipe2D(scene);
    expect(text).toMatch(/combine-blocks multiply my=Pair a=\{/);
    const back = parseRecipe2D(text);
    expect(back.errors).toEqual([]);
    expect(printRecipe2D(back.scene)).toBe(text);
    const short = parseRecipe2D('combine-blocks my=Pair');
    expect(short.errors).toEqual([]);
    expect(short.scene.space[0].combine!.b.lines).toEqual(wobble.lines);
  });
});
