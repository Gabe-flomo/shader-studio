/**
 * The web runtime after the browser takes the GPU away: the loss event is
 * preventDefault-ed (so a restore can follow), drawing stops, and on restore
 * the mount is built again on a fresh context from the same second with the
 * controls where they were; a Rebuild button appears when the restore never
 * comes; the handle keeps working across the rebuild; destroy stops it all.
 */
import { describe, it, expect } from 'vitest';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { emptyPlayRecord } from '../../types/play';

type Call = [string, ...unknown[]];

/** A WebGL context that answers everything and remembers each call; `lose()` cuts it off like a driver reset. */
function fakeGl(calls: Call[], onLose: () => void) {
  const consts = new Map<string, number>();
  let next = 1;
  const target = {
    getShaderParameter: () => true, getProgramParameter: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    getUniformLocation: (_p: unknown, n: string) => ({ uniform: n }),
    getExtension: (n: string) => ({ name: n, HALF_FLOAT_OES: 0x8d61, loseContext: onLose, restoreContext() {} }),
    checkFramebufferStatus: () => target.FRAMEBUFFER_COMPLETE,
    isContextLost: () => false,
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

/** A stand-in element that keeps its listeners, so context events can be sent to it. */
class FakeEl {
  tagName: string; children: FakeEl[] = []; style: Record<string, string> = {}; attrs: Record<string, string> = {};
  width = 300; height = 150; className = ''; parentNode: FakeEl | null = null; parentElement: FakeEl | null = null;
  private text = '';
  get textContent() { return this.text; }
  set textContent(v: string) { this.text = v; this.innerHTML = ''; }
  clientWidth = 400; clientHeight = 300; readyState = 0; currentTime = 0; type = ''; hidden = false;
  classList = { add() {}, remove() {}, toggle() {} };
  listeners = new Map<string, ((e: unknown) => void)[]>();
  gl: unknown = null;
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  get innerHTML() { return ''; }
  set innerHTML(_v: string) { for (const c of this.children) { c.parentNode = null; c.parentElement = null; } this.children = []; }
  append(...c: FakeEl[]) { for (const e of c) { if (e.parentNode) e.parentNode.removeChild(e); e.parentNode = this; e.parentElement = this; this.children.push(e); } }
  appendChild(c: FakeEl) { this.append(c); return c; }
  removeChild(c: FakeEl) { this.children = this.children.filter(x => x !== c); c.parentNode = null; c.parentElement = null; return c; }
  replaceChildren(...c: FakeEl[]) { this.innerHTML = ''; this.append(...c); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  removeAttribute() {}
  addEventListener(type: string, fn: (e: unknown) => void) { const l = this.listeners.get(type) ?? []; l.push(fn); this.listeners.set(type, l); }
  removeEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn)); }
  /** Send an event; returns whether a listener called preventDefault. */
  fire(type: string): boolean { let prevented = false; for (const fn of this.listeners.get(type) ?? []) fn({ type, preventDefault: () => { prevented = true; } }); return prevented; }
  querySelector(sel: string): FakeEl | null {
    const cls = sel.replace(/^\./, '');
    for (const c of this.children) { if (c.className.split(' ').includes(cls)) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
  all(cls: string): FakeEl[] { const out: FakeEl[] = []; for (const c of this.children) { if (c.className.split(' ').includes(cls)) out.push(c); out.push(...c.all(cls)); } return out; }
  setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return kind === 'webgl2' ? this.gl : null;
  }
}

interface Handle {
  destroy(): void; state?(): unknown; get(id: string): { value: number; driven: boolean } | null; set(id: string, v: number): void;
  feedOut(): { t: number; playing: boolean }; rebuild(): void; gpu(): { state: string; restarts: number }; pause(): void; play(): void;
  canvases(): { picture: FakeEl }; still(): unknown;
}

/** Mount the runtime in a stand-in page. `nextGl` makes each new context (null = the GPU is still away). */
function harness(bundle: Record<string, unknown>, opts: Record<string, unknown> = {}, kit: unknown = undefined) {
  const calls: Call[] = [];
  const canvases: FakeEl[] = [];
  const rafs: ((t: number) => void)[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let glAvailable = true;
  const makeGl = () => fakeGl(calls, () => {});
  const doc = {
    head: new FakeEl('head'), hidden: false,
    getElementById: () => null,
    createElement: (tag: string) => { const e = new FakeEl(tag); if (tag === 'canvas') { e.gl = glAvailable ? makeGl() : null; canvases.push(e); } return e; },
  };
  const win: Record<string, unknown> = {
    devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }),
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: (id: number) => { if (timers[id - 1]) timers[id - 1].fn = () => {}; },
  };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', 'setTimeout', 'clearTimeout', 'SSKit', runtimeSource);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, FakeEl.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, win.setTimeout, win.clearTimeout, kit);
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => Handle };
  const root = new FakeEl('div');
  const play = { ...emptyPlayRecord(), controls: [{ id: 'c1', target: 'n1::radius', kind: 'float', label: 'Radius', min: 0, max: 1 }] };
  const m = api.mount(root, { title: 'T', uniforms: { u_radius: 0.3 }, paramBindings: { 'n1::radius': 'u_radius' }, play, aspect: { id: 'free', ratio: null }, ...bundle }, { mode: 'player', ...opts });
  let now = 0;
  const frame = () => { now += 16; const cb = rafs.shift(); cb?.(now); };
  const uniformCalls = () => calls.filter(c => c[0] === 'uniform1f' && (c[1] as { uniform: string }).uniform === 'u_time');
  const runTimers = () => { const t = timers.splice(0); for (const x of t) x.fn(); };
  return { root, m, calls, canvases, frame, uniformCalls, runTimers, timers, setGl: (on: boolean) => { glAvailable = on; }, notice: () => root.querySelector('.ssp-gpu') };
}

