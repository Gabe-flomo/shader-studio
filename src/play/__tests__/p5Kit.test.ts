/**
 * p5 compatibility in the layer kit (kit/p5.js) and multi-file sketches: files
 * share one scope in order, errors point at file:line, p5 drawing calls reach
 * the canvas as p5 would make them, noise and random are deterministic when
 * seeded, vectors and HSB colour do their maths, DOM controls read the
 * layer's controls, and a restart control starts the sketch over.
 */
import { describe, expect, it } from 'vitest';
import { klSketchCompile, klSketchPress, klSketchSource, klSketchStale, klSketchStep, klStripModules } from '../kit/layers.js';
import { kp5Event, kp5Levels, kp5Lcg, kp5Noise, kp5Vector } from '../kit/p5.js';
import { extractScriptParams } from '../../components/play/layers/scriptExamples';

type Op = [string, ...unknown[]];
/** A 2D context that records what is drawn (and keeps the state a sketch reads back). */
function fakeCanvas(w: number, h: number) {
  const ops: Op[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over', font: '10px sans-serif', imageSmoothingEnabled: true };
  const canvas: Record<string, unknown> = { width: w, height: h, ops };
  const data = () => new Uint8ClampedArray((canvas.width as number) * (canvas.height as number) * 4);
  let pixels = data();
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'canvas') return canvas;
      if (k in t) return t[k];
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (k === 'getImageData') return (x: number, y: number, ww: number, hh: number) => { if (pixels.length !== (canvas.width as number) * (canvas.height as number) * 4) pixels = data(); ops.push(['getImageData', x, y, ww, hh]); return { data: ww === canvas.width ? pixels : new Uint8ClampedArray(ww * hh * 4), width: ww, height: hh }; };
      return (...a: unknown[]) => { ops.push([k, ...a]); };
    },
    set(t, k: string, v) { t[k] = v; ops.push(['set:' + k, v]); return true; },
  });
  canvas.getContext = () => ctx;
  return canvas as { width: number; height: number; ops: Op[]; getContext: () => CanvasRenderingContext2D };
}
const made: Array<ReturnType<typeof fakeCanvas>> = [];
const makeCanvas = (w: number, h: number) => { const c = fakeCanvas(w, h); made.push(c); return c; };

const W = 800, H = 400;
function frame(layer: ReturnType<typeof fakeCanvas>, i: number, params: Record<string, unknown> = {}, mouse = { x: 400, y: 200, over: true, down: false }) {
  return { ctx: layer.getContext(), width: W, height: H, dpr: 1, time: i / 60, dt: 1 / 60, frame: i, params, state: {}, mouse, picture: { brightness: () => 0 }, null: () => null, random: kp5Lcg(7) } as Record<string, unknown>;
}
function p5(code: string, opts: Record<string, unknown> = {}) {
  made.length = 0;
  const logs: Array<[string, unknown[]]> = [];
  const st = klSketchCompile(code, { makeCanvas, log: (level, args) => logs.push([level, args]), ...opts });
  const layer = fakeCanvas(W, H);
  const run = (i: number, params: Record<string, unknown> = {}, mouse?: { x: number; y: number; over: boolean; down: boolean }, defs: Array<Record<string, unknown>> = []) =>
    klSketchStep(st, frame(layer, i, params, mouse), defs as never, false);
  return { st, layer, logs, run, sketch: () => made[made.length - 1] };
}
const opsOf = (c: { ops: Op[] }, name: string) => c.ops.filter(o => o[0] === name);

