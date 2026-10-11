/**
 * The language's help (lang/help.ts): every word of every dialect in a section with a description,
 * the scene's sections in the documented order, what helpAt finds under the pointer (a head, a
 * setting with its type, a value with its alternatives), the Do… bar's plain sentences, and when
 * the hover help opens and closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});

import { HOVER_DELAY_MS, HOVER_GRACE_MS, helpAt, helpEntries, helpEntry, helpSections, hoverIntent, plainSentence, typeLabel } from '../help';
import { entriesFor, type Dialect } from '../registry';
import { RECIPE_WORDS, parseRecipe } from '../../sceneBuilder/recipe';
import { readLine } from '../run';

const DIALECTS: Dialect[] = ['scene', 'picture', 'edit', 'grid', 'agents', 'pass'];

describe('help sections', () => {
  it('the 3D scene\'s sections, in order', () => {
    expect(helpSections('scene').map(s => s.title)).toEqual(['Modes', 'Combine', 'Shapes', 'Warps', 'Settings', 'Camera', 'Colours', 'Output']);
    expect(helpSections('scene').find(s => s.id === 'modes')!.entries.map(e => e.word)).toEqual(['surface', 'volumetric', 'glass', 'gi']);
  });

  it('every section has a plain description and at least one entry', () => {
    for (const d of DIALECTS) for (const s of helpSections(d)) {
      expect(s.blurb.length, `${d}/${s.id}`).toBeGreaterThan(20);
      expect(s.entries.length, `${d}/${s.id}`).toBeGreaterThan(0);
    }
  });

  it('every registry word of every dialect is in exactly one section, with a description, an example and typed settings', () => {
    for (const d of DIALECTS) {
      const ids = helpEntries(d).map(e => e.id);
      expect(new Set(ids).size, d).toBe(ids.length);
      for (const e of entriesFor(d)) expect(ids, `${d}: ${e.id}`).toContain(e.id);
      for (const e of helpEntries(d)) {
        expect(e.section, e.id).toBeTruthy();
        expect(e.summary.trim().length, e.id).toBeGreaterThan(3);
        expect(e.more.trim().length, e.id).toBeGreaterThanOrEqual(e.summary.trim().length);
        expect(e.example.trim(), e.id).not.toBe('');
        for (const p of e.params) {
          expect(p.type, `${e.id}.${p.key}`).toBeTruthy();
          expect(p.hint, `${e.id}.${p.key}`).toBeTruthy();
        }
      }
    }
  });

  it('every 3D example reads cleanly, and so does every Grid Rules line', () => {
    for (const e of helpEntries('scene')) {
      const r = parseRecipe(e.example, { seed: 1 });
      expect(r.errors.map(x => x.message), `${e.id}: ${e.example}`).toEqual([]);
    }
    // Agent rules' examples are fragments of a rule set; grid lines stand alone.
    for (const d of ['grid'] as Dialect[]) for (const e of helpEntries(d)) {
      if (!e.example.startsWith('grid')) continue;
      expect(readLine(e.example, { seed: 1 }).errors.map(x => x.message), `${e.id}: ${e.example}`).toEqual([]);
    }
  });

  it('no 3D recipe keyword is without an entry', () => {
    const words = [...Object.keys(RECIPE_WORDS.modes), ...Object.keys(RECIPE_WORDS.ops), ...Object.keys(RECIPE_WORDS.shapes), ...Object.keys(RECIPE_WORDS.warps), ...RECIPE_WORDS.settings, 'random', 'seed'];
    for (const w of words) {
      const e = helpEntry('scene', w) ?? helpAt('scene', `${w} by depth`, 0)?.entry;
      expect(e, w).toBeTruthy();
      expect(e!.section, w).toBeTruthy();
      expect(e!.more.length, w).toBeGreaterThan(10);
    }
  });

  it('modes, combines, settings and the camera have written explanations', () => {
    for (const w of ['surface', 'volumetric', 'glass', 'gi', 'union', 'smooth-union', 'subtract', 'intersect', 'sun', 'fog', 'shadows', 'camera', 'output'])
      expect(helpEntry('scene', w)!.more.length, w).toBeGreaterThan(helpEntry('scene', w)!.summary.length + 20);
  });

  it('shapes with dimensions explain linked size and show it in their example', () => {
    const box = helpEntry('scene', 'box')!;
    expect(box.more).toMatch(/size=0.5 sets the width, height and depth/);
    expect(box.example).toContain('width=');
    expect(box.params.map(p => p.key)).toEqual(expect.arrayContaining(['size', 'width', 'height', 'depth']));
    expect(helpEntry('scene', 'cylinder')!.params.map(p => p.key)).toContain('size');
  });

  it('types read as words', () => {
    expect(typeLabel({ type: 'vec3' })).toMatch(/^3 numbers/);
    expect(typeLabel({ type: 'colour' })).toBe('colour');
    expect(typeLabel({ type: 'angle' })).toBe('angle (degrees)');
    expect(typeLabel({ type: 'choice', options: ['x', 'y'] })).toBe('one of x, y');
    const at = helpEntry('scene', 'box')!.params.find(p => p.key === 'at')!;
    expect(at.type).toMatch(/3 numbers/);
    expect(helpEntry('scene', 'box')!.params.find(p => p.key === 'width')!.range).toBe('0.01 to 5');
  });
});

describe('helpAt', () => {
  const at = (d: Dialect, text: string, word: string, nth = 0) => {
    let i = -1;
    for (let k = 0; k <= nth; k++) i = text.indexOf(word, i + 1);
    return helpAt(d, text, i + 1);
  };

  it('a mode, with the other modes to switch to', () => {
    const h = at('scene', 'volumetric density=0.04 · box', 'volumetric')!;
    expect(h.kind).toBe('entry');
    expect(h.entry.section).toBe('modes');
    expect(h.alternatives.map(a => a.text)).toEqual(['surface', 'glass', 'gi']);
    expect([h.from, h.to]).toEqual([0, 10]);
  });

  it('a setting and its type', () => {
    const h = at('scene', 'volumetric density=0.04 · box', 'density')!;
    expect(h.kind).toBe('param');
    expect(h.param!.key).toBe('density');
    expect(h.param!.type).toBe('number');
    const f = at('scene', 'smooth-intersect( schwarz-p freq=3, box ) k=0.2', 'freq')!;
    expect(f.entry.word).toBe('schwarz-p');
    expect(f.param!.key).toBe('freq');
    const k = at('scene', 'smooth-intersect( schwarz-p freq=3, box ) k=0.2', 'k=')!;
    expect(k.entry.word).toBe('smooth-intersect');
    const s = at('scene', 'box-frame size=(1,2,3)', 'size')!;
    expect(s.param!.type).toMatch(/3 numbers/);
    expect(at('scene', 'sun dir=(1,2,1)', 'dir')!.param!.type).toMatch(/3 numbers/);
    expect(at('scene', 'camera dist=4 orbit=10', 'orbit')!.entry.section).toBe('camera');
    expect(at('scene', 'box @twist(k=2)', 'k')!.entry.word).toBe('twist');
  });

  it('a value, with its choices', () => {
    const c = at('scene', 'box color=gold', 'gold')!;
    expect(c.kind).toBe('value');
    expect(c.param!.key).toBe('color');
    expect(c.alternatives.some(a => a.text === 'teal' && a.swatch)).toBe(true);
    const o = at('scene', 'sphere · output depth', 'depth')!;
    expect(o.kind).toBe('value');
    expect(o.alternatives.map(a => a.text)).toContain('normal');
    const t = at('scene', 'sphere · tone agx', 'agx')!;
    expect(t.alternatives.map(a => a.text)).toContain('aces');
  });

  it('a shape\'s glass flag, a warp after @, colour by', () => {
    expect(at('scene', 'sphere glass', 'glass')!.entry.id).toBe('colours:glass');
    expect(at('scene', 'glass · sphere', 'glass')!.entry.id).toBe('scene:glass');
    expect(at('scene', 'box @twist(2)', 'twist')!.entry.section).toBe('warps');
    expect(at('scene', 'sphere · colour by depth', 'colour')!.entry.word).toBe('colour by');
  });

  it('other dialects', () => {
    expect(at('grid', 'grid life walls board=480', 'life')!.entry.section).toBe('presets');
    expect(at('grid', 'grid life walls board=480', 'board')!.param!.options).toContain('960');
    expect(at('picture', 'circle · glow falloff=8', 'glow')!.entry.section).toBe('shape-it');
    expect(at('picture', 'circle · glow falloff=8', 'falloff')!.kind).toBe('param');
    expect(at('picture', 'create ring', 'create')!.entry.section).toBe('edits');
  });

  it('nothing on a space or a bracket', () => {
    expect(helpAt('scene', 'box  sphere', 4)).toBeNull();
    expect(helpAt('scene', 'union( box )', 5)).not.toBeNull(); // the end of "union"
    expect(helpAt('scene', 'union( box )', 6)).toBeNull();
  });
});

describe('plain sentences', () => {
  it('reads a suggestion as what it will do', () => {
    expect(plainSentence({ label: 'create', kind: 'setting', detail: 'Adds a shape (with its UV) or any node by name. Modifiers after it…' })).toBe('adds a shape (with its UV) or any node by name');
    expect(plainSentence({ label: 'circle', kind: 'shape', detail: 'Circle SDF' })).toBe('adds a circle (Circle SDF)');
    expect(plainSentence({ label: 'circle', kind: 'shape', detail: 'A circle (a distance, with a UV in front).' })).toBe('adds a circle (a distance, with a UV in front)');
    expect(plainSentence({ label: 'falloff', kind: 'param', detail: 'Falloff (default 8)' })).toBe('sets falloff (default 8)');
    expect(plainSentence({ label: 'r', kind: 'param', detail: 'Radius: 0.3' })).toBe('sets r (radius: 0.3)');
    expect(plainSentence({ label: 'blur', kind: 'action', detail: 'Blur: softens it. More words.' })).toBe('blur: softens it');
  });
});

describe('hover intent', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const make = () => {
    const log: string[] = [];
    const h = hoverIntent<string>({ onOpen: t => log.push(`open ${t}`), onClose: () => log.push('close') });
    return { h, log };
  };

  it('opens only after the pointer rests on a word', () => {
    const { h, log } = make();
    h.over('a', 'A');
    vi.advanceTimersByTime(HOVER_DELAY_MS - 50);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(log).toEqual(['open A']);
    expect(h.openKey).toBe('a');
  });

  it('passing over words opens nothing; resting on another starts again', () => {
    const { h, log } = make();
    h.over('a', 'A'); vi.advanceTimersByTime(200);
    h.over('b', 'B'); vi.advanceTimersByTime(200);
    h.out(); vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(log).toEqual([]);
    h.over('c', 'C'); vi.advanceTimersByTime(HOVER_DELAY_MS + 1);
    expect(log).toEqual(['open C']);
  });

  it('stays open while the pointer moves from the word into the help, and closes after leaving both', () => {
    const { h, log } = make();
    h.over('a', 'A'); vi.advanceTimersByTime(HOVER_DELAY_MS + 1);
    h.out(); vi.advanceTimersByTime(HOVER_GRACE_MS - 50);
    h.enterPopover(); vi.advanceTimersByTime(HOVER_GRACE_MS * 5);
    expect(log).toEqual(['open A']);
    h.leavePopover(); vi.advanceTimersByTime(HOVER_GRACE_MS + 1);
    expect(log).toEqual(['open A', 'close']);
    expect(h.openKey).toBeNull();
  });

  it('closes after the grace when the pointer leaves the word for nothing', () => {
    const { h, log } = make();
    h.over('a', 'A'); vi.advanceTimersByTime(HOVER_DELAY_MS + 1);
    h.out(); vi.advanceTimersByTime(HOVER_GRACE_MS + 1);
    expect(log).toEqual(['open A', 'close']);
  });

  it('moving back onto the same word keeps it open; resting on another word swaps it', () => {
    const { h, log } = make();
    h.over('a', 'A'); vi.advanceTimersByTime(HOVER_DELAY_MS + 1);
    h.out(); vi.advanceTimersByTime(100); h.over('a', 'A'); vi.advanceTimersByTime(HOVER_GRACE_MS * 3);
    expect(log).toEqual(['open A']);
    h.over('b', 'B'); vi.advanceTimersByTime(HOVER_DELAY_MS + 1);
    expect(log.slice(-1)).toEqual(['open B']);
    expect(h.openKey).toBe('b');
  });

  it('close() shuts it at once and cancels a pending open', () => {
    const { h, log } = make();
    h.over('a', 'A'); vi.advanceTimersByTime(HOVER_DELAY_MS + 1);
    h.close();
    h.over('b', 'B'); h.close(); vi.advanceTimersByTime(HOVER_DELAY_MS * 2);
    expect(log).toEqual(['open A', 'close']);
  });
});