const FS = 'precision highp float;\nuniform float u_time;\nuniform float u_radius;\nvarying vec2 vUv;\nvoid main(){ gl_FragColor = vec4(vUv, u_time, u_radius); }';

describe('web runtime GPU recovery', () => {
  it('prevents the default on loss so a restore can follow, and stops drawing meanwhile', () => {
    const h = harness({ fragmentShader: FS });
    h.frame(); h.frame();
    const drawn = h.uniformCalls().length;
    expect(drawn).toBeGreaterThan(0);
    const gl = h.canvases[0];
    expect(gl.fire('webglcontextlost')).toBe(true);
    expect(h.m.gpu().state).toBe('lost');
    h.frame(); h.frame(); h.frame();
    expect(h.uniformCalls().length).toBe(drawn);
    expect(h.notice()!.children[0].textContent).toMatch(/Graphics paused/);
    // The mount is still one mount: nothing rebuilt yet.
    expect(h.m.gpu().restarts).toBe(0);
    expect(h.canvases.filter(c => c.className === 'ssp-gl')).toHaveLength(1);
  });

  it('rebuilds everything on restore from the same second with the controls as they were', () => {
    const h = harness({ fragmentShader: FS }, { startTime: 5 });
    h.frame(); h.frame(); h.frame();
    h.m.set('c1', 0.75);
    const before = h.m.feedOut();
    expect(before.t).toBeGreaterThan(5);
    expect(h.m.get('c1')!.value).toBe(0.75);
    const programsBefore = h.calls.filter(c => c[0] === 'createProgram').length;
    const texturesBefore = h.calls.filter(c => c[0] === 'createTexture').length;
    const first = h.canvases.find(c => c.className === 'ssp-gl')!;

    first.fire('webglcontextlost');
    expect(h.m.gpu().state).toBe('lost');
    first.fire('webglcontextrestored');
    expect(h.m.gpu()).toEqual({ state: 'ok', restarts: 1 });
    // A new canvas and context, with the program and its textures made again.
    const glCanvases = h.canvases.filter(c => c.className === 'ssp-gl');
    expect(glCanvases).toHaveLength(2);
    expect(h.m.canvases().picture).toBe(glCanvases[1]);
    expect(h.calls.filter(c => c[0] === 'createProgram').length).toBeGreaterThan(programsBefore);
    expect(h.calls.filter(c => c[0] === 'createTexture').length).toBeGreaterThan(texturesBefore);
    // The clock carries on where it was, playing, and the control keeps its value.
    const after = h.m.feedOut();
    expect(after.t).toBeCloseTo(before.t, 3);
    expect(after.playing).toBe(true);
    expect(h.m.get('c1')!.value).toBe(0.75);
    // Drawing resumes on the new context.
    const drawn = h.uniformCalls().length;
    h.frame(); h.frame(); h.frame(); h.frame();  // the old mount's queued frame goes by first, and does nothing
    expect(h.uniformCalls().length).toBeGreaterThan(drawn);
    expect(h.m.feedOut().t).toBeGreaterThan(after.t);
    // The note says so, inside the new stage.
    const n = h.notice()!;
    expect(n.children[0].textContent).toBe('Graphics restarted');
    expect(n.parentNode!.className).toBe('ssp-stage');
    // Events from the old canvas are stale now.
    first.fire('webglcontextlost');
    expect(h.m.gpu().state).toBe('ok');
  });

  it('keeps pause across the rebuild', () => {
    const h = harness({ fragmentShader: FS }, { startTime: 2 });
    h.frame();
    h.m.pause();
    const t = h.m.feedOut().t;
    const first = h.canvases.find(c => c.className === 'ssp-gl')!;
    first.fire('webglcontextlost');
    first.fire('webglcontextrestored');
    expect(h.m.feedOut().playing).toBe(false);
    expect(h.m.feedOut().t).toBeCloseTo(t, 3);
  });

  it('offers Rebuild when the restore never comes, and tries again from the button', () => {
    const h = harness({ fragmentShader: FS });
    h.frame();
    const first = h.canvases.find(c => c.className === 'ssp-gl')!;
    first.fire('webglcontextlost');
    expect(h.notice()!.children).toHaveLength(1);
    h.runTimers();  // the wait for the browser is over
    const n = h.notice()!;
    expect(n.children).toHaveLength(2);
    expect(n.children[1].textContent).toBe('Rebuild');
    // The GPU is still away: the rebuild fails and the button stays.
    h.setGl(false);
    n.children[1].fire('click');
    expect(h.m.gpu().state).toBe('lost');
    expect(h.notice()!.children[1].textContent).toBe('Rebuild');
    // Back: the button works.
    h.setGl(true);
    h.notice()!.children[1].fire('click');
    expect(h.m.gpu().state).toBe('ok');
    expect(h.notice()!.children[0].textContent).toBe('Graphics restarted');
    expect(h.canvases.filter(c => c.className === 'ssp-gl').length).toBe(3);
  });

  it('rebuild() on the handle does the same on demand, and destroy stops everything', () => {
    const h = harness({ fragmentShader: FS }, { startTime: 1 });
    h.frame(); h.frame();
    const t = h.m.feedOut().t;
    h.m.rebuild();
    expect(h.m.gpu()).toEqual({ state: 'ok', restarts: 1 });
    expect(h.m.feedOut().t).toBeCloseTo(t, 3);
    h.m.destroy();
    expect(h.root.children).toHaveLength(0);
    expect(h.m.feedOut()).toBeUndefined();
    // A stale loss after destroy does nothing.
    for (const c of h.canvases) c.fire('webglcontextlost');
    expect(h.m.gpu().state).toBe('ok');
    expect(h.root.children).toHaveLength(0);
  });

  it('a Finish stack canvas losing its context counts too', () => {
    // A stand-in kit with a Finish stack: the runtime makes the Finish canvas and watches it like the shader's.
    const finishCanvases: FakeEl[] = [];
    const kit = {
      createLayerKit: () => null,
      finish: { active: () => true, create: (c: FakeEl) => { finishCanvases.push(c); return { ok: true, draw: () => false, reset() {}, dispose() {}, info: () => ({}), error: () => null }; } },
    };
    const h = harness({ fragmentShader: FS }, { startTime: 3 }, kit);
    h.frame(); h.frame();
    expect(finishCanvases).toHaveLength(1);
    const fn = finishCanvases[0];
    expect(fn.listeners.get('webglcontextlost')).toHaveLength(1);
    const t = h.m.feedOut().t;
    expect(fn.fire('webglcontextlost')).toBe(true);
    expect(h.m.gpu().state).toBe('lost');
    fn.fire('webglcontextrestored');
    expect(h.m.gpu()).toEqual({ state: 'ok', restarts: 1 });
    // The Finish stack was made again on a new canvas, and the clock went on from where it was.
    expect(finishCanvases).toHaveLength(2);
    expect(h.m.feedOut().t).toBeCloseTo(t, 3);
  });
});
