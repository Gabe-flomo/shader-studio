/**
 * The Live connector end to end without Live: the fake Live (tools/fake-live.mjs) speaks the
 * script's OSC; liveClient assembles the catalogue, keeps values and the transport, asks for the
 * catalogue and re-sends its watch list when the script appears; the Play engine reads Live
 * parameters, follows Live's beat, fires clip and scene triggers and learns a clicked parameter;
 * Do in Live reactions send commands the fake answers; records keep it all through a save.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { FakeLive } from '../../../tools/fake-live.mjs';
import { decodeOsc, encodeOsc } from '../osc/decode.js';
import { liveClient } from '../liveClient';
import { commandMessage, liveColour, LIVE_CONNECTOR_VERSION, LiveState, splitLiveKey } from '../live/liveProtocol';
import { playEngine } from '../playEngine';
import { inputBus } from '../inputBus';
import { liveCommandOf, liveDoText } from '../liveActions';
import { compileGraph } from '../../compiler/graphCompiler';
import { readBaseValues } from '../../play/playControls';
import { parsePlayRecord, type PlayRecord } from '../../types/play';
import { liveClipKeys, liveSceneKeys, triggerKey } from '../../play/triggers';
import { sourceLabel, triggerLabel } from '../../play/playSources';
import { LIVE_HEADING, liveSection, mapPickerSections, parseMapPick } from '../../components/play/mapPicker';
import type { GraphNode } from '../../types/nodeGraph';

const ROOT = resolve(__dirname, '../../..');
type Msg = { address: string; args: Array<number | string | boolean> };
const msgs = (packets: Uint8Array[]): Msg[] => packets.flatMap(p => decodeOsc(p).map(m => ({ address: m.address, args: m.args.filter((x): x is number | string | boolean => x !== null) })));

let sent: Msg[];
let now: number;
function feed(packets: Uint8Array[], at = now): void { for (const m of msgs(packets)) liveClient.inject(m, at); }

beforeEach(() => {
  liveClient.resetForTests();
  sent = [];
  now = 1000;
  liveClient.now = () => now;
  liveClient.sendHook = (address, args) => sent.push({ address, args: args as Msg['args'] });
});
afterEach(() => { liveClient.resetForTests(); });

describe('the protocol', () => {
  it('assembles the fake set’s catalogue from bundles, with the Playfield rack’s macros and every value', () => {
    const live = new FakeLive();
    const state = new LiveState();
    const packets = live.catalog(0);
    for (const p of packets) expect(p.length).toBeLessThan(8000);
    for (const m of msgs(packets)) state.apply(m, 0);
    expect(state.catalogGen).toBe(1);
    expect(state.tracks.map(t => `${t.name}:${t.kind}`)).toEqual(['Drums:track', 'Bass:track', 'Pad:track', 'A-Reverb:return', 'Master:master']);
    expect(state.scenes.map(s => s.name)).toEqual(['Intro', 'Verse', 'Drop']);
    expect(state.rackParams().map(p => p.name).slice(0, 2)).toEqual(['Filter sweep', 'Glow']);
    const type = state.params.get('Bass / Auto Filter / Filter Type')!;
    expect(type.quantized).toBe(true);
    expect(type.items).toEqual(['Lowpass', 'Highpass', 'Bandpass', 'Notch']);
    expect(state.unit('Bass / Auto Filter / Resonance')).toBeCloseTo(0.3 / 1.25, 5);
    expect(liveColour(0x3b7bff)).toBe('#3b7bff');
    expect(splitLiveKey('Bass / Auto Filter / Frequency')).toEqual({ where: 'Bass / Auto Filter', name: 'Frequency' });
  });

  it('a half-received catalogue (lost end, or a newer begin) never replaces the last complete one', () => {
    const state = new LiveState();
    const live = new FakeLive();
    for (const m of msgs(live.catalog(0))) state.apply(m, 0);
    state.apply({ address: '/pf/catalog/begin', args: [2, 1] }, 1);
    state.apply({ address: '/pf/catalog/track', args: [0, 'Only', 0, 'track'] }, 1);
    expect(state.tracks).toHaveLength(5);
    state.apply({ address: '/pf/catalog/end', args: [3] }, 1);
    expect(state.catalogGen).toBe(1);
  });

  it('commands are the script’s addresses; "#3" is an index, names stay names', () => {
    expect(commandMessage({ cmd: 'clip', track: 'Drums', clip: '#2' })).toEqual({ address: '/pf/fire/clip', args: ['Drums', { i: 1 }] });
    expect(commandMessage({ cmd: 'scene', scene: 'Drop' })).toEqual({ address: '/pf/fire/scene', args: ['Drop'] });
    expect(commandMessage({ cmd: 'watch', keys: ['a', 'b'] }).args).toEqual(['a', 'b']);
    expect(commandMessage({ cmd: 'stopAll' }).address).toBe('/pf/stop/all');
    expect(commandMessage({ cmd: 'tap' }).address).toBe('/pf/tap');
    expect(commandMessage({ cmd: 'nextScene' }).address).toBe('/pf/scene/next');
  });
});

describe('liveClient', () => {
  it('connects on the first hello: asks for the catalogue, sends its watch list; goes quiet after 3 s', () => {
    liveClient.watch(['Bass / Auto Filter / Frequency']);
    const live = new FakeLive();
    feed([live.hello()]);
    expect(liveClient.getStatus()).toBe('connected');
    expect(sent.map(m => m.address)).toEqual(['/pf/catalog/request', '/pf/watch']);
    expect(sent[1].args).toEqual(['Bass / Auto Filter / Frequency']);
    // The fake answers the request with the catalogue.
    feed(live.handle(encodeOsc(sent[0].address), now));
    expect(liveClient.state.catalogGen).toBe(1);
    // Hellos keep it connected; silence makes it "not heard from" (the heartbeat's check).
    now += 2500;
    expect(liveClient.state.connected(now)).toBe(true);
    now += 1000;
    expect(liveClient.state.connected(now)).toBe(false);
  });

  it('a new set (or a newer catalogue) is asked for again', () => {
    const live = new FakeLive();
    feed([live.hello()]);
    sent = [];
    live.gen = 2;
    now += 3000;
    feed([live.hello()]);
    expect(sent.map(m => m.address)).toContain('/pf/catalog/request');
  });

  it('the fake answers commands like the script: fire a clip by name, a scene, unknown ones ignored', () => {
    const live = new FakeLive();
    const out = msgs([
      ...live.handle(encodeOsc('/pf/fire/clip', ['Drums', 'Beat B']), 0),
      ...live.handle(encodeOsc('/pf/fire/scene', [{ i: 2 }]), 0),
      ...live.handle(encodeOsc('/pf/nonsense', []), 0),
    ]);
    expect(out.find(m => m.address === '/pf/clip')?.args.slice(1, 5)).toEqual(['Drums', 1, 'triggered', 'Beat B']);
    expect(out.find(m => m.address === '/pf/scene')?.args[1]).toBe('Drop');
    expect(out.filter(m => m.address === '/pf/ack').map(m => m.args[1])).toEqual([1, 1, 0]);
  });
});

function floatNode(id: string, value: number): GraphNode {
  return { id, type: 'constant', position: { x: 0, y: 0 }, inputs: { value: { type: 'float', label: 'Value' } }, outputs: { value: { type: 'float', label: 'Value' } }, params: { value, x: 0, y: 0, z: 0, w: 1, outputType: 'float' } } as GraphNode;
}
function outputNode(fromId: string): GraphNode {
  return { id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color', connection: { nodeId: fromId, outputKey: 'value' } } }, outputs: {}, params: {} } as GraphNode;
}

describe('the Play engine with Live', () => {
  const nodes = [floatNode('node_3', 0), floatNode('node_5', 0), outputNode('node_3')];
  const setup = (record: PlayRecord) => {
    const r = compileGraph({ nodes });
    inputBus.setParamBindings(r.paramBindings);
    playEngine.setRecord(record);
    playEngine.setBaseValues(readBaseValues(nodes, record));
    return { a: r.paramBindings['node_3::value'], b: r.paramBindings['node_5::value'] };
  };
  const controls: PlayRecord['controls'] = [
    { id: 'a', target: 'node_3::value', kind: 'float', label: 'A', min: 0, max: 10 },
    { id: 'b', target: 'node_5::value', kind: 'float', label: 'B', min: 0, max: 1 },
  ];

  it('a Live parameter drives a control over its own range; using Live listens and streams the key', () => {
    const key = 'Bass / Auto Filter / Frequency';
    const { a } = setup({ version: 1, layers: [], controls, mappings: [
      { id: 'f', controlId: 'a', source: { kind: 'ableton', read: 'param', key }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true },
    ] });
    expect(liveClient.getStatus()).toBe('waiting');
    // Nothing from Live yet: the control is left alone.
    expect(inputBus.tick(1 / 60, 0).has(a)).toBe(false);
    liveClient.inject({ address: '/pf/param', args: [key, 77.5, 20, 135, '1.0 kHz'] });
    expect(inputBus.tick(1 / 60, 0).get(a)).toBeCloseTo(5);
    // The watch list goes out once things settle (a 50 ms debounce).
    return new Promise<void>(done => setTimeout(() => { expect(sent.find(m => m.address === '/pf/watch')?.args).toEqual([key]); done(); }, 80));
  });

  it('Clock and Beat follow Live’s beat while it’s connected, and fall back to their own BPM', () => {
    const { a } = setup({ version: 1, layers: [], controls, mappings: [
      { id: 'c', controlId: 'a', source: { kind: 'clock', shape: 'saw', bpm: 60, beats: 4, follow: true }, outMin: 0, outMax: 10, curve: 'linear', smoothMs: 0, enabled: true },
    ] });
    // Not connected: its own 60 BPM clock (at time 0, the start of a cycle).
    expect(inputBus.tick(1 / 60, 0).get(a)).toBeCloseTo(0, 3);
    const live = new FakeLive({ tempo: 120 });
    feed([live.hello(), live.jump(2, now)[0]]);
    // Two beats into a four-beat cycle of Live's: halfway.
    expect(liveClient.hasTransport()).toBe(true);
    expect(inputBus.tick(1 / 60, 0).get(a)).toBeCloseTo(5, 1);
    const beat = { on: 'beat' as const, bpm: 60, beats: 1, follow: true };
    expect(triggerKey(beat)).toBe('beat:60:1:live');
    expect(triggerLabel(beat)).toBe('Every beat · Live');
    // On the beat: the gate is open.
    expect(playEngine.isHeld(beat)).toBe(true);
    now += 250;
    expect(playEngine.isHeld(beat)).toBe(false);
  });

  it('clip and scene launches fire their triggers (any track, a named clip, playing vs launched)', () => {
    const { b } = setup({ version: 1, layers: [], controls, mappings: [
      { id: 'hit', controlId: 'b', source: { kind: 'trigger', trigger: { on: 'liveClip', track: 'Drums', clip: 'Beat B', when: 'playing' }, mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
    ] });
    inputBus.tick(1 / 60, 0);
    // Launched (not yet playing): the "plays" trigger waits.
    liveClient.inject({ address: '/pf/clip', args: [0, 'Drums', 1, 'triggered', 'Beat B', 0xff0000] });
    expect(inputBus.tick(1 / 60, 0).get(b) ?? 0).toBe(0);
    liveClient.inject({ address: '/pf/clip', args: [0, 'Drums', 1, 'playing', 'Beat B', 0xff0000] });
    expect(inputBus.tick(1 / 60, 0).get(b)).toBe(1);
    // Another clip doesn't flip it.
    liveClient.inject({ address: '/pf/clip', args: [0, 'Drums', 0, 'playing', 'Beat A', 0xff0000] });
    expect(inputBus.tick(1 / 60, 0).get(b)).toBe(1);
    expect(liveClipKeys('Drums', 'Beat B', 'playing')).toContain(triggerKey({ on: 'liveClip', track: '', clip: '', when: 'playing' }));
    expect(liveSceneKeys('Drop')).toEqual(['liveScene:Drop', 'liveScene:']);
    expect(triggerLabel({ on: 'liveClip', track: 'Drums', clip: 'Beat B', when: 'playing' })).toBe('Live clip “Beat B” on Drums plays');
  });

  it('Learn takes the parameter clicked in Live', () => {
    setup({ version: 1, layers: [], controls, mappings: [] });
    let learned: unknown = null;
    playEngine.startLearn(s => { learned = s; });
    liveClient.inject({ address: '/pf/selected/param', args: ['Pad / Playfield / Glow', 'Pad', 'Playfield', 'Glow', 40, 0, 127, '40'] });
    expect(learned).toEqual({ kind: 'ableton', read: 'param', key: 'Pad / Playfield / Glow' });
    expect(sourceLabel(learned as never)).toBe('Live · Glow (Pad / Playfield)');
  });
});

describe('Do in Live, the picker, and saving', () => {
  it('reactions become connector commands', () => {
    expect(liveCommandOf({ cmd: 'clip', track: 'Drums', target: 'Beat B' })).toEqual({ cmd: 'clip', track: 'Drums', clip: 'Beat B' });
    expect(liveCommandOf({ cmd: 'clip', target: 'Beat B' })).toBeNull();
    expect(liveCommandOf({ cmd: 'scene', target: '#2' })).toEqual({ cmd: 'scene', scene: '#2' });
    expect(liveDoText({ cmd: 'stopAll' })).toBe('Stop all clips · Live');
  });

  it('+ Map has an Ableton Live section: connect, Learn, the rack, the selected device, beat, clips', () => {
    const live = { connected: true, status: 'Fake Set · 120 BPM', rack: [{ key: 'Pad / Playfield / Glow', name: 'Glow', track: 'Pad' }], selected: { track: 'Bass', device: 'Auto Filter', params: [{ key: 'Bass / Auto Filter / Frequency', name: 'Frequency' }] } };
    const s = liveSection(live, false);
    expect(s.heading).toBe(`${LIVE_HEADING} · Fake Set · 120 BPM`);
    const values = s.items.map(i => i.value);
    expect(values.slice(0, 3)).toEqual(['live:learn', 'live:key:Pad / Playfield / Glow', 'live:key:Bass / Auto Filter / Frequency']);
    expect(values).toContain('type:ableton:beat');
    expect(parseMapPick('live:key:Pad / Playfield / Glow')).toEqual({ kind: 'liveKey', key: 'Pad / Playfield / Glow' });
    expect(parseMapPick('live:clip')).toEqual({ kind: 'liveClip' });
    expect(liveSection({ ...live, connected: false, status: 'Waiting for Live…' }, true).items[0].value).toBe('live:connect');
    // The section comes after the kinds; the generic "Ableton Live" types aren't listed twice.
    const all = mapPickerSections([], false, [], {}, live);
    expect(all.filter(x => x.items.some(i => i.value === 'type:ableton:beat'))).toHaveLength(1);
  });

  it('a record with Live sources, triggers, a reaction and Follow Live survives a save', () => {
    const raw = {
      version: 1, layers: [], controls: [{ id: 'a', target: 'n::value', kind: 'float', label: 'A', min: 0, max: 1 }],
      mappings: [
        { id: 'm1', controlId: 'a', source: { kind: 'ableton', read: 'param', key: 'Bass / Auto Filter / Frequency' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 30, enabled: true },
        { id: 'm2', controlId: 'a', source: { kind: 'ableton', read: 'bar', key: 'ignored' }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm3', controlId: 'a', source: { kind: 'clock', shape: 'saw', bpm: 120, beats: 4, follow: true }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
        { id: 'm4', controlId: 'a', source: { kind: 'trigger', trigger: { on: 'liveScene', scene: 'Drop' }, mode: 'envelope', attack: 0, decay: 100, sustain: 0, release: 100, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true },
      ],
      signals: [{ id: 's1', name: 'Drop', inputs: [{ kind: 'trigger', trigger: { on: 'liveClip', track: 'Drums', clip: '', when: 'bogus' } }], do: [
        { id: 'r1', do: 'live', layerId: '', amount: 1, enabled: true, live: { cmd: 'scene', target: 'Drop' } },
        { id: 'r2', do: 'live', layerId: '', amount: 1, enabled: true, live: { cmd: 'explode' } },
      ] }],
      audioEngine: { racks: [] },
      arrangement: { length: 2, loop: true, bpm: 120, metronome: false, countIn: 0, fade: 0, tracks: {}, followLive: true },
    };
    const p = parsePlayRecord(raw)!;
    const src = (id: string) => p.mappings.find(m => m.id === id)?.source;
    expect(src('m1')).toEqual({ kind: 'ableton', read: 'param', key: 'Bass / Auto Filter / Frequency' });
    expect(src('m2')).toEqual({ kind: 'ableton', read: 'bar', key: '' });
    expect(src('m3')).toMatchObject({ kind: 'clock', follow: true });
    expect(src('m4')).toMatchObject({ trigger: { on: 'liveScene', scene: 'Drop' } });
    const sg = p.signals?.[0];
    expect(sg?.inputs?.[0]).toMatchObject({ trigger: { on: 'liveClip', track: 'Drums', when: 'triggered' } });
    expect(sg?.do?.map(r => r.id)).toEqual(['r1']);
    expect(sg?.do?.[0].live).toEqual({ cmd: 'scene', target: 'Drop' });
    expect(p.arrangement?.followLive).toBe(true);
    // Through JSON and back: the same.
    expect(parsePlayRecord(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});

describe('the script and the app agree', () => {
  it('the version the app ships is the script’s, and the desktop installer copies every file of it', () => {
    const init = readFileSync(resolve(ROOT, 'tools/live-connector/Playfield/__init__.py'), 'utf8');
    expect(/^VERSION = "([\d.]+)"$/m.exec(init)?.[1]).toBe(LIVE_CONNECTOR_VERSION);
    expect(readFileSync(resolve(ROOT, 'tools/live-connector/Playfield/version.txt'), 'utf8').trim()).toBe(LIVE_CONNECTOR_VERSION);
    const rust = readFileSync(resolve(ROOT, 'src-tauri/src/live_connector.rs'), 'utf8');
    const shipped = [...rust.matchAll(/\("([^"]+)", include_str!\("\.\.\/\.\.\/tools\/live-connector\/Playfield\/([^"]+)"\)\)/g)].map(m => m[2]);
    const files = readdirSync(resolve(ROOT, 'tools/live-connector/Playfield')).filter(f => !f.startsWith('.') && f !== '__pycache__' && f !== 'log.txt');
    expect(shipped.sort()).toEqual(files.sort());
  });
});
