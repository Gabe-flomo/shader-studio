// @vitest-environment jsdom
/**
 * The 3D Scene Builder on the studio shell (docs/scene-builder-3d.md, "The window"):
 *  - the sections write the recipe, and what they write builds a graph that compiles;
 *  - the viewport's maths (project, pick, sizes) and its gizmo drags, one undo step a drag;
 *  - the Play menu: a recipe value mapped to the node param it builds;
 *  - Surprise me makes the same scene from the same seed;
 *  - reopening a built scene opens it as built.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { GraphNode } from '../../../types/nodeGraph';
import { useNodeGraphStore } from '../../../store/useNodeGraphStore';
import { useSceneBuilder } from '../../../sceneBuilder/store';
import { applyScene } from '../../../sceneBuilder/apply';
import { buildStandaloneGraph } from '../../../sceneBuilder/build';
import { parseRecipe, printRecipe } from '../../../sceneBuilder/recipe';
import { templateSpec } from '../../../sceneBuilder/templates';
import { editSceneInBuilder } from '../../../sceneBuilder/actions';
import { SCENE_SECTIONS, sectionOfTab, sectionSummary } from '../../../sceneBuilder/sections';
import { canonicalSpec, findItem, type ShapeSpec } from '../../../sceneBuilder/spec';
import { cameraBasis, linkedSize, pickShape, project, pxToUv, rayAt, scaleSize, uvToPx } from '../../../sceneBuilder/viewMath';
import { liveParam, paramTarget } from '../../../sceneBuilder/paramMap';
import { compileGraph } from '../../../compiler/graphCompiler';
import { SceneBuilderModal } from '../SceneBuilderModal';
import { surpriseSceneAction } from '../surpriseActions';
import { lazyParamFor } from '../playParam';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

const mounted: Array<{ root: Root; host: HTMLElement }> = [];
function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(ui));
  mounted.push({ root, host });
  return host;
}
afterEach(() => { for (const m of mounted.splice(0)) { act(() => m.root.unmount()); m.host.remove(); } useSceneBuilder.getState().close(); });
const $ = (sel: string) => document.body.querySelector(sel);
const click = (el: Element | null) => { expect(el).toBeTruthy(); act(() => { (el as HTMLElement).click(); }); };
const sb = () => useSceneBuilder.getState();
const output = (): GraphNode => ({ id: 'out', type: 'output', position: { x: 600, y: 0 }, inputs: { color: { type: 'vec4', label: 'Color' } } as GraphNode['inputs'], outputs: {}, params: {} });
let n = 0;
const nextId = () => `n${++n}`;
const compiles = (spec = sb().spec) => compileGraph({ nodes: buildStandaloneGraph(spec).nodes }).success;

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  useNodeGraphStore.setState({ nodes: [output()] });
});

describe('the sections', () => {
  it('lists Mode, Shapes, Combine, Warps, Light & colour, Camera and Output, each with a line, Learn more and a summary', () => {
    expect(SCENE_SECTIONS.map(s => s.id)).toEqual(['mode', 'shapes', 'combine', 'warps', 'light', 'camera', 'output']);
    const spec = templateSpec('blobs');
    for (const s of SCENE_SECTIONS) {
      expect(s.line.length).toBeGreaterThan(20);
      expect(s.learn.length).toBeGreaterThan(80);
      expect(sectionSummary(spec, s.id)).toBeTruthy();
    }
    // Older tab names open the section that holds them now.
    expect(sectionOfTab('look')).toBe('light');
    expect(sectionOfTab('quality')).toBe('output');
    expect(sectionOfTab('templates')).toBe('shapes');
    expect(sectionOfTab('describe')).toBe('describe');
  });

  it('the window shows the sections in the nav, the viewport, the presets and the top bar', () => {
    sb().openWith(templateSpec('blobs'));
    mount(<SceneBuilderModal />);
    for (const s of SCENE_SECTIONS) expect($(`[data-studio-section="${s.id}"]`)).toBeTruthy();
    expect($('[data-studio-section="describe"]')).toBeTruthy();
    expect($('[data-scene-viewport]')).toBeTruthy();
    // Four built-ins (the GI-lit room, the volumetric orb and two more), then your own, then Save this scene.
    expect(document.querySelectorAll('[data-scene-presets] [data-preset]').length).toBe(4);
    expect($('[data-save-preset]')).toBeTruthy();
    for (const a of ['data-hood-toggle', 'data-surprise-top', 'data-open-as-nodes', 'data-studio-primary']) expect($(`[${a}]`)).toBeTruthy();
    expect($('[data-studio-primary]')?.textContent).toBe('Done');
  });

  it('Mode, Combine and Warps write the recipe, and the scene still builds a graph that compiles', () => {
    sb().openWith(parseRecipe('sphere r=0.6 · box size=0.4 at=(0.5,0,0)').spec, { tab: 'mode' });
    mount(<SceneBuilderModal />);
    click($('[data-choice="mode:glass"]'));
    expect(printRecipe(sb().spec)).toMatch(/^glass/);
    click($('[data-choice="mode:volumetric"]'));
    expect(printRecipe(sb().spec)).toMatch(/^volumetric/);
    expect(compiles()).toBe(true);

    click($('[data-studio-section="combine"]'));
    act(() => sb().select(null));
    click($('[data-combine-cards] [data-op="smooth-union"]'));
    expect(sb().spec.root.k).toBeGreaterThan(0);
    expect(printRecipe(sb().spec)).toContain('smooth-union(');
    expect($('[data-combine-tree]')).toBeTruthy();

    click($('[data-studio-section="warps"]'));
    click($('[data-warp-target="g1"]'));
    click($('[data-add-warp="twist"]'));
    expect(printRecipe(sb().spec)).toMatch(/twist/);
    expect(document.querySelectorAll('[data-warp-stack] [data-sb-card]').length).toBe(1);
    expect(compiles()).toBe(true);
  });

  it('Shapes: a gallery pick adds a shape; a box\'s linked Size keeps its proportions; a cylinder has a radius and a height', () => {
    sb().openWith(parseRecipe('box size=(0.2,0.4,0.2)').spec, { tab: 'shapes' });
    mount(<SceneBuilderModal />);
    const before = sb().spec.root.children.length;
    click($('[data-shape-gallery] button'));
    expect(sb().spec.root.children.length).toBe(before + 1);
    // Linked size: every dimension scaled together.
    const box = sb().spec.root.children[0] as ShapeSpec;
    expect(linkedSize(box)).toBe(0.4);
    act(() => sb().edit(d => { const it = findItem(d, box.id)!.item as ShapeSpec; it.size = scaleSize('box', it.size, 2); }));
    expect((findItem(sb().spec, box.id)!.item as ShapeSpec).size.size).toEqual([0.4, 0.8, 0.4]);
    // Rows: the box opens on separate sizes (its sides differ), the cylinder on radius and height.
    act(() => sb().select(box.id));
    expect(document.body.textContent).toContain('Width');
    act(() => sb().edit(d => { d.root.children.push(parseRecipe('cylinder r=0.3 h=0.5').spec.root.children[0]); d.root.children[d.root.children.length - 1].id = 's9'; }));
    act(() => sb().select('s9'));
    expect(document.body.textContent).toContain('Radius');
    expect(document.body.textContent).toContain('Height (half)');
    expect(compiles()).toBe(true);
  });

  it('Under the hood shows the recipe in place of the settings', () => {
    sb().openWith(templateSpec('twisted'));
    mount(<SceneBuilderModal />);
    click($('[data-hood-toggle]'));
    expect($('[data-inspector="recipe"]')).toBeTruthy();
    expect($('[data-inspector="recipe"]')?.textContent).toContain('torus');
  });
});

describe('the viewport', () => {
  const cam = { dist: 4, angle: 35, elev: 17, orbit: 0, zoom: 1.5, flatten: 0, x: 0, y: 0, z: 0 };
  it('projects a point and turns a pixel back into the ray through it (perspective and flattened)', () => {
    for (const flatten of [0, 0.6, 1]) {
      const b = cameraBasis({ ...cam, flatten });
      const p: [number, number, number] = [0.3, 0.2, -0.4];
      const pr = project(b, p)!;
      const r = rayAt(b, pr.uv);
      // The ray passes through p.
      const t = (p[0] - r.o[0]) * r.d[0] + (p[1] - r.o[1]) * r.d[1] + (p[2] - r.o[2]) * r.d[2];
      const q = [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t];
      expect(Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2])).toBeLessThan(1e-6);
    }
    // The target is in the middle of the picture.
    const [x, y] = uvToPx(project(cameraBasis(cam), [0, 0, 0])!.uv, 800, 600);
    expect(x).toBeCloseTo(400);
    expect(y).toBeCloseTo(300);
    expect(pxToUv(400, 300, 800, 600)).toEqual([0, 0]);
  });

  it('a click picks the shape under it', () => {
    const spec = parseRecipe('sphere r=0.4 name=A · box size=0.3 at=(1.5,0,0) name=B · camera dist=5').spec;
    const b = cameraBasis(spec.camera);
    const at = (p: [number, number, number]) => project(b, p)!.uv;
    expect(pickShape(spec, b, at([0, 0, 0]))?.id).toBe(spec.root.children[0].id);
    expect(pickShape(spec, b, at([1.5, 0, 0]))?.id).toBe(spec.root.children[1].id);
    expect(pickShape(spec, b, [1.6, 0.95])).toBeNull();
  });

  /** Mount with a laid-out viewport (jsdom has no layout). */
  function mountSized() {
    const rect = { x: 0, y: 0, left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, toJSON: () => ({}) };
    const orig = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () { return rect as DOMRect; };
    mount(<SceneBuilderModal />);
    return () => { Element.prototype.getBoundingClientRect = orig; };
  }
  const fire = (el: Element, type: string, x: number, y: number) => act(() => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 })); });
  const centre = (el: Element) => { const c = el.tagName === 'g' ? el.querySelector('circle')! : el; return [Number(c.getAttribute('cx') ?? Number(c.getAttribute('x')) + 7), Number(c.getAttribute('cy') ?? Number(c.getAttribute('y')) + 7)]; };

  it('the gizmo moves a shape along an axis and sizes it; each drag is one undo step', () => {
    const spec = parseRecipe('sphere r=0.5 · camera dist=4').spec;
    sb().openWith(spec, { tab: 'shapes' });
    act(() => sb().select(spec.root.children[0].id));
    const restore = mountSized();
    try {
      const view = $('[data-scene-viewport]')!;
      expect($('[data-scene-gizmo]')).toBeTruthy();
      const past = sb().past.length;
      // Drag the Y arrow up in several steps: one undo step.
      const [yx, yy] = centre($('[data-gizmo-axis="y"]')!);
      fire($('[data-gizmo-axis="y"]')!, 'pointerdown', yx, yy);
      for (let i = 1; i <= 5; i++) fire(view, 'pointermove', yx, yy - i * 8);
      fire(view, 'pointerup', yx, yy - 40);
      const sh = () => sb().spec.root.children[0] as ShapeSpec;
      expect(sh().at[1]).toBeGreaterThan(0.1);
      expect(sh().at[0]).toBe(0);
      expect(sh().at[2]).toBe(0);
      expect(sb().past.length).toBe(past + 1);
      // The size square: outward grows it.
      const [sx, sy] = centre($('[data-gizmo-size]')!);
      fire($('[data-gizmo-size]')!, 'pointerdown', sx, sy);
      for (let i = 1; i <= 4; i++) fire(view, 'pointermove', sx + i * 10, sy - i * 10);
      fire(view, 'pointerup', sx + 40, sy - 40);
      expect(Number(sh().size.r)).toBeGreaterThan(0.55);
      expect(sb().past.length).toBe(past + 2);
      // Undo takes back the size drag, then the move.
      act(() => sb().undo());
      expect(sh().size.r).toBe(0.5);
      act(() => sb().undo());
      expect(sh().at).toEqual([0, 0, 0]);
    } finally { restore(); }
  });

  it('dragging the picture turns the camera (one undo step); a click picks a shape', () => {
    const spec = parseRecipe('sphere r=0.5 · camera dist=4').spec;
    sb().openWith(spec, { tab: 'camera' });
    act(() => sb().select(null));
    const restore = mountSized();
    try {
      const view = $('[data-scene-viewport]')!;
      const past = sb().past.length;
      fire(view, 'pointerdown', 100, 100);
      for (let i = 1; i <= 6; i++) fire(view, 'pointermove', 100 + i * 10, 100);
      fire(view, 'pointerup', 160, 100);
      expect(sb().spec.camera.angle).not.toBe(35);
      expect(sb().past.length).toBe(past + 1);
      // A click in the middle picks the sphere and goes to Shapes.
      fire(view, 'pointerdown', 400, 300);
      fire(view, 'pointerup', 400, 300);
      expect(sb().selectedId).toBe(spec.root.children[0].id);
      expect(sb().tab).toBe('shapes');
    } finally { restore(); }
  });
});

