import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import * as threeSlim from '../kit/three-slim.js';
import { klSketchCompile, klSketchPress, klSketchStep, type KlSketchState } from '../kit/layers.js';
import { K3_SKETCH_NAMES } from '../kit/sketch3d.js';
import { parsePlayRecord } from '../../types/play';
import { defaultLayer, script3dDefaults, DEFAULT_SCRIPT_3D } from '../../types/playLayers';
import { buildPlayHtml, buildPlaySnippet, playUses3D, threeCarried, type PlayHtmlInput } from '../exportHtml';
import { setThreeSource } from '../threeSource';
import { SCRIPT_REFERENCE_3D, referenceFor } from '../../components/play/layers/scriptReference';
import { SCRIPT_SNIPPETS_3D, snippetsFor } from '../../components/play/layers/scriptSnippets';
import { extractScriptParams, SCRIPT_EXAMPLES } from '../../components/play/layers/scriptExamples';
import { scriptCompletions } from '../../components/play/layers/scriptCompletions';
import { addKindLayer, editKind, saveLayerAsKind } from '../layerKinds';
import { parseLayerKind } from '../../types/layerKinds';

const W = 640, H = 360;
const frame = (i: number, params: Record<string, number> = {}, mouse = { x: 320, y: 180, over: true, down: false }) => ({
  ctx: null, width: W, height: H, dpr: 1, time: i / 60, dt: 1 / 60, frame: i, params, state: {},
  mouse, picture: { brightness: () => 0.5, texture: null }, null: () => null, random: Math.random,
}) as Record<string, unknown>;

function compile3d(code: string): KlSketchState {
  const st = klSketchCompile(code, { mode: '3d', three: THREE });
  expect(st.error).toBeNull();
  return st;
}
function step(st: KlSketchState, i: number, params: Record<string, number> = {}, mouse?: { x: number; y: number; over: boolean; down: boolean }) {
  return klSketchStep(st, { ...frame(i, params, mouse), state: st.state }, [], true);
}
/** What the frame drew: shape batches with their instance count, and line vertices. */
function drawn(st: KlSketchState) {
  const g = st.g3!;
  return { batches: g.batchList.filter(b => b.n > 0).map(b => ({ key: b.key, n: b.n })), meshes: g.batchList.filter(b => b.mesh.visible).length, lines: g.lineN };
}
const matrixOf = (st: KlSketchState, batch: number, i: number) => new THREE.Matrix4().fromArray(st.g3!.batchList[batch].mesh.instanceMatrix.array as Float32Array, i * 16);

