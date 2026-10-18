// @vitest-environment jsdom
/**
 * The Play page audit's round 1, lane B (2026-10-18): one entry point per action (P2),
 * Sound's tabs and its effects' sliders (P9), menus instead of wrapping and "Clear Play
 * setup…" (P15), the rail's labels and its ⌘1–5 order (P18), copy and icons (P22).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

// jsdom has no Worker, so hand tracking would read "not available here": give it one before handFeed loads.
vi.hoisted(() => { if (typeof (globalThis as { Worker?: unknown }).Worker === 'undefined') (globalThis as { Worker?: unknown }).Worker = class {}; });
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { emptyPlayRecord, type PlayRecord } from '../../../types/play';
import { isSyncedEcho, playTempo, syncEchoTempo } from '../../../play/echoTempo';
import { emptyArrangement } from '../../../types/playArrangement';
import { newAudioFxEffect, MASTER_CHAIN } from '../../../types/playAudioFx';
import { COUNT_MAX_MARKS, isCountRange, isLogRange } from '../../ui/rulerMath';
import { isLongHint } from '../../ui/Menu';
import { firstClause } from '../layers/AddLayerMenu';
import { playSetupItems } from '../playSetupMenu';
import { startOverMenuItem } from '../../../play/startOver';
import { HandsChip } from '../HandsChip';
import { RAIL_CATEGORIES, RAIL_CATEGORY_SHORTCUT, RAIL_PAGES } from '../railPages';
import { AF_EFFECTS } from '../../../play/kit/audioFx.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return { host };
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } });

function withEcho(sync: string, bpm = 120, extra: Partial<PlayRecord> = {}): PlayRecord {
  const echo = { ...newAudioFxEffect('echo', 'e1'), sync, bpm };
  return { ...emptyPlayRecord(), audioFx: { chains: { [MASTER_CHAIN]: { on: true, effects: [echo] } } }, ...extra };
}
const echoOf = (p: PlayRecord) => p.audioFx!.chains[MASTER_CHAIN].effects[0];

describe('P9: a synced Echo follows the setup’s tempo', () => {
  it('takes the arrangement’s BPM, else 120', () => {
    expect(playTempo(emptyPlayRecord())).toBe(120);
    expect(playTempo({ ...emptyPlayRecord(), arrangement: emptyArrangement(96) })).toBe(96);
  });

  it('writes the tempo into synced echoes only, and leaves the record alone when nothing changes', () => {
    const p = withEcho('1/8d', 120, { arrangement: emptyArrangement(90) });
    expect(echoOf(syncEchoTempo(p)).bpm).toBe(90);
    const free = withEcho('off', 120, { arrangement: emptyArrangement(90) });
    expect(syncEchoTempo(free)).toBe(free);
    const same = withEcho('1/4', 90, { arrangement: emptyArrangement(90) });
    expect(syncEchoTempo(same)).toBe(same);
    expect(isSyncedEcho({ kind: 'echo', sync: '1/4' })).toBe(true);
    expect(isSyncedEcho({ kind: 'echo', sync: 'off' })).toBe(false);
  });
});

describe('P9: sliders for large and log ranges', () => {
  it('only a small whole-number range gets the count track (a filter’s Hz was a grey bar)', () => {
    const cutoff = AF_EFFECTS.filter.params.find(p => p.key === 'cutoff')!;
    expect(isCountRange(cutoff.step, cutoff.min, cutoff.max)).toBe(false);
    const bits = AF_EFFECTS.distortion.params.find(p => p.key === 'bits')!;
    expect(isCountRange(bits.step, bits.min, bits.max)).toBe(true);
    expect(isCountRange(1, 0, COUNT_MAX_MARKS + 1)).toBe(false);
    expect(isCountRange(0.01, 0, 1)).toBe(false);
  });

  it('a frequency over decades runs on a log scale', () => {
    expect(isLogRange(20, 20000, 'Hz')).toBe(true);
    expect(isLogRange(200, 16000, 'Hz')).toBe(true);
    expect(isLogRange(0, 20, 'Hz')).toBe(false); // the LFO rate starts at 0
    expect(isLogRange(1, 2000, 'ms')).toBe(false);
  });
});

describe('P9: Sound’s tabs', () => {
  it('are Arrangement and Effects (not Sound inside Sound)', () => {
    const sound = RAIL_CATEGORIES.find(c => c.id === 'engine')!;
    expect(sound.label).toBe('Sound');
    expect(sound.pages.map(p => RAIL_PAGES[p].label)).toEqual(['Arrangement', 'Effects']);
  });
});

describe('P18: the rail reads in its shortcuts’ order', () => {
  it('Controls, Layers, Rules, Finish, Sound is ⌘1–5', () => {
    expect(RAIL_CATEGORIES.map(c => c.label)).toEqual(['Controls', 'Layers', 'Rules', 'Finish', 'Sound']);
    expect(RAIL_CATEGORIES.map(c => RAIL_CATEGORY_SHORTCUT[c.id])).toEqual(['cmd+1', 'cmd+2', 'cmd+3', 'cmd+4', 'cmd+5']);
  });
});

describe('P2/P15: the Play setup menu', () => {
  it('holds Open, Import, Export, Put it on a website and Clear Play setup, in that order', () => {
    const labels = playSetupItems({ close: () => {}, anchor: null }).map(it => (typeof it === 'string' ? it : 'label' in it ? it.label.replace(' (Pro)', '') : it.heading));
    expect(labels).toEqual(['Open Play setup…', 'Import .play…', 'Export .play…', 'Put it on a website…', 'separator', 'Clear Play setup…']);
  });

  it('“Start over…” is now “Clear Play setup…”, still a danger item', () => {
    const it = startOverMenuItem(() => {});
    expect(it).toMatchObject({ label: 'Clear Play setup…', danger: true });
  });

  it('Export is off until there is a control', () => {
    const exp = playSetupItems({ close: () => {}, anchor: null }).find(it => typeof it !== 'string' && 'label' in it && it.label === 'Export .play…');
    expect(exp && typeof exp !== 'string' && 'label' in exp && exp.disabled).toBe(true);
  });
});

describe('P2: Enable hand tracking shows in one place', () => {
  const enableButton = (host: HTMLElement) => Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Enable');
  it('the chip offers Enable by default', () => {
    const { host } = mount(<HandsChip settings={false} />);
    expect(enableButton(host)).toBeTruthy();
  });
  it('and not where the picture’s pill already does', () => {
    const { host } = mount(<HandsChip settings={false} enable={false} />);
    expect(enableButton(host)).toBeFalsy();
    expect(host.textContent).toContain('Hands: off');
  });
});

describe('P22: copy', () => {
  it('a menu hint of four words or more goes under the label, a shortcut stays beside it', () => {
    expect(isLongHint('Fast and jittery: a tremble')).toBe(true);
    expect(isLongHint('A new value every frame')).toBe(true);
    expect(isLongHint('⌘K')).toBe(false);
    expect(isLongHint('Rotation 0°')).toBe(false);
    expect(isLongHint(undefined)).toBe(false);
  });

  it('an Add layer row shows its description’s first clause', () => {
    expect(firstClause('Boxes, circles, lines or drawn outlines: to see, and as walls, emitters.')).toBe('Boxes, circles, lines or drawn outlines');
    expect(firstClause('A picture of your own, blended or matted.')).toBe('A picture of your own, blended or matted');
    expect(firstClause('Holds 0.5 of it. Then more.')).toBe('Holds 0.5 of it');
    expect(firstClause(undefined)).toBe('');
  });
});
