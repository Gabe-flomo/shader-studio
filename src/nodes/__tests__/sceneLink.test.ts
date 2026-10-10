/**
 * A light linked to an object in a Scene Group (nodes/sceneLink.ts, docs/depth-node.md "Link to a scene object"):
 * the picker's list, the link's outputs and wires, the compiled position following the object (its slider's live
 * uniform, a time-driven chain copied into main(), a value wired from outside), its colour, several lights, unlink.
 */
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0, clear: () => {} };
});

import { compileGraph } from '../../compiler/graphCompiler';
import { n } from '../../store/graphBuilder';
import type { GraphNode, SubgraphData } from '../../types/nodeGraph';
import {
  addLinkedLight, lightLinkOf, linkableScenes, linkColourSource, linkLight, linkTargets, staticCentre, translateChain, unlinkLight, unlinkedTargets,
} from '../sceneLink';

/** Scene Pos → Move A (1, 2, 3) → Sphere A; Scene Pos → Move B (−2, 0, 1) → Box B; union → Scene Output. */
function scene(opts: { timeDriven?: boolean } = {}): GraphNode {
  const inner: GraphNode[] = [
    n('scenePos', 'sp', 0, 0),
    n('translate3D', 'moveA', 400, 0, { tx: 1, ty: 2, tz: 3, _sbRole: 'a:at', __comment: 'Moves ‘Ball’ to (1, 2, 3).' }, { pos: ['sp', 'pos'] }),
    n('sphereSDF3D', 'ballA', 800, 0, { radius: 0.4, _sbRole: 'a:shape' }, { pos: ['moveA', 'pos'] }),
    n('translate3D', 'moveB', 400, 300, { tx: -2, ty: 0, tz: 1 }, { pos: ['sp', 'pos'] }),
    n('boxSDF3D', 'boxB', 800, 300, {}, { pos: ['moveB', 'pos'] }),
    n('sdfUnion', 'u', 1200, 0, {}, { a: ['ballA', 'dist'], b: ['boxB', 'dist'] }),
    n('sceneOutput', 'so', 1600, 0, {}, { dist: ['u', 'distance'] }),
  ];
  if (opts.timeDriven) {
    inner.push(n('time', 'tm', 0, 600), n('sin', 'wave', 400, 600, {}, { input: ['tm', 'time'] }));
    const a = inner.find(x => x.id === 'moveA')!;
    a.inputs.ty = { ...a.inputs.ty, connection: { nodeId: 'wave', outputKey: 'output' } };
  }
  const sg: SubgraphData = { nodes: inner, inputPorts: [], outputPorts: [] };
  return n('sceneGroup', 'scene', 0, 0, { subgraph: sg });
}

/** Camera, scene, loop, a picture with depth, a Depth Light, Output. */
function graph(opts: { timeDriven?: boolean; colour?: boolean } = {}): GraphNode[] {
  return [
    n('marchCamera', 'cam', 0, 0),
    scene(opts),
    n('marchLoopGroup', 'loop', 0, 0, { subgraph: { nodes: [n('marchLoopInputs', 'mi', 0, 0), n('marchLoopOutput', 'mo', 0, 0, {}, { pos: ['mi', 'marchPos'] })], inputPorts: [], outputPorts: [] } }, { ro: ['cam', 'ro'], rd: ['cam', 'rd'], scene: ['scene', 'scene'] }),
    ...(opts.colour ? [n('colorPicker', 'ballColour', 0, 0, { color: [0.9, 0.2, 0.1], _sbRole: 'a:color' })] : []),
    n('textureInput', 'pic', 0, 0),
    n('depth', 'dep', 0, 0, {}, { texture: ['pic', 'texture'] }),
    n('depthLight', 'lit', 0, 0, {}, { picture: ['pic', 'color'], nearness: ['dep', 'depth'], ro: ['cam', 'ro'], rd: ['cam', 'rd'] }),
    n('output', 'out', 0, 0, {}, { color: ['lit', 'color'] }),
  ];
}

