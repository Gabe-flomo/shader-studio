/**
 * The Grid Rules dialect (docs/playfield-language-plan.md §4.3, phase 3): text ⇄ Grid Rules params.
 * Every preset round-trips (and with random overrides), the plan's examples read as written,
 * stencils and blocks as text run on the CPU exactly as the presets they print as, B/S text,
 * mistakes with "did you mean", and randomness.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { GRID_PRESET_NAMES, RECIPE_KEYS, parseGrid, presetParams, printGrid } from '../dialects/grid';
import { BOARD_SIZES, COUNT_PRESETS, GRID_DEFAULTS, STAGES_PRESETS, SMOOTH_PRESETS, maskOf, matchingPreset } from '../../gridRules/spec';
import { BLOCK_PRESETS, PATTERN_PRESETS } from '../../gridRules/stencils';
import { cpuSeed, cpuStep } from '../../gridRules/cpu';
import { makeRng } from '../random';
import { COLOUR_TABLE } from '../colours';
import { lookupHead } from '../registry';

type P = Record<string, unknown>;
const pick = (p: P) => Object.fromEntries(RECIPE_KEYS.map(k => [k, JSON.parse(JSON.stringify(p[k] ?? GRID_DEFAULTS[k]))]));
const norm = (p: P) => JSON.parse(JSON.stringify(pick({ ...GRID_DEFAULTS, ...p }), (_k, v) => (typeof v === 'number' ? Math.round(v * 10000) / 10000 : v)));
const read = (src: string, base?: P) => {
  const r = parseGrid(src, { base, seed: 1 });
  expect(r.errors.map(e => e.message), src).toEqual([]);
  return r.params;
};
const roundTrip = (p: P) => {
  for (const pretty of [false, true]) {
    const text = printGrid(p, { pretty });
    expect(norm(read(text)), text).toEqual(norm(p));
  }
};

describe('grid dialect: presets', () => {
  it('names every preset by its slugged label (D14: maze is Count, labyrinth is Smooth)', () => {
    const slugs = GRID_PRESET_NAMES.map(p => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of ['life', 'highlife', 'seeds', 'day-and-night', 'maze', 'coral', 'anneal', 'diamoeba', 'replicator', 'life-without-death', 'caves', 'diamonds', 'bosco', 'majority',
      'brians-brain', 'star-wars', 'frogs', 'sticks', 'spirals', 'swirl', 'lava', 'bloomerang', 'heat', 'ripples', 'mitosis', 'coral-growth', 'worms', 'spots', 'labyrinth',
      'wireworld', 'falling-dots', 'crystal', 'falling-sand', 'gas']) expect(slugs, s).toContain(s);
    expect(GRID_PRESET_NAMES.find(p => p.slug === 'maze')!.ruleType).toBe('count');
    expect(GRID_PRESET_NAMES.find(p => p.slug === 'labyrinth')!.ruleType).toBe('smooth');
    expect(lookupHead('labyrinth', 'grid')?.entry.id).toBe('grid:preset:smooth:maze');
  });
  it('every preset reads as the params the editor and the Do… bar set, and prints back as its name', () => {
    for (const p of GRID_PRESET_NAMES) {
      const params = read(`grid ${p.slug}`);
      expect(norm(params), p.slug).toEqual(norm(presetParams(p.ruleType, p.preset)));
      expect(matchingPreset(params), p.slug).toBe(p.key);
      expect(printGrid(params).replace(/^grid /, ''), p.slug).toBe(p.slug);
      roundTrip(params);
    }
  });
  it('every preset with random overrides round-trips (text → params → text)', () => {
    const rng = makeRng(33);
    for (let i = 0; i < 400; i++) {
      const p = rng.pick(GRID_PRESET_NAMES);
      const params: P = { ...GRID_DEFAULTS, ...presetParams(p.ruleType, p.preset) };
      const n = rng.int(1, 5);
      for (let k = 0; k < n; k++) {
        const key = rng.pick(['board', 'edges', 'rate', 'steps', 'density', 'seed', 'start', 'states', 'bornMask', 'surviveMask', 'neighbourhood', 'radius', 'bornLo', 'afterglow', 'ageFade', 'color0', 'color1', 'color5', 'glowColor', 'brushRadius', 'brushFill', 'brushState', 'feed', 'kill', 'template', 'customU', 'knobA', 'gain', 'shape']);
        if (key === 'board') params.board = rng.pick(BOARD_SIZES).value;
        else if (key === 'edges') params.edges = rng.pick(['wrap', 'walls']);
        else if (key === 'rate') params.rate = Math.round(rng.range(0.05, 1) * 100) / 100;
        else if (key === 'steps') params.steps = rng.int(1, 8);
        else if (key === 'start') params.start = rng.pick(['noise', 'empty', 'image', 'centre']);
        else if (key === 'states') params.states = rng.int(2, 12);
        else if (key === 'seed') params.seed = rng.int(1, 999);
        else if (key === 'bornMask' || key === 'surviveMask') params[key] = maskOf(Array.from({ length: 9 }, (_, j) => j).filter(() => rng.chance(0.3)));
        else if (key === 'neighbourhood') params.neighbourhood = rng.pick(['moore', 'vonNeumann', 'radius']);
        else if (key === 'radius') params.radius = rng.int(1, 7);
        else if (key === 'bornLo') { params.bornLo = rng.int(2, 30); params.bornHi = rng.int(31, 60); }
        else if (key.startsWith('color') || key === 'glowColor') params[key] = rng.chance(0.5) ? rng.pick(Object.values(COLOUR_TABLE)) : [rng.int(0, 255) / 255, 0.5, 0.25].map(x => Math.round(x * 10000) / 10000);
        else if (key === 'brushState') params.brushState = rng.int(0, 3);
        else if (key === 'template') params.template = rng.pick(['diffusion', 'waves', 'reaction', 'custom']);
        else if (key === 'customU') params.customU = 'mix(u, avg_u, 0.9) * 0.996';
        else if (key === 'shape') params.shape = rng.pick(['box', 'circle']);
        else params[key] = Math.round(rng.range(0, 1) * 1000) / 1000;
      }
      roundTrip(params);
    }
  });
});

describe('grid dialect: the plan\'s examples', () => {
  it('reads them as written', () => {
    expect(printGrid(read('grid count born=3 survive=2,3 board=240 wrap'))).toBe('life');
    expect(read('grid life survive=2,3,4 board=240 walls')).toMatchObject({ surviveMask: maskOf([2, 3, 4]), edges: 'walls', board: '0.125' });
    const bosco = read('grid count neighbours=radius radius=5 shape=box born=34..45 survive=33..57');
    expect(matchingPreset(bosco)).toBe('bosco');
    expect(printGrid(bosco)).toBe('bosco');
    const brian = read('grid stages born=2 survive= states=3');
    expect(matchingPreset(brian)).toBe('briansBrain');
    expect(read('grid smooth waves wave-speed=0.9 damping=0.995 board=480 walls')).toMatchObject({ template: 'waves', waveSpeed: 0.9, board: '0.25', edges: 'walls' });
    expect(read('grid smooth custom u={u + 0.2 * lap_u} v={v} a=0.5')).toMatchObject({ template: 'custom', customU: 'u + 0.2 * lap_u', customV: 'v', knobA: 0.5 });
    expect(read('grid life board=120 speed=1 · colours on=green empty=black')).toMatchObject({ board: '0.0625', rate: 1, color1: COLOUR_TABLE.green, color0: COLOUR_TABLE.black });
    expect(read('life speed=4')).toMatchObject({ rate: 1, steps: 4 });
  });
  it('B/S text reads as a Count rule, and as rule=', () => {
    expect(printGrid(read('B36/S23'))).toBe('highlife');
    expect(printGrid(read('23/3'))).toBe('life');
    expect(printGrid(read('S23/B36'))).toBe('highlife');
    expect(read('grid count rule=B3678/S34678 walls')).toMatchObject({ bornMask: maskOf([3, 6, 7, 8]), edges: 'walls' });
  });
  it('Wireworld as stencils and falling sand as blocks', () => {
    const ww = read('grid patterns states=4\n  stencil .../.1./... → 2\n  stencil .../.2./... → 3\n  stencil .../.3./... → 1 count=1:1..2');
    expect(matchingPreset(ww)).toBe('wireworld');
    const sand = read('grid blocks states=3 · block 11/00 → 00/11 · block 1./0. → 0=/1= @mirror · block 10/*0 → 00/=1 @mirror chance=0.8');
    expect(matchingPreset(sand)).toBe('sand');
    expect(printGrid({ ...sand, blocks: [...(sand.blocks as unknown[]), { before: [2, 0, 0, 0], after: [0, 0, 0, 2], symmetry: 'rotate', chance: 0.5, off: true }] }, { pretty: true }))
      .toBe('grid blocks\n  block 11/00 → 00/11\n  block 1./0. → 0=/1= @mirror\n  block 10/*0 → 00/=1 chance=0.8 @mirror\n  block 20/00 → 00/02 chance=0.5 @turns @off');
  });
  it('stencil and block text runs on the CPU exactly as the preset it reads as (plan test 9)', () => {
    for (const [text, preset] of [
      ['grid patterns states=4 · stencil .../.1./... → 2 · stencil .../.2./... → 3 · stencil .../.3./... → 1 count=1:1..2', PATTERN_PRESETS.wireworld],
      ['grid blocks states=3 · block 11/00 → 00/11 · block 1./0. → 0=/1= @mirror · block 10/*0 → 00/=1 @mirror chance=0.8', BLOCK_PRESETS.sand],
      ['grid blocks states=2 · block 10/00 → 00/01 @turns · block 10/01 → 01/10 @turns · block 11/00 → 00/11 @turns · block 11/10 → 01/11 @turns', BLOCK_PRESETS.gas],
      ['grid patterns states=2 · stencil .../.0./... → 1 count=1:1', PATTERN_PRESETS.crystal],
    ] as const) {
      const a = { ...GRID_DEFAULTS, ...read(text) }, b = { ...GRID_DEFAULTS, ...presetParams(a.ruleType as 'blocks', preset) };
      expect(a.patterns ?? null).toEqual(b.patterns ?? null);
      expect(a.blocks ?? null).toEqual(b.blocks ?? null);
      const rs = (seed: number) => { const r = makeRng(seed); return () => r.next(); };
      // Blocks roll their chance with Math.random: the same rolls for both.
      const run = (p: P) => {
        const r = makeRng(9);
        const spy = vi.spyOn(Math, 'random').mockImplementation(() => r.next());
        let X = cpuSeed(p, 32, 24, rs(5));
        for (let k = 0; k < 12; k++) X = cpuStep(p, X);
        spy.mockRestore();
        return X;
      };
      const A = run(a), B = run(b);
      expect(Array.from(A.a), text).toEqual(Array.from(B.a));
    }
  });
});

describe('grid dialect: mistakes, hints and randomness', () => {
  it('reports mistakes at their place, with "did you mean"', () => {
    const r = parseGrid('grid lief board=240');
    expect(r.errors[0]).toMatchObject({ col: 6 });
    expect(r.errors[0].message).toContain('“life”');
    expect(parseGrid('grid life bord=240').errors[0].message).toContain('“board”');
    expect(parseGrid('stencil .1./... → 2').errors[0].message).toContain('3×3');
    expect(parseGrid('grid life · colours on=grene').errors[0].message).toContain('“green”');
  });
  it('an alias reads with a hint to the preset\'s name', () => {
    const r = parseGrid('grid conway');
    expect(matchingPreset(r.params)).toBe('life');
    expect(r.hints[0].fixes).toEqual(['life']);
  });
  it('without a rule type the text changes the params it is given (the editor)', () => {
    const base = { ...GRID_DEFAULTS, ...presetParams('smooth', SMOOTH_PRESETS.mitosis) };
    const r = parseGrid('board=480 walls', { base });
    expect(r.headed).toBe(false);
    expect(r.params).toMatchObject({ template: 'reaction', feed: 0.0367, board: '0.25', edges: 'walls' });
  });
  it('random values and a leading random, repeatable with a seed', () => {
    const a = parseGrid('grid mitosis feed=random kill=random(0.05..0.06) · seed=7'), b = parseGrid('grid mitosis feed=random kill=random(0.05..0.06) · seed=7');
    expect(a.params.feed).toBe(b.params.feed);
    expect(a.params.feed as number).toBeGreaterThanOrEqual(0.025);
    expect(a.params.kill as number).toBeLessThanOrEqual(0.06);
    expect(a.resolved.map(x => x.key)).toEqual(['feed', 'kill']);
    const r = parseGrid('random grid stages', { seed: 3 });
    expect(r.errors).toEqual([]);
    expect(r.resolved.map(x => x.key)).toEqual(expect.arrayContaining(['born', 'survive', 'states', 'density']));
    // What was drawn prints as plain text that reads back the same.
    expect(norm(read(printGrid(r.params)))).toEqual(norm(r.params));
  });
  it('the header is written only where a name clashes in the Do… bar (§13 decision 6)', () => {
    expect(printGrid(presetParams('count', COUNT_PRESETS.life))).toBe('life');
    expect(printGrid({ ...presetParams('stages', STAGES_PRESETS.swirl) })).toBe('grid swirl');
    expect(printGrid(presetParams('count', COUNT_PRESETS.life), { header: 'always' })).toBe('grid life');
  });
});
