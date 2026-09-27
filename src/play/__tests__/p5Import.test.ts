import { describe, expect, it } from 'vitest';
import { parse } from 'acorn';
import { strToU8, zipSync, unzipSync } from 'fflate';
import {
  analyzeProject, applyControls, assetToRecord, buildP5Layer, candidateAt, findControlCandidates, groupItems,
  mapDomControls, projectFromEntries, projectFromText, rangeFor, suggestControls, unmakeControl, paramKeys,
  type P5File,
} from '../p5import';

const enc = (s: string) => strToU8(s);
const entries = (files: Record<string, string | Uint8Array>) => Object.entries(files).map(([path, v]) => ({ path, bytes: typeof v === 'string' ? enc(v) : v }));
const parses = (code: string) => { parse(code, { ecmaVersion: 'latest', sourceType: 'script' }); return true; };
const main = (files: P5File[]) => files.find(f => f.name === 'sketch.js')!.code;

const INDEX = `<!DOCTYPE html>
<html><head><title>Flow field</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
<script src="libraries/p5.sound.min.js"></script>
<script src="libraries/p5.collide2d.js"></script>
<!-- <script src="old.js"></script> -->
<script src="particle.js"></script>
<script src="main.js"></script>
<script>
  const GREETING = 'hi';
</script>
</head><body></body></html>`;