describe('Play controls from the builder', () => {
  it('maps recipe values to the node params they build', () => {
    const spec = parseRecipe('sphere r=0.5 at=(1,0,0) · smooth-union(box, sphere) k=0.2 @twist(1) · volumetric · camera dist=3').spec;
    const s1 = spec.root.children[0].id;
    const g = spec.root.children[1];
    expect(paramTarget(spec, { at: 'camera', key: 'dist' })).toEqual({ role: 'camera', key: 'camDist' });
    expect(paramTarget(spec, { at: 'size', id: s1, key: 'r' })).toEqual({ role: s1, key: 'radius' });
    expect(paramTarget(spec, { at: 'place', id: s1, what: 'at', part: 0 })).toEqual({ role: `${s1}:at`, key: 'x' });
    expect(paramTarget(spec, { at: 'k', id: g.id })).toEqual({ role: `${g.id}:op1`, key: 'k' });
    expect(paramTarget(spec, { at: 'warp', itemId: g.id, warpId: g.warps[0].id, key: 'k' })).toEqual({ role: g.warps[0].id, key: 'k' });
    expect(paramTarget(spec, { at: 'look', key: 'glow.density' })).toEqual({ role: 'march:glow', key: 'density' });
  });

  it('finds the built node once the scene is built, and says why not before', () => {
    const spec = parseRecipe('sphere r=0.5 at=(1,0,0) · box size=0.3 · smooth-union(sphere, box) k=0.3 · camera dist=3').spec;
    const s1 = spec.root.children[0].id;
    expect(liveParam([output()], null, spec, { at: 'camera', key: 'dist' })).toHaveProperty('missing');
    const r = applyScene([output()], spec, { nextId });
    const sceneId = r.nodes.find(x => x.type === 'sceneGroup')!.id;
    for (const path of [
      { at: 'camera', key: 'dist' }, { at: 'size', id: s1, key: 'r' }, { at: 'place', id: s1, what: 'at', part: 0 },
      { at: 'k', id: spec.root.children[2].id }, { at: 'look', key: 'shadows' }, { at: 'quality', key: 'jitter' },
    ] as const) {
      const hit = liveParam(r.nodes, sceneId, spec, path);
      expect(hit, JSON.stringify(path)).toHaveProperty('nodeId');
    }
    // The slider's lazy param reads the graph and the builder.
    useNodeGraphStore.setState({ nodes: r.nodes });
    sb().openWith(spec, { targetSceneId: sceneId });
    const p = lazyParamFor({ at: 'camera', key: 'dist' })();
    expect('nodeId' in p && r.nodes.find(x => x.id === p.nodeId)?.type).toBe('marchCamera');
  });

  it('the builder\'s sliders carry the Play menu', () => {
    const spec = parseRecipe('sphere · camera dist=3').spec;
    sb().openWith(spec, { tab: 'camera' });
    mount(<SceneBuilderModal />);
    expect(document.querySelectorAll('[data-builder-lazy-param]').length).toBeGreaterThanOrEqual(9);
  });
});