describe('multi-file sketches', () => {
  it('runs the other files first in one scope: classes, functions and variables are shared', () => {
    const files = [
      { name: 'particle.js', code: 'class Particle { constructor(x) { this.x = x; } step() { this.x += SPEED; } }' },
      { name: 'util.js', code: 'const SPEED = 2;\nfunction make(n) { const out = []; for (let i = 0; i < n; i++) out.push(new Particle(i)); return out; }' },
    ];
    const st = klSketchCompile('let ps;\nfunction setup(s) { ps = make(3); }\nfunction draw(s) { for (const p of ps) p.step(); s.state.xs = ps.map(p => p.x); }', { files });
    expect(st.error).toBeNull();
    const layer = fakeCanvas(W, H);
    const f = frame(layer, 0);
    expect(klSketchStep(st, f, [], true)).toBeNull();
    expect(st.state.xs).toEqual([2, 3, 4]);
  });
  it('drops import and export between files, keeping line numbers', () => {
    const src = "import { Particle } from './particle.js';\nexport class A {}\nexport default function f() {}\nexport const k = 1;\nexport { A };\nlet x = 1;";
    const out = klStripModules(src);
    expect(out.split('\n')).toHaveLength(6);
    expect(out).not.toMatch(/\b(import|export)\b/);
    expect(out).toContain('class A {}');
    const st = klSketchCompile("import { k2 } from './b.js';\nfunction draw(s) { s.state.v = k2 + k; }", { files: [{ name: 'b.js', code: 'export const k2 = 40;\nexport let k = 2;' }] });
    expect(st.error).toBeNull();
    const f = frame(fakeCanvas(W, H), 0);
    klSketchStep(st, f, [], true);
    expect(st.state.v).toBe(42);
  });
  it('puts a runtime error at its file and line', () => {
    const files = [{ name: 'helpers.js', code: '// helpers\nfunction boom() {\n  return nope.x;\n}' }];
    const st = klSketchCompile('function draw(s) {\n  boom();\n}', { files });
    const err = klSketchStep(st, frame(fakeCanvas(W, H), 0), [], true);
    expect(err).toBe('Runtime (helpers.js:3): nope is not defined');
    expect(st.errorAt).toEqual({ file: 'helpers.js', line: 3 });
  });
  it('names the file with a syntax error', () => {
    const st = klSketchCompile('function draw(s) {}', { files: [{ name: 'bad.js', code: 'function oops( {' }] });
    expect(st.error).toMatch(/^Compile \(bad\.js\): /);
  });
  it('the source map covers each file in order, the main file last', () => {
    const { map } = klSketchSource('a\nb', [{ name: 'one.js', code: 'x' }, { name: 'two.js', code: 'y\nz\nw' }]);
    expect(map).toEqual([{ name: 'one.js', from: 1, to: 1 }, { name: 'two.js', from: 2, to: 4 }, { name: 'sketch.js', from: 5, to: 6 }]);
  });
  it('recompiles when a file changes, and reads params declared in any file', () => {
    const files = [{ name: 'a.js', code: 'const params = { speed: { value: 2, min: 0, max: 5 } };' }];
    const st = klSketchCompile('function draw(s) {}', { files });
    expect(klSketchStale(st, 'function draw(s) {}', files, '2d', null)).toBe(false);
    expect(klSketchStale(st, 'function draw(s) {}', [{ name: 'a.js', code: '' }], '2d', null)).toBe(true);
    const r = extractScriptParams('function draw(s) {}', files);
    expect(r.ok && r.defs.map(d => d.key)).toEqual(['speed']);
  });
});

