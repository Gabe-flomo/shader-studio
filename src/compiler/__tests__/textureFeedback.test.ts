/**
 * Feedback (texture) (nodes/definitions/textureFeedback.ts, compiler/feedbackExpand.ts): one node
 * that compiles into a real Pass with its own buffer.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import * as THREE from 'three';
import { compileGraph } from '../graphCompiler';
import type { CompilationResult, PassProgram } from '../types';
import type { GraphNode } from '../../types/nodeGraph';
import { n } from '../../store/graphBuilder';
import { findLoop, isFrameDelayWire, loopIfWired } from '../graphLoops';
import { expandFeedback, feedbackPrevId, feedbackStepId } from '../feedbackExpand';
import { paramBindingKey } from '../uniformPatcher';
import { getNodeDefinition } from '../../nodes/definitions';
import { TextureFeedbackNode, hueTurn } from '../../nodes/definitions/textureFeedback';
import { BUILTINS, compileFragment, drawPass, makeBoard, type Board, type Env, type Program } from './glslRun';
import { PassRunner, PassTargets } from '../../lib/passRunner';
import { buildTextureToolExamples, TEXTURE_TOOL_EXAMPLE_INDEX } from '../../store/textureToolExamples';

// glslRun knows the common built-ins; the hue drift and Read's turn use radians().
(BUILTINS as Record<string, unknown>).radians ??= (a: number | number[]) => (Array.isArray(a) ? a.map(x => x * Math.PI / 180) : a * Math.PI / 180);

const LIVE = ['tail', 'clean', 'tint', 'amount', 'zoom', 'turn', 'moveX', 'moveY', 'pivotX', 'pivotY', 'flowAmount', 'hueDrift'];

/** A colour drawn into a source Pass, a Feedback reading its Texture, the Output reading the Feedback. */
function graph(fbParams: Record<string, unknown> = {}, extra: GraphNode[] = [], out: [string, string] = ['fb', 'color']): GraphNode[] {
  return [
    n('colorPicker', 'paint', 0, 0, { color: [0.6, 0.3, 0.1] }),
    n('pass', 'src', 0, 0, { label: 'Source' }, { color: ['paint', 'rgb'] }),
    n('textureFeedback', 'fb', 0, 0, { label: 'Trail', ...fbParams }, { texture: ['src', 'texture'] }),
    ...extra,
    n('output', 'out', 0, 0, {}, { color: out }),
  ];
}

const compile = (nodes: GraphNode[]) => compileGraph({ nodes }) as CompilationResult;

describe('Feedback (texture): the node', () => {
  it('is in the library next to the texture tools, found by feedback, trails, echo, video feedback', () => {
    const def = getNodeDefinition('textureFeedback')!;
    expect(def.type).toBe(TextureFeedbackNode.type);
    expect(def.category).toBe('Texture tools');
    expect([def.label, ...(def.aliases ?? [])].map(a => a.toLowerCase())).toEqual(expect.arrayContaining(['feedback', 'trails', 'echo', 'video feedback']));
    expect(def.outputs.texture.type).toBe('texture');
    expect(Object.keys(def.inputs)).toEqual(expect.arrayContaining(['texture', 'uv', 'flow', 'fresh']));
  });

  it('every slider but the selects is live and offered as a socket', () => {
    const def = getNodeDefinition('textureFeedback')!;
    for (const k of LIVE) {
      expect(def.paramDefs![k], k).toBeDefined();
      expect(def.paramDefs![k].compileTime, k).toBeFalsy();
      expect(def.inputs[k], k).toBeDefined();
    }
  });

  it('hue drift turns a colour round the grey axis (grey stays grey; a full turn comes back)', () => {
    expect(hueTurn([0.5, 0.5, 0.5], 77).map(v => +v.toFixed(6) + 0)).toEqual([0.5, 0.5, 0.5]);
    expect(hueTurn([1, 0, 0], 360).map(v => +v.toFixed(6) + 0)).toEqual([1, 0, 0]);
    const g = hueTurn([1, 0, 0], 120).map(v => +v.toFixed(4) + 0);
    expect(g).toEqual([0, 1, 0]);
  });
});

