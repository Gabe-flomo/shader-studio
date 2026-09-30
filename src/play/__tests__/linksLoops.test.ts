/**
 * Links and loops (simplification plan, 9b): a signal sends others after a
 * delay; a ring of links is a loop with Run / Stop, Speed, Laps, a policy
 * for a start while it runs and a cap on pulses; every signal gets a place in
 * the graph (on its own, a chain, a branch, a merge, a loop) — in the kit,
 * the engine, the file and the web runtime.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});
import { SG_LOOP_PULSES, sgLinkDue, sgLinkFire, sgLinkNew, sgLinkPlan } from '../kit/signals.js';
import { mapSignal } from '../playRefs';
import { addLink, removeLink, setLoop, signalStructure } from '../../components/play/signalFlow';
import { playEngine } from '../../lib/playEngine';
import { inputBus } from '../../lib/inputBus';
import { conditionRanges } from '../conditionRange';
import { kitScript } from '../exportHtml';
import runtimeSource from '../runtime/play-runtime.js?raw';
import { defaultLayer, emptyPlayRecord, parsePlayRecord, type PlayControl, type PlayLayer, type PlayLoop, type PlayRecord, type PlaySignal, type TriggerSpec } from '../../types/play';

afterEach(() => { playEngine.setRecord(emptyPlayRecord()); playEngine.setBaseValues(new Map()); });

const ring = (delay = 0.2, loop?: Partial<PlayLoop>): { signals: PlaySignal[]; loops?: PlayLoop[] } => ({
  signals: [
    { id: 'a', name: 'A', when: { kind: 'trigger', trigger: { on: 'value', value: 'ctl:src', cmp: 'crossUp', threshold: 0.5, hysteresis: 0, tolerance: 0 } }, links: [{ to: 'b', delay }] },
    { id: 'b', name: 'B', links: [{ to: 'c', delay }] },
    { id: 'c', name: 'C', links: [{ to: 'a', delay }] },
  ],
  ...(loop ? { loops: [{ key: 'a|b|c', ...loop }] } : {}),
});

describe('the kit', () => {
  it('finds loops, their period and whether they branch; a chain is no loop', () => {
    const plan = sgLinkPlan(ring(0.25).signals, [{ key: 'a|b|c', speed: 2 }]);
    expect(plan.loops).toEqual([expect.objectContaining({ key: 'a|b|c', members: ['a', 'b', 'c'], period: 0.375, speed: 2, laps: 0, running: true, policy: 'ignore', branches: false })]);
    expect(sgLinkPlan([{ id: 'x', links: [{ to: 'y', delay: 1 }] }, { id: 'y' }]).loops).toEqual([]);
    expect(sgLinkPlan([{ id: 'x', links: [{ to: 'x', delay: 1 }] }]).loops.map(l => l.key)).toEqual(['x']);
    const branchy = sgLinkPlan([{ id: 'x', links: [{ to: 'y', delay: 0 }, { to: 'z', delay: 0 }] }, { id: 'y', links: [{ to: 'x', delay: 0 }] }, { id: 'z', links: [{ to: 'x', delay: 0 }] }]);
    expect(branchy.loops[0].branches).toBe(true);
  });

  it('schedules on, caps pulses in a loop, counts laps from where it was started, and ignores a second start by default', () => {
    const plan = sgLinkPlan(ring(0.1, { laps: 2 }).signals, [{ key: 'a|b|c', laps: 2 }]);
    const st = sgLinkNew();
    const sent: string[] = [];
    let t = 0;
    const fire = (id: string, external: boolean) => sgLinkFire(st, plan, id, t, 'rise', external);
    fire('a', true);
    fire('a', true); // ignored: one already going round
    for (let i = 0; i < 20; i++) { t += 0.05; for (const id of sgLinkDue(st, t)) { sent.push(id); fire(id, false); } }
    // Two laps: b c a b c, then the pulse arriving back at a is dropped.
    expect(sent).toEqual(['b', 'c', 'a', 'b', 'c']);
    expect(st.inFlight.get('a|b|c') ?? 0).toBe(0);
    expect(SG_LOOP_PULSES).toBe(16);
  });
});

describe('the file and the helpers', () => {
  it('keeps links to signals of the setup and loop settings; renames links', () => {
    const rec = parsePlayRecord({ version: 1, layers: [], controls: [], mappings: [], signals: [
      { id: 'a', name: 'A', links: [{ to: 'b', delay: 0.5 }, { to: 'gone', delay: 1 }, { to: 'a', delay: 99, on: 'fall' }] }, { id: 'b', name: 'B' },
    ], loops: [{ key: 'a', speed: 50, laps: 3.4, running: false, policy: 'add', name: '  Ring ' }] });
    expect(rec?.signals?.[0].links).toEqual([{ to: 'b', delay: 0.5 }, { to: 'a', delay: 10, on: 'fall' }]);
    expect(rec?.loops).toEqual([{ key: 'a', name: 'Ring', speed: 20, laps: 3, running: false, policy: 'add' }]);
    expect(mapSignal(rec!.signals![0], (_k, id) => `${id}2`).links?.map(l => l.to)).toEqual(['b2', 'a2']);
    const p: PlayRecord = { ...emptyPlayRecord(), signals: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] };
    const linked = addLink(p, 'a', { to: 'b', delay: 1 });
    expect(linked.signals?.[0].links).toEqual([{ to: 'b', delay: 1 }]);
    expect(removeLink(linked, 'a', 0).signals?.[0].links).toBeUndefined();
    expect(setLoop(setLoop(p, 'a|b', { speed: 2 }), 'a|b', { laps: 4 }).loops).toEqual([{ key: 'a|b', speed: 2, laps: 4 }]);
  });

  it('a pair mapping on a captured position, an event spot or the picture pointer survives a reload', () => {
    const raw = {
      version: 1, layers: [defaultLayer('particles', 'p', 'P')], mappings: [], signals: [{ id: 's', name: 'S' }],
      controls: [{ id: 'x', target: 'layer:p::x', kind: 'float', label: 'X', min: 0, max: 1 }, { id: 'y', target: 'layer:p::y', kind: 'float', label: 'Y', min: 0, max: 1 }],
      pairs: [{ id: 'pr', label: 'P', a: 'x', b: 'y', position: true }],
      pairMappings: ['sig:s', 'ev:p:annihilate', 'pointer', 'ev:gone:born'].map((anchor, i) => ({ id: `pm${i}`, pairId: 'pr', affect: 'both', enabled: true, source: { kind: 'position', anchor },
        a: { outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0 }, b: { outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0 } })),
    };
    expect(parsePlayRecord(raw)?.pairMappings?.map(m => m.id)).toEqual(['pm0', 'pm1', 'pm2']);
  });

  it('labels where each signal sits', () => {
    const play: PlayRecord = { ...emptyPlayRecord(), signals: [
      { id: 'lone', name: 'Lone' },
      { id: 's', name: 'S', links: [{ to: 'm', delay: 0 }] }, { id: 'm', name: 'M', links: [{ to: 'e', delay: 0 }] }, { id: 'e', name: 'E' },
      { id: 'fan', name: 'Fan', links: [{ to: 'x', delay: 0 }, { to: 'y', delay: 0 }] }, { id: 'x', name: 'X' }, { id: 'y', name: 'Y' },
      { id: 'both', name: 'Both', when: { kind: 'logic', op: 'and', inputs: ['x', 'y'] } },
      ...ring().signals,
    ] };
    const shape = signalStructure(play);
    expect(Object.fromEntries(['lone', 's', 'm', 'e', 'fan', 'both', 'a'].map(id => [id, shape.get(id)]))).toEqual({ lone: 'isolated', s: 'start', m: 'middle', e: 'end', fan: 'branch', both: 'merge', a: 'loop' });
  });
});

// ── The engine and the website ───────────────────────────────────────────────

const control = (id: string): PlayControl => ({ id, target: `n::${id}`, kind: 'float', label: id, min: 0, max: 1 });
const sparks = () => ({ ...defaultLayer('particles', 'p', 'Sparks'), emit: 'burst' }) as PlayLayer;
const onSig = (signal: string): TriggerSpec => ({ on: 'signal', signal });

function drive(values: number[], from = 1): string[][] {
  const heard: string[][] = [];
  let now: string[] = [];
  const off = playEngine.onSignal(id => now.push(id));
  let t = from;
  for (const v of values) { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(0.1, (t += 0.1)); heard.push(now); now = []; }
  off();
  return heard;
}

describe('in the engine', () => {
  it('a key starts the ring; it goes round every 0.2 s a link, and Laps stops it', () => {
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [sparks()], ...ring(0.2, { laps: 1 }) });
    const heard = drive([0, 1, 1, 1, 1, 1, 1, 1, 1, 1]).map(h => h.join(''));
    // A crosses on frame 2; B two frames later, C two after, then back at A ends the one lap.
    expect(heard).toEqual(['', 'a', '', 'b', '', 'c', '', '', '', '']);
    expect(playEngine.loops().map(l => l.key)).toEqual(['a|b|c']);
  });

  it('a stopped loop sends nothing round; speed scales the delays', () => {
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [sparks()], ...ring(0.2, { running: false }) });
    expect(drive([0, 1, 1, 1, 1]).flat()).toEqual(['a']);
    playEngine.setRecord({ ...emptyPlayRecord(), controls: [control('src')], layers: [sparks()], ...ring(0.2, { speed: 2 }) });
    const heard = drive([0, 1, 1, 1, 1, 1, 1, 1], 0.2).map(h => h.join(''));
    expect(heard.slice(0, 6)).toEqual(['', 'a', 'b', 'c', 'a', 'b']);
  });
});

describe('the web runtime', () => {
  it('goes round the same way as the app', () => {
    const rec: PlayRecord = {
      ...emptyPlayRecord(), controls: [control('src'), control('n')], layers: [sparks()], ...ring(0.2, { laps: 2 }),
      mappings: [{ id: 'm', controlId: 'n', source: { kind: 'trigger', trigger: onSig('c'), mode: 'step', attack: 0, decay: 0, sustain: 1, release: 0, steps: 4, velocity: false }, outMin: 0, outMax: 1, curve: 'linear', smoothMs: 0, enabled: true }],
    };
    const values = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    playEngine.setRecord(rec);
    const app: Array<number | undefined> = [];
    // Earlier on the clock than the tests before: a rewind, so nothing of theirs is still going round.
    let t = 0;
    for (const v of values) { playEngine.setBaseValues(new Map([['src', v]])); inputBus.tick(0.1, (t += 0.1)); app.push(playEngine.liveValue('n') as number | undefined); }
    const web = runtimeRun(rec, values, 'n');
    expect(web).toEqual(app);
    // Two laps: C sets it off twice (a step's first press is step 0, the second 1/3).
    expect(app[app.length - 1]).toBeCloseTo(1 / 3);
  });
});

class El {
  tagName: string; children: El[] = []; style: Record<string, string> = {}; className = ''; textContent = ''; innerHTML = ''; parentElement: El | null = null;
  width = 300; height = 150; clientWidth = 400; clientHeight = 300; value = ''; disabled = false; dataset = {};
  classList = { add() {}, remove() {}, toggle() {} };
  constructor(tag: string) { this.tagName = tag.toUpperCase(); }
  append(...c: El[]) { for (const e of c) { e.parentElement = this; this.children.push(e); } }
  appendChild(c: El) { this.append(c); return c; }
  prepend(...c: El[]) { this.append(...c); }
  replaceChildren(...c: El[]) { this.children = []; this.append(...c); }
  remove() {} setAttribute() {} removeAttribute() {} addEventListener() {} removeEventListener() {} setPointerCapture() {}
  load() {} pause() {} play() { return Promise.resolve(); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 }; }
  getContext(kind: string) {
    if (kind === '2d') return new Proxy({}, { get: (_t, k) => (k === 'canvas' ? this : () => ({ data: new Uint8ClampedArray(4) })) });
    return new Proxy({}, { get: (_t, k: string) => (/^[A-Z0-9_]+$/.test(k) ? 1 : k === 'getShaderParameter' || k === 'getProgramParameter' ? () => true : k === 'checkFramebufferStatus' ? () => 1 : k === 'getExtension' ? () => ({}) : () => ({})) });
  }
}

function runtimeRun(play: PlayRecord, values: number[], read: string) {
  const rafs: ((t: number) => void)[] = [];
  const win: Record<string, unknown> = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) };
  const doc = { head: new El('head'), hidden: false, getElementById: () => null, createElement: (tag: string) => new El(tag), addEventListener() {}, removeEventListener() {} };
  const noop = class { observe() {} disconnect() {} };
  const fn = new Function('window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'IntersectionObserver', 'Image', 'URL', `${kitScript()}\n${runtimeSource}`);
  fn(win, doc, {}, (cb: (t: number) => void) => { rafs.push(cb); return rafs.length; }, () => {}, noop, noop, El.bind(null, 'img'), { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  const api = win.ShaderStudioPlay as { mount: (el: unknown, b: unknown, o?: unknown) => { set(id: string, v: number): void; get(id: string): { value: number; driven: boolean } | null } };
  const bindings = Object.fromEntries(play.controls.map(c => [c.target, `u_${c.id}`]));
  const uniforms = Object.fromEntries(play.controls.map(c => [`u_${c.id}`, { type: 'float', value: 0 }]));
  const h = api.mount(new El('div'), { title: 'T', fragmentShader: 'void main(){}', uniforms, paramBindings: bindings, play: { ...play, condRanges: conditionRanges(play) }, aspect: { id: 'free', ratio: null } }, { mode: 'player', panel: false });
  let now = 1000;
  return values.map(v => {
    h.set('src', v);
    rafs.shift()?.((now += 100));
    const g = h.get(read);
    return g?.driven ? g.value : undefined;
  });
}