describe('p5 sketches', () => {
  it('draws on a canvas of createCanvas’s size, fitted into the layer, and keeps it between frames', () => {
    const { st, layer, run, sketch } = p5('function setup() { createCanvas(200, 100); background(20); }\nfunction draw() { fill(255, 0, 0); noStroke(); ellipse(50, 50, 20, 10); }');
    expect(st.error).toBeNull();
    expect(run(0)).toBeNull();
    const c = sketch();
    // Fit: 200×100 into 800×400 is ×4; the density follows it, up to 3.
    expect([c.width, c.height]).toEqual([600, 300]);
    expect(opsOf(c, 'fillRect')[0]).toEqual(['fillRect', 0, 0, 600, 300]);
    expect(opsOf(c, 'ellipse')[0]).toEqual(['ellipse', 50, 50, 10, 5, 0, 0, Math.PI * 2]);
    expect(c.ops.find(o => o[0] === 'set:fillStyle' && o[1] === 'rgba(255, 0, 0, 1)')).toBeTruthy();
    // Nothing clears the sketch's own canvas: p5 keeps what was drawn.
    expect(opsOf(c, 'clearRect')).toHaveLength(0);
    // The layer gets the sketch's canvas, fitted and centred.
    expect(opsOf(layer, 'drawImage').at(-1)).toEqual(['drawImage', c, 0, 0, 800, 400]);
    run(1);
    expect(opsOf(c, 'ellipse')).toHaveLength(2);
    expect(st.p5!.frameCount).toBe(2);
  });
  it('maps the mouse into the sketch’s pixels and calls mousePressed / mouseReleased / mouseDragged', () => {
    const { run: run2, st: st2, logs } = p5('function setup() { createCanvas(400, 400); }\nfunction draw() {}\nfunction mousePressed() { print("down", mouseX, mouseY); }\nfunction mouseDragged() { print("drag", pmouseX, mouseX); }\nfunction mouseReleased() { print("up"); }\nfunction mouseClicked() { print("click"); }');
    run2(0, {}, { x: 300, y: 100, over: true, down: false });
    run2(1, {}, { x: 300, y: 100, over: true, down: true });
    run2(2, {}, { x: 310, y: 120, over: true, down: true });
    run2(3, {}, { x: 310, y: 120, over: true, down: false });
    expect(st2.p5!.mouseX).toBe(110);
    expect(st2.p5!.mouseY).toBe(120);
    expect(logs.map(l => l[1])).toEqual([['down', 100, 100], ['drag', 100, 110], ['up'], ['click']]);
  });
  it('delivers keys to keyPressed with key and keyCode', () => {
    const { run, logs } = p5('function setup() { createCanvas(100, 100); }\nfunction draw() {}\nfunction keyPressed() { print("key", key, keyCode); }\nfunction keyTyped() { print("typed", key); }');
    run(0);
    kp5Event({ type: 'down', key: 'a', keyCode: 65 });
    kp5Event({ type: 'up', key: 'a', keyCode: 65 });
    run(1);
    expect(logs.filter(l => l[0] === 'log').map(l => l[1])).toEqual([['key', 'a', 65], ['typed', 'a']]);
  });
  it('p5 defaults: white fill and black 1px stroke; push/pop keep the style; arcs are wedges when filled', () => {
    const { run, sketch } = p5('function setup() { createCanvas(100, 100); noLoop(); }\nfunction draw() { push(); fill(0, 0, 255); stroke(9); pop(); rect(10, 10, 20, 20); arc(50, 50, 40, 40, 0, HALF_PI); line(0, 0, 10, 10); noStroke(); line(0, 0, 5, 5); }');
    run(0);
    const c = sketch();
    const sets = c.ops.filter(o => o[0] === 'set:fillStyle' || o[0] === 'set:strokeStyle').map(o => `${o[0]}=${o[1]}`);
    expect(sets).toContain('set:fillStyle=rgba(255, 255, 255, 1)');
    expect(sets).toContain('set:strokeStyle=rgba(0, 0, 0, 1)');
    expect(sets).not.toContain('set:fillStyle=rgba(0, 0, 255, 1)');
    expect(opsOf(c, 'moveTo')[0]).toEqual(['moveTo', 50, 50]); // the wedge's centre
    // line() with no stroke draws nothing.
    expect(opsOf(c, 'lineTo').filter(o => o[1] === 5)).toHaveLength(0);
    // noLoop: draw ran once.
    run(1); run(2);
    expect(opsOf(c, 'rect')).toHaveLength(1);
  });
  it('colorMode(HSB): hue, saturation, brightness to RGB; reads back', () => {
    expect(kp5Levels([0, 100, 100], 'hsb').map(Math.round)).toEqual([255, 0, 0, 255]);
    expect(kp5Levels([120, 100, 50], 'hsb').map(Math.round)).toEqual([0, 128, 0, 255]);
    expect(kp5Levels([240, 100, 50], 'hsl').map(Math.round)).toEqual([0, 0, 255, 255]);
    expect(kp5Levels([0.5, 1, 1, 0.5], 'hsb', [1, 1, 1, 1]).map(Math.round)).toEqual([0, 255, 255, 128]);
    const { run, logs } = p5('function setup() { createCanvas(10, 10); colorMode(HSB); const c = color(200, 60, 80); print(round(hue(c)), round(saturation(c)), round(brightness(c))); print(red(color(0, 100, 100)), lerpColor(color(0, 100, 100), color(120, 100, 100), 0.5).toString()); }\nfunction draw() {}');
    run(0);
    expect(logs[0][1]).toEqual([200, 60, 80]);
    expect(logs[1][1][0]).toBe(255);
    expect(logs[1][1][1]).toBe('rgba(255, 255, 0, 1)'); // through hue: red → yellow → green
  });
  it('noise: the same seed gives the same field; noiseDetail changes it; values stay 0–1', () => {
    const a = kp5Noise(Math.random), b = kp5Noise(Math.random);
    a.seed(42); b.seed(42);
    const xs = [0, 0.1, 1.7, 13.2, 99.5];
    expect(xs.map(x => a.at(x, x * 0.5))).toEqual(xs.map(x => b.at(x, x * 0.5)));
    for (const x of xs) { const v = a.at(x, 3, 2); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    b.octaves = 1;
    expect(b.at(1.7, 0.85)).not.toBe(a.at(1.7, 0.85));
    // Smooth: nearby inputs give nearby values.
    expect(Math.abs(a.at(5, 5) - a.at(5.001, 5))).toBeLessThan(0.01);
    const { run, logs } = p5('function setup() { createCanvas(10, 10); noiseSeed(3); randomSeed(9); print(noise(0.5), random(), random(10, 20)); noiseSeed(3); randomSeed(9); print(noise(0.5), random(), random(10, 20)); }\nfunction draw() {}');
    run(0);
    expect(logs[0][1]).toEqual(logs[1][1]);
  });
  it('p5.Vector maths', () => {
    const v = new kp5Vector(3, 4);
    expect(v.mag()).toBe(5);
    expect(v.copy().normalize().mag()).toBeCloseTo(1);
    expect(v.copy().limit(2).mag()).toBeCloseTo(2);
    expect(v.copy().setMag(10).array().map(n => Math.round(n))).toEqual([6, 8, 0]);
    expect(kp5Vector.add(new kp5Vector(1, 2), new kp5Vector(3, 4)).array()).toEqual([4, 6, 0]);
    expect(new kp5Vector(1, 0).rotate(Math.PI / 2).array().map(n => Math.round(n * 1000) / 1000)).toEqual([0, 1, 0]);
    expect(new kp5Vector(1, 0).heading()).toBe(0);
    expect(new kp5Vector(0, 1).angleBetween(new kp5Vector(1, 0))).toBeCloseTo(-Math.PI / 2);
    expect(new kp5Vector(1, 2, 3).dot(new kp5Vector(4, 5, 6))).toBe(32);
    expect(new kp5Vector(1, 0, 0).cross(new kp5Vector(0, 1, 0)).array()).toEqual([0, 0, 1]);
    expect(new kp5Vector(2, 4).div(2).array()).toEqual([1, 2, 0]);
    expect(new kp5Vector(2, 4).div(0).array()).toEqual([2, 4, 0]);
    expect(kp5Vector.fromAngle(0, 5).array()).toEqual([5, 0, 0]);
    const { run, logs } = p5('function setup() { createCanvas(10, 10); const a = createVector(1, 1); a.add(p5.Vector.mult(createVector(1, 0), 2)); print(a.x, a.y); }\nfunction draw() {}');
    run(0);
    expect(logs[0][1]).toEqual([3, 1]);
  });
  it('instance mode: new p5(p => { p.setup = …; p.draw = … })', () => {
    const { st, run, sketch } = p5('new p5(p => {\n  p.setup = () => { p.createCanvas(100, 50); };\n  p.draw = () => { p.background(255, 0, 0); p.rect(0, 0, p.width / 2, p.height); };\n});');
    expect(st.error).toBeNull();
    run(0);
    const c = sketch();
    expect(st.p5!.sf.w).toBe(100);
    expect(opsOf(c, 'rect')[0]).toEqual(['rect', 0, 0, 50, 50]);
  });
  it('preload waits for files; loadJSON and loadStrings read the project’s files', () => {
    const assets = [{ name: 'data/points.json', kind: 'json', data: '{"n": 3}' }, { name: 'words.txt', kind: 'text', data: 'a\nb' }];
    const { run, logs } = p5('let d, w;\nfunction preload() { d = loadJSON("data/points.json"); w = loadStrings("./words.txt"); }\nfunction setup() { createCanvas(10, 10); print(d.n, w.length); }\nfunction draw() {}', { assets });
    run(0);
    expect(logs[0]).toEqual(['log', [3, 2]]);
  });
  it('frameRate(n) runs draw at that rate; redraw draws once after noLoop', () => {
    const { st, run } = p5('function setup() { createCanvas(10, 10); frameRate(20); }\nfunction draw() {}');
    for (let i = 0; i < 60; i++) run(i);
    expect(st.p5!.frameCount).toBeGreaterThanOrEqual(19);
    expect(st.p5!.frameCount).toBeLessThanOrEqual(21);
  });
  it('createGraphics draws on a buffer of its own that image() puts on the canvas', () => {
    const { run } = p5('let g;\nfunction setup() { createCanvas(100, 100); g = createGraphics(20, 10); g.background(255, 0, 0); g.circle(5, 5, 4); }\nfunction draw() { image(g, 10, 20); }');
    run(0);
    const buf = made.find(c => c.width === 20 && c.height === 10)!;
    expect(opsOf(buf, 'fillRect')[0]).toEqual(['fillRect', 0, 0, 20, 10]);
    expect(opsOf(buf, 'ellipse')).toHaveLength(1);
    const main = made.find(c => c.width === 800 && c.height === 800) ?? made.find(c => c.ops.some(o => o[0] === 'drawImage'))!;
    expect(main.ops.some(o => o[0] === 'drawImage' && o[1] === buf && o[2] === 10 && o[3] === 20)).toBe(true);
  });
  it('pixels: loadPixels reads the canvas at density 1 when the sketch uses them', () => {
    const { st, run, sketch } = p5('function setup() { createCanvas(40, 20); }\nfunction draw() { loadPixels(); pixels[0] = 255; updatePixels(); }');
    run(0);
    expect(st.p5!.sf.d).toBe(1);
    expect(opsOf(sketch(), 'putImageData')).toHaveLength(1);
  });
  it('DOM controls read the layer’s declared controls; unknown page elements do nothing', () => {
    const code = `const params = {
  speed: { value: 2, min: 0, max: 10, label: 'Speed' },
  shape: { kind: 'choice', options: ['circle', 'square'], value: 'circle', label: 'Shape' },
  tint: { kind: 'colour', value: '#ff8000', label: 'Tint' },
  trails: { kind: 'toggle', value: true, label: 'Trails' },
};
let speedSlider = control('speed'), shapeSelect = control('shape'), tintPicker = control('tint'), trailsBox = control('trails');
let changed = 0;
function setup() { createCanvas(10, 10); createDiv('hello').position(0, 0).style('color', 'red'); speedSlider.changed(() => changed++); }
function draw() { print(speedSlider.value(), shapeSelect.value(), tintPicker.value(), trailsBox.checked(), changed); }`;
    const r = extractScriptParams(code);
    expect(r.ok).toBe(true);
    const defs = r.ok ? r.defs : [];
    expect(defs.map(d => [d.key, d.kind ?? 'slider', d.value])).toEqual([['speed', 'slider', 2], ['shape', 'choice', 0], ['tint', 'colour', 0xff8000], ['trails', 'toggle', 1]]);
    const { run, logs } = p5(code);
    run(0, { speed: 2, shape: 1, tint: 0x00ff00, trails: 1 }, undefined, defs as never);
    run(1, { speed: 7, shape: 0, tint: 0x00ff00, trails: 0 }, undefined, defs as never);
    expect(logs.map(l => l[1])).toEqual([[2, 'square', '#00ff00', true, 0], [7, 'circle', '#00ff00', false, 1]]);
  });
  it('a createSlider without the importer keeps its own value; unsupported calls say so', () => {
    const { run, logs } = p5('let s;\nfunction setup() { createCanvas(10, 10); s = createSlider(0, 100, 30, 1); }\nfunction draw() { print(s.value()); }');
    run(0);
    expect(logs[0][1]).toEqual([30]);
    const bad = p5('function setup() { createCanvas(10, 10); loadShader("a.vert", "a.frag"); }');
    expect(bad.run(0)).toMatch(/loadShader\(\) is not supported/);
    expect(bad.logs.some(l => l[0] === 'error')).toBe(true);
  });
  it('a control marked restart starts the sketch over when it moves', () => {
    const code = 'const params = { count: { value: 5, min: 1, max: 50, step: 1, restart: true } };\nlet count = 5;\nlet ps = [];\nfunction setup() { createCanvas(10, 10); for (let i = 0; i < count; i++) ps.push(i); }\nfunction draw() { watch("n", ps.length); }';
    const r = extractScriptParams(code);
    const defs = r.ok ? r.defs : [];
    expect(defs[0].restart).toBe(true);
    const { st, run } = p5(code);
    run(0, { count: 5 }, undefined, defs as never);
    run(1, { count: 5 }, undefined, defs as never);
    expect(st.wantRestart).toBe(false);
    run(2, { count: 9 }, undefined, defs as never);
    expect(st.wantRestart).toBe(true);
    expect(klSketchStale(st, code, null, '2d', null)).toBe(true);
    // Run (the editor's button) asks the same way.
    const again = klSketchCompile(code, { makeCanvas });
    klSketchPress(again, '__restart');
    expect(klSketchStale(again, code, null, '2d', null)).toBe(true);
  });
  it('the console goes to the host: print, console.*, watch and runtime errors', () => {
    const { run, logs } = p5('function setup() { createCanvas(10, 10); console.warn("careful"); console.table([{ a: 1 }]); }\nfunction draw() { watch("frame", frameCount); if (frameCount > 1) nope(); }');
    run(0); run(1);
    expect(logs.map(l => l[0])).toEqual(['warn', 'table', 'watch', 'watch', 'error']);
    expect(logs[2][1]).toEqual(['frame', 1]);
    expect(String(logs[4][1][0])).toMatch(/^Runtime \(sketch\.js:2\): nope is not defined/);
  });
  it('a plain (non-p5) sketch keeps its old behaviour and also gets the console', () => {
    const logs: unknown[][] = [];
    const st = klSketchCompile('function draw(s) { print("hi", s.width); fill(255); circle(1, 2, 3); }', { log: (_l, a) => logs.push(a) });
    expect(st.p5).toBeNull();
    const layer = fakeCanvas(W, H);
    klSketchStep(st, frame(layer, 0), [], true);
    expect(logs).toEqual([['hi', 800]]);
    expect(opsOf(layer, 'arc')[0]).toEqual(['arc', 1, 2, 1.5, 0, Math.PI * 2]);
  });
});