describe('Feedback (texture): it compiles into a Pass', () => {
  it('opens into a step and a Pass with the node\'s id that reads its own Previous', () => {
    const { nodes, bindAs } = expandFeedback(graph());
    const pass = nodes.find(x => x.id === 'fb')!;
    expect(pass.type).toBe('pass');
    expect(pass.inputs.color.connection).toEqual({ nodeId: feedbackStepId('fb'), outputKey: 'color' });
    const step = nodes.find(x => x.id === feedbackStepId('fb'))!;
    expect(step.inputs.prev.connection).toEqual({ nodeId: 'fb', outputKey: 'previous' });
    expect(step.inputs.texture.connection).toEqual({ nodeId: 'src', outputKey: 'texture' });
    expect(bindAs.get(step.id)).toBe('fb');
    // No Feedback node left.
    expect(nodes.some(x => x.type === 'textureFeedback')).toBe(false);
  });

  it('a graph with one compiles to a buffer Pass that keeps its Previous, and the picture reads it', () => {
    const r = compile(graph());
    expect(r.errors).toBeUndefined();
    expect(r.success).toBe(true);
    const fb = r.passes!.find(p => p.nodeId === 'fb')!;
    expect(fb).toBeDefined();
    expect(fb.previous).toBe(true);
    expect(fb.live).toBe(true);
    expect(fb.format).toBe('half');
    expect(fb.readsPrevious).toContain(fb.slug);
    const src = r.passes!.find(p => p.nodeId === 'src')!;
    expect(fb.reads).toContain(src.slug);
    // Read's drift and Fade's decay, both from their own generators.
    expect(fb.fragmentShader).toContain(`u_passprev_${fb.slug}`);
    expect(fb.fragmentShader).toContain('exp(-4.605170186');
    expect(fb.fragmentShader).toContain('radians(');
    expect(r.fragmentShader).toContain(`u_pass_${fb.slug}`);
  });

  it('takes any texture: its buffer\'s program reads the source wired in', () => {
    const sources: Array<[string, GraphNode[], [string, string], RegExp]> = [
      ['pass', [n('colorPicker', 'c', 0, 0), n('pass', 'src', 0, 0, {}, { color: ['c', 'rgb'] })], ['src', 'texture'], /texture2D\(u_pass_\w+,/],
      ['pass previous', [n('colorPicker', 'c', 0, 0), n('pass', 'src', 0, 0, {}, { color: ['c', 'rgb'] })], ['src', 'previous'], /texture2D\(u_passprev_\w+,/],
      ['texture input', [n('textureInput', 'src', 0, 0)], ['src', 'texture'], /texture2D\(u_tex_\w+,/],
      ['video', [n('videoInput', 'src', 0, 0)], ['src', 'texture'], /texture2D\(u_vid_\w+,/],
      ['baked', [n('baked', 'src', 0, 0)], ['src', 'texture'], /texture2D\(u_vid_\w+,/],
    ];
    for (const [name, nodes, tex, sampler] of sources) {
      const r = compile([...nodes, n('textureFeedback', 'fb', 0, 0, {}, { texture: tex }), n('output', 'out', 0, 0, {}, { color: ['fb', 'color'] })]);
      expect(r.errors, name).toBeUndefined();
      expect(r.passes!.find(p => p.nodeId === 'fb')!.fragmentShader, name).toMatch(sampler);
    }
  });

  it('every mode compiles (each Blend, Resolution and Edges)', () => {
    const def = getNodeDefinition('textureFeedback')!;
    for (const [k, pd] of Object.entries(def.paramDefs!)) {
      if (pd.type !== 'select') continue;
      for (const o of pd.options ?? []) expect(compile(graph({ [k]: o.value })).errors, `${k} ${o.value}`).toBeUndefined();
    }
  });

  it('takes Resolution and Edges from the node', () => {
    const r = compile(graph({ scale: '0.5', wrap: 'mirror' }));
    const fb = r.passes!.find(p => p.nodeId === 'fb')!;
    expect(fb.scale).toBe(0.5);
    expect(fb.wrap).toBe('mirror');
  });

  it('its Texture output feeds another texture node, and two Feedbacks chain', () => {
    const r = compile(graph({}, [
      n('textureFeedback', 'fb2', 0, 0, { label: 'Second' }, { texture: ['fb', 'texture'] }),
      n('textureLevels', 'lv', 0, 0, { gain: 2 }, { texture: ['fb2', 'texture'] }),
    ], ['lv', 'color']));
    expect(r.errors).toBeUndefined();
    const a = r.passes!.find(p => p.nodeId === 'fb')!, b = r.passes!.find(p => p.nodeId === 'fb2')!;
    expect(b.reads).toContain(a.slug);
    expect(a.slug).not.toBe(b.slug);
  });

  it('every blend compiles (add, over, max, screen)', () => {
    for (const blend of ['add', 'over', 'max', 'screen']) {
      const r = compile(graph({ blend }));
      expect(r.errors, blend).toBeUndefined();
    }
    expect(compile(graph({ blend: 'screen' })).passes!.find(p => p.nodeId === 'fb')!.fragmentShader).toContain('(1.0 - (1.0 - clamp(');
  });

  it('a Fresh colour wired replaces the texture\'s colour; UV and Flow reach the step', () => {
    const r = compile([
      n('uv', 'uv', 0, 0),
      n('colorPicker', 'paint', 0, 0, { color: [0.2, 0.9, 0.4] }),
      n('makeVec2', 'wind', 0, 0, { x: 0.01, y: 0 }),
      n('textureFeedback', 'fb', 0, 0, {}, { fresh: ['paint', 'rgb'], uv: ['uv', 'uv'], flow: ['wind', 'xy'] }),
      n('output', 'out', 0, 0, {}, { color: ['fb', 'color'] }),
    ]);
    expect(r.errors).toBeUndefined();
    const fs = r.passes!.find(p => p.nodeId === 'fb')!.fragmentShader;
    expect(fs).toMatch(/_src = vec4\(/);
  });
});

describe('Feedback (texture): sliders are live uniforms', () => {
  it('each live slider is a uniform bound to the Feedback node itself', () => {
    const r = compile(graph({ zoom: 1.02, turn: 3, tail: 2, hueDrift: 30 }));
    for (const k of LIVE) {
      const u = r.paramBindings[paramBindingKey('fb', k)];
      expect(u, k).toBeTruthy();
      expect(r.passes!.find(p => p.nodeId === 'fb')!.fragmentShader, k).toContain(u);
    }
    expect(r.paramUniforms[r.paramBindings[paramBindingKey('fb', 'zoom')]]).toBe(1.02);
    expect(r.paramUniforms[r.paramBindings[paramBindingKey('fb', 'turn')]]).toBe(3);
  });

  it('moving a slider changes no shader text (no recompile)', () => {
    const a = compile(graph({ zoom: 1, turn: 0, tail: 1.5, tint: [1, 1, 1], hueDrift: 0, moveX: 0, amount: 1 }));
    const b = compile(graph({ zoom: 1.05, turn: 12, tail: 6, tint: [0.2, 0.5, 1], hueDrift: 90, moveX: 4, amount: 0.3 }));
    expect(b.fragmentShader).toBe(a.fragmentShader);
    expect(b.passes!.map(p => p.fragmentShader)).toEqual(a.passes!.map(p => p.fragmentShader));
  });
});

describe('Feedback (texture): the loop check treats it as a frame delay', () => {
  const loopNodes = () => graph({}, [
    n('textureFlow', 'curl', 0, 0, { direction: 'along' }, { texture: ['fb', 'texture'] }),
    n('textureLevels', 'lv', 0, 0, {}, { color: ['fb', 'color'] }),
  ]).map(x => (x.id === 'fb' ? { ...x, inputs: { ...x.inputs, flow: { type: 'vec2' as const, label: 'Flow', connection: { nodeId: 'curl', outputKey: 'flow' } } } } : x));

  it('a wire out of a Feedback is a frame-delay wire; a loop through it is not a loop', () => {
    const nodes = loopNodes();
    const byId = new Map(nodes.map(x => [x.id, x]));
    expect(isFrameDelayWire({ nodeId: 'fb', outputKey: 'texture' }, byId)).toBe(true);
    expect(findLoop(nodes)).toBeNull();
    // Wiring the Levels (which reads the Feedback) back into the Feedback's Fresh is allowed.
    expect(loopIfWired(nodes, 'lv', 'color', 'fb', 'fresh')).toBeNull();
    // Even straight into itself.
    expect(loopIfWired(nodes, 'fb', 'texture', 'fb', 'texture')).toBeNull();
  });

  it('control: the same loop through an ordinary node is refused', () => {
    const nodes = [
      n('textureLevels', 'a', 0, 0, {}),
      n('textureLevels', 'b', 0, 0, {}, { color: ['a', 'color'] }),
      n('output', 'out', 0, 0, {}, { color: ['b', 'color'] }),
    ];
    expect(loopIfWired(nodes, 'b', 'color', 'a', 'color')).not.toBeNull();
  });

  it('a loop back into it compiles: those reads take the buffer a frame ago', () => {
    const r = compile(loopNodes());
    expect(r.errors).toBeUndefined();
    expect(r.loop).toBeUndefined();
    const fb = r.passes!.find(p => p.nodeId === 'fb')!;
    // The flow inside the step reads the buffer's Previous, never the texture it is drawing.
    expect(fb.fragmentShader).not.toContain(`texture2D(u_pass_${fb.slug},`);
    expect(fb.reads).not.toContain(fb.slug);
    expect(fb.readsPrevious).toContain(fb.slug);
  });

  it('the Color of a Feedback fed back in is read from the buffer a frame ago', () => {
    const nodes = graph({}, [n('invert', 'inv', 0, 0, {}, { color: ['fb', 'color'] })])
      .map(x => (x.id === 'fb' ? { ...x, inputs: { ...x.inputs, fresh: { type: 'vec3' as const, label: 'Fresh', connection: { nodeId: 'inv', outputKey: 'color' } } } } : x));
    const { nodes: opened } = expandFeedback(nodes);
    expect(opened.find(x => x.id === 'inv')!.inputs.color.connection).toEqual({ nodeId: feedbackPrevId('fb'), outputKey: 'color' });
    expect(opened.find(x => x.id === feedbackPrevId('fb'))!.inputs.texture.connection).toEqual({ nodeId: 'fb', outputKey: 'previous' });
    const r = compile(nodes);
    expect(r.errors).toBeUndefined();
  });
});

// ── The buffer, pixel for pixel (the real GLSL on the CPU, through the app's PassRunner) ─────────

/** A three.js renderer stand-in that draws for real (as lib/__tests__/trueReset.test.ts). */
function cpuRenderer(uniforms: Record<string, THREE.IUniform>) {
  const boards = new Map<THREE.WebGLRenderTarget, Board>();
  const byTexture = new Map<THREE.Texture, THREE.WebGLRenderTarget>();
  const programs = new Map<string, Program>();
  let target: THREE.WebGLRenderTarget | null = null;
  const boardOf = (rt: THREE.WebGLRenderTarget) => {
    let b = boards.get(rt);
    if (!b || b.w !== rt.width || b.h !== rt.height) {
      b = makeBoard(rt.width, rt.height, rt.texture.wrapS === THREE.RepeatWrapping ? 'repeat' : 'clamp');
      boards.set(rt, b);
      for (const t of rt.textures) byTexture.set(t, rt);
    }
    return b;
  };
  const env = (): { values: Env; samplers: Record<string, Board> } => {
    const values: Env = {}, samplers: Record<string, Board> = {};
    for (const [k, u] of Object.entries(uniforms)) {
      const v = u.value as unknown;
      if (typeof v === 'number') values[k] = v;
      else if (v instanceof THREE.Vector2) values[k] = [v.x, v.y];
      else if (v instanceof THREE.Vector3) values[k] = [v.x, v.y, v.z];
      else if (Array.isArray(v)) values[k] = v as number[];
      else if (v instanceof THREE.Texture) { const rt = byTexture.get(v); if (rt) samplers[k] = boardOf(rt); }
    }
    return { values, samplers };
  };
  const renderer = {
    compileAsync: () => Promise.resolve(),
    getContext: () => ({ getProgramParameter: () => true, LINK_STATUS: 0, flush: () => {} }),
    properties: { get: () => ({}) },
    autoClear: true,
    getClearColor: (c: THREE.Color) => c.setRGB(0, 0, 0), getClearAlpha: () => 0, setClearColor: () => {},
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { target = t; if (t) boardOf(t); },
    clear: () => { if (target) boardOf(target).data.fill(0); },
    render: (scene: THREE.Scene) => {
      if (!target) return;
      const m = (scene.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
      let prog = programs.get(m.fragmentShader);
      if (!prog) { prog = compileFragment(m.fragmentShader); programs.set(m.fragmentShader, prog); }
      const out = boardOf(target);
      const { values, samplers } = env();
      out.data.set(drawPass(prog, out.w, out.h, out.wrap, samplers, values).data);
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, boardOf };
}

const PIC = { w: 12, h: 8 };

async function sim(nodes: GraphNode[], ids: string[]) {
  const r = compile(nodes);
  expect(r.errors).toBeUndefined();
  const passes = (r.passes ?? []).filter(p => p.live);
  const uniforms: Record<string, THREE.IUniform> = {
    u_time: { value: 0 }, u_frameDt: { value: 1 / 60 }, u_resolution: { value: new THREE.Vector2(PIC.w, PIC.h) },
    u_mouse: { value: new THREE.Vector2(-1000, -1000) }, u_mousebtn: { value: 0 },
  };
  for (const [k, v] of Object.entries(r.paramUniforms)) uniforms[k] = { value: Array.isArray(v) ? [...v] : v };
  const { renderer, boardOf } = cpuRenderer(uniforms);
  const runner = new PassRunner({ renderer, geometry: new THREE.PlaneGeometry(2, 2), camera: new THREE.Camera(), uniforms: () => uniforms, onReady: () => {}, onLinkFailed: () => {} });
  runner.update(passes as PassProgram[], 'void main() {}');
  await new Promise(res => setTimeout(res, 0));
  const targets = new PassTargets(renderer, true);
  const bySlug = new Map(passes.map(p => [p.nodeId, p.slug]));
  /** One frame: each named buffer's centre pixel, as the picture reads it. */
  const frame = (time: number) => {
    uniforms.u_time.value = time;
    runner.run(targets, PIC.w, PIC.h);
    return ids.map(id => {
      const slug = bySlug.get(id)!;
      const tex = uniforms[`u_pass_${slug}`].value as THREE.Texture;
      const t = targets.get(slug)!;
      const rt = [t.cur, t.prev!].find(x => x.textures.includes(tex))!;
      const b = boardOf(rt);
      const k = ((b.h >> 1) * b.w + (b.w >> 1)) * 4;
      return Array.from(b.data.slice(k, k + 4)).map(v => Math.round(v * 1e5) / 1e5);
    });
  };
  return { frame, targets, r };
}

describe('Feedback (texture): the buffer', () => {
  it('builds up: Add keeps adding the fresh picture over the faded trail', async () => {
    const s = await sim(graph({ tail: 1, clean: 0, blend: 'add' }), ['fb']);
    const f0 = s.frame(0)[0], f1 = s.frame(1 / 60)[0], f2 = s.frame(2 / 60)[0];
    expect(f0[0]).toBeCloseTo(0.6, 4);
    // Each frame: old × exp(ln 0.01 × dt / tail) + fresh.
    const d = Math.exp(-4.605170186 / 60);
    expect(f1[0]).toBeCloseTo(0.6 * d + 0.6, 4);
    expect(f2[0]).toBeCloseTo((0.6 * d + 0.6) * d + 0.6, 4);
  });

  it('two Feedback nodes keep two buffers', async () => {
    const two = graph({ tail: 0.5, clean: 0 }, [
      n('textureFeedback', 'fb2', 0, 0, { label: 'Trail', tail: 4, clean: 0 }, { texture: ['src', 'texture'] }),
      n('addColor', 'sum', 0, 0, {}, { a: ['fb', 'color'], b: ['fb2', 'color'] }),
    ], ['sum', 'result']);
    const s = await sim(two, ['fb', 'fb2']);
    expect(s.r.passes!.filter(p => p.nodeId === 'fb' || p.nodeId === 'fb2').map(p => p.slug).length).toBe(2);
    expect(new Set(s.r.passes!.map(p => p.slug)).size).toBe(s.r.passes!.length);
    let last: number[][] = [];
    for (let k = 0; k < 5; k++) last = s.frame(k / 60);
    expect(last[0]).not.toEqual(last[1]);
    // Each matches the same Feedback alone.
    const a = await sim(graph({ tail: 0.5, clean: 0 }), ['fb']);
    const b = await sim(graph({ tail: 4, clean: 0 }), ['fb']);
    let la: number[][] = [], lb: number[][] = [];
    for (let k = 0; k < 5; k++) { la = a.frame(k / 60); lb = b.frame(k / 60); }
    expect(last[0]).toEqual(la[0]);
    expect(last[1]).toEqual(lb[0]);
  });

  it('a true reset clears it: the first frames after ↺ are a fresh open\'s', async () => {
    const FIRST = [0, 1 / 60, 2 / 60];
    const fresh = await sim(graph({ tail: 3, clean: 0 }), ['fb']);
    const want = FIRST.map(t => fresh.frame(t));
    const s = await sim(graph({ tail: 3, clean: 0 }), ['fb']);
    for (let k = 0; k < 10; k++) s.frame(k / 60);
    // Control: without the reset, the trail has built up.
    expect(s.frame(0)).not.toEqual(want[0]);
    // ↺: what ShaderCanvas's reset does to every Pass (lib/runtimeReset.ts).
    s.targets.clearPrevious();
    expect(FIRST.map(t => s.frame(t))).toEqual(want);
  });
});

describe('Feedback (texture): the examples', () => {
  const ex = buildTextureToolExamples();
  for (const key of ['ttFeedbackTunnel', 'ttFeedbackFlow', 'ttFeedbackCamera']) {
    it(`${key} compiles, with a Feedback buffer, every node noted`, () => {
      expect(TEXTURE_TOOL_EXAMPLE_INDEX[key]).toBeDefined();
      const g = ex[key];
      const r = compile(g.nodes);
      expect(r.errors).toBeUndefined();
      expect(r.success).toBe(true);
      const fbIds = g.nodes.filter(x => x.type === 'textureFeedback').map(x => x.id);
      expect(fbIds.length).toBeGreaterThan(0);
      for (const id of fbIds) expect(r.passes!.find(p => p.nodeId === id)?.live).toBe(true);
      for (const node of g.nodes) expect(typeof node.params.__comment === 'string' && node.params.__comment.length > 10, node.id).toBe(true);
      // The built-in Ball action clip.
      expect(g.nodes.some(x => x.type === 'videoInput' && x.params.videoId === 'builtin:ball-action')).toBe(true);
      // Its Play controls aim at real params.
      for (const c of g.play!.controls) {
        const [id, key2] = c.target.split('::');
        expect(g.nodes.find(x => x.id === id)?.params[key2], c.target).toBeDefined();
      }
    });
  }
});
