/**
 * Pictures in the Grid scene builder (docs/grid-builder.md, "Textures" and "Pictures in pieces"):
 * any shape can carry a picture, in one of four modes (in each shape, mask, matte colour, matte
 * piece); a picture as the pattern (brightness drives size, colour…); a picture mask; Build / Edit
 * this one keeping the picture's node; a video source.
 *
 * The sampling coordinates are checked on the CPU (cpuGlsl.ts): the picture read is replaced by its
 * own coordinates, so the colour a pixel gets *is* where it read the picture.
 */
import { motionDecls, motionLines, motionUniforms } from './motionArgs';
import { describe, expect, it } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import { compileGraph } from '../../compiler/graphCompiler';
import { CpuShader } from '../../lib/guidedConvert/cpuGlsl';
import { buildStandaloneGrid } from '../build';
import { applyGridScene, findGridBuild } from '../apply';
import { gridProgram, shapeArgs } from '../glsl';
import { gridTemplate } from '../templates';
import {
  MOTION_PATHS, PATTERN_TARGETS, PIC_MODES, SHAPE_KINDS, cellSize, picModeOf, shownCells, emptyGridScene, motionAt, newShape, placeCell, starterGridScene, texturesUsedGrid,
  type GridSceneSpec, type MotionPath, type PicMode,
} from '../spec';
import { textureNodeFor } from '../../builders/textures';
import { getNodeDefinition } from '../../nodes/definitions';
import type { GraphNode } from '../../types/nodeGraph';

const PIC = { name: 'pond', node: 'pic1', aspect: 1.5 };

