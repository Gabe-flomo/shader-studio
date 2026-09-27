/**
 * The web runtime's extra passes, run against a stand-in DOM and a WebGL
 * context that records its calls: feedback ping-pongs between two targets,
 * echo keeps its ring of copies, particles draw additively as points, images
 * and videos get sampler units, and the GLSL is prepared the way Three.js
 * prepares it. Plus the pure helpers (particle shapes, the camera, audio bands).
 */
import { describe, it, expect } from 'vitest';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { emptyPlayRecord } from '../../types/play';

type Call = [string, ...unknown[]];

/** A WebGL context that answers everything and remembers each call. */
function fakeGl(calls: Call[]) {
  const consts = new Map<string, number>();
  let next = 1;
  const target = {
    getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getUniformLocation: (_p: unknown, n: string) => ({ uniform: n }),
    getExtension: (n: string) => ({ name: n, HALF_FLOAT_OES: 0x8d61 }),
    checkFramebufferStatus: () => target.FRAMEBUFFER_COMPLETE,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
  } as Record<string, unknown>;
  return new Proxy(target, {
    get(t, k: string) {
      if (k in t) {
        const v = t[k];
        return typeof v === 'function' ? (...a: unknown[]) => { calls.push([k, ...a]); return (v as (...x: unknown[]) => unknown)(...a); } : v;
      }
      if (/^[A-Z0-9_]+$/.test(k)) { if (!consts.has(k)) consts.set(k, next++); return consts.get(k); }
      return (...a: unknown[]) => { calls.push([k, ...a]); return k.startsWith('create') ? { id: next++, kind: k } : undefined; };
    },
  });
}

class FakeEl {
  tagName: string; children: FakeEl[] = []; style: Record<string, string> = {}; attrs: Record<string, string> = {};
  width = 300; height = 150; className = ''; textContent = ''; innerHTML = ''; parentElement: FakeEl | null = null;
  clientWidth = 400; clientHeight = 300; readyState = 0; currentTime = 0;
  classList = { add() {}, remove() {}, toggle() {} };
  gl: unknown = null;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...c: FakeEl[]) { for (const e of c) { e.parentElement = this; this.children.push(e); } }
  appendChild(c: FakeEl) { this.append(c); return c; }
  replaceChildren(...c: FakeEl[]) { this.children = []; this.append(...c); }
  remove() {}
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute() {}
  addEventListener() {} removeEventListener() {}
  setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return kind === 'webgl2' ? this.gl : null;
  }
}

/** Mount the runtime once in a stand-in page, draw `frames` frames, and return the GL calls. */
function run(bundle: Record<string, unknown>, frames = 2) {
  const calls: Call[] = [];
  const gl = fakeGl(calls);
  const rafs: ((t: number) => void)[] = [];
  const doc = {
    head: new FakeEl('head'), hidden: false,
    getElementById: () => null,
    createElement: (tag: string) => { const e = new FakeEl(tag); if (tag === 'canvas') e.gl = gl; return e; },
  };
  const win: Record<string, unknown> = {
    devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }),
  };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', runtimeSource);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, FakeEl.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => unknown; internals: Record<string, (...a: never[]) => unknown> };
  const root = new FakeEl('div');
  api.mount(root, { title: 'T', uniforms: {}, paramBindings: {}, play: emptyPlayRecord(), aspect: { id: 'free', ratio: null }, ...bundle }, { mode: 'player' });
  const setup = calls.length;
  for (let i = 0; i < frames; i++) { const cb = rafs.shift(); cb?.(16 * (i + 1)); }
  return { calls, setup, frameCalls: calls.slice(setup), internals: api.internals, gl: gl as unknown as Record<string, number> };
}

const FS = 'precision highp float;\nuniform sampler2D u_prevFrame;\nuniform sampler2D u_echo0;\nuniform sampler2D u_echo1;\nvarying vec2 vUv;\nvoid main(){ gl_FragColor = texture2D(u_prevFrame, vUv) + texture2D(u_echo0, vUv); }';