const compile = (nodes: GraphNode[]) => {
  const r = compileGraph({ nodes });
  expect(r.errors ?? []).toEqual([]);
  expect(r.success).toBe(true);
  return r;
};
const mainOf = (fs: string) => fs.slice(fs.indexOf('void main()'));

describe('link targets', () => {
  it('lists the Translates and shapes in a Scene Group, by name, with where they sit', () => {
    const s = scene();
    expect(linkTargets(s).map(t => `${t.kind}:${t.id}:${t.label}`)).toEqual([
      'translate:moveA:Ball (Translate 3D)', 'shape:ballA:Sphere SDF 3D', 'translate:moveB:Translate 3D (Box SDF 3D)', 'shape:boxB:Box SDF 3D',
    ]);
    expect(translateChain((s.params.subgraph as SubgraphData).nodes, 'ballA')).toEqual(['moveA']);
    expect(staticCentre(s, 'ballA')).toEqual([1, 2, 3]);
    expect(staticCentre(s, 'moveB')).toEqual([-2, 0, 1]);
    // An override on the group's face (a pinned setting) counts
    expect(staticCentre({ ...s, params: { ...s.params, 'moveB::tx': 5 } }, 'boxB')).toEqual([5, 0, 1]);
  });

  it('offers the scenes the graph draws first', () => {
    const nodes = [...graph(), n('sceneGroup', 'spare', 0, 0, { subgraph: { nodes: [], inputPorts: [], outputPorts: [] } })];
    expect(linkableScenes(nodes).map(s => s.id)).toEqual(['scene', 'spare']);
  });
});

