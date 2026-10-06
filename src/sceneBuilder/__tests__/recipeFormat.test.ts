/**
 * The recipe's highlighting, pretty form and rows (sceneBuilder/highlight.ts, recipe.ts formatRecipe):
 * token kinds on sample recipes, the formatter's output and its round trip (one line ↔ pretty, any
 * whitespace), and row edits (replace, move, delete a clause) that read back as meant.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { formatRecipe, parseRecipe, printRecipe } from '../recipe';
import { clauseTree, recipeRuns, recipeTokens, splitClauses } from '../highlight';
import { deleteClause, moveClause, replaceClause } from '../recipeRows';
import { canonicalSpec } from '../spec';
import { SCENE_TEMPLATES, templateSpec } from '../templates';

const BLOBS = SCENE_TEMPLATES.find(t => t.key === 'blobs')!.recipe;
const kinds = (src: string) => {
  const toks = recipeTokens(src);
  return (text: string, nth = 0) => toks.filter(t => src.slice(t.from, t.to) === text)[nth];
};
const same = (a: string, b: string) => expect(canonicalSpec(parseRecipe(a).spec)).toEqual(canonicalSpec(parseRecipe(b).spec));

describe('recipeTokens', () => {
  it('colours each kind of word in the Smooth-blob sculpture', () => {
    const k = kinds(BLOBS);
    expect(k('surface').kind).toBe('mode');
    expect(k('smooth-union').kind).toBe('op');
    expect(k('sphere').kind).toBe('shape');
    expect(k('capsule').kind).toBe('shape');
    expect(k('plane').kind).toBe('shape');
    expect(k('r').kind).toBe('key');
    expect(k('at').kind).toBe('key');
    expect(k('rot').kind).toBe('key');
    expect(k('color').kind).toBe('key');
    expect(k('k').kind).toBe('key');
    expect(k('0.55').kind).toBe('number');
    expect(k('Body').kind).toBe('name');
    expect(k('Sculpture').kind).toBe('name');
    expect(k('sun').kind).toBe('setting');
    expect(k('shadows').kind).toBe('setting');
    expect(k('background').kind).toBe('setting');
    expect(k('camera').kind).toBe('setting');
  });
  it('marks vectors, and gives colour vectors, hexes and colour names a swatch', () => {
    const src = 'sphere at=(0,0.05,0) color=(0.85,0.45,0.3) · box color=#ff8800 · torus color=gold · sky (0.2,0.4,0.9)';
    const toks = recipeTokens(src);
    const at = (i: number) => toks.find(t => t.from === i)!;
    const open1 = src.indexOf('(0,0.05');
    expect(at(open1).kind).toBe('vector');
    expect(at(open1).swatch).toBeUndefined();
    const open2 = src.indexOf('(0.85');
    expect(at(open2).swatch).toEqual([0.85, 0.45, 0.3]);
    expect(at(src.indexOf('#ff8800'))).toMatchObject({ kind: 'colour', swatch: [1, 136 / 255, 0] });
    expect(at(src.indexOf('gold')).kind).toBe('colour');
    expect(at(src.indexOf('gold')).swatch).toBeTruthy();
    expect(at(src.indexOf('(0.2,0.4'))).toMatchObject({ kind: 'vector', swatch: [0.2, 0.4, 0.9] });
  });
  it('warps: whole-scene and @ on a shape', () => {
    const k = kinds('box @twist(2) · polar-repeat 6 · mirror xz');
    expect(k('twist').kind).toBe('warp');
    expect(k('polar-repeat').kind).toBe('warp');
    expect(k('mirror').kind).toBe('warp');
  });
  it('puts the parser\'s mistakes, with did-you-mean, on the runs they cover', () => {
    const src = 'surface · spehre r=1 · box';
    const bad = recipeTokens(src).find(t => src.slice(t.from, t.to) === 'spehre')!;
    expect(bad.error).toMatch(/sphere/);
    expect(recipeTokens(src).filter(t => t.error)).toHaveLength(1);
  });
  it('runs cover the whole text', () => {
    expect(recipeRuns(BLOBS).map(r => r.text).join('')).toBe(BLOBS);
  });
});

describe('formatRecipe', () => {
  it('puts each item of a combine on its own line, k= on the closing line', () => {
    const pretty = formatRecipe(BLOBS);
    expect(pretty.split('\n').slice(0, 7)).toEqual([
      'surface',
      'smooth-union(',
      '  sphere r=0.55 at=(0,0.05,0) color=(0.85,0.45,0.3) shine=0.4 name=Body,',
      '  sphere r=0.36 at=(0.55,0.5,0.1) color=(0.9,0.7,0.35) shine=0.4 name=Head,',
      '  sphere r=0.28 at=(-0.5,0.45,-0.25) color=(0.55,0.3,0.6) shine=0.4,',
      '  capsule h=0.5 r=0.12 at=(0.1,-0.3,0.55) rot=(0,0,60) color=(0.85,0.45,0.3)',
      ') k=0.35 name=Sculpture',
    ]);
    expect(parseRecipe(pretty).errors).toEqual([]);
  });
  it('round-trips: one line ↔ pretty ↔ any whitespace, for every template', () => {
    for (const t of SCENE_TEMPLATES) {
      const spec = templateSpec(t.key);
      const compact = printRecipe(spec);
      const pretty = printRecipe(spec, { pretty: true });
      same(compact, pretty);
      same(pretty, t.recipe);
      expect(formatRecipe(compact)).toBe(pretty);
      expect(formatRecipe(pretty)).toBe(pretty);
      // Squashed or stretched spacing reads the same.
      const stretched = pretty.replace(/\n {2}/g, '\n      ').split('"').map((part, i) => (i % 2 ? part : part.replace(/ /g, '  '))).join('"');
      same(stretched, compact);
      expect(printRecipe(parseRecipe(pretty).spec)).toBe(compact);
    }
  });
  it('nests combines with deeper indents', () => {
    const src = 'smooth-union(sphere, subtract(box size=(1,1,1), sphere r=0.6)) k=0.2';
    const pretty = formatRecipe(src);
    expect(pretty).toContain('\n  subtract(\n    box');
    same(pretty, src);
  });
  it('a new line that is not indented still ends a clause (so a half-typed bracket doesn\'t eat the lines under it)', () => {
    const r = parseRecipe('union(sphere\nbox');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(splitClauses('union(sphere\nbox').map(c => c.text)).toEqual(['union(sphere', 'box']);
  });
  it('leaves text that doesn\'t read alone', () => {
    expect(formatRecipe('spehre r=1')).toBe('spehre r=1');
  });
});

describe('rows', () => {
  const pretty = formatRecipe(BLOBS);
  it('one row per clause, a combine as a tree', () => {
    const rows = splitClauses(pretty);
    expect(rows.map(r => r.text.split('\n')[0])).toEqual(['surface', 'smooth-union(', 'plane y=-0.6 color=(0.55,0.55,0.6)', 'sun dir=(0.7,0.8,0.3)', 'shadows 12', 'background top=(0.45,0.6,0.85) bottom=(0.85,0.75,0.65)', 'camera dist=3.8 angle=30 elev=14 orbit=6']);
    const tree = clauseTree(rows[1].text);
    expect(tree.head).toBe('smooth-union(');
    expect(tree.children!.map(c => c.head.split(' ')[0])).toEqual(['sphere', 'sphere', 'sphere', 'capsule']);
    expect(tree.tail).toBe(') k=0.35 name=Sculpture');
    expect(clauseTree('sun dir=(0.7,0.8,0.3)')).toEqual({ head: 'sun dir=(0.7,0.8,0.3)' });
  });
  it('a row edited reads back as the new clause', () => {
    const next = replaceClause(pretty, 2, 'plane y=-1 color=red');
    const r = parseRecipe(next);
    expect(r.errors).toEqual([]);
    const plane = r.spec.root.children.find(c => c.type === 'shape' && c.kind === 'plane');
    expect(plane && plane.type === 'shape' && plane.size.y).toBe(-1);
    // The combine row edited as one line.
    const one = replaceClause(pretty, 1, 'smooth-union(sphere r=0.5, box) k=0.5');
    const g = parseRecipe(one).spec.root.children[0];
    expect(g.type === 'group' && g.children.length).toBe(2);
    expect(g.type === 'group' && g.k).toBe(0.5);
  });
  it('moves and deletes rows', () => {
    const moved = moveClause(pretty, 2, 1);
    expect(splitClauses(moved)[1].text).toMatch(/^plane/);
    const kids = parseRecipe(moved).spec.root.children;
    expect(kids[0].type === 'shape' && kids[0].kind).toBe('plane');
    const gone = deleteClause(pretty, 4);
    expect(parseRecipe(gone).spec.look.shadows).toBe(parseRecipe('surface').spec.look.shadows);
    expect(splitClauses(gone)).toHaveLength(6);
  });
});