describe('web runtime passes', () => {
  it('prepares GLSL as Three.js does on WebGL2', () => {
    const { calls } = run({ fragmentShader: FS });
    const sources = calls.filter(c => c[0] === 'shaderSource').map(c => c[2] as string);
    expect(sources.length).toBe(2);
    for (const s of sources) expect(s.startsWith('#version 300 es\n')).toBe(true);
    expect(sources[1]).toContain('#define gl_FragColor pc_fragColor');
    expect(sources[1]).toContain('#define texture2D texture');
    expect(sources[0]).toContain('#define attribute in');
  });

  it('feedback draws into alternating targets, reads the other, and dithers to the screen', () => {
    const { frameCalls, gl } = run({ fragmentShader: FS, passes: { stateful: true, echo: null, particles: [] } }, 3);
    const fbs = frameCalls.filter(c => c[0] === 'createFramebuffer').length;
    expect(fbs).toBe(2);
    // Each frame: the picture into a target, then the blit to the screen (null).
    const binds = frameCalls.filter(c => c[0] === 'bindFramebuffer' && c[1] === gl.FRAMEBUFFER).map(c => c[2]);
    const drawn = binds.filter(b => b !== null);
    const frameTargets = drawn.filter((_, i) => i >= 2); // after the two clears
    expect(frameTargets.length).toBe(3);
    expect(frameTargets[0]).not.toBe(frameTargets[1]);
    expect(frameTargets[0]).toBe(frameTargets[2]);
    expect(binds[binds.length - 1]).toBeNull();
    // u_prevFrame on its own unit, past the font and the Layers node's.
    const prev = frameCalls.find(c => c[0] === 'uniform1i' && (c[1] as { uniform: string }).uniform === 'u_prevFrame');
    expect(prev?.[2]).toBe(3);
  });

  it('echo keeps copies × one frame and rotates them every `delay` frames', () => {
    const { frameCalls } = run({ fragmentShader: FS, passes: { stateful: false, echo: { copies: 2, delay: 2 }, particles: [] } }, 4);
    // One scene target and two echo slots.
    expect(frameCalls.filter(c => c[0] === 'createFramebuffer').length).toBe(3);
    // A blit per frame to the screen, plus a copy into the ring on frames 2 and 4.
    const blits = frameCalls.filter(c => c[0] === 'uniform1f' && (c[1] as { uniform: string }).uniform === 'u_seed');
    expect(blits.length).toBe(6);
    expect(blits.filter(c => c[2] === 0).length).toBe(2);
  });

  it('particles draw as points, additively, with the app’s camera', () => {
    const vs = 'precision highp float;\nuniform float u_time;\nattribute float a_normDist;\nvoid main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = 4.0; }';
    const { calls, frameCalls, gl } = run({ fragmentShader: FS, passes: { stateful: false, echo: null, particles: [{ vertexShader: vs, fragmentShader: 'precision highp float; void main(){ gl_FragColor = vec4(1.0); }', count: 500, shape: 3 }] } });
    const pvs = calls.filter(c => c[0] === 'shaderSource').map(c => c[2] as string).find(s => s.includes('ssp_main'));
    expect(pvs).toContain('uniform mat4 projectionMatrix;');
    expect(pvs).toContain('void main() { ssp_main(); gl_PointSize *= ssp_pointScale; }');
    expect(frameCalls).toContainEqual(['drawArrays', gl.POINTS, 0, 500]);
    expect(frameCalls).toContainEqual(['blendFunc', gl.SRC_ALPHA, gl.ONE]);
    expect(calls).toContainEqual(['bindAttribLocation', expect.anything(), 1, 'a_normDist']);
  });

  it('an image input without an image reads blank, on a unit of its own', () => {
    const fs = 'precision highp float; uniform sampler2D u_tex_a; varying vec2 vUv; void main(){ gl_FragColor = texture2D(u_tex_a, vUv); }';
    const { frameCalls } = run({ fragmentShader: fs, media: { textures: { u_tex_a: { src: null } }, videos: {}, audio: [] } }, 1);
    expect(frameCalls).toContainEqual(['uniform1i', { uniform: 'u_tex_a' }, 3]);
  });

  it('an image, video or colour background: the graph never compiles or draws, its passes and inputs stay off', () => {
    for (const source of ['image', 'video', 'colour']) {
      const display = { picture: true, backdrop: [0, 0, 0], source, image: { name: 'a.png', src: 'data:image/png;base64,AAAA' }, video: { name: 'b.mp4', src: 'data:video/mp4;base64,AAAA', bytes: 3, loop: true, muted: true, rate: 1 } };
      const { calls, frameCalls } = run({
        fragmentShader: FS, play: { ...emptyPlayRecord(), display },
        passes: { stateful: true, echo: null, particles: [] },
        media: { textures: {}, videos: { u_vid: { src: 'data:video/mp4;base64,AAAA', loop: true, speed: 1 } }, audio: [] },
      }, 3);
      const sources = calls.filter(c => c[0] === 'shaderSource').map(c => c[2] as string);
      expect(sources.some(s => s.includes('u_prevFrame')), source).toBe(false);
      expect(frameCalls.filter(c => c[0] === 'drawArrays'), source).toEqual([]);
      expect(calls.filter(c => c[0] === 'createFramebuffer'), source).toEqual([]);
    }
    // The shader, as ever, draws each frame.
    expect(run({ fragmentShader: FS }, 2).frameCalls.filter(c => c[0] === 'drawArrays').length).toBe(2);
  });
});