describe('linking a Depth Light', () => {
  it('adds the object\'s position output to the Scene Group and wires Light position from it', () => {
    const nodes = linkLight(graph(), 'lit', 'scene', 'ballA')!;
    const sc = nodes.find(x => x.id === 'scene')!;
    const lit = nodes.find(x => x.id === 'lit')!;
    expect(sc.outputs.at_ballA).toMatchObject({ type: 'vec3' });
    expect(sc.outputs.col_ballA).toBeUndefined(); // no colour to follow
    expect(lit.inputs.lightPos.connection).toEqual({ nodeId: 'scene', outputKey: 'at_ballA' });
    expect(lit.inputs.lightColor.connection).toBeUndefined();
    expect(lightLinkOf(lit)).toEqual({ scene: 'scene', object: 'ballA', label: 'Sphere SDF 3D' });
  });

  it('follows the object: its Translate\'s live slider uniforms reach the light in main()', () => {
    const r = compile(linkLight(graph(), 'lit', 'scene', 'ballA')!);
    const main = mainOf(r.fragmentShader);
    const ux = r.paramBindings['moveA::tx'], uy = r.paramBindings['moveA::ty'], uz = r.paramBindings['moveA::tz'];
    expect(ux && uy && uz).toBeTruthy();
    // The light's distance to the light position reads the Translate's own uniforms: drag (or Play) moves the light.
    expect(main).toContain(`vec3(${ux}, ${uy}, ${uz})`);
    expect(r.paramUniforms[ux]).toBe(1);
  });

  it('follows a time-driven object: the chain inside the group (Time → Sin → Y) is copied into main()', () => {
    const r = compile(linkLight(graph({ timeDriven: true }), 'lit', 'scene', 'moveA')!);
    const main = mainOf(r.fragmentShader);
    expect(main).toMatch(/copied from the Scene Group for a link/);
    expect(main).toMatch(/sin\(/);
    expect(main).not.toMatch(/(?<![\w.])p(?![\w])\s*[-+*]/); // nothing reads the scene's point
  });

  it('a value wired into the group\'s face from outside reaches the light too', () => {
    const nodes = linkLight(graph(), 'lit', 'scene', 'ballA')!;
    const sc = nodes.find(x => x.id === 'scene')!;
    nodes.push(n('constant', 'k', 0, 0, { value: 4 }));
    sc.inputs.ps_moveA_tz = { type: 'float', label: 'Z', connection: { nodeId: 'k', outputKey: 'value' } };
    const r = compile(nodes);
    expect(mainOf(r.fragmentShader)).toMatch(/vec3\(u_p_\w+_tx, u_p_\w+_ty, \w+\)/);
  });

  it('takes the object\'s colour when it has one (a Scene Builder swatch), as its live uniform', () => {
    const base = graph({ colour: true });
    expect(linkColourSource(base, base.find(x => x.id === 'scene')!, 'ballA')).toMatchObject({ nodeId: 'ballColour', key: 'color' });
    const nodes = linkLight(base, 'lit', 'scene', 'ballA')!;
    expect(nodes.find(x => x.id === 'lit')!.inputs.lightColor.connection).toEqual({ nodeId: 'scene', outputKey: 'col_ballA' });
    const r = compile(nodes);
    const u = r.paramBindings['ballColour::color'];
    expect(u).toBeTruthy();
    expect(r.fragmentShader).not.toContain('__LINKV3__');
    expect(mainOf(r.fragmentShader)).toContain(u);
  });

  it('or the scene\'s glow tint (a Glow to Color after the loop that draws it)', () => {
    const base = [...graph(), n('glowToColor', 'glow', 0, 0, { tint: [0.2, 0.6, 1] }, { glow: ['loop', 'color'] })];
    // (wired from the loop: what matters is that it reads this scene's loop)
    expect(linkColourSource(base, base.find(x => x.id === 'scene')!, 'boxB')).toMatchObject({ nodeId: 'glow', key: 'tint' });
  });

  it('a graph without links compiles exactly as before', () => {
    const a = compileGraph({ nodes: graph() }).fragmentShader;
    expect(a).not.toMatch(/at_|copied from the Scene Group/);
  });
});

describe('several lights', () => {
  it('"Add a light" chains a second Depth Light linked to another object; the Output reads it', () => {
    const one = linkLight(graph(), 'lit', 'scene', 'ballA')!;
    expect(unlinkedTargets(one, one.find(x => x.id === 'scene')!).map(t => t.id)).toEqual(['moveA', 'moveB', 'boxB']);
    const added = addLinkedLight(one, 'lit', 'scene', 'boxB', 'lit2')!;
    const lit2 = added.nodes.find(x => x.id === 'lit2')!;
    expect(lit2.type).toBe('depthLight');
    expect(lit2.inputs.picture.connection).toEqual({ nodeId: 'lit', outputKey: 'color' });
    expect(lit2.inputs.nearness.connection).toEqual({ nodeId: 'dep', outputKey: 'depth' });
    expect(lit2.inputs.ro.connection).toEqual({ nodeId: 'cam', outputKey: 'ro' });
    expect(lit2.inputs.lightPos.connection).toEqual({ nodeId: 'scene', outputKey: 'at_boxB' });
    expect(added.nodes.find(x => x.id === 'out')!.inputs.color.connection).toEqual({ nodeId: 'lit2', outputKey: 'color' });
    const sc = added.nodes.find(x => x.id === 'scene')!;
    expect(Object.keys(sc.outputs).filter(k => k.startsWith('at_')).sort()).toEqual(['at_ballA', 'at_boxB']);
    const r = compile(added.nodes);
    const main = mainOf(r.fragmentShader);
    expect(main).toContain(`vec3(${r.paramBindings['moveA::tx']}, ${r.paramBindings['moveA::ty']}, ${r.paramBindings['moveA::tz']})`);
    expect(main).toContain(`vec3(${r.paramBindings['moveB::tx']}, ${r.paramBindings['moveB::ty']}, ${r.paramBindings['moveB::tz']})`);
  });

  it('unlinking takes the wires off and the outputs nothing reads any more', () => {
    const one = linkLight(graph({ colour: true }), 'lit', 'scene', 'ballA')!;
    const back = unlinkLight(one, 'lit');
    const lit = back.find(x => x.id === 'lit')!;
    expect(lit.inputs.lightPos.connection).toBeUndefined();
    expect(lit.inputs.lightColor.connection).toBeUndefined();
    expect(lightLinkOf(lit)).toBeNull();
    expect(Object.keys(back.find(x => x.id === 'scene')!.outputs)).toEqual(['scene']);
    compile(back);
  });
});