function compiles(spec: GridSceneSpec) {
  const g = buildStandaloneGrid(spec);
  const r = compileGraph({ nodes: g.nodes });
  expect(r.success, String(r.errors)).toBe(true);
  expect(() => parser.parse(r.fragmentShader.replace(/^#version.*$/m, ''), { quiet: true })).not.toThrow();
  return { g, r };
}

function pictureCells(): GridSceneSpec {
  const s = emptyGridScene();
  s.textures = [{ ...PIC }];
  s.shapes = [newShape('A', { kind: 'circle' }), newShape('B', { kind: 'picture', tex: 'pond', spin: 0.2 })];
  for (let i = 0; i < 4; i++) { placeCell(s, i, 2, 'A'); placeCell(s, i, 4, 'B'); }
  return s;
}

describe('Grid scene: pictures', () => {
  it('a picture shape: the scene function reads the picture itself, through a sampler input', () => {
    const s = pictureCells();
    const prog = gridProgram(s);
    expect(prog.shapePics).toBe(true);
    expect(prog.textures).toEqual(['pond']);
    expect(prog.functions).toContain('sampler2D tx0');
    expect(prog.functions).toMatch(/if \(k < 9\.5\) return gs_heart/);
    const { g, r } = compiles(s);
    expect(g.warnings).toEqual([]);
    const grid = g.nodes.find(n => n.id === g.gridId)!;
    expect(grid.inputs.tx0).toMatchObject({ type: 'texture', connection: { nodeId: 'pic1', outputKey: 'texture' } });
    expect(Object.values(r.textureUniforms)).toEqual(['pic1']);
    // The sampler is passed by name: no local sampler variable.
    expect(r.fragmentShader).not.toMatch(/\bsampler2D tx0 =/);
  });

  it('a scene without pictures reads none', () => {
    const prog = gridProgram(starterGridScene());
    expect(prog.functions).not.toContain('sampler2D');
    expect(prog.functions).toContain('  return gs_heart');
  });

  it.each(PATTERN_TARGETS.map(t => [t] as const))('a picture pattern drives %s, and the fill', target => {
    const s = starterGridScene();
    s.textures = [{ ...PIC }];
    s.shapes.push(newShape('B', { kind: 'square' }));
    s.pattern = { ...s.pattern, kind: 'picture', tex: 'pond', target, amount: 0.8, fill: 'B' };
    const prog = gridProgram(s);
    // The wave is the brightness at each shape's own cell (floor(P)), read in the function.
    expect(prog.functions).toMatch(/\(gs_lum_\w+\(tx0, floor\(P\), 1\.5\) \* 2\.0 - 1\.0\)/);
    expect(prog.functions).not.toContain('gs_wave');
    compiles(s);
  });

  it('a picture mask: shapes only where their own cell is bright (or dark)', () => {
    const s = starterGridScene();
    s.textures = [{ ...PIC }];
    s.picMask = { tex: 'pond', cut: 0.3, invert: true };
    const prog = gridProgram(s);
    expect(prog.maskCut).toBe(true);
    expect(prog.functions).toMatch(/vis \*= 1\.0 - step\(pcut, gs_lum_\w+\(tx0, C, 1\.5\)\)/);
    const { g } = compiles(s);
    const grid = g.nodes.find(n => n.id === g.gridId)!;
    expect(grid.params.pcut).toBe(0.3);
  });

  it('the pattern and the mask share one sampler for the same picture', () => {
    const s = pictureCells();
    s.pattern = { ...s.pattern, kind: 'picture', tex: 'pond' };
    s.picMask = { tex: 'pond', cut: 0.5, invert: false };
    expect(gridProgram(s).textures).toEqual(['pond']);
    compiles(s);
    expect(texturesUsedGrid(s)).toEqual(['pond']);
  });

  it('warns about a picture the scene does not have', () => {
    const s = pictureCells();
    s.textures = [];
    expect(buildStandaloneGrid(s).warnings.join(' ')).toMatch(/“pond”/);
  });

  it('Build uses the picture\'s node; Edit this one reopens with it; a missing node is made', () => {
    let n = 0;
    const nextId = () => `node_${300 + n++}`;
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} };
    const res = applyGridScene([out, textureNodeFor(PIC, 'pic1')], pictureCells(), { nextId });
    expect(res.nodes.filter(x => x.type === 'textureInput')).toHaveLength(1);
    expect(compileGraph({ nodes: res.nodes }).success).toBe(true);
    const found = findGridBuild(res.nodes, res.sceneId)!;
    expect(found.meta.spec.textures).toEqual([PIC]);
    expect(found.meta.spec.shapes[1].tex).toBe('pond');
    const s = pictureCells();
    s.textures = [{ name: 'pond' }];
    const made = applyGridScene([out], s, { nextId });
    const tex = made.nodes.filter(x => x.type === 'textureInput');
    expect(tex).toHaveLength(1);
    expect(made.spec.textures![0].node).toBe(tex[0].id);
  });

  it('a video (or webcam) source: the pieces read it every frame, as any picture', () => {
    const def = getNodeDefinition('videoInput')!;
    const vid: GraphNode = {
      id: 'vid1', type: 'videoInput', position: { x: 0, y: 0 },
      inputs: Object.fromEntries(Object.entries(def.inputs).map(([k, v]) => [k, { type: v.type, label: v.label }])),
      outputs: Object.fromEntries(Object.entries(def.outputs).map(([k, v]) => [k, { type: v.type, label: v.label }])),
      params: { ...(def.defaultParams ?? {}) },
    };
    const out: GraphNode = { id: 'out', type: 'output', position: { x: 0, y: 0 }, inputs: { color: { type: 'vec3', label: 'Color' } }, outputs: {}, params: {} };
    const s = starterGridScene();
    s.textures = [{ name: 'cam', node: 'vid1', aspect: 16 / 9 }];
    s.shapes[0] = { ...s.shapes[0], tex: 'cam', picMode: 'piece' };
    const res = applyGridScene([out, vid], s, { nextId: (() => { let i = 0; return () => `n${i++}`; })() });
    const r = compileGraph({ nodes: res.nodes });
    expect(r.success, String(r.errors)).toBe(true);
    expect(r.fragmentShader).toMatch(/gs_scene_\w+\([^;]*u_\w*vid/);
  });
});

describe('Grid scene: picture modes on every shape kind', () => {
  it.each(SHAPE_KINDS.flatMap(k => PIC_MODES.map(m => [k, m] as const)))('%s carrying a picture as %s compiles', (kind, mode) => {
    const s = starterGridScene();
    s.textures = [{ ...PIC }];
    s.warps = [];
    s.shapes = [newShape('A', { kind, tex: 'pond', picMode: mode, motion: { path: 'circle', xy: [0.3, 0.3], speed: 0.5, lag: 0.1 } }), newShape('B', { kind: 'ring', tex: 'pond', picMode: mode })];
    s.pattern = { ...s.pattern, kind: 'ripple', fill: 'B', target: 'turn', amount: 0.6 };
    s.rules = [{ id: 'r1', on: true, when: { kind: 'sameCell', a: 'A', b: 'B' }, do: { kind: 'become', shape: 'B' } }];
    const { g } = compiles(s);
    expect(g.warnings).toEqual([]);
    const grid = g.nodes.find(n => n.id === g.gridId)!;
    expect(!!grid.inputs.suv).toBe(mode === 'mask');
  });
});

// ── Where each mode reads the picture, under motion ─────────────────────────

/** The scene function on the CPU, its picture reads replaced by their coordinates (colour = st). */
function cpuScene(spec: GridSceneSpec) {
  const p = gridProgram(spec);
  const fns = p.functions.replace(/return texture2D\(tx, st\);/, 'return vec4(st, 0.0, 1.0);')
    .replace(/vec4 c = textureLod\(tx, ([^;]*), 0\.0\);/, 'vec4 c = vec4($1, 0.0, 1.0);');
  const decl = [...spec.shapes.flatMap(s => { const a = shapeArgs(s.id); return [`uniform vec4 ${a.m};`, `uniform vec4 ${a.l};`, `uniform float ${a.e};`, `uniform vec3 ${a.c};`]; }), ...motionDecls(spec)]
  const src = ['uniform vec2 p_uv;', 'uniform float p_t;', 'uniform vec4 pt;', 'uniform float tx0;', 'uniform float pcut;', ...decl, fns,
    'void main() {', `  float gd[${p.data.length}];`, ...p.data.map((v, i) => `  gd[${i}] = ${v.toFixed(1)};`),
    ...motionLines(spec),
    '  vec4 hp = vec4(0.0);',
    `  vec4 g = ${p.name}(p_uv, p_t, pt, ${p.args.map(a => (a === 'suv' ? 'p_uv' : a)).join(', ')});`,
    '  gl_FragColor = vec4(g.xy, g.w, 0.0);', '}'].join('\n');
  const cpu = new CpuShader(src);
  const u: Record<string, number | number[]> = { pt: [spec.pattern.amount, spec.pattern.freq, spec.pattern.speed, spec.pattern.arms], pcut: spec.picMask?.cut ?? 0 };
  for (const s of spec.shapes) {
    const a = shapeArgs(s.id);
    u[a.m] = [s.motion.xy[0], s.motion.xy[1], s.motion.speed, s.motion.lag];
    u[a.l] = [s.size, s.turn * Math.PI / 180, s.spin, s.pulse];
    u[a.e] = s.outline; u[a.c] = [...s.color];
  }
  Object.assign(u, motionUniforms(spec));
  const cs = cellSize(spec);
  /** What the pixel at grid place g (cells, y down) gets at time t: [st.x, st.y, distance]. */
  return (g: [number, number], t: number) => {
    const uv = [(g[0] - spec.cols / 2) * cs, (spec.rows / 2 - g[1]) * cs];
    return cpu.run([0, 0], { resolution: [800, 800], time: t, uniforms: { ...u, p_uv: uv, p_t: t } })!.slice(0, 3);
  };
}

/** The picture over the 10 × 10 grid (aspect 1): grid place → st. */
const gst = (g: [number, number]) => [g[0] / 10, 1 - g[1] / 10];
const near = (a: number[], b: number[]) => { expect(a[0]).toBeCloseTo(b[0], 4); expect(a[1]).toBeCloseTo(b[1], 4); };

function moving(mode: PicMode, path: MotionPath, o: { spin?: number; pulse?: number } = {}): GridSceneSpec {
  const s = emptyGridScene();
  s.textures = [{ name: 'pond', node: 'pic1', aspect: 1 }];
  s.look.glow = false;
  s.shapes = [newShape('A', { kind: 'circle', size: 0.8, tex: 'pond', picMode: mode, spin: o.spin ?? 0, pulse: o.pulse ?? 0, motion: { path, xy: [0.6, 0.4], speed: 0.3, lag: 0.07 } })];
  placeCell(s, 4, 5, 'A');
  return s;
}

const PATHS = MOTION_PATHS.filter(p => p !== 'still');

describe('Grid scene: where each picture mode reads the picture', () => {
  it.each(PATHS.map(p => [p] as const))('%s: mask reads the screen, matte the home centre, piece home + the offset within the shape', path => {
    for (const t of [0.4, 1.7]) {
      const [px, py] = motionAt({ cols: 10, rows: 10 }, moving('mask', path).shapes[0].motion, 4, 5, t);
      const d: [number, number] = [0.13, -0.09];
      const at: [number, number] = [px + d[0], py + d[1]];
      // Mask: the picture stays put; the shape is a window onto it.
      const mask = cpuScene(moving('mask', path))(at, t);
      expect(mask[2]).toBeLessThan(0);
      near(mask, gst(at));
      // Matte colour: the colour at the home cell's centre, wherever the shape is.
      near(cpuScene(moving('matte', path))(at, t), gst([4.5, 5.5]));
      // Matte piece: the home's piece, offset as this point is from the shape's centre.
      near(cpuScene(moving('piece', path))(at, t), gst([4.5 + d[0], 5.5 + d[1]]));
    }
  });

  it('at rest, matte piece is the mask: the pieces make up the picture', () => {
    const s = moving('piece', 'updown');
    s.shapes[0].motion = { path: 'still', xy: [0, 0], speed: 0, lag: 0 };
    const m = moving('mask', 'updown');
    m.shapes[0].motion = s.shapes[0].motion;
    for (const at of [[4.3, 5.6], [4.7, 5.2]] as Array<[number, number]>) near(cpuScene(s)(at, 0.5), cpuScene(m)(at, 0.5));
  });

  it('piece turns and grows with the shape (spin, pulse); matte and mask do not care', () => {
    const s = moving('piece', 'updown', { spin: 0.25, pulse: 0.5 });
    s.shapes[0].motion = { path: 'still', xy: [0, 0], speed: 1, lag: 0 };
    // At t = 1: spun a quarter turn; the pulse (once a second, still) back at 1.
    const at: [number, number] = [4.5 + 0.2, 5.5];
    const got = cpuScene(s)(at, 1);
    // A quarter turn on: the point 0.2 right of the centre (y up) came from 0.2 along the turned axis.
    const back = [Math.cos(-Math.PI / 2) * 0.2, Math.sin(-Math.PI / 2) * 0.2];
    near(got, gst([4.5 + back[0], 5.5 - back[1]]));
    // Pulse: a quarter second in, the shape is 1.25 times its size, the piece too.
    const t = 0.25;
    const sp = moving('piece', 'updown', { pulse: 0.5 });
    sp.shapes[0].motion = { path: 'still', xy: [0, 0], speed: 1, lag: 0 };
    near(cpuScene(sp)([4.5 + 0.25, 5.5], t), gst([4.5 + 0.2, 5.5]));
  });

  it('the pattern\'s push and a rule carry the picture in matte, not in mask', () => {
    const s = moving('matte', 'updown');
    s.shapes[0].motion = { path: 'still', xy: [0, 0], speed: 0, lag: 0 };
    s.pattern = { kind: 'ripple', target: 'push', amount: 1, freq: 4, speed: 0.3, arms: 3, fill: null };
    const f = cpuScene(s);
    // Wherever the push has moved it, the shape keeps its home's colour.
    for (const at of [[4.5, 5.5], [4.35, 5.6], [4.65, 5.4]] as Array<[number, number]>) {
      const g = f(at, 0.8);
      if (g[2] < 0) near(g, gst([4.5, 5.5]));
    }
  });

  it('the fill: matte pieces from each empty cell\'s own home', () => {
    const s = emptyGridScene();
    s.textures = [{ name: 'pond', node: 'pic1', aspect: 1 }];
    s.look.glow = false;
    s.shapes = [newShape('A', { kind: 'circle', size: 0.9, tex: 'pond', picMode: 'piece' })];
    s.pattern = { kind: 'ripple', target: 'turn', amount: 0, freq: 4, speed: 0, arms: 3, fill: 'A' };
    near(cpuScene(s)([7.6, 2.4], 0.3), gst([7.6, 2.4]));
    s.shapes[0].picMode = 'matte';
    near(cpuScene(s)([7.6, 2.4], 0.3), gst([7.5, 2.5]));
  });

  it('the template "A picture in pieces": one drawn cell repeated into every cell, each circle carrying its piece', () => {
    const s = gridTemplate('pieces');
    expect(shownCells(s).every(x => x === 'A')).toBe(true);
    expect(picModeOf(s.shapes[0])).toBe('piece');
    const { g } = compiles(s);
    expect(g.warnings).toEqual([]);
    const grid = g.nodes.find(n => n.id === g.gridId)!;
    expect(grid.inputs.tx0.connection?.outputKey).toBe('texture');
    expect(grid.params.periodX).toBe(1);
  });

  it('home and piece come out of the Grid scene node, in picture units', () => {
    const { g } = compiles(moving('piece', 'circle'));
    const grid = g.nodes.find(n => n.id === g.gridId)!;
    expect(Object.keys(grid.outputs)).toEqual(expect.arrayContaining(['home', 'piece', 'd']));
  });
});