describe('web runtime helpers', () => {
  const { internals } = run({ fragmentShader: 'void main(){}' }, 0);
  const I = internals as unknown as {
    toGlsl: (s: string, vertex: boolean, webgl2: boolean, d: () => unknown) => string;
    particleGeometry: (n: number, shape: number) => { positions: Float32Array; normDists: Float32Array };
    perspective: (fov: number, aspect: number, near: number, far: number) => Float32Array;
    bandAmplitude: (freq: Float32Array, sr: number, fft: number, center: number, range: number) => number;
  };

  it('WebGL1 turns on derivatives for fwidth, and drops #extension lines on WebGL2', () => {
    expect(I.toGlsl('void main(){ float w = fwidth(1.0); }', false, false, () => ({}))).toMatch(/^#extension GL_OES_standard_derivatives : enable\n/);
    expect(I.toGlsl('void main(){}', false, false, () => ({}))).toBe('void main(){}');
    expect(I.toGlsl('#extension GL_OES_standard_derivatives : enable\nvoid main(){}', false, true, () => ({}))).not.toContain('#extension');
  });

  it('particle shapes: a disk is flat and inside the unit circle; a sphere is on it', () => {
    const disk = I.particleGeometry(200, 3);
    for (let i = 0; i < 200; i++) {
      expect(disk.positions[i * 3 + 1]).toBe(0);
      expect(Math.hypot(disk.positions[i * 3], disk.positions[i * 3 + 2])).toBeLessThanOrEqual(1);
      expect(disk.normDists[i]).toBeCloseTo(Math.hypot(disk.positions[i * 3], disk.positions[i * 3 + 2]), 5);
    }
    const sphere = I.particleGeometry(50, 0);
    for (let i = 0; i < 50; i++) expect(Math.hypot(sphere.positions[i * 3], sphere.positions[i * 3 + 1], sphere.positions[i * 3 + 2])).toBeCloseTo(1, 5);
  });

  it('the camera matches THREE.PerspectiveCamera(60°)', () => {
    const m = I.perspective(60, 2, 0.01, 100);
    const f = 1 / Math.tan(Math.PI / 6);
    expect(m[0]).toBeCloseTo(f / 2, 6);
    expect(m[5]).toBeCloseTo(f, 6);
    expect(m[11]).toBe(-1);
    expect(m[10]).toBeCloseTo(-(100 + 0.01) / (100 - 0.01), 6);
  });

  it('audio bands read as the app’s audio engine: mean dB over centre ± range, −100..0 dB → 0..1', () => {
    const freq = new Float32Array(1024).fill(-100);
    // 48 kHz, fft 2048: 23.4 Hz a bin. Loud around 100 Hz (bins 2–6).
    for (let i = 2; i <= 6; i++) freq[i] = -20;
    expect(I.bandAmplitude(freq, 48000, 2048, 100, 50)).toBeCloseTo(0.8, 5);
    expect(I.bandAmplitude(freq, 48000, 2048, 5000, 200)).toBe(0);
    // Range 0 is the full spectrum.
    expect(I.bandAmplitude(freq, 48000, 2048, 0, 0)).toBeCloseTo((5 * 80) / 1024 / 100, 5);
    freq[3] = -Infinity;
    expect(I.bandAmplitude(freq, 48000, 2048, 100, 50)).toBe(0);
  });
});
