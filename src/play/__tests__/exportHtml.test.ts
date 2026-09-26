/**
 * Web exports: a page and a paste-in snippet, both carrying the shader, the
 * uniforms, the record and the runtime, with nothing that could close the
 * script element early, and the mode and placement the user picked.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_EMBED, buildPlayHtml, buildPlaySnippet, leftBehind, mediaCarried, unsupportedFeatures, type PlayHtmlInput, type PlayMedia } from '../exportHtml';
import { defaultLayer, emptyPlayRecord, type PlayLayer, type PlayRecord } from '../../types/play';

const input = (): PlayHtmlInput => ({
  title: 'My <Piece>', fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }',
  uniforms: { u_p_n_k: 0.5 }, paramBindings: { 'n::k': 'u_p_n_k' },
  play: { ...emptyPlayRecord(), controls: [{ id: 'c', target: 'n::k', kind: 'float', label: 'A </script> B', min: 0, max: 1 }] },
  aspect: '16:9',
});

describe('web page export', () => {
  it('bundles the shader, the record and the runtime, and escapes script closers', () => {
    const html = buildPlayHtml(input());
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>My &lt;Piece&gt;</title>');
    expect(html).toContain('window.PLAY_BUNDLE = {');
    expect(html).toContain('"fragmentShader":"precision highp float;');
    expect(html).toContain('"ratio":1.7777777777777777');
    expect(html).toContain('A <\\/script> B');
    expect(html).toContain('ShaderStudioPlay = { version: 3, mount');
    expect(html).toContain('window.PLAY_OPTIONS = {"mode":"player"');
    expect(html.match(/<\/script>/g)?.length).toBe(2);
  });

  it('a background page fills the window and covers', () => {
    const html = buildPlayHtml(input(), { ...DEFAULT_EMBED, mode: 'background', markers: false });
    expect(html).toContain('"mode":"background","fit":"cover"');
    expect(html).toContain('"markers":false');
  });
});

describe('embed snippet', () => {
  it('a player is a block with the runtime and one mount call', () => {
    const s = buildPlaySnippet(input(), { ...DEFAULT_EMBED, height: 480 });
    expect(s).toContain('<div data-shader-studio style="position:relative;width:100%;height:480px');
    expect(s).toContain('ShaderStudioPlay.mount(e, {');
    expect(s).toContain('document.currentScript.previousElementSibling');
    expect(s.match(/<\/script>/g)?.length).toBe(1);
    expect(s).not.toContain('<html');
  });

  it('a section background sits behind its siblings; a page background is fixed', () => {
    const sec = buildPlaySnippet(input(), { ...DEFAULT_EMBED, mode: 'background', placement: 'section' });
    expect(sec).toContain('position:absolute;inset:0;z-index:-1');
    expect(sec).toContain("h.style.isolation='isolate'");
    const page = buildPlaySnippet(input(), { ...DEFAULT_EMBED, mode: 'background', placement: 'page' });
    expect(page).toContain('position:fixed;inset:0;z-index:-1');
    expect(page).not.toContain('isolation');
  });
});

describe('unsupported features', () => {
  it('lists only what the page still cannot run: a MIDI Input node’s outputs', () => {
    expect(unsupportedFeatures({ liveUniforms: {} })).toEqual([]);
    expect(unsupportedFeatures({ liveUniforms: { u_midi_m_note: 'm::note' } })).toEqual(['MIDI Input node outputs']);
  });
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const media = (): PlayMedia => ({
  textures: { u_tex_a: { label: 'Texture Input', name: '', src: PNG, bytes: PNG.length }, u_tex_b: { label: 'Texture Input', name: '', src: null, bytes: 0 } },
  videos: {
    u_vid_v: { label: 'Video Input', name: 'clip.mp4', src: 'data:video/mp4;base64,AAAA', bytes: 26, loop: true, speed: 1.5 },
    u_vid_w: { label: 'Big Video', name: 'long.mov', src: null, bytes: 23 * 1024 * 1024, loop: true, speed: 1 },
  },
  audio: [
    { id: 'au', label: 'Audio Input', name: 'beat.mp3', src: 'data:audio/mpeg;base64,SUQz', bytes: 27, uniforms: ['u_audio_au_0', 'u_audio_au_1'], bands: [80, 2000], range: 100, mode: 'band' },
    { id: 'big', label: 'Audio Input 2', name: 'album.wav', src: null, bytes: 40 * 1024 * 1024, uniforms: [''], bands: [200], range: 200, mode: 'full' },
  ],
});

describe('feedback, echo, particles and media in the bundle', () => {
  it('carries the passes and the files, without the dialog’s labels and sizes', () => {
    const html = buildPlayHtml({
      ...input(),
      passes: { stateful: true, echo: { copies: 3, delay: 4 }, particles: [{ vertexShader: 'void main(){}', fragmentShader: 'void main(){}', count: 500, shape: 3 }] },
      media: media(),
    });
    const bundle = JSON.parse(html.slice(html.indexOf('window.PLAY_BUNDLE = ') + 21, html.indexOf(';\nwindow.PLAY_OPTIONS'))) as Record<string, unknown>;
    expect(bundle.passes).toEqual({ stateful: true, echo: { copies: 3, delay: 4 }, particles: [{ vertexShader: 'void main(){}', fragmentShader: 'void main(){}', count: 500, shape: 3 }] });
    const m = bundle.media as { textures: Record<string, unknown>; videos: Record<string, unknown>; audio: unknown[] };
    expect(m.textures).toEqual({ u_tex_a: { src: PNG }, u_tex_b: { src: null } });
    expect(m.videos.u_vid_v).toEqual({ src: 'data:video/mp4;base64,AAAA', loop: true, speed: 1.5 });
    expect(m.audio[0]).toEqual({ id: 'au', src: 'data:audio/mpeg;base64,SUQz', uniforms: ['u_audio_au_0', 'u_audio_au_1'], bands: [80, 2000], range: 100, mode: 'band' });
    expect(JSON.stringify(m)).not.toMatch(/label|bytes/);
  });

  it('a single-pass graph carries no passes', () => {
    const html = buildPlayHtml({ ...input(), passes: { stateful: false, echo: null, particles: [] } });
    expect(html).not.toContain('"passes"');
  });

  it('says what each file adds to the page, and which are too big to carry', () => {
    const carried = mediaCarried(media());
    expect(carried.map(c => c.what)).toEqual(['Image in Texture Input', 'Video “clip.mp4” in Video Input', 'Song “beat.mp3” in Audio Input']);
    expect(carried[0].bytes).toBe(PNG.length);
    const left = leftBehind(emptyPlayRecord(), media());
    expect(left.map(l => l.what)).toEqual(['The video “long.mov” (23.0 MB) in Big Video', 'The song “album.wav” (40.0 MB) in Audio Input 2']);
    expect(left[1].why).toContain('microphone');
    expect(mediaCarried(undefined)).toEqual([]);
  });
});

describe('mock websites for the preview', () => {
  const SNIP = '<div data-shader-studio></div>';
  it('puts a player in the content, a section background in the hero, a page background first in <body>', async () => {
    const { buildMockSite, MOCK_SITES } = await import('../mockSites');
    for (const { id } of MOCK_SITES) {
      const player = buildMockSite(id, SNIP, { mode: 'player', placement: 'section' }, 'T');
      const section = buildMockSite(id, SNIP, { mode: 'background', placement: 'section' }, 'T');
      const page = buildMockSite(id, SNIP, { mode: 'background', placement: 'page' }, 'T');
      for (const html of [player, section, page]) expect(html.split(SNIP).length - 1).toBe(1);
      expect(page).toMatch(/<body class="bgpage">\s*<div data-shader-studio>/);
      expect(section).not.toContain('class="bgpage"');
      expect(section.indexOf(SNIP)).toBeGreaterThan(section.indexOf('<nav'));
    }
    expect(buildMockSite('blog', SNIP, { mode: 'player', placement: 'section' }, '<b>')).toContain('&lt;b&gt;');
  });
});

describe('what the web page leaves out', () => {
  it('lists a loaded song, the MIDI file, audio-band mappings and notes', () => {
    const audio = { ...defaultLayer('audio', 'a', 'Beat'), input: 'file', fileName: 'track.mp3' } as PlayLayer;
    const play = {
      ...emptyPlayRecord(),
      layers: [audio],
      midiFile: { name: 'lead.mid', data: '', loop: false, offset: 0 },
      mappings: [{ id: 'm', controlId: 'c', enabled: true, source: { kind: 'sensor', layerId: 'a', read: 'bass', otherId: '' } }] as unknown as PlayRecord['mappings'],
      notes: 'hi',
    } as PlayRecord;
    const what = leftBehind(play).map(x => x.what).join(' | ');
    expect(what).toContain('track.mp3');
    expect(what).toContain('lead.mid');
    expect(what).toContain('1 mapping');
    expect(what).toContain('notes');
  });

  it('has nothing to say about a plain setup', () => {
    expect(leftBehind(emptyPlayRecord())).toEqual([]);
  });
});