describe('3D Script: p5-style shapes on three.js', () => {
  it('batches shapes by kind and look: one instanced mesh per shape and material, colours per instance', () => {
    const st = compile3d(`function draw(s) {
      noStroke();
      for (let i = 0; i < 10; i++) { fill(i * 20, 100, 200); box(20); }
      fill(255, 0, 0); sphere(30);
      normalMaterial(); sphere(30); torus(40, 10);
    }`);
    expect(step(st, 0)).toBeNull();
    const d = drawn(st);
    expect(d.batches.map(b => b.n)).toEqual([10, 1, 1, 1]);
    expect(d.batches[0].key).toMatch(/^box#f/);
    expect(d.batches[2].key).toMatch(/^sphere:24:16#n/);
    expect(d.lines).toBe(0);
    // Instance colours differ; the box batch is one mesh with 10 instances.
    const col = st.g3!.batchList[0].mesh.instanceColor!.array;
    expect(col[0]).not.toBeCloseTo(col[9 * 3]);
  });

  it('applies translate, rotate, scale and push/pop to each instance, and scales the unit shape to its size', () => {
    const st = compile3d(`function draw(s) {
      push(); translate(100, -50, 20); box(10, 20, 30); pop();
      push(); rotateZ(HALF_PI); translate(10, 0, 0); box(10); pop();
      box(5);
    }`);
    step(st, 0);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    matrixOf(st, 0, 0).decompose(p, q, sc);
    expect(p.toArray()).toEqual([100, -50, 20]);
    expect(sc.toArray().map(v => Math.round(v))).toEqual([10, 20, 30]);
    matrixOf(st, 0, 1).decompose(p, q, sc);
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(10);
    matrixOf(st, 0, 2).decompose(p, q, sc);
    expect(p.toArray()).toEqual([0, 0, 0]);
    expect(sc.x).toBeCloseTo(5);
  });

  it('keeps p5’s coordinates: y goes down under a root flipped in y', () => {
    const st = compile3d('function draw(s) { translate(0, 100, 0); box(10); }');
    step(st, 0);
    const mesh = st.g3!.batchList[0].mesh;
    mesh.updateWorldMatrix(true, false);
    const world = new THREE.Vector3(0, 0, 0).applyMatrix4(matrixOf(st, 0, 0)).applyMatrix4(mesh.matrixWorld);
    expect(world.y).toBe(-100);
  });

  it('pools: the same meshes and buffers serve every frame, and shapes do not pile up across frames', () => {
    const st = compile3d(`function draw(s) { noStroke(); const n = s.frame % 2 ? 40 : 300; for (let i = 0; i < n; i++) { push(); translate(i, 0, 0); fill(i % 255); box(8); pop(); } }`);
    step(st, 0);
    const mesh = st.g3!.batchList[0].mesh;
    expect(drawn(st).batches).toEqual([{ key: expect.any(String), n: 300 }]);
    for (let i = 1; i < 12; i++) step(st, i);
    // Frame 11 drew 40: the pool holds its capacity, the count follows the frame.
    expect(st.g3!.batchList.length).toBe(1);
    expect(st.g3!.batchList[0].mesh).toBe(mesh);
    expect(st.g3!.batchList[0].n).toBe(40);
    expect(st.g3!.batchList[0].mesh.count).toBe(40);
    expect(st.g3!.scene.children.length).toBe(1);
    expect(st.g3!.root.children.filter(c => (c as THREE.Mesh).isMesh).length).toBe(1);
  });

  it('hides batches a frame did not use and grows a batch past its first capacity', () => {
    const st = compile3d(`function draw(s) { if (s.frame === 0) { for (let i = 0; i < 100; i++) sphere(5); } else box(10); }`);
    step(st, 0);
    expect(st.g3!.batchList[0].cap).toBeGreaterThanOrEqual(100);
    step(st, 1);
    const [spheres, boxes] = st.g3!.batchList;
    expect(spheres.mesh.visible).toBe(false);
    expect(boxes.mesh.visible).toBe(true);
    expect(boxes.n).toBe(1);
  });

  it('draws edges for stroke() and 3D lines into one pooled line buffer', () => {
    const st = compile3d('function draw(s) { stroke(255); noFill(); box(10); line(0, 0, 0, 100, 100, 100); line(0, 0, 50, 50); }');
    step(st, 0);
    const d = drawn(st);
    expect(d.batches).toEqual([]);
    expect(d.lines).toBe(24 + 2 + 2); // a box's 12 edges, two lines
  });

  it('lights: pooled per kind, the ones a frame skips go dark rather than away', () => {
    const st = compile3d(`function draw(s) {
      ambientLight(60);
      if (s.frame === 0) { directionalLight(255, 255, 255, 0, 0, -1); pointLight(255, 0, 0, 0, -100, 100); }
      fill(200); box(40);
    }`);
    step(st, 0);
    const g = st.g3!;
    expect([g.lights.ambient.length, g.lights.directional.length, g.lights.point.length]).toEqual([1, 1, 1]);
    expect(g.lights.directional[0].intensity).toBeCloseTo(Math.PI);
    // A lit frame uses the lit material for fill().
    expect((g.batchList[0].mesh.material as THREE.Material).type).toBe('MeshLambertMaterial');
    step(st, 1);
    expect([g.lights.ambient.length, g.lights.directional.length, g.lights.point.length]).toEqual([1, 1, 1]);
    expect(g.lights.directional[0].intensity).toBe(0);
    expect(g.lights.ambient[0].intensity).toBeCloseTo(Math.PI);
  });

  it('fill without lights is flat, as in p5', () => {
    const st = compile3d('function draw(s) { fill(255, 100, 0); box(40); }');
    step(st, 0);
    expect((st.g3!.batchList[0].mesh.material as THREE.Material).type).toBe('MeshBasicMaterial');
  });

  it('camera, perspective, ortho and orbitControl keep the camera between frames', () => {
    const st = compile3d(`function setup(s) { camera(0, -200, 600, 0, 0, 0, 0, 1, 0); }
      function draw(s) { orbitControl(); box(50); }`);
    step(st, 0);
    expect(st.g3!.api.camera).toBe(st.g3!.persp);
    const cam = (st.g3! as unknown as { cam: { eye: number[] } }).cam;
    expect(cam.eye).toEqual([0, -200, 600]);
    // A drag to the right turns the camera round the centre at the same distance.
    step(st, 1, {}, { x: 300, y: 180, over: true, down: true });
    step(st, 2, {}, { x: 400, y: 180, over: true, down: true });
    expect(cam.eye[0]).not.toBeCloseTo(0);
    expect(Math.hypot(...cam.eye)).toBeCloseTo(Math.hypot(0, 200, 600));
  });

  it('gives raw three.js as s.three: a retained scene built in setup survives the frames', () => {
    const st = compile3d(`let knot;
      function setup(s) {
        const { THREE, scene } = s.three;
        knot = new THREE.Mesh(new THREE.TorusKnotGeometry(80, 20), new THREE.MeshNormalMaterial());
        scene.add(knot);
      }
      function draw(s) { knot.rotation.y = s.time; }`);
    for (let i = 0; i < 3; i++) expect(step(st, i)).toBeNull();
    const g = st.g3!;
    expect(g.scene.children.length).toBe(2);
    expect((g.scene.children[1] as THREE.Mesh).rotation.y).toBeCloseTo(2 / 60);
    expect(g.api.THREE).toBe(THREE);
  });

  it('says so when a 2D helper is called on a 3D layer', () => {
    const st = compile3d('function draw(s) { circle(0, 0, 10); }');
    expect(step(st, 0)).toMatch(/circle\(\) draws on the 2D canvas/);
  });

  it('without three.js the sketch reports it instead of running', () => {
    expect(klSketchCompile('function draw(s) { box(10); }', { mode: '3d' }).error).toMatch(/three\.js/);
  });

  it('runs on the app’s three-slim set, and every 3D name is a function there', () => {
    const st = klSketchCompile(DEFAULT_SCRIPT_3D, { mode: '3d', three: threeSlim });
    expect(st.error).toBeNull();
    const r = extractScriptParams(DEFAULT_SCRIPT_3D);
    expect(r.ok).toBe(true);
    expect(klSketchStep(st, { ...frame(0, { count: 12, size: 60, speed: 1 }), state: st.state }, r.ok ? r.defs : [], true)).toBeNull();
    expect(K3_SKETCH_NAMES.length).toBeGreaterThan(30);
  });

  it('buttons and driven variables work the same in 3D', () => {
    const code = `let size = 10;\nconst params = { size: { value: 10, min: 1, max: 100 }, grow(s) { s.state.big = true; } };\nfunction draw(s) { box(s.state.big ? size * 2 : size); }`;
    const st = compile3d(code);
    const r = extractScriptParams(code);
    if (!r.ok) throw new Error(r.error);
    klSketchPress(st, 'grow', 1);
    expect(klSketchStep(st, { ...frame(0, { size: 40, grow: 0 }), state: st.state }, r.defs, true)).toBeNull();
    const sc = new THREE.Vector3();
    matrixOf(st, 0, 0).decompose(new THREE.Vector3(), new THREE.Quaternion(), sc);
    expect(sc.x).toBeCloseTo(80);
  });

  it('is seeded like 2D sketches: random() reads s.random', () => {
    let n = 0;
    const st = compile3d('function draw(s) { s.state.r = random(); }');
    klSketchStep(st, { ...frame(0), random: () => { n++; return 0.25; }, state: st.state }, [], true);
    expect(n).toBe(1);
    expect(st.state.r).toBe(0.25);
  });
});

describe('3D Script: the layer, its file and kinds', () => {
  it('mode round-trips through parsePlayRecord; old files and bad values are 2d', () => {
    const three = { ...defaultLayer('script', 'a', 'A'), ...script3dDefaults() };
    const flat = defaultLayer('script', 'b', 'B') as unknown as Record<string, unknown>;
    delete flat.mode;
    const p = parsePlayRecord({ layers: [three, flat, { ...defaultLayer('script', 'c', 'C'), mode: 'webgl' }] });
    expect(p.layers.map(l => (l.kind === 'script' ? l.mode : null))).toEqual(['3d', '2d', '2d']);
    const again = parsePlayRecord(JSON.parse(JSON.stringify(p)));
    expect(again.layers[0]).toMatchObject({ mode: '3d', code: DEFAULT_SCRIPT_3D, p_count: 12 });
  });

  it('a 3D sketch saved as a kind makes 3D layers, and editing the kind can change its mode', () => {
    const l = { ...defaultLayer('script', 's1', 'Script 1'), ...script3dDefaults() };
    const base = parsePlayRecord({ layers: [l] });
    const saved = saveLayerAsKind(base, 's1', { name: 'Cubes', hint: '', icon: 'cube', colour: 'teal' });
    expect(saved.kind!.mode).toBe('3d');
    expect(parseLayerKind(JSON.parse(JSON.stringify(saved.kind)))!.mode).toBe('3d');
    const two = addKindLayer(saved.play, saved.kind!, 's2');
    expect(two.layers[1]).toMatchObject({ kind: 'script', mode: '3d', kindId: saved.kind!.id });
    const flat = editKind(two, saved.kind!.id, 'function draw(s) {}', [], '2d');
    expect(flat.play.layers.map(x => (x.kind === 'script' ? x.mode : null))).toEqual(['2d', '2d']);
    // A kind from before 3D is 2d.
    expect(parseLayerKind({ id: 'sketch:old-1', code: 'function draw(s) {}' })!.mode).toBe('2d');
  });
});

describe('3D Script: web export', () => {
  const input = (mode: '2d' | '3d'): PlayHtmlInput => ({
    title: 't', fragmentShader: 'void main(){}', uniforms: {}, paramBindings: {}, aspect: '16:9' as PlayHtmlInput['aspect'],
    play: parsePlayRecord({ layers: [{ ...defaultLayer('script', 'a', 'A'), ...(mode === '3d' ? script3dDefaults() : {}) }] }),
  });
  it('carries three.js only when a 3D Script layer needs it', () => {
    setThreeSource('var SSThree=(()=>({marker:"THREE-SLIM"}))();');
    expect(playUses3D(input('2d').play)).toBe(false);
    expect(buildPlayHtml(input('2d'))).not.toContain('THREE-SLIM');
    expect(buildPlaySnippet(input('2d'))).not.toContain('THREE-SLIM');
    expect(threeCarried(input('2d').play)).toBeNull();
    const page = buildPlayHtml(input('3d'));
    expect(page).toContain('THREE-SLIM');
    // Before the kit, so the runtime finds SSThree.
    expect(page.indexOf('THREE-SLIM')).toBeLessThan(page.indexOf('var SSKit'));
    expect(buildPlaySnippet(input('3d'))).toContain('THREE-SLIM');
    expect(threeCarried(input('3d').play)).toEqual({ what: expect.stringContaining('three.js'), bytes: 'var SSThree=(()=>({marker:"THREE-SLIM"}))();'.length });
  });
  it('the kit script carries the 3D helpers', () => {
    expect(buildPlayHtml(input('2d'))).toContain('function k3Helpers');
  });
});

describe('3D Script: the editor', () => {
  it('3D reference entries are complete, cover every 3D helper and their examples run', () => {
    const items = SCRIPT_REFERENCE_3D.flatMap(g => g.items);
    const names = new Set(items.map(it => it.name));
    for (const n of K3_SKETCH_NAMES) expect(names.has(n), n).toBe(true);
    for (const it of items) {
      expect(it.doc.trim() && it.example.trim() && it.type.trim(), it.name).toBeTruthy();
      const body = /^function (setup|draw)\b/.test(it.example) ? it.example : `function draw(s) {\n${it.example}\n}`;
      const code = /function draw\b/.test(body) ? body : `${body}\nfunction draw(s) {}`;
      const st = klSketchCompile(code, { mode: '3d', three: THREE });
      expect(st.error, it.name).toBeNull();
    }
    expect(new Set(referenceFor('3d').flatMap(g => g.items.map(i => i.name))).has('s.ctx')).toBe(false);
    expect(referenceFor('2d').some(g => g.title.startsWith('3D'))).toBe(false);
  });

  it('autocomplete in 3D offers the 3D helpers with their signatures', () => {
    const box = scriptCompletions('', '3d').all.find(c => c.name === 'box')!;
    expect(box).toMatchObject({ kind: 'fn', detail: '([w], [h], [d])' });
    expect(scriptCompletions('', '2d').all.find(c => c.name === 'box')).toBeUndefined();
    expect(scriptCompletions('', '3d').members.s.find(c => c.name === 'three.scene')).toBeTruthy();
  });

  it('every 3D pattern has an example that runs in 3D for a few frames', () => {
    expect(SCRIPT_SNIPPETS_3D.length).toBeGreaterThanOrEqual(6);
    for (const sn of SCRIPT_SNIPPETS_3D) {
      expect(sn.group).toBe('3D');
      const r = extractScriptParams(sn.example);
      if (!r.ok) throw new Error(`${sn.name}: ${r.error}`);
      const st = klSketchCompile(sn.example, { mode: '3d', three: THREE });
      expect(st.error, sn.name).toBeNull();
      const params = Object.fromEntries(r.defs.map(d => [d.key, d.value]));
      for (let i = 0; i < 3; i++) expect(klSketchStep(st, { ...frame(i, { ...params }), state: st.state }, r.defs, true), sn.name).toBeNull();
    }
    expect(snippetsFor('3d').every(sn => sn.group === '3D' || sn.group === 'Sketch basics')).toBe(true);
    expect(snippetsFor('2d').some(sn => sn.group === '3D')).toBe(false);
  });

  it('500 boxes are one instanced mesh', () => {
    const st = compile3d('function draw(s) { noStroke(); for (let i = 0; i < 500; i++) { push(); translate((i % 25) * 20 - 250, floor(i / 25) * 20 - 200, 0); rotateY(s.time + i); fill(i % 255, 120, 200); box(12); pop(); } }');
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) step(st, i);
    const per = (performance.now() - t0) / 30;
    expect(drawn(st).batches).toEqual([{ key: expect.any(String), n: 500 }]);
    // Recording 500 shapes is a small share of a frame (a generous bound for slow CI).
    expect(per).toBeLessThan(12);
  });

  it('keeps the 2D starters 2D', () => {
    for (const ex of SCRIPT_EXAMPLES) expect(klSketchCompile(ex.code).error, ex.name).toBeNull();
  });
});