describe('Surprise me and reopening', () => {
  it('the same seed makes the same scene', async () => {
    sb().openWith(templateSpec('blobs'));
    await surpriseSceneAction(4242);
    const a = canonicalSpec(sb().spec);
    sb().openWith(templateSpec('orb'));
    await surpriseSceneAction(4242);
    expect(canonicalSpec(sb().spec)).toEqual(a);
    expect(compiles()).toBe(true);
  });

  it('a built scene reopens as built, and Done leaves it alone when nothing changed', async () => {
    const spec = templateSpec('pillars');
    const r = applyScene([output()], spec, { nextId });
    useNodeGraphStore.setState({ nodes: r.nodes });
    const sceneId = r.nodes.find(x => x.type === 'sceneGroup')!.id;
    expect(editSceneInBuilder(sceneId)).toBe(true);
    expect(canonicalSpec(sb().spec)).toEqual(canonicalSpec(spec));
    expect(sb().targetSceneId).toBe(sceneId);
    mount(<SceneBuilderModal />);
    expect($('[data-studio-title]')?.textContent).toBe('Your 3D scene');
    const before = useNodeGraphStore.getState().nodes;
    const { doneAction } = await import('../SceneBuilderModal');
    await act(async () => { await doneAction(); });
    expect(sb().open).toBe(false);
    expect(useNodeGraphStore.getState().nodes).toBe(before);
  });
});
