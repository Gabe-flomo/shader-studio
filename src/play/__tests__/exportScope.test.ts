/**
 * What a website export supports (play/exportScope.ts, docs/web-export.md): the shader, time, the
 * pointer, keys and mappings from them come along; hand / face / pose tracking, the camera, MIDI, the
 * mic and the Depth model are left out, said plainly, with what they drove held at its current value
 * and none of their code in the page.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} });
});
import { EXPORT_OUTS, exportFrozenText, sourceOut, triggerOut, webExportScope } from '../exportScope';
import { DEFAULT_EMBED, buildPlaySnippet, kitGroupsFor, playBundle, type PlayHtmlInput } from '../exportHtml';
import { webInputFrom, type CompiledForWeb } from '../webInput';
import { buildLiteSnippet, liteBlockers, liteMaps } from '../embedLite';
import { DEPTH_SOURCE_MARK } from '../../nodes/definitions/depth';
import { SPLAT_MARK } from '../../nodes/definitions/splatScene';
import { defaultLayer, emptyPlayRecord, type PlayMapping, type PlayRecord, type PlaySource } from '../../types/play';

const SHADER = `precision highp float;
uniform float u_time;
uniform float u_p_n_glow;
uniform float u_p_n_size;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vec3(u_p_n_glow * u_p_n_size * sin(u_time)), 1.0); }`;

const mapping = (id: string, controlId: string, source: PlaySource, extra: Partial<PlayMapping> = {}): PlayMapping => ({ id, controlId, source, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true, ...extra });
const trigger = (on: Record<string, unknown>): PlaySource => ({ kind: 'trigger', trigger: on as never, mode: 'toggle', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false });
const record = (mappings: PlayMapping[], more: Partial<PlayRecord> = {}): PlayRecord => ({
  ...emptyPlayRecord(),
  controls: [{ id: 'glow', target: 'n::glow', kind: 'float', label: 'Glow', min: 0, max: 1 }, { id: 'size', target: 'n::size', kind: 'float', label: 'Size', min: 0, max: 2 }],
  mappings, ...more,
});
const input = (play: PlayRecord, more: Partial<PlayHtmlInput> = {}): PlayHtmlInput => ({
  title: 'T', fragmentShader: SHADER, uniforms: { u_p_n_glow: 0.5, u_p_n_size: 1 }, paramBindings: { 'n::glow': 'u_p_n_glow', 'n::size': 'u_p_n_size' },
  play, aspect: '16:9', passes: { stateful: false, echo: null }, ...more,
});

describe('what a web export supports', () => {
  it('classifies sources: pointer, keys, time and controls come along; tracking, MIDI and the mic don’t', () => {
    const ok: PlaySource[] = [
      { kind: 'mouse', axis: 'x' }, { kind: 'mouse', axis: 'down' }, { kind: 'key', code: 'Space' }, { kind: 'lfo', shape: 'sine', rate: 1, phase: 0 },
      { kind: 'control', controlId: 'size' }, { kind: 'noise', type: 'smooth', rate: 1, seed: 1, steps: 0 }, trigger({ on: 'key', code: 'KeyA' }), trigger({ on: 'mouse' }),
      trigger({ on: 'beat', bpm: 120, beats: 1 }),
    ];
    for (const s of ok) expect(sourceOut(s), JSON.stringify(s)).toBeNull();
    const out: [PlaySource, string][] = [
      [{ kind: 'hand', side: 'any', read: 'x', point: 8, axis: 'x', gesture: 'pinch' } as unknown as PlaySource, 'hands'],
      [{ kind: 'face', read: 'smile', point: 1, axis: 'x', gesture: 'smile' } as unknown as PlaySource, 'face'],
      [{ kind: 'pose', read: 'x', point: 0, axis: 'x', gesture: 'none' } as unknown as PlaySource, 'pose'],
      [{ kind: 'midi', signal: 'cc', channel: 0, cc: 1 }, 'midi'],
      [{ kind: 'pad', read: 'x', col: 0, row: 0 } as unknown as PlaySource, 'midi'],
      [{ kind: 'live', band: 'bass', gain: 1 }, 'mic'],
      [{ kind: 'audio', nodeId: 'a1', band: 0 }, 'mic'],
      [trigger({ on: 'note', channel: 0, note: -1 }), 'midi'],
      [trigger({ on: 'audio', band: 'bass', threshold: 0.6 }), 'mic'],
      [trigger({ on: 'hand', side: 'any', gesture: 'pinch' }), 'hands'],
      [trigger({ on: 'face', gesture: 'smile' }), 'face'],
    ];
    for (const [s, kind] of out) expect(sourceOut(s), JSON.stringify(s)).toBe(kind);
    expect(triggerOut({ on: 'pose', gesture: 'none' } as never)).toBe('pose');
    expect(triggerOut({ on: 'key', code: 'KeyA' })).toBeNull();
  });

  it('says plainly what it leaves out', () => {
    expect(exportFrozenText('hands').why).toBe('Hand tracking won’t work on a web page; those controls will hold their current value.');
    for (const k of EXPORT_OUTS) expect(exportFrozenText(k).why).toMatch(/web page/);
  });
});

describe('left out, held at the current value', () => {
  it('a hand mapping goes; its control keeps the value it has now; the page carries no tracker or MIDI code', () => {
    const play = record([mapping('m1', 'glow', { kind: 'hand', side: 'any', read: 'x', point: 8, axis: 'x', gesture: 'pinch' } as unknown as PlaySource), mapping('m2', 'size', { kind: 'midi', signal: 'cc', channel: 0, cc: 7 })], { hands: { smoothing: 0.5, overlay: true, colour: [1, 1, 1], mirror: true } as never });
    const compiled: CompiledForWeb = {
      fragmentShader: SHADER, paramUniforms: { u_p_n_glow: 0.5, u_p_n_size: 1 }, paramBindings: { 'n::glow': 'u_p_n_glow', 'n::size': 'u_p_n_size' },
      textureUniforms: {}, videoUniforms: {}, audioUniforms: {}, liveUniforms: {}, isStateful: false,
    };
    // The hand has the glow at 0.83 and MIDI the size at 1.7 right now.
    const { input: raw } = webInputFrom(compiled, play, { title: 'T', aspect: '16:9', live: new Map([['glow', 0.83], ['size', 1.7]]) });
    const { input: scoped, frozen } = webExportScope(raw);
    expect(frozen.map(f => f.kind)).toEqual(['hands', 'midi']);
    expect(scoped.play.mappings).toEqual([]);
    expect(scoped.play.hands).toBeUndefined();
    expect(scoped.uniforms).toMatchObject({ u_p_n_glow: 0.83, u_p_n_size: 1.7 });
    // With nothing else, it fits the small snippet, values baked in.
    expect(liteBlockers(scoped)).toEqual([]);
    const s = buildLiteSnippet(scoped, DEFAULT_EMBED);
    expect(s).toContain('"u_p_n_glow": 0.83, // Glow');
    expect(s).toContain('"u_p_n_size": 1.7, // Size');
    // The full player leaves the trackers and MIDI out, even with a control named after a hand.
    const named = { ...scoped, play: { ...scoped.play, controls: [...scoped.play.controls, { id: 'x', target: 'n::face', kind: 'float' as const, label: 'Hand face pose', min: 0, max: 1 }] } };
    expect([...kitGroupsFor(playBundle(named))]).toEqual([]);
    const page = buildPlaySnippet(named, DEFAULT_EMBED);
    expect(page).toContain("hands: null");
    expect(page).toContain("midi: null");
    expect(page).not.toContain('function hdCreate(');
    expect(page).not.toContain('function kmGridFit(');
  });

  it('the camera: Camera and Motion layers go, layers drawn from it hide; what reads them goes too', () => {
    const cam = defaultLayer('camera', 'cam', 'Camera');
    const motion = { ...defaultLayer('motion', 'mo', 'Motion'), readFrom: 'camera' } as never;
    const parts = { ...defaultLayer('particles', 'pa', 'Dust'), readFrom: 'camera' } as never;
    const play = record([mapping('m', 'glow', { kind: 'sensor', layerId: 'cam', read: 'motion', otherId: '' })], {
      layers: [cam, motion, parts], controls: [...record([]).controls, { id: 'lc', target: 'layer:cam::opacity', kind: 'float', label: 'Cam', min: 0, max: 1 }],
    });
    const { input: s, frozen } = webExportScope(input(play));
    expect(frozen.map(f => f.kind)).toEqual(['camera']);
    expect(s.play.layers.map(l => [l.id, l.visible])).toEqual([['pa', false]]);
    expect(s.play.mappings).toEqual([]);
    expect(s.play.controls.map(c => c.id)).toEqual(['glow', 'size']);
  });

  it('MIDI: the pad grid, MIDI-played pads and racks; the mic: live readers, Audio layers, an Audio Input with no song', () => {
    const pads = defaultLayer('sampler', 'dp', 'Pads');
    const audio = defaultLayer('audio', 'au', 'Mic');
    const play = record([mapping('k', 'glow', { kind: 'key', code: 'Space' })], {
      padGrid: { cols: 8, rows: 8 } as never, layers: [pads, audio],
      audioReaders: { input: '', readers: [{ id: 'r', name: 'Kick' } as never] },
      actions: [{ id: 'a', trigger: { on: 'note', channel: 0, note: 60 }, do: 'burst', layerId: 'x', amount: 1, enabled: true }],
    });
    const media = { audio: [{ id: 'node1', label: 'Audio Input', name: '', src: null, bytes: 0, uniforms: ['u_audio_a'], bands: [0], range: 1, mode: 'fft' }] };
    const { input: s, frozen } = webExportScope(input(play, { media }));
    expect(frozen.map(f => f.kind)).toEqual(['midi', 'mic']);
    expect(s.play.padGrid).toBeUndefined();
    expect(s.play.audioReaders).toBeUndefined();
    expect(s.play.actions).toEqual([]);
    expect(s.play.layers.find(l => l.id === 'dp')).toMatchObject({ midi: false });
    expect(s.play.layers.find(l => l.id === 'au')?.visible).toBe(false);
    expect(s.media?.audio).toEqual([]);
    // The key mapping stays: keys work on a page.
    expect(s.play.mappings.map(m => m.id)).toEqual(['k']);
  });

  it('a song on an Audio Input travels, and its band mappings with it', () => {
    const media = { audio: [{ id: 'node1', label: 'Audio Input', name: 'song.mp3', src: 'data:audio/mpeg;base64,AA', bytes: 2, uniforms: ['u_audio_a'], bands: [0], range: 1, mode: 'fft' }] };
    const { input: s, frozen } = webExportScope(input(record([mapping('m', 'glow', { kind: 'audio', nodeId: 'node1', band: 0 })]), { media }));
    expect(frozen).toEqual([]);
    expect(s.play.mappings).toHaveLength(1);
  });

  it('the Depth node’s live model is named; a baked depth isn’t', () => {
    const live = `${SHADER}\n${DEPTH_SOURCE_MARK}u_tex_d1 picture`;
    expect(webExportScope(input(record([]), { fragmentShader: live })).frozen.map(f => f.kind)).toEqual(['depth']);
    const baked = { textures: { u_tex_d1: { label: 'Depth', name: 'd.png', src: 'data:image/png;base64,AA', bytes: 2 } } };
    expect(webExportScope(input(record([]), { fragmentShader: live, media: baked })).frozen).toEqual([]);
  });

  it('a Splat Scene is named: its scan reads empty on a page', () => {
    const f = webExportScope(input(record([]), { fragmentShader: `${SHADER}\n${SPLAT_MARK}u_tex_splat_1_color` })).frozen;
    expect(f.map(x => x.kind)).toEqual(['splats']);
    expect(f[0].why).toMatch(/reads empty/);
  });

  it('a graph with nothing left out is unchanged', () => {
    const i = input(record([mapping('m', 'glow', { kind: 'mouse', axis: 'x' })]));
    const s = webExportScope(i);
    expect(s.frozen).toEqual([]);
    expect(s.input.play.mappings).toEqual(i.play.mappings);
    expect(liteMaps(s.input)).toHaveLength(1);
  });
});
