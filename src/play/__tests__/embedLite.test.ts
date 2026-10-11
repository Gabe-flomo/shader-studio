/**
 * The small web export (play/embedLite.ts) and the player's feature groups
 * (exportHtml.ts kitGroupsFor / kitScript): a plain shader exports as a
 * canvas, a short WebGL2 bootstrap and its GLSL with no player code; a graph
 * the bootstrap can't run says why; and the full player carries only the
 * kit groups its bundle uses, each of which loads on its own.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const mem = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, String(v)); }, removeItem: (k: string) => { mem.delete(k); },
    key: (i: number) => [...mem.keys()][i] ?? null, get length() { return mem.size; }, clear: () => mem.clear(),
  });
  vi.stubGlobal('window', { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} });
});
import { parser } from '@shaderfrog/glsl-parser';
import { snapshotExample } from '../../present/snapshot';
import { DEFAULT_EMBED, KIT_GROUPS, buildPlaySnippet, kitGroupsFor, kitScript, playBundle, type KitGroup, type PlayHtmlInput } from '../exportHtml';
import { LITE_BOOTSTRAP, LITE_BOOTSTRAP_MAPS, buildGlslOnly, buildLitePage, buildLiteSnippet, liteBlockers, liteImages, liteMaps, usedUniforms } from '../embedLite';
import { defaultLayer, emptyPlayRecord, type PlayMapping } from '../../types/play';

const SHADER = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_p_n_speed;
uniform vec3 u_p_n_tint;
uniform sampler2D u_fontTexture;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(u_p_n_tint * (0.5 + 0.5 * sin(u_time * u_p_n_speed + vUv.x * u_resolution.x * 0.01)), 1.0);
}`;
const simple = (): PlayHtmlInput => ({
  title: 'Rings', fragmentShader: SHADER, uniforms: { u_p_n_speed: 2, u_p_n_tint: [1, 0.5, 0.25], u_p_other_unused: 3 },
  paramBindings: { 'n::speed': 'u_p_n_speed' },
  play: { ...emptyPlayRecord(), controls: [{ id: 'c', target: 'n::speed', kind: 'float', label: 'Speed', min: 0, max: 4 }] },
  aspect: '16:9', passes: { stateful: false, echo: null },
});
const opts = { ...DEFAULT_EMBED };

describe('the small snippet', () => {
  it('is a canvas, the GLSL and a short bootstrap, with no player code', () => {
    const s = buildLiteSnippet(simple(), opts);
    expect(s).toContain('<div data-playfield style="position:relative;width:100%;aspect-ratio:1.777778');
    expect(s).toContain('<canvas');
    expect(s).toContain('<script type="x-shader/x-fragment">\nprecision highp float;');
    for (const kit of ['SSKit', 'ShaderStudioPlay', 'createLayerKit', 'three', 'PLAY_BUNDLE']) expect(s).not.toContain(kit);
    // The bootstrap stays small, and the snippet is the shader plus a few KB.
    expect(LITE_BOOTSTRAP.split('\n').length).toBeLessThan(100);
    expect(s.length - SHADER.length).toBeLessThan(10 * 1024);
    // Values baked in, labelled with their controls; uniforms the shader never reads stay out.
    expect(s).toContain('"u_p_n_speed": 2, // Speed');
    expect(s).toContain('"u_p_n_tint": [1, 0.5, 0.25],');
    expect(s).not.toContain('u_p_other_unused');
    expect(s.match(/<\/script>/g)?.length).toBe(2);
  });

  it('a background fills its section or the page; a free shape takes the height', () => {
    expect(buildLiteSnippet(simple(), { ...opts, mode: 'background', placement: 'section' })).toContain("h.style.isolation = 'isolate'");
    expect(buildLiteSnippet(simple(), { ...opts, mode: 'background', placement: 'page' })).toContain('position:fixed;inset:0;z-index:-1');
    expect(buildLiteSnippet({ ...simple(), aspect: 'free' }, { ...opts, height: 420 })).toContain('height:420px');
    expect(buildLitePage(simple(), opts)).toMatch(/^<!doctype html>[\s\S]*<title>Rings<\/title>[\s\S]*data-playfield/);
  });

  it('carries feedback and images, inline or as a file next to the page', () => {
    const input: PlayHtmlInput = {
      ...simple(), passes: { stateful: true, echo: null },
      media: { textures: {
        u_tex_a: { label: 'Image', name: 'small.png', src: 'data:image/png;base64,AAAA', bytes: 4 },
        u_tex_b: { label: 'Photo', name: 'big photo.jpg', src: null, bytes: 9_000_000 },
      } },
    };
    expect(liteBlockers(input)).toEqual([]);
    expect(liteImages(input).map(i => [i.uniform, i.src, i.inline])).toEqual([['u_tex_a', 'data:image/png;base64,AAAA', true], ['u_tex_b', 'big-photo.jpg', false]]);
    const s = buildLiteSnippet(input, opts);
    expect(s).toContain('"feedback":true');
    expect(s).toContain('"dpr":1');
    expect(s).toContain('"u_tex_b":{"src":"big-photo.jpg"}');
    expect(s).toContain('Put big-photo.jpg next to this page');
  });

  it('runs: compiles the shader with the app’s defines, sets uniforms by type and draws', () => {
    const calls: string[] = [];
    const { root, gl } = fakePage(calls);
    const s = buildLiteSnippet(simple(), opts);
    const glsl = s.split('<script type="x-shader/x-fragment">\n')[1].split('\n</script>')[0];
    const call = s.split('<script>\n')[1].split('\n</script>')[0]
      .replace(/\(function \(\) \{ var el = document\.currentScript[^\n]*\n/, 'ROOT,\n')
      .replace('document.currentScript.previousElementSibling.textContent', 'GLSL');
    const raf: ((t: number) => void)[] = [];
    new Function('ROOT', 'GLSL', 'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'matchMedia', call)(
      root, glsl, { devicePixelRatio: 1, addEventListener() {}, matchMedia: () => ({ matches: false }) }, { hidden: false }, (f: (t: number) => void) => raf.push(f), () => {},
      class { observe() {} }, class { observe() {} }, class {}, () => ({ matches: false }),
    );
    raf.shift()!(16); raf.shift()!(32);
    expect(gl.sources[1]).toMatch(/^#version 300 es\n#define varying in\n[\s\S]*#define gl_FragColor pc_fragColor[\s\S]*precision highp float;/);
    expect(calls).toContain('uniform1fv u_p_n_speed 2');
    expect(calls).toContain('uniform3fv u_p_n_tint 1,0.5,0.25');
    expect(calls.some(c => c.startsWith('uniform1fv u_time'))).toBe(true);
    expect(calls).toContain('uniform2fv u_resolution 400,225');
    expect(calls.filter(c => c === 'drawArrays').length).toBe(2);
    // The page can set a value, or draw a frame at a time.
    (root as unknown as { playfield: { set(k: string, v: number): void; renderAt(t: number): void } }).playfield.set('u_p_n_speed', 3);
    (root as unknown as { playfield: { renderAt(t: number): void } }).playfield.renderAt(1.5);
    expect(calls).toContain('uniform1fv u_p_n_speed 3');
    expect(calls).toContain('uniform1fv u_time 1.5');
  });

  it('data attributes override the baked values', () => {
    const calls: string[] = [];
    const { root } = fakePage(calls, { u_p_n_speed: '0.25', u_p_n_tint: '0,1,0' });
    const s = buildLiteSnippet(simple(), opts);
    const glsl = s.split('<script type="x-shader/x-fragment">\n')[1].split('\n</script>')[0];
    const call = s.split('<script>\n')[1].split('\n</script>')[0].replace(/\(function \(\) \{ var el = document\.currentScript[^\n]*\n/, 'ROOT,\n').replace('document.currentScript.previousElementSibling.textContent', 'GLSL');
    const raf: ((t: number) => void)[] = [];
    new Function('ROOT', 'GLSL', 'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', call)(
      root, glsl, { devicePixelRatio: 1, addEventListener() {} }, { hidden: false }, (f: (t: number) => void) => raf.push(f), () => {}, class { observe() {} }, class { observe() {} }, class {},
    );
    raf.shift()!(16);
    expect(calls).toContain('uniform1fv u_p_n_speed 0.25');
    expect(calls).toContain('uniform3fv u_p_n_tint 0,1,0');
  });

  it('the GLSL only: the shader with what to feed it', () => {
    const g = buildGlslOnly(simple());
    expect(g).toContain('//   u_p_n_speed = 2 (Speed)');
    expect(g).toContain('//   u_time: seconds since start');
    expect(g).toContain('#define gl_FragColor pc_fragColor');
    expect(g.endsWith(`${SHADER}\n`)).toBe(true);
  });

  it('counts a uniform as read only past its declaration', () => {
    expect(usedUniforms(SHADER)).toEqual(['u_time', 'u_resolution', 'u_p_n_speed', 'u_p_n_tint']);
  });
});

describe('the small snippet with clicks and keys', () => {
  const ctl = (id: string, target: string, label: string) => ({ id, target, kind: 'float' as const, label, min: 0, max: 4 });
  const map = (id: string, controlId: string, source: PlayMapping['source'], extra: Partial<PlayMapping> = {}): PlayMapping => ({ id, controlId, source, outMin: 0, outMax: 4, curve: 'linear', smoothMs: 0, enabled: true, ...extra });
  const trig = (on: Record<string, unknown>, mode: 'toggle' | 'envelope' | 'step' | 'random', env: Partial<{ attack: number; decay: number; sustain: number; release: number; steps: number }> = {}): PlayMapping['source'] =>
    ({ kind: 'trigger', trigger: on as never, mode, attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false, ...env });
  const withMaps = (mappings: PlayMapping[]): PlayHtmlInput => ({
    ...simple(), paramBindings: { 'n::speed': 'u_p_n_speed', 'n::tint': 'u_p_n_tint' },
    play: { ...emptyPlayRecord(), controls: [ctl('c', 'n::speed', 'Speed'), { ...ctl('t', 'n::tint', 'Tint'), kind: 'color' as never }], mappings },
  });

  it('takes mappings from the mouse, keys and the clock; any other source needs the player', () => {
    expect(liteMaps(withMaps([map('m', 'c', { kind: 'clock', shape: 'saw', bpm: 120, beats: 4 })]))?.[0]).toMatchObject({ on: 'wave', w: { shape: 'saw', hz: 0.5, ph: 0 } });
    expect(liteMaps(withMaps([map('m', 'c', { kind: 'mouse', axis: 'down' })]))).toEqual([{ u: 'u_p_n_speed', on: 'down', lo: 0, hi: 4 }]);
    expect(liteMaps(withMaps([map('m', 'c', trig({ on: 'key', code: 'Space' }, 'toggle'))]))?.[0]).toMatchObject({ on: 'key', key: 'Space', t: { mode: 'toggle' } });
    expect(liteMaps(withMaps([map('m', 't', { kind: 'mouse', axis: 'x' }, { channel: 1 })]))?.[0]).toMatchObject({ u: 'u_p_n_tint', ch: 1 });
    expect(liteBlockers(withMaps([map('m', 'c', { kind: 'key', code: 'KeyA' })]))).toEqual([]);
    for (const bad of [
      map('m', 'c', { kind: 'noise', type: 'smooth', rate: 1, seed: 1, steps: 0 }),
      map('m', 'c', { kind: 'lfo', shape: 'random', rate: 1, phase: 0 }),
      map('m', 'c', { kind: 'tilt', axis: 'beta' }),
      map('m', 'c', { kind: 'mouse', axis: 'x' }, { delayMs: 200 }),
      map('m', 'c', trig({ on: 'key', code: 'KeyA', fire: { mode: 'every', every: 3, unit: 'frames' } }, 'toggle')),
    ]) expect(liteBlockers(withMaps([bad])).map(b => b.what), JSON.stringify(bad.source)).toEqual(['Mappings']);
    // A colour as a whole: its brightness; its channels one each.
    expect(liteMaps(withMaps([map('m', 't', { kind: 'mouse', axis: 'x' })]))?.[0]).toMatchObject({ u: 'u_p_n_tint', ch: -1 });
    expect(liteMaps(withMaps([map('a', 't', { kind: 'mouse', axis: 'x' }, { channel: 0 }), map('b', 't', { kind: 'mouse', axis: 'y' }, { channel: 2 })]))).toHaveLength(2);
    expect(liteMaps(withMaps([map('a', 't', { kind: 'mouse', axis: 'x' }, { channel: 0 }), map('b', 't', { kind: 'mouse', axis: 'y' })]))).toBeNull();
    // Two mappings on one control combine in the player.
    expect(liteMaps(withMaps([map('a', 'c', { kind: 'mouse', axis: 'x' }), map('b', 'c', { kind: 'key', code: 'KeyA' })]))).toBeNull();
  });

  it('carries the mapping code only when it has mappings', () => {
    expect(buildLiteSnippet(simple(), opts)).not.toContain('function tickMaps');
    const s = buildLiteSnippet(withMaps([map('m', 'c', { kind: 'key', code: 'Space' })]), opts);
    expect(s).toContain('tickMaps(dt)');
    expect(s).toContain('"maps":[{"u":"u_p_n_speed","on":"key","key":"Space","lo":0,"hi":4}]');
    expect(LITE_BOOTSTRAP_MAPS.length - LITE_BOOTSTRAP.length).toBeLessThan(4 * 1024);
  });

  it('runs: keys held and pressed, clicks on the picture, a colour channel', () => {
    const page = livePage(buildLiteSnippet(withMaps([
      map('k', 'c', { kind: 'key', code: 'Space' }),
      map('t', 't', trig({ on: 'mouse' }, 'toggle'), { channel: 2, outMin: 0, outMax: 1 }),
    ]), opts));
    page.frame();
    expect(page.last('u_p_n_speed')).toBe('0');
    expect(page.last('u_p_n_tint')).toBe('1,0.5,0');
    page.fire('keydown', { code: 'Space', repeat: false, target: {} });
    page.frame();
    expect(page.last('u_p_n_speed')).toBe('4');
    page.fire('keyup', { code: 'Space' });
    page.frame();
    expect(page.last('u_p_n_speed')).toBe('0');
    // Typing in a field on the page doesn't count.
    page.fire('keydown', { code: 'Space', repeat: false, target: { tagName: 'INPUT' } });
    page.frame();
    expect(page.last('u_p_n_speed')).toBe('0');
    // A click on the picture toggles the blue channel on; another, off. A click off the picture doesn't count.
    page.click(100, 100); page.frame();
    expect(page.last('u_p_n_tint')).toBe('1,0.5,1');
    page.click(900, 900); page.frame();
    expect(page.last('u_p_n_tint')).toBe('1,0.5,1');
    page.click(100, 100); page.frame();
    expect(page.last('u_p_n_tint')).toBe('1,0.5,0');
  });

  it('a colour mapped as a whole scales its brightness', () => {
    const page = livePage(buildLiteSnippet(withMaps([map('b', 't', { kind: 'key', code: 'KeyB' }, { outMin: 0.5, outMax: 1 })]), opts));
    page.frame();
    expect(page.last('u_p_n_tint')).toBe('0.5,0.25,0.125');
    page.fire('keydown', { code: 'KeyB', repeat: false, target: {} }); page.frame();
    expect(page.last('u_p_n_tint')).toBe('1,0.5,0.25');
  });

  it('an envelope on a key: up over its attack, down over its release', () => {
    const page = livePage(buildLiteSnippet(withMaps([map('e', 'c', trig({ on: 'key', code: 'KeyA' }, 'envelope', { attack: 100, decay: 0, sustain: 1, release: 100 }))]), opts));
    page.frame();
    page.fire('keydown', { code: 'KeyA', repeat: false, target: {} });
    page.frame(50); // half the attack
    expect(Number(page.last('u_p_n_speed'))).toBeCloseTo(2, 5);
    page.frame(50); page.frame(16);
    expect(page.last('u_p_n_speed')).toBe('4');
    page.fire('keyup', { code: 'KeyA' });
    page.frame(16); page.frame(50);
    expect(Number(page.last('u_p_n_speed'))).toBeLessThan(4);
    page.frame(100);
    expect(page.last('u_p_n_speed')).toBe('0');
  });

  it('an LFO on the snippet’s clock, and renderAt draws it at that time', () => {
    const page = livePage(buildLiteSnippet(withMaps([map('l', 'c', { kind: 'lfo', shape: 'triangle', rate: 0.5, phase: 0 })]), opts));
    for (let i = 0; i < 10; i++) page.frame(100); // one second in (frames step at most 0.1 s): half a cycle, the top of the triangle
    expect(Number(page.last('u_p_n_speed'))).toBeCloseTo(4, 5);
    page.renderAt(0.5);
    expect(Number(page.last('u_p_n_speed'))).toBeCloseTo(2, 5);
  });

  it('the mouse button drives a mapping, and a background reads clicks from the window', () => {
    const bg = livePage(buildLiteSnippet(withMaps([map('d', 'c', { kind: 'mouse', axis: 'down' })]), { ...opts, mode: 'background', placement: 'page', followPage: true }));
    expect(bg.rootListeners).not.toContain('pointerdown');
    bg.fire('pointerdown', { clientX: 10, clientY: 10 }); bg.frame();
    expect(bg.last('u_p_n_speed')).toBe('4');
    bg.fire('pointerup', {}); bg.frame();
    expect(bg.last('u_p_n_speed')).toBe('0');
  });
});

/** The snippet's bootstrap running on a fake page: frames on demand, window and root events, the uniforms it sets. */
function livePage(snippet: string) {
  const calls: string[] = [];
  const { root } = fakePage(calls);
  const win: Record<string, ((e: unknown) => void)[]> = {};
  const rootListeners: string[] = [];
  (root as unknown as { addEventListener: (k: string, f: (e: unknown) => void) => void }).addEventListener = (k, f) => { rootListeners.push(k); (win[`root:${k}`] ??= []).push(f); };
  const glsl = snippet.split('<script type="x-shader/x-fragment">\n')[1].split('\n</script>')[0];
  const call = snippet.split('<script>\n')[1].split('\n</script>')[0]
    .replace(/\(function \(\) \{ var el = document\.currentScript[^\n]*\n/, 'ROOT,\n')
    .replace('document.currentScript.previousElementSibling.textContent', 'GLSL');
  const raf: ((t: number) => void)[] = [];
  let now = 0;
  const win0 = { devicePixelRatio: 1, addEventListener: (k: string, f: (e: unknown) => void) => { (win[k] ??= []).push(f); }, matchMedia: () => ({ matches: false }) };
  new Function('ROOT', 'GLSL', 'window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'matchMedia', call)(
    root, glsl, win0, { hidden: false }, (f: (t: number) => void) => raf.push(f), () => {}, class { observe() {} }, class { observe() {} }, class {}, () => ({ matches: false }),
  );
  raf.shift()!(now += 16);
  const fire = (k: string, e: Record<string, unknown>) => { for (const f of [...(win[k] ?? []), ...(win[`root:${k}`] ?? [])]) f(e); };
  return {
    rootListeners,
    renderAt: (t: number) => (root as unknown as { playfield: { renderAt(t: number): void } }).playfield.renderAt(t),
    frame: (ms = 16) => raf.shift()!(now += ms),
    fire,
    click: (x: number, y: number) => { fire('pointerdown', { clientX: x, clientY: y }); fire('pointerup', {}); },
    last: (u: string) => { for (let i = calls.length - 1; i >= 0; i--) if (calls[i].split(' ')[1] === u) return calls[i].split(' ')[2]; return undefined; },
  };
}

describe('when a graph needs the full player', () => {
  const what =(i: PlayHtmlInput) => liteBlockers(i).map(b => b.what);
  it('says what it uses, feature by feature', () => {
    expect(what(simple())).toEqual([]);
    const map: PlayMapping = { id: 'm', controlId: 'c', source: { kind: 'noise', type: 'smooth', rate: 1, seed: 1, steps: 0 }, outMin: 0, outMax: 4, curve: 'linear', smoothMs: 0, enabled: true };
    expect(what({ ...simple(), play: { ...simple().play, mappings: [map] } })).toEqual(['Mappings']);
    expect(what({ ...simple(), play: { ...simple().play, layers: [defaultLayer('script', 'L1', 'Sketch')] } })).toEqual(['Script layers']);
    expect(liteBlockers({ ...simple(), play: { ...simple().play, layers: [defaultLayer('script', 'L1', 'Sketch')] } })[0].feature).toBe('script');
    expect(what({ ...simple(), passes: { stateful: false, echo: { copies: 3, delay: 2 } } })).toEqual(['Echo']);
    expect(what({ ...simple(), fragmentShader: SHADER.replace('void main', 'uniform sampler2D u_pass_a;\nvec4 f(){ return texture2D(u_pass_a, vec2(0.0)); }\nvoid main') })).toEqual(['Pass nodes']);
    expect(what({ ...simple(), fragmentShader: SHADER.replace('void main', 'uniform float u_mystery;\nfloat g(){ return u_mystery; }\nvoid main') })).toEqual(['its input u_mystery']);
    // Text nodes read the player's font atlas.
    expect(what({ ...simple(), fragmentShader: SHADER.replace('vec4(u_p_n_tint', 'texture2D(u_fontTexture, vUv) + vec4(u_p_n_tint') })).toEqual(['Text (the font atlas)']);
  });
});

describe('the full player carries only what it uses', () => {
  const groups = (i: PlayHtmlInput) => [...kitGroupsFor(playBundle(i))].sort();
  it('picks feature groups from the bundle', () => {
    expect(groups(simple())).toEqual([]);
    expect(groups({ ...simple(), play: { ...simple().play, layers: [defaultLayer('script', 'L1', 'S')] } })).toEqual(['script']);
    expect(groups({ ...simple(), play: { ...simple().play, finish: { on: true, effects: [] } as never } })).toEqual(['blur', 'finish']);
    expect(groups({ ...simple(), fragmentShader: `${SHADER}\n// gpu-particles x` })).toEqual(['blur', 'gpuParticles']);
    expect(groups({ ...simple(), agents: { groups: [], deposits: [], trails: [], draws: [], bessel: 'u_b' } })).toEqual(['agentsGpu', 'blur', 'gpuParticles']);
    expect(groups({ ...simple(), graphPasses: [{ slug: 'a', label: 'A', fragmentShader: 'void main(){}', scale: 1, format: 'half', filter: 'linear', wrap: 'clamp', previous: false, live: true, u: { tex: 'u_pass_a', prev: 'u_passprev_a' } }] })).toEqual(['passes']);
    expect(groups({ ...simple(), play: { ...simple().play, layers: [defaultLayer('drumpad', 'L1', 'Pads')] } })).toEqual(['drums']);
  });

  it('every subset of the kit loads, with what it left out null', () => {
    const load = (g?: Set<KitGroup>) => new Function(`${kitScript(g)}\nreturn SSKit;`)() as Record<string, unknown>;
    const none = load(new Set());
    expect(typeof none.createLayerKit).toBe('function');
    for (const k of ['finish', 'agents', 'gpuParticles', 'jfa', 'hands', 'data', 'drumPads', 'granulator', 'audioFx']) expect(none[k]).toBeNull();
    // The frame's order schedules particles and agents as well as passes: it stays, without the Pass host.
    expect(none.passes).toEqual({ create: null, steps: expect.any(Function) });
    for (const g of KIT_GROUPS) {
      const kit = load(new Set([g]));
      expect(typeof kit.createLayerKit).toBe('function');
    }
    // The dependent groups together, as kitGroupsFor adds them.
    expect(load(new Set(['agentsGpu', 'gpuParticles', 'blur'] as KitGroup[])).agents).not.toBeNull();
    expect(load(new Set(['finish', 'blur'] as KitGroup[])).finish).not.toBeNull();
    expect(kitScript(new Set()).length).toBeLessThan(kitScript().length * 0.55);
  });

  it('a left-out group the page calls says so', () => {
    const js = kitScript(new Set());
    expect(js).toContain("function fnCreate() { throw new Error('[Playfield] Finish effects and Water layers: not in this page'); }");
  });
});

describe('a real example', () => {
  let input: PlayHtmlInput;
  beforeAll(async () => {
    const r = await snapshotExample('fractalRings');
    if (!r.ok) throw new Error(r.error);
    input = r.source.bundle;
  });
  it('exports small: a few hundred lines in place of the whole player', () => {
    expect(liteBlockers(input)).toEqual([]);
    const s = buildLiteSnippet(input, opts);
    const player = buildPlaySnippet(input, opts);
    expect(s.length).toBeLessThan(24 * 1024);
    expect(s.split('\n').length).toBeLessThan(400);
    expect(s.length * 20).toBeLessThan(player.length);
  });
  it('its GLSL parses as the snippet carries it', () => {
    const s = buildLiteSnippet(input, opts);
    const glsl = s.split('<script type="x-shader/x-fragment">\n')[1].split('\n</script>')[0];
    expect(glsl).toBe(input.fragmentShader.trim());
    expect(() => parser.parse(glsl, { quiet: true })).not.toThrow();
  });
});

/** A page with a WebGL2 context that records what the bootstrap does. */
function fakePage(calls: string[], dataset: Record<string, string> = {}) {
  const sources: string[] = [];
  let uniforms: { name: string; type: number }[] = [];
  const T: Record<string, number> = { float: 5126, vec2: 35664, vec3: 35665, vec4: 35666, int: 5124, bool: 35670, sampler2D: 35678, mat2: 35674, mat3: 35675, mat4: 35676 };
  const gl = new Proxy({ sources } as Record<string, unknown>, {
    get(_t, k: string) {
      if (k === 'sources') return sources;
      if (/^[A-Z0-9_]+$/.test(k)) return k === 'TEXTURE0' ? 33984 : k === 'ACTIVE_UNIFORMS' ? 35718 : 1;
      if (k === 'shaderSource') return (_s: unknown, src: string) => {
        sources.push(src);
        uniforms = [...src.matchAll(/^\s*uniform\s+(\w+)\s+(\w+)/gm)].filter(m => (src.match(new RegExp(`\\b${m[2]}\\b`, 'g')) ?? []).length > 1).map(m => ({ name: m[2], type: T[m[1]] }));
      };
      if (k === 'getShaderParameter' || k === 'getProgramParameter') return (_p: unknown, what: number) => (what === 35718 ? uniforms.length : true);
      if (k === 'getActiveUniform') return (_p: unknown, i: number) => ({ name: uniforms[i].name, type: uniforms[i].type, size: 1 });
      if (k === 'getUniformLocation') return (_p: unknown, name: string) => name;
      if (/^uniform/.test(k)) return (at: string, a: unknown, b: unknown) => calls.push(`${k} ${at} ${String(k.startsWith('uniformMatrix') ? b : a)}`);
      if (k === 'drawArrays') return () => calls.push('drawArrays');
      if (k === 'getExtension') return () => null;
      return () => ({});
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => gl };
  const root = { dataset, textContent: '', querySelector: () => canvas, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 225 }), addEventListener() {} } as unknown as HTMLElement;
  return { root, gl: gl as unknown as { sources: string[] } };
}
