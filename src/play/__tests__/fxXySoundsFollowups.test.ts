/**
 * Follow-ups to audio effects, pairs and drum pads: effect numbers as targets
 * everywhere (Map…, Add control, condition values), the XY pad in the website
 * player's panel, the pad grid's last pad as a position, and drum pad samples
 * as Sounds (the Library and the Files page).
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { strFromU8 } from 'fflate';

const store = vi.hoisted(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = globalThis;
  g.dispatchEvent = () => true;
  const store = new Map<string, string>();
  g.localStorage = {
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  return store;
});

import { addVideoFile, listVideos, resetBackgroundCache, VIDEOS_MANIFEST, wavePeaks } from '../../lib/backgroundLibrary';
import { describeVideoUses } from '../../lib/videoUsage';
import { soundsSource, videosSource } from '../../files/videosSource';
import { buildInventory } from '../../files/inventory';
import { localMutableKV } from '../../files/mutate';
import { listExternal } from '../../files/sources';
import { externalPart } from '../../files/profileZip';
import { audioFxControlFor, audioFxHosts, audioFxTarget, newAudioFxEffect, type PlayAudioFx } from '../../types/playAudioFx';
import { defaultLayer, emptyPlayRecord, PAD_ANCHOR, type PlayControl, type PlayLayer, type PlayRecord } from '../../types/play';
import { mapSourceTo } from '../../components/play/layerOps';
import { valueRange, valueSections } from '../../components/play/ConditionFields';
import { sgParseValueRef } from '../kit/signals.js';
import { anchorLabel, valueRefLabel } from '../playSources';
import { playEngine } from '../../lib/playEngine';
import { padGrid } from '../../lib/padGrid';
import { midiEngine } from '../../lib/midiEngine';
import { DEFAULT_PAD_GRID } from '../../types/playMidi';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';

function freshBrowser() {
  store.clear();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetBackgroundCache();
}
beforeEach(freshBrowser);

// ── Audio effect numbers as targets ─────────────────────────────────────────

const echo = { ...newAudioFxEffect('echo', 'ec_1'), feedback: 0.4 };
const fx: PlayAudioFx = { chains: { 'layer:song': { on: true, effects: [echo] }, master: { on: true, effects: [newAudioFxEffect('filter', 'fl_1')] } } };
const song = { ...defaultLayer('audio', 'song', 'Song') } as PlayLayer;
const record = (): PlayRecord => ({ ...emptyPlayRecord(), layers: [song], audioFx: fx });
const FEEDBACK = audioFxTarget('layer:song', 'ec_1', 'feedback');

describe('audio effect numbers as targets', () => {
  it('lists every effect with its chain’s name and its shown numbers', () => {
    const hosts = audioFxHosts(fx, [song]);
    expect(hosts.map(h => [h.id, h.label])).toEqual([['audiofx:layer:song:ec_1', 'Song · Echo'], ['audiofx:master:fl_1', 'Master · Filter']]);
    // Echo without sync shows its time, not its tempo.
    expect(hosts[0].params.map(p => p.key)).toContain('time');
    expect(hosts[0].params.map(p => p.key)).not.toContain('bpm');
    expect(audioFxControlFor(fx, [song], FEEDBACK)).toMatchObject({ target: FEEDBACK, kind: 'float', label: 'Song · Echo · Feedback' });
    expect(audioFxControlFor(fx, [song], audioFxTarget('layer:song', 'gone', 'feedback'))).toBeNull();
  });

  it('Map… makes the control (once) and the mapping', () => {
    const src = { kind: 'mouse' as const, axis: 'x' as const };
    const r = mapSourceTo(record(), src, { audioFx: FEEDBACK });
    expect(r.control).toMatchObject({ target: FEEDBACK, label: 'Song · Echo · Feedback' });
    expect(r.play.mappings).toHaveLength(1);
    const again = mapSourceTo(r.play, src, { audioFx: FEEDBACK });
    expect(again.play.controls.filter(c => c.target === FEEDBACK)).toHaveLength(1);
    expect(again.play.mappings).toHaveLength(2);
  });

  it('is a condition value: picked, parsed, labelled, ranged and read', () => {
    const play = record();
    const sound = valueSections(play).find(s => s.heading === 'Sound effects')!;
    expect(sound.items.map(i => i.value)).toContain(FEEDBACK);
    expect(sgParseValueRef(FEEDBACK)).toEqual({ kind: 'prop', layerId: 'audiofx:layer:song:ec_1', key: 'feedback' });
    expect(sgParseValueRef('audiofx:master')).toBeNull();
    expect(valueRefLabel(FEEDBACK, { layers: play.layers, audioFx: play.audioFx })).toBe('Song · Echo · Feedback');
    const range = valueRange(FEEDBACK, play);
    expect(range.max).toBeGreaterThan(range.min);
    playEngine.setRecord(play);
    expect(playEngine.readValue(FEEDBACK)).toBeCloseTo(0.4);
    playEngine.setRecord(emptyPlayRecord());
  });
});

// ── The pad grid's last pad as a position ───────────────────────────────────

describe('the pad grid’s last pad as a position', () => {
  it('has no position before a hit, then the pad’s column across and row up', () => {
    expect(anchorLabel(PAD_ANCHOR)).toBe('Pad grid · last pad');
    padGrid.setConfig({ ...DEFAULT_PAD_GRID, mode: 'hold', release: 1 });
    padGrid.tickInputs(0, 1);
    expect(playEngine.anchorAt(PAD_ANCHOR)).toBeNull();
    midiEngine.handleBytes(0x90, 36 + 8 * 2 + 3, 127, 'Push'); // pad (3, 2)
    padGrid.tickInputs(0, 2);
    const p = playEngine.anchorAt(PAD_ANCHOR)!;
    expect(p.x).toBeCloseTo(3 / 7);
    expect(p.y).toBeCloseTo(2 / 7);
    midiEngine.handleBytes(0x80, 36 + 8 * 2 + 3, 0, 'Push');
    padGrid.setConfig(undefined);
  });
});

// ── The XY pad in the website player's panel ───────────────────────────────

class El {
  tagName: string; children: El[] = []; style: Record<string, string> = {}; className = ''; textContent = ''; innerHTML = ''; parentElement: El | null = null;
  width = 300; height = 150; clientWidth = 400; clientHeight = 300; value = ''; disabled = false; dataset = {}; type = '';
  classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  [k: string]: unknown;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...c: El[]) { for (const e of c) { if (typeof e !== 'object') continue; e.parentElement = this; this.children.push(e); } }
  appendChild(c: El) { this.append(c); return c; }
  prepend(...c: El[]) { this.append(...c); }
  replaceChildren(...c: El[]) { this.children = []; this.append(...c); }
  remove() {} setAttribute() {} removeAttribute() {} addEventListener() {} removeEventListener() {} setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  querySelector() { return null; } querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return new Proxy({}, { get: (_t, k: string) => (/^[A-Z0-9_]+$/.test(k) ? 1 : k === 'getShaderParameter' || k === 'getProgramParameter' ? () => true : k === 'checkFramebufferStatus' ? () => 1 : k === 'getExtension' ? () => ({}) : () => ({})) });
  }
}
const find = (e: El, cls: string): El[] => [...(e.className.split(' ').includes(cls) ? [e] : []), ...e.children.flatMap(c => find(c, cls))];

describe('the website player’s panel', () => {
  it('shows a position pair as one XY pad that sets both values', () => {
    const ctl = (id: string, over: Partial<PlayControl> = {}): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1, ...over });
    const play: PlayRecord = {
      ...emptyPlayRecord(),
      controls: [ctl('px', { label: 'Pos X', min: -1, max: 1 }), ctl('py', { label: 'Pos Y' }), ctl('amt', { label: 'Amount' })],
      pairs: [{ id: 'p', label: 'Pos', a: 'px', b: 'py', position: true }],
    };
    const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
    const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
    const noop = class { observe() {} disconnect() {} };
    const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
    fn(win, doc, {}, () => 1, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
    const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { get(id: string): { value: number; driven: boolean } | null } };
    const root = new El('div');
    const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, { type: 'float', value: 0 }]));
    const h = api.mount(root, { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`])), play, aspect: { id: 'free', ratio: null } }, { mode: 'player' });
    const pads = find(root, 'ssp-xy');
    expect(pads).toHaveLength(1);
    // One row for the pair (named after it) and one slider for the lone control.
    const labels = find(root, 'ssp-label').map(e => e.textContent);
    expect(labels).toContain('Pos');
    expect(labels).not.toContain('Pos Y');
    expect(find(root, 'ssp-range')).toHaveLength(1);
    // Press three quarters across and a quarter down: X is 0.5 of −1..1, Y is 0.75.
    (pads[0].onpointerdown as (e: unknown) => void)({ clientX: 300, clientY: 75, pointerId: 1 });
    expect(h.get('px')!.value).toBeCloseTo(0.5);
    expect(h.get('py')!.value).toBeCloseTo(0.75);
  });
});

// ── Sounds ───────────────────────────────────────────────────────────────────

const wav = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'audio/wav' });
const webm = (...n: number[]) => new Blob([new Uint8Array(n)], { type: 'video/webm' });
const padsSetup = (sampleId: string) => JSON.stringify({ nodes: [{ id: 'o', type: 'output' }], version: 1, savedAt: 1, play: { ...emptyPlayRecord(), layers: [{ ...defaultLayer('drumpad', 'd', 'Kit'), pads: [{ sampleId, fileName: 'kick.wav', bytes: 3 }] }] } });

describe('drum pad samples as Sounds', () => {
  it('lists sounds and videos apart on the Files page, with who uses a sound', async () => {
    const v = await addVideoFile(webm(1), { name: 'Clip' });
    const s = await addVideoFile(wav(1, 2, 3), { name: 'Kick' });
    const u = await addVideoFile(wav(4), { name: 'Spare' });
    store.set('shader-studio:Beat', padsSetup(s.id));
    expect((await videosSource.list()).map(i => i.id)).toEqual([v.id]);
    expect((await soundsSource.list()).map(i => i.label).sort()).toEqual(['Kick', 'Spare']);
    const inv = await buildInventory(localMutableKV, { external: await listExternal([videosSource, soundsSource]) });
    const kick = inv.byId.get(`ext:sounds:${s.id}`)!;
    expect(kick).toMatchObject({ size: 3, detail: 'WAV' });
    expect(kick.usedBy).toEqual([{ id: 'graph:Beat', label: 'Beat', where: 'A drum pad in its Play setup', breaks: true }]);
    expect(inv.byId.get(`ext:sounds:${u.id}`)!.unused).toBeTruthy();
  });

  it('carries both in one ZIP manifest, and each installs only its own kind', async () => {
    const v = await addVideoFile(webm(1), { name: 'Clip' });
    const s = await addVideoFile(wav(1, 2), { name: 'Kick' });
    const part = await externalPart(null, [videosSource, soundsSource]);
    const ids = JSON.parse(strFromU8(part.files[VIDEOS_MANIFEST])).videos.map((x: { id: string }) => x.id);
    expect(ids.sort()).toEqual([v.id, s.id].sort());
    expect((await soundsSource.preview(part.files)).map(x => x.id)).toEqual([s.id]);
    freshBrowser();
    expect(await soundsSource.install(part.files, 'merge')).toEqual({ added: 1, same: 0 });
    expect((await listVideos()).map(x => x.name)).toEqual(['Kick']);
    expect(await videosSource.install(part.files, 'replace')).toEqual({ added: 1, same: 0 });
    // Replacing the videos leaves the sounds.
    expect((await listVideos()).map(x => x.name).sort()).toEqual(['Clip', 'Kick']);
  });

  it('draws a waveform from the loudest level in each slice, and names pads in warnings', () => {
    expect(wavePeaks([0, 0.5, -1, 0.25, 0, 0.1], 3)).toEqual([0.5, 1, 0.1]);
    expect(wavePeaks([], 2)).toEqual([0, 0]);
    expect(describeVideoUses([{ kind: 'graph', label: 'Beat', layers: 2 }], ['A drum pad', 'drum pads'])).toBe('2 drum pads in “Beat” use it.');
  });
});
