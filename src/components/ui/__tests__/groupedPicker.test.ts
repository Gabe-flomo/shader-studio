/** GroupedPicker's pure parts (search, key moves, type-ahead) and the Play pickers' sections built on it. */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import {
  countItems, filterSections, findItem, moveActive, navigableValues, sectionsFromOptions, typeahead, type PickerSection,
} from '../groupedPickerModel';
import { HAND_POINT_SECTIONS, sourcePickerSections, triggerKindSections } from '../../play/sourcePickerSections';
import { HAND_POINT_OPTIONS, OPEN_READERS, SOURCE_TYPES, TRIGGER_KINDS } from '../../../play/playSources';
import { FREE_TRIGGER_ONS, sourceTypeNeedsPro } from '../../../play/planGates';

const SECTIONS: PickerSection[] = [
  { heading: 'Pointer', items: [{ value: 'mx', label: 'Mouse X' }, { value: 'my', label: 'Mouse Y' }, { value: 'mb', label: 'Mouse button', disabled: true }] },
  { heading: 'Generators', items: [{ value: 'lfo', label: 'LFO', description: 'Sine or saw' }, { value: 'noise', label: 'Noise', keywords: 'random' }] },
  { heading: 'Empty', items: [] },
];

describe('filtering', () => {
  it('keeps every non-empty section for an empty query', () => {
    expect(filterSections(SECTIONS, '  ').map(s => s.heading)).toEqual(['Pointer', 'Generators']);
  });
  it('matches label, description, keywords and heading, every word, any case', () => {
    expect(navigableValues(filterSections(SECTIONS, 'mouse'))).toEqual(['mx', 'my']);
    expect(navigableValues(filterSections(SECTIONS, 'SAW'))).toEqual(['lfo']);
    expect(navigableValues(filterSections(SECTIONS, 'random'))).toEqual(['noise']);
    expect(navigableValues(filterSections(SECTIONS, 'generators'))).toEqual(['lfo', 'noise']);
    expect(navigableValues(filterSections(SECTIONS, 'mouse y'))).toEqual(['my']);
    expect(filterSections(SECTIONS, 'zzz')).toEqual([]);
  });
  it('drops sections with nothing left', () => {
    expect(filterSections(SECTIONS, 'lfo').map(s => s.heading)).toEqual(['Generators']);
  });
});

describe('keys', () => {
  const values = navigableValues(SECTIONS);
  it('walks items only, skipping headings and disabled rows', () => {
    expect(values).toEqual(['mx', 'my', 'lfo', 'noise']);
  });
  it('arrows wrap and start from the ends', () => {
    expect(moveActive(values, 'my', 'ArrowDown')).toBe('lfo');
    expect(moveActive(values, 'noise', 'ArrowDown')).toBe('mx');
    expect(moveActive(values, 'mx', 'ArrowUp')).toBe('noise');
    expect(moveActive(values, null, 'ArrowDown')).toBe('mx');
    expect(moveActive(values, null, 'ArrowUp')).toBe('noise');
  });
  it('Home, End and the page keys stop at the ends', () => {
    expect(moveActive(values, 'lfo', 'Home')).toBe('mx');
    expect(moveActive(values, 'mx', 'End')).toBe('noise');
    expect(moveActive(values, 'mx', 'PageDown')).toBe('noise');
    expect(moveActive(values, 'noise', 'PageUp')).toBe('mx');
    expect(moveActive([], 'mx', 'ArrowDown')).toBeNull();
  });
  it('type-ahead finds a prefix and cycles on a repeated letter', () => {
    expect(typeahead(SECTIONS, null, 'n')).toBe('noise');
    expect(typeahead(SECTIONS, null, 'mo')).toBe('mx');
    expect(typeahead(SECTIONS, 'mx', 'mouse y')).toBe('my');
    expect(typeahead(SECTIONS, 'mx', 'm')).toBe('my');
    expect(typeahead(SECTIONS, 'my', 'mm')).toBe('mx'); // the disabled Mouse button is skipped
    expect(typeahead(SECTIONS, 'mx', 'q')).toBeNull();
  });
  it('finds an item anywhere and counts them all', () => {
    expect(findItem(SECTIONS, 'noise')?.label).toBe('Noise');
    expect(findItem(SECTIONS, 'nope')).toBeUndefined();
    expect(countItems(SECTIONS)).toBe(5);
  });
  it('turns grouped select options into sections', () => {
    const s = sectionsFromOptions([{ value: 'a', label: 'A', group: 'Layers' }, { value: 'b', label: 'B', group: 'Layers' }, { value: 'h', label: 'H', group: 'Hands' }]);
    expect(s.map(x => [x.heading, x.items.map(i => i.value)])).toEqual([['Layers', ['a', 'b']], ['Hands', ['h']]]);
  });
});

describe('the Play pickers', () => {
  const readers = [{ id: 'k', name: 'Kick' }, { id: 'h', name: 'Hi-hat' }];
  it('lists every source type once (the hidden Data apart), and the readers and the panel entry under Live audio', () => {
    const values = navigableValues(sourcePickerSections(readers, false));
    expect(new Set(values).size).toBe(values.length);
    expect([...values].filter(v => !v.startsWith('reader')).sort()).toEqual(SOURCE_TYPES.map(t => t.value).filter(v => v !== 'data').sort());
    const live = sourcePickerSections(readers, false).find(s => s.heading === 'Live audio')!;
    expect(live.items.map(i => i.label)).toEqual(['Audio band', 'Reader · Kick', 'Reader · Hi-hat', 'Spectrum readers…', 'Audio Input node band']);
    expect(live.items.some(i => i.value === OPEN_READERS)).toBe(true);
  });
  it('marks Pro only when locked, and only on Pro source types', () => {
    expect(navigableValues(sourcePickerSections(readers, false)).every(v => !findItem(sourcePickerSections(readers, false), v)?.pro)).toBe(true);
    const locked = sourcePickerSections(readers, true);
    for (const s of locked) for (const it of s.items) expect(!!it.pro).toBe(sourceTypeNeedsPro(it.value));
  });
  it('has every trigger kind once, Pro where Free can’t fire from it', () => {
    const s = triggerKindSections(true);
    expect(navigableValues(s).sort()).toEqual(TRIGGER_KINDS.map(k => k.value).sort());
    for (const sec of s) for (const it of sec.items) expect(!!it.pro).toBe(!FREE_TRIGGER_ONS.has(it.value as never));
  });
  it('has all 21 hand points', () => {
    expect(navigableValues(HAND_POINT_SECTIONS).sort()).toEqual(HAND_POINT_OPTIONS.map(o => o.value).sort());
    expect(HAND_POINT_SECTIONS[0].items).toHaveLength(5);
  });
});