describe('projectFromEntries', () => {
  it('reads index.html script order, skips p5 and addons, renames the sketch', () => {
    const p = projectFromEntries(entries({
      'myproj/index.html': INDEX,
      'myproj/libraries/p5.sound.min.js': '/* sound */',
      'myproj/libraries/p5.collide2d.js': '/* addon */',
      'myproj/particle.js': 'class Particle { constructor() { this.x = 0; } }',
      'myproj/main.js': 'function setup() { createCanvas(400, 400); }\nfunction draw() {}',
      'myproj/helpers.js': 'function helper() { return 1; }',
      'myproj/.DS_Store': 'junk',
      '__MACOSX/myproj/._main.js': 'junk',
      'myproj/style.css': 'body {}',
    }));
    expect(p.title).toBe('Flow field');
    expect(p.main.name).toBe('sketch.js');
    expect(p.main.path).toBe('main.js');
    expect(p.main.code).toContain('function setup');
    // particle.js, then the inline script (it comes after main.js, which is main), then the loose helpers.js.
    expect(p.files.map(f => f.name)).toEqual(['particle.js', 'inline-1.js', 'helpers.js']);
    expect(p.files[1].code).toContain("GREETING");
    const skipped = p.skipped.map(s => s.path);
    expect(skipped).toContain('https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js');
    expect(skipped).toContain('libraries/p5.sound.min.js');
    expect(p.skipped.find(s => s.path === 'libraries/p5.collide2d.js')?.unsupported).toBe(true);
    expect(p.skipped.find(s => s.path === 'libraries/p5.sound.min.js')?.unsupported).toBeFalsy();
    expect(p.skipped.find(s => s.path === 'style.css')).toBeTruthy();
    expect(skipped.some(s => s.includes('old.js'))).toBe(false);
    expect(p.notes.join(' ')).toMatch(/helpers\.js/);
    expect(p.notes.join(' ')).toMatch(/main\.js is the sketch, renamed sketch\.js/);
  });

  it('renames an extra tab called sketch.js, and warns about several setups', () => {
    const p = projectFromEntries(entries({
      'index.html': '<script src="p5.js"></script><script src="sketch.js"></script><script src="app.js"></script>',
      'p5.js': '/* p5 */',
      'sketch.js': 'function setup() {}',
      'app.js': 'function setup() {}\nfunction draw() {}',
    }));
    expect(p.main.path).toBe('app.js');
    expect(p.files.map(f => f.name)).toEqual(['sketch-2.js']);
    expect(p.warnings.join(' ')).toMatch(/each define setup or draw/);
    expect(p.skipped[0].reason).toMatch(/p5 itself/);
  });

  it('without index.html: every script, the sketch last, the others alphabetical', () => {
    const p = projectFromEntries(entries({
      'sketch.js': 'function draw() {}',
      'b.js': 'const B = 1;',
      'a.js': 'const A = 1;',
    }));
    expect(p.files.map(f => f.name)).toEqual(['a.js', 'b.js']);
    expect(p.main.path).toBe('sketch.js');
  });

  it('finds instance mode as the sketch', () => {
    const p = projectFromEntries(entries({ 'x.js': 'new p5(p => { p.draw = () => {}; });', 'y.js': 'const Y = 2;' }));
    expect(p.main.path).toBe('x.js');
  });

  it('reads a zip made of a folder', () => {
    const zip = zipSync({
      'proj/index.html': enc('<script src="sketch.js"></script>'),
      'proj/sketch.js': enc('function setup() { loadImage("assets/cat.png"); }'),
      'proj/assets/cat.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    });
    const files = unzipSync(zip);
    const p = projectFromEntries(Object.entries(files).map(([path, bytes]) => ({ path, bytes })));
    expect(p.main.code).toContain('loadImage');
    expect(p.assets.map(a => a.name)).toEqual(['assets/cat.png']);
  });
});

describe('assets', () => {
  it('sorts assets by kind, flags big ones and skips others', () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    const p = projectFromEntries(entries({
      'sketch.js': 'function setup() {}',
      'img/a.png': new Uint8Array([1, 2, 3]),
      'data.json': '{"a": 1}',
      'table.csv': 'a,b\n1,2',
      'font.ttf': new Uint8Array([0, 1]),
      'huge.json': big,
      'song.mp3': new Uint8Array([1]),
      'thing.xyz': 'x',
    }));
    const kinds = Object.fromEntries(p.assets.map(a => [a.name, a.kind]));
    expect(kinds).toEqual({ 'img/a.png': 'image', 'data.json': 'json', 'table.csv': 'text', 'font.ttf': 'font', 'huge.json': 'json' });
    expect(p.assets.find(a => a.name === 'huge.json')?.tooBig).toBe(true);
    expect(p.skipped.find(s => s.path === 'song.mp3')?.unsupported).toBe(true);
    expect(p.skipped.find(s => s.path === 'thing.xyz')).toBeTruthy();
    expect(p.skipped.find(s => s.path === 'huge.json')?.reason).toMatch(/Too big/);

    const png = assetToRecord(p.assets.find(a => a.name === 'img/a.png')!);
    expect(png.data).toBe('data:image/png;base64,AQID');
    const json = assetToRecord(p.assets.find(a => a.name === 'data.json')!);
    expect(json.data).toBe('{"a": 1}');
    expect(assetToRecord(p.assets.find(a => a.name === 'font.ttf')!).data).toBe('data:font/ttf;base64,AAE=');

    const built = buildP5Layer(p, analyzeProject([{ name: 'sketch.js', code: p.main.code }]));
    expect(built.patch.assets.map(a => a.name)).not.toContain('huge.json');
    expect(built.report.assetsTooBig).toBe(1);
  });
});

describe('analyzeProject', () => {
  const code = `let img;
let mic, amp;
function preload() {
  img = loadImage('assets/cat.png');
  song = loadSound('tune.mp3');
}
function setup() {
  createCanvas(400, 300);
  mic = new p5.AudioIn();
  amp = new p5.Amplitude();
  createDiv('hello');
  let s = createSlider(0, 10, 5);
}
function draw() {
  background(0);
  image(img, 0, 0);
  loadPixels();
  box(20);
  song.play();
  loadJSON('missing.json');
}
function fill() {}
`;
  const a = analyzeProject([{ name: 'sketch.js', code }], [{ name: 'assets/cat.png' }]);
  const find = (n: string) => a.items.find(i => i.name === n);

  it('sorts names by what they do here, with lines', () => {
    expect(find('background')).toMatchObject({ status: 'supported', refs: [{ file: 'sketch.js', line: 15 }] });
    expect(find('loadImage')?.status).toBe('mapped');
    expect(find('createSlider')?.status).toBe('mapped');
    expect(find('p5.AudioIn')?.status).toBe('mapped');
    expect(find('p5.Amplitude')?.status).toBe('mapped');
    expect(find('createCanvas')?.status).toBe('mapped');
    expect(find('createDiv')).toMatchObject({ status: 'stubbed', refs: [{ line: 11 }] });
    expect(find('loadSound')).toMatchObject({ status: 'unsupported', severity: 'error', refs: [{ line: 5 }] });
    expect(find('sound.play')).toMatchObject({ status: 'unsupported', refs: [{ line: 19 }] });
    expect(find('box')).toMatchObject({ status: 'unsupported', severity: 'warning' });
    // The sketch's own fill() shadows p5's.
    expect(find('fill')).toBeUndefined();
    expect(find('setup')?.status).toBe('supported');
    expect(a.callbacks).toEqual(['draw', 'preload', 'setup']);
    expect(a.preload).toBe(true);
    expect(a.usesPixels).toBe(true);
    expect(a.mode).toBe('2d');
    expect(a.canvas).toEqual({ width: 400, height: 300 });
    const g = groupItems(a.items);
    expect(g.unsupported.length).toBeGreaterThanOrEqual(3);
  });

  it('warns about assets the project does not have', () => {
    expect(a.warnings.some(w => /missing\.json/.test(w.message) && w.line === 20)).toBe(true);
    expect(a.warnings.some(w => /cat\.png/.test(w.message))).toBe(false);
  });

  it('WEBGL makes a 3D sketch, and 2D-only names warn', () => {
    const b = analyzeProject([{ name: 'sketch.js', code: 'function setup() { createCanvas(windowWidth, windowHeight, WEBGL); }\nfunction draw() { rotateX(1); box(50); loadPixels(); }' }]);
    expect(b.mode).toBe('3d');
    expect(b.canvas).toEqual({ width: 'window', height: 'window' });
    expect(b.items.find(i => i.name === 'box')?.status).toBe('supported');
    expect(b.items.find(i => i.name === 'WEBGL')?.status).toBe('mapped');
    expect(b.items.find(i => i.name === 'loadPixels')).toMatchObject({ status: 'unsupported', severity: 'warning' });
  });

  it('instance mode: p.name calls', () => {
    const b = analyzeProject([{ name: 'sketch.js', code: `const s = (p) => {\n  p.setup = () => { p.createCanvas(200, 200); };\n  p.draw = () => {\n    p.fill(255);\n    p.createCapture();\n  };\n};\nnew p5(s);` }]);
    expect(b.instance).toBe(true);
    expect(b.callbacks).toEqual(['draw', 'setup']);
    expect(b.items.find(i => i.name === 'fill')).toMatchObject({ status: 'supported', refs: [{ line: 4 }] });
    expect(b.items.find(i => i.name === 'createCapture')?.status).toBe('unsupported');
    expect(b.canvas).toEqual({ width: 200, height: 200 });
  });

  it('reports a syntax error with file and line', () => {
    const b = analyzeProject([{ name: 'a.js', code: 'const A = 1;' }, { name: 'sketch.js', code: 'function setup() {\n  let x = ;\n}' }]);
    expect(b.syntaxErrors).toHaveLength(1);
    expect(b.syntaxErrors[0]).toMatchObject({ file: 'sketch.js', line: 2 });
    expect(b.syntaxErrors[0].message).toMatch(/Unexpected token/);
  });

  it('accepts import / export (the kit strips them)', () => {
    const b = analyzeProject([{ name: 'sketch.js', code: "import { a } from './a.js';\nexport function draw() { circle(1, 2, 3); }" }]);
    expect(b.syntaxErrors).toHaveLength(0);
  });
});

describe('mapDomControls', () => {
  const code = `let speedSlider, showCheckbox, shapeSel, colorPicker, resetButton, modeRadio;
let speed;
function setup() {
  createCanvas(400, 400);
  speedSlider = createSlider(0, 10, 2, 0.5);
  speedSlider.position(10, 10);
  showCheckbox = createCheckbox('Show trails', true);
  shapeSel = createSelect();
  shapeSel.option('circles');
  shapeSel.option('Squares', 'squares');
  shapeSel.selected('squares');
  modeRadio = createRadio();
  modeRadio.option('a');
  modeRadio.option('b');
  colorPicker = createColorPicker('#ff7828');
  resetButton = createButton('Reset');
  resetButton.mousePressed(reset);
  createSlider(0, 1, 0.5, 0).position(10, 50);
}
function reset() {}
function draw() {
  speed = speedSlider.value();
}
`;
  const r = mapDomControls([{ name: 'sketch.js', code }]);
  const out = main(r.files);

  it('rewrites the create calls to control(key), keeping the rest', () => {
    expect(parses(out)).toBe(true);
    // speed is a top-level variable, so the key avoids it.
    expect(out).toContain("speedSlider = control('speedControl');");
    expect(out).toContain('speedSlider.position(10, 10);');
    expect(out).toContain("showCheckbox = control('show');");
    expect(out).toContain("shapeSel = control('shape');");
    expect(out).toContain("modeRadio = control('mode');");
    expect(out).toContain("colorPicker = control('color2')".replace('color2', r.controls.find(c => c.creator === 'createColorPicker')!.key));
    expect(out).toContain("resetButton = control('reset2')".replace('reset2', r.controls.find(c => c.creator === 'createButton')!.key));
    expect(out).toContain('resetButton.mousePressed(reset);');
    expect(out).toContain("control('slider2').position(10, 50);");
    expect(out).not.toMatch(/createSlider|createCheckbox|createSelect|createRadio|createColorPicker|createButton/);
  });

  it('writes params entries with ranges, defaults and options', () => {
    const e = Object.fromEntries(r.entries.map(x => [x.key, x.entry]));
    expect(e.speedControl).toBe("speedControl: { value: 2, min: 0, max: 10, step: 0.5, label: 'Speed' }");
    expect(e.show).toBe("show: { kind: 'toggle', value: true, label: 'Show trails' }");
    expect(e.shape).toBe("shape: { kind: 'choice', options: ['circles', 'squares'], value: 'squares', label: 'Shape' }");
    expect(e.mode).toBe("mode: { kind: 'choice', options: ['a', 'b'], value: 'a', label: 'Mode' }");
    const colourKey = r.controls.find(c => c.creator === 'createColorPicker')!.key;
    expect(e[colourKey]).toContain("kind: 'colour', value: '#ff7828'");
    const buttonKey = r.controls.find(c => c.creator === 'createButton')!.key;
    expect(e[buttonKey]).toContain("kind: 'button', label: 'Reset'");
    expect(e.slider2).toMatch(/value: 0\.5, min: 0, max: 1, step: 0\.001/);
    expect(r.startAt.shape).toBe(1);
    expect(r.startAt[colourKey]).toBe(0xff7828);
    expect(out.startsWith('const params = {')).toBe(true);
    expect(paramKeys(r.files)).toEqual(r.entries.map(x => x.key));
  });

  it('non-literal arguments get defaults and a note', () => {
    const r2 = mapDomControls([{ name: 'sketch.js', code: 'let n;\nfunction setup() { n = createSlider(0, width, TWO_PI / 4); }' }]);
    expect(r2.entries[0].entry).toBe("nControl: { value: 2, min: 0, max: 100, step: 1, label: 'N' }");
    expect(r2.notes.join(' ')).toMatch(/max/);
  });
});

// ── Candidates ──────────────────────────────────────────────────────────────

const FLOW = `let noiseScale = 0.01;
const N = 500;
let t = 0;
let particles = [];

function setup() {
  createCanvas(600, 600);
  for (let i = 0; i < N; i++) particles.push(createVector(random(width), random(height)));
}

function draw() {
  background(0, 10);
  stroke(255, 120, 40);
  strokeWeight(2);
  for (const p of particles) {
    const a = noise(p.x * noiseScale, p.y * noiseScale, t) * TWO_PI;
    p.add(cos(a), sin(a));
    point(p.x, p.y);
  }
  t += 0.01;
}
`;

const MODES = `let mode = 'circles';
let invert = false;
let SIZE = 40;

function draw() {
  background(invert ? 255 : 0);
  switch (mode) {
    case 'circles': circle(width / 2, height / 2, SIZE); break;
    case 'squares': square(10, 10, SIZE); break;
  }
  if (mode === 'lines') line(0, 0, width, height);
  fill('#3366ff');
  rotate(frameCount * 0.02);
}
`;

const CLASSY = `const COLS = 20, ROWS = 10;
let palette = [30, 200, 180];
class Cell {
  constructor() { this.r = random(5, 10); }
  show() { fill(palette); ellipse(0, 0, 12, 12); }
}
let cells = [];
function setup() {
  for (let i = 0; i < COLS * ROWS; i++) cells.push(new Cell());
  frameRate(30);
}
function draw() { for (const c of cells) c.show(); }
`;

describe('findControlCandidates', () => {
  const flow = findControlCandidates([{ name: 'sketch.js', code: FLOW }]);
  const by = (list: typeof flow, name: string) => list.find(c => c.name === name)!;

  it('ranks named constants high and flags state', () => {
    expect(by(flow, 'noiseScale')).toMatchObject({ kind: 'slider', state: false, setupOnly: false });
    expect(by(flow, 'N')).toMatchObject({ kind: 'integer', setupOnly: true, state: false });
    expect(by(flow, 't').state).toBe(true);
    expect(by(flow, 't').score).toBeLessThan(0);
    expect(flow.find(c => c.name === 'particles')).toBeUndefined();
    const top2 = flow.slice(0, 3).map(c => c.name);
    expect(top2).toContain('noiseScale');
    expect(top2).toContain('N');
    expect(by(flow, 'noiseScale').range).toEqual({ min: 0, max: 0.04, step: 0.0001 });
    expect(by(flow, 'N').range).toEqual({ min: 1, max: 2000, step: 1 });
    expect(by(flow, 'noiseScale').uses.map(u => u.line)).toEqual([16]);
  });

  it('finds colour literals, with alpha as its own value', () => {
    const stroke = by(flow, 'strokeColour');
    expect(stroke).toMatchObject({ kind: 'colour', value: [255, 120, 40], source: 'literal', line: 13 });
    const bg = by(flow, 'bgColour');
    expect(bg).toMatchObject({ kind: 'colour', value: [0, 0, 0] });
    expect(bg.sites[0].spread).toBe(true);
    expect(by(flow, 'bgAlpha')).toMatchObject({ value: 10, range: { min: 0, max: 255, step: 1 } });
    expect(by(flow, 'lineWeight')).toMatchObject({ value: 2, kind: 'slider' });
  });

  it('a string compared in a switch and an if is a choice', () => {
    const modes = findControlCandidates([{ name: 'sketch.js', code: MODES }]);
    expect(by(modes, 'mode')).toMatchObject({ kind: 'choice', options: ['circles', 'squares', 'lines'], value: 'circles' });
    expect(by(modes, 'invert')).toMatchObject({ kind: 'toggle', value: false });
    expect(by(modes, 'SIZE')).toMatchObject({ kind: 'integer', setupOnly: false });
    expect(by(modes, 'fillColour')).toMatchObject({ kind: 'colour', value: '#3366ff' });
    expect(by(modes, 'speed')).toMatchObject({ value: 0.02, kind: 'slider' });
  });

  it('class methods count as every frame; colour arrays used in fill are colours', () => {
    const cls = findControlCandidates([{ name: 'sketch.js', code: CLASSY }]);
    expect(by(cls, 'palette')).toMatchObject({ kind: 'colour', value: [30, 200, 180], setupOnly: false });
    expect(by(cls, 'COLS')).toMatchObject({ kind: 'integer', setupOnly: true });
    expect(by(cls, 'ellipseSize').sites).toHaveLength(2);
    expect(by(cls, 'fps')).toMatchObject({ value: 30, kind: 'integer', setupOnly: true });
  });

  it('suggestControls picks three to six, never state', () => {
    for (const code of [FLOW, MODES, CLASSY]) {
      const c = findControlCandidates([{ name: 'sketch.js', code }]);
      const ids = suggestControls(c);
      expect(ids.length).toBeGreaterThanOrEqual(3);
      expect(ids.length).toBeLessThanOrEqual(6);
      for (const id of ids) expect(c.find(x => x.id === id)!.state).toBe(false);
    }
    const ids = suggestControls(flow);
    expect(ids).toContain('var:sketch.js:noiseScale');
    expect(ids).toContain('var:sketch.js:N');
    expect(ids).not.toContain('var:sketch.js:t');
  });

  it('leaves out values that are already controls', () => {
    const c = findControlCandidates([{ name: 'sketch.js', code: `const params = { noiseScale: { value: 0.01, min: 0, max: 1 } };\n${FLOW}` }]);
    expect(c.find(x => x.name === 'noiseScale')).toBeUndefined();
  });

  it('rangeFor', () => {
    expect(rangeFor(0.5)).toEqual({ min: 0, max: 2, step: 0.001 });
    expect(rangeFor(20, { integer: true, name: 'count' })).toEqual({ min: 1, max: 80, step: 1 });
    expect(rangeFor(3, { integer: true, name: 'x' })).toEqual({ min: 0, max: 12, step: 1 });
    expect(rangeFor(128, { name: 'alpha' })).toEqual({ min: 0, max: 255, step: 1 });
  });
});

describe('applyControls', () => {
  it('turns variables and literals into controls, minimally', () => {
    const files = [{ name: 'sketch.js', code: FLOW }];
    const cands = findControlCandidates(files);
    const id = (n: string) => cands.find(c => c.name === n)!.id;
    const r = applyControls(files, [
      { id: id('noiseScale') },
      { id: id('N'), label: 'Particles' },
      { id: id('strokeColour') },
      { id: id('bgColour'), key: 'trailColour' },
    ], cands);
    const out = main(r.files);
    expect(parses(out)).toBe(true);
    expect(out).toContain("noiseScale: { value: 0.01, min: 0, max: 0.04, step: 0.0001, label: 'Noise scale' }");
    expect(out).toContain("N: { value: 500, min: 1, max: 2000, step: 1, label: 'Particles', restart: true }");
    expect(out).toContain("strokeColour: { kind: 'colour', value: [255, 120, 40], label: 'Stroke colour' }");
    expect(out).toContain('let N = 500;');
    expect(out).not.toContain('const N');
    expect(out).toContain('stroke(strokeColour);');
    expect(out).toContain('background(...trailColour, 10);');
    expect(out).toMatch(/let strokeColour = \[255, 120, 40\];\nlet trailColour = \[0, 0, 0\];\n\nfunction setup/);
    expect(r.startAt).toEqual({ noiseScale: 0.01, N: 500, strokeColour: 0xff7828, trailColour: 0 });
    // Untouched parts stay as they were.
    expect(out).toContain('  strokeWeight(2);\n');
    expect(out).toContain('t += 0.01;');
  });

  it('choices, toggles and hex colours; params merge into an existing object', () => {
    const code = `const params = {\n  size: { value: 1, min: 0, max: 2 },\n};\n\n${MODES}`;
    const files = [{ name: 'sketch.js', code }];
    const cands = findControlCandidates(files);
    const id = (n: string) => cands.find(c => c.name === n)!.id;
    const r = applyControls(files, [{ id: id('mode') }, { id: id('invert') }, { id: id('fillColour') }, { id: id('SIZE'), kind: 'slider', min: 10, max: 100 }], cands);
    const out = main(r.files);
    expect(parses(out)).toBe(true);
    expect(out.match(/const params/g)).toHaveLength(1);
    expect(out).toContain("mode: { kind: 'choice', options: ['circles', 'squares', 'lines'], value: 'circles', label: 'Mode' }");
    expect(out).toContain("invert: { kind: 'toggle', value: false, label: 'Invert' }");
    expect(out).toContain("fillColour: { kind: 'colour', value: '#3366ff', label: 'Fill colour' }");
    expect(out).toContain('SIZE: { value: 40, min: 10, max: 100, step: 1');
    expect(out).toContain('fill(fillColour);');
    expect(out).toContain("let fillColour = '#3366ff';");
    expect(r.startAt).toMatchObject({ mode: 0, invert: 0, fillColour: 0x3366ff, SIZE: 40 });
  });

  it('hoists into the file the literal is in', () => {
    const files = [{ name: 'cell.js', code: CLASSY.split('let cells')[0] }, { name: 'sketch.js', code: 'let cells = [];\nfunction setup() { for (let i = 0; i < COLS * ROWS; i++) cells.push(new Cell()); }\nfunction draw() { for (const c of cells) c.show(); }\n' }];
    const cands = findControlCandidates(files);
    const ell = cands.find(c => c.name === 'ellipseSize')!;
    expect(ell.file).toBe('cell.js');
    const r = applyControls(files, [{ id: ell.id }, { id: cands.find(c => c.name === 'COLS')!.id }], cands);
    const cell = r.files.find(f => f.name === 'cell.js')!.code;
    expect(parses(cell)).toBe(true);
    expect(cell).toContain('ellipse(0, 0, ellipseSize, ellipseSize)');
    expect(cell).toMatch(/let ellipseSize = 12;\n\nclass Cell/);
    expect(cell).toContain('let COLS = 20, ROWS = 10;');
    expect(main(r.files)).toContain('ellipseSize: { value: 12');
    expect(main(r.files)).toContain('COLS: { value: 20');
  });
});

describe('candidateAt and unmakeControl', () => {
  it('finds a variable by any read of it, a colour by any of its numbers, and a plain literal', () => {
    const files = [{ name: 'sketch.js', code: FLOW }];
    const read = FLOW.indexOf('noiseScale, p.y');
    expect(candidateAt(files, 'sketch.js', read + 2)?.name).toBe('noiseScale');
    expect(candidateAt(files, 'sketch.js', FLOW.indexOf('120'))?.name).toBe('strokeColour');
    const lit = candidateAt(files, 'sketch.js', FLOW.indexOf('600, 600') + 1);
    expect(lit).toMatchObject({ source: 'literal', value: 600, name: 'createCanvasValue' });
    expect(candidateAt(files, 'sketch.js', FLOW.indexOf('particles.push'))?.name).toBeUndefined();
    // Apply the ad-hoc literal.
    const r = applyControls(files, [{ id: lit!.id }], [lit!]);
    expect(main(r.files)).toContain('createCanvas(createCanvasValue, 600)');
    expect(parses(main(r.files))).toBe(true);
  });

  it('round trip: make a control, then turn it back into a plain value', () => {
    const files = [{ name: 'sketch.js', code: MODES }];
    const cands = findControlCandidates(files);
    const made = applyControls(files, [{ id: cands.find(c => c.name === 'mode')!.id }, { id: cands.find(c => c.name === 'SIZE')!.id }], cands);
    const back1 = unmakeControl(made.files, 'mode', 2);
    expect(main(back1)).toContain("let mode = 'lines';");
    expect(paramKeys(back1)).toEqual(['SIZE']);
    expect(parses(main(back1))).toBe(true);
    const back2 = unmakeControl(back1, 'SIZE', 55);
    expect(main(back2)).not.toContain('params');
    expect(main(back2)).toContain('let SIZE = 55;');
    expect(main(back2).startsWith("let mode = 'lines';")).toBe(true);
  });

  it('colours go back as they were written', () => {
    const files = [{ name: 'sketch.js', code: FLOW }];
    const cands = findControlCandidates(files);
    const made = applyControls(files, [{ id: cands.find(c => c.name === 'strokeColour')!.id }], cands);
    const back = unmakeControl(made.files, 'strokeColour', 0x00ff80);
    expect(main(back)).toContain('let strokeColour = [0, 255, 128];');
    expect(main(back)).not.toContain('params');
  });
});

describe('buildP5Layer', () => {
  it('builds the patch from a pasted sketch with DOM controls', () => {
    const p = projectFromText('function setup() { createCanvas(100, 100, WEBGL); s = createSlider(0, 5, 1); }\nlet s;\nfunction draw() { box(s.value()); }');
    const dom = mapDomControls([{ name: 'sketch.js', code: p.main.code }]);
    const a = analyzeProject(dom.files);
    const b = buildP5Layer(p, a, dom);
    expect(b.patch).toMatchObject({ mode: '3d', p5: true, clear: false, readPicture: false, files: [] });
    expect(b.patch.code).toContain("control('s2')".replace('s2', dom.entries[0].key));
    expect(b.report.controls).toBe(1);
    expect(b.startAt[dom.entries[0].key]).toBe(1);
  });
});
